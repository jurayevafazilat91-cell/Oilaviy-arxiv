import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { after, beforeEach, describe, test } from "node:test";
import exifr from "exifr";
import sharp from "sharp";
import { getMediaDetail, getMediaForFile, listMedia } from "../src/lib/media/queries";
import { exifToDate, parseProbe, playbackPlan } from "../src/lib/media/process";
import { purgeMedia } from "../src/lib/media/ingest";
import { sniff } from "../src/lib/media/sniff";
import { cancelUpload, CHUNK_SIZE, completeUpload, contiguousBytes, createUpload, getUpload, uploadPath, writeChunk, type UploadRow } from "../src/lib/media/uploads";
import { mediaKey, mediaPrefix, storage } from "../src/lib/storage";
import { drainJobs, jpegFixture, makeUser, read, resetDb, sql, videoFixture } from "./helpers";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function uploadBytes(user: Awaited<ReturnType<typeof makeUser>>, bytes: Buffer, fileName: string, chunk = 64 * 1024) {
  let up: UploadRow = await createUpload(user, { fileName, size: bytes.length, clientKey: `${fileName}:${bytes.length}:${Math.random()}`, albumId: null });
  for (let off = 0; off < bytes.length; off += chunk) up = await writeChunk(up, off, bytes.subarray(off, off + chunk));
  up = await completeUpload(up);
  await drainJobs();
  return getUpload(user, up.id);
}

beforeEach(resetDb);
after(() => sql.end());

describe("direct (bucket) uploads", () => {
  test("only consecutive full-size parts from part 1 count as received", () => {
    const MB8 = CHUNK_SIZE;
    const size = MB8 * 2 + 100;
    const p = (part: number, s: number) => ({ part, size: s, etag: `"${part}"` });
    assert.equal(contiguousBytes([], size), 0);
    assert.equal(contiguousBytes([p(1, MB8), p(2, MB8), p(3, 100)], size), size, "complete");
    assert.equal(contiguousBytes([p(1, MB8), p(3, 100)], size), MB8, "gap stops the count");
    assert.equal(contiguousBytes([p(1, MB8), p(2, MB8 - 1), p(3, 100)], size), MB8, "short middle part is not accepted");
    assert.equal(contiguousBytes([p(1, MB8), p(2, MB8), p(3, 200)], size), MB8 * 2, "oversized last part is not accepted");
    assert.equal(contiguousBytes([p(1, 500)], 500), 500, "single small file");
  });
});

describe("file type detection", () => {
  test("recognises supported formats by content and rejects others", async () => {
    assert.equal(sniff(read(await jpegFixture()))?.mime, "image/jpeg");
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
    assert.equal(sniff(png)?.mime, "image/png");
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer();
    assert.equal(sniff(webp)?.mime, "image/webp");
    assert.equal(sniff(read(videoFixture("h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"])))?.mime, "video/mp4");
    assert.equal(sniff(read(videoFixture("h264.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov"])))?.mime, "video/quicktime");
    assert.equal(sniff(Buffer.from("MZ\x90\x00 this is a windows exe......")), null);
    assert.equal(sniff(Buffer.from("<html><script>alert(1)</script>")), null);
  });

  test("EXIF dates without zone use the family zone; ffmpeg probe parsing", () => {
    assert.equal(exifToDate("2019:07:14 14:03:22", undefined)?.toISOString(), "2019-07-14T09:03:22.000Z");
    assert.equal(exifToDate("2019:07:14 14:03:22", "+02:00")?.toISOString(), "2019-07-14T12:03:22.000Z");
    assert.equal(exifToDate("0000:00:00 00:00:00", undefined), null);
    const p = parseProbe(`  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc), 3840x2160, 30 fps
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo
      creation_time   : 2021-05-01T10:00:00.000000Z`);
    assert.deepEqual([p.durationMs, p.codec, p.pixFmt, p.audio, p.width, p.height], [62500, "hevc", "yuv420p10le", "aac", 2160, 3840]);
    assert.equal(p.createdAt?.toISOString(), "2021-05-01T10:00:00.000Z");
    assert.equal(playbackPlan(p, "video/quicktime"), "transcode");
    assert.equal(playbackPlan({ ...p, codec: "h264", pixFmt: "yuv420p" }, "video/quicktime"), "remux");
    assert.equal(playbackPlan({ ...p, codec: "h264", pixFmt: "yuv420p" }, "video/mp4"), "none");
  });
});

describe("photo upload → storage → authorized access", () => {
  test("chunked upload persists original byte-for-byte, derivatives without GPS, EXIF date kept", async () => {
    const owner = await makeUser("owner");
    const bytes = read(await jpegFixture());
    assert.ok((await exifr.gps(bytes))?.latitude, "fixture must contain GPS");

    const up = await uploadBytes(owner, bytes, "oila.jpg");
    assert.equal(up.status, "done");
    const media = await getMediaForFile(owner, up.mediaId!);
    assert.ok(media);
    assert.deepEqual([...media.variants].sort(), ["preview", "thumb"]);

    const original = await storage().get(mediaKey(owner.familyId, media.id, "original"));
    const stored = Buffer.from(await new Response(original!.body).arrayBuffer());
    assert.equal(hash(stored), hash(bytes), "original must be preserved exactly");

    const preview = await storage().get(mediaKey(owner.familyId, media.id, "preview"));
    const previewBuf = Buffer.from(await new Response(preview!.body).arrayBuffer());
    const meta = await sharp(previewBuf).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined, "derivatives must not carry EXIF/GPS");
    assert.ok(meta.width! <= 2048);

    const detail = await getMediaDetail(owner, media.id);
    assert.equal(detail?.takenAt, "2019-07-14T09:03:22.000Z");
    assert.equal(detail?.width, 1600);

    // "Reload": a fresh query lists it.
    const list = await listMedia(owner, {});
    assert.deepEqual(list.items.map((i) => i.id), [media.id]);
  });

  test("search treats every Uzbek apostrophe (' ’ ‘ ` ʼ ʻ) as the same letter", async () => {
    const owner = await makeUser("owner");
    const up = await uploadBytes(owner, read(await jpegFixture()), "oila.jpg");
    await sql`update media set title = 'Togʻda dam olish', ai_caption = ${"Ko'z rasmi"}, ai_tags = ${["gʼisht"]} where id = ${up.mediaId!}`;
    const found = async (f: Parameters<typeof listMedia>[1]) => (await listMedia(owner, f)).items.length;
    assert.equal(await found({ q: "tog'" }), 1, "ASCII apostrophe finds ʻ in the title");
    assert.equal(await found({ q: "tog’" }), 1, "typographic apostrophe too");
    assert.equal(await found({ keywords: ["koʻz"] }), 1, "AI keyword with ʻ finds ' in the caption");
    assert.equal(await found({ keywords: ["g'isht"] }), 1, "ʼ in a tag");
    assert.equal(await found({ q: "dengiz" }), 0);
  });

  test("another family cannot see, list or fetch the file; viewer in same family can", async () => {
    const owner = await makeUser("owner");
    const up = await uploadBytes(owner, read(await jpegFixture()), "a.jpg");
    const stranger = await makeUser("owner"); // separate family
    assert.equal(await getMediaForFile(stranger, up.mediaId!), null);
    assert.equal(await getMediaDetail(stranger, up.mediaId!), null);
    assert.equal((await listMedia(stranger, {})).items.length, 0);
    await assert.rejects(getUpload(stranger, up.id), /topilmadi/);
    const viewer = await makeUser("viewer", owner.familyId);
    assert.ok(await getMediaForFile(viewer, up.mediaId!));
  });

  test("retrying a chunk at the same offset is safe", async () => {
    const owner = await makeUser("owner");
    const bytes = read(await jpegFixture());
    let up = await createUpload(owner, { fileName: "r.jpg", size: bytes.length, clientKey: "r", albumId: null });
    const half = Math.floor(bytes.length / 2);
    up = await writeChunk(up, 0, bytes.subarray(0, half));
    up = await writeChunk(up, 0, bytes.subarray(0, half)); // network retry of the same chunk
    up = await writeChunk(up, half, bytes.subarray(half));
    await assert.rejects(writeChunk(up, bytes.length + 10, Buffer.from("x")), /tartibi|hajmi/);
    up = await completeUpload(up);
    await completeUpload(up); // double "complete" is harmless
    await drainJobs();
    const done = await getUpload(owner, up.id);
    assert.equal(done.status, "done");
    const stored = await storage().get(mediaKey(owner.familyId, done.mediaId!, "original"));
    assert.equal(hash(Buffer.from(await new Response(stored!.body).arrayBuffer())), hash(bytes));
  });

  test("resume: re-selecting the same file returns the unfinished upload", async () => {
    const owner = await makeUser("owner");
    const a = await createUpload(owner, { fileName: "v.jpg", size: 1000, clientKey: "same", albumId: null });
    const b = await createUpload(owner, { fileName: "v.jpg", size: 1000, clientKey: "same", albumId: null });
    assert.equal(a.id, b.id);
  });

  test("invalid content, wrong extension and oversize are rejected server-side", async () => {
    const owner = await makeUser("owner");
    const fake = Buffer.from("MZ" + "x".repeat(200)); // an .exe renamed to .jpg
    const up = await createUpload(owner, { fileName: "virus.jpg", size: fake.length, clientKey: "v", albumId: null });
    await assert.rejects(writeChunk(up, 0, fake), /rasm yoki video emas/);
    assert.equal((await getUpload(owner, up.id)).status, "failed");
    assert.equal(existsSync(await uploadPath(up.id)), false, "temp file removed");

    await assert.rejects(createUpload(owner, { fileName: "doc.pdf", size: 10, clientKey: "p", albumId: null }), /qoʻllab-quvvatlanmaydi/);
    await assert.rejects(createUpload(owner, { fileName: "big.jpg", size: 51 * 1024 * 1024, clientKey: "b", albumId: null }), /50 MB/);
    await assert.rejects(createUpload(owner, { fileName: "big.mp4", size: 2049 * 1024 * 1024, clientKey: "b2", albumId: null }), /2048 MB/);

    // A video renamed .jpg passes the extension check but is validated against the video limit by content.
    const mp4 = read(videoFixture("h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]));
    const disguised = await createUpload(owner, { fileName: "clip.jpg", size: mp4.length, clientKey: "d", albumId: null });
    const written = await writeChunk(disguised, 0, mp4.subarray(0, 4096));
    assert.equal(written.kind, "video");
  });

  test("cancellation stops the upload and cleans the temp file", async () => {
    const owner = await makeUser("owner");
    const bytes = read(await jpegFixture());
    let up = await createUpload(owner, { fileName: "c.jpg", size: bytes.length, clientKey: "c", albumId: null });
    up = await writeChunk(up, 0, bytes.subarray(0, 1000));
    await cancelUpload(up);
    assert.equal((await getUpload(owner, up.id)).status, "cancelled");
    assert.equal(existsSync(await uploadPath(up.id)), false);
    await assert.rejects(writeChunk(await getUpload(owner, up.id), 1000, bytes.subarray(1000, 2000)), /bekor/);
  });

  test("duplicates are detected by content; trashed duplicates are restored", async () => {
    const owner = await makeUser("owner");
    const bytes = read(await jpegFixture());
    const first = await uploadBytes(owner, bytes, "1.jpg");
    const second = await uploadBytes(owner, bytes, "2.jpg");
    assert.equal(second.status, "duplicate");
    assert.equal(second.mediaId, first.mediaId);
    assert.equal(Number((await sql`select count(*) from media`)[0].count), 1);

    await sql`update media set deleted_at = now() where id = ${first.mediaId}`;
    const third = await uploadBytes(owner, bytes, "3.jpg");
    assert.equal(third.status, "duplicate");
    const [row] = await sql`select deleted_at from media where id = ${first.mediaId}`;
    assert.equal(row.deletedAt, null, "re-uploading a trashed file restores it");
  });

  test("purge removes stored objects and the row", async () => {
    const owner = await makeUser("owner");
    const up = await uploadBytes(owner, read(await jpegFixture()), "p.jpg");
    await purgeMedia(up.mediaId!);
    assert.equal(await storage().size(mediaKey(owner.familyId, up.mediaId!, "original")), null);
    assert.equal(await storage().size(mediaPrefix(owner.familyId, up.mediaId!) + "thumb.webp"), null);
    assert.equal((await sql`select 1 from media where id = ${up.mediaId}`).length, 0);
  });
});

describe("video processing", () => {
  test("H.264 MP4 plays as-is; MOV is remuxed; HEVC is transcoded to H.264", async () => {
    const owner = await makeUser("owner");
    const cases: [string, string[], string[]][] = [
      ["h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"], ["preview", "thumb"]],
      ["h264.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov"], ["playback", "preview", "thumb"]],
      ["hevc.mp4", ["-c:v", "libx265", "-pix_fmt", "yuv420p", "-c:a", "aac", "-tag:v", "hvc1"], ["playback", "preview", "thumb"]],
    ];
    for (const [name, args, expected] of cases) {
      const up = await uploadBytes(owner, read(videoFixture(name, args)), name, 256 * 1024);
      assert.equal(up.status, "done", `${name}: ${up.error}`);
      const m = await getMediaDetail(owner, up.mediaId!);
      assert.equal(m?.kind, "video");
      assert.deepEqual([...m!.variants].sort(), expected, name);
      assert.ok(m!.durationMs! >= 1900 && m!.durationMs! <= 2100, `${name} duration ${m!.durationMs}`);
      assert.deepEqual([m!.width, m!.height], [320, 240]);
    }
  });
});
