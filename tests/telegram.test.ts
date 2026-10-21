// Telegram Bot API is replaced by a local test double on 127.0.0.1 (TELEGRAM_API_BASE in .env.test).
// These tests verify our logic; they are not a live Telegram integration test.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { POST as webhook } from "../src/app/api/telegram/webhook/route";
import { albumFromCaption, createLinkCode, handleUpdate, type TgUpdate } from "../src/lib/telegram";
import sharp from "sharp";
import { mediaKey, storage } from "../src/lib/storage";
import { drainJobs, fakeServer, jpegFixture, makeUser, read, resetDb, sql, videoFixture } from "./helpers";

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
const files = new Map<string, Buffer>();
let server: Awaited<ReturnType<typeof fakeServer>>;
let failDownloads = 0;

before(async () => {
  server = await fakeServer(45999, (req, body, res) => {
    const url = req.url ?? "";
    const file = /^\/file\/bottest-token\/(.+)$/.exec(url);
    if (file) {
      if (failDownloads > 0) {
        failDownloads--;
        res.writeHead(502).end();
        return;
      }
      const data = files.get(file[1]);
      res.writeHead(data ? 200 : 404).end(data);
      return;
    }
    const method = /^\/bottest-token\/(\w+)$/.exec(url)?.[1] ?? "?";
    // File uploads arrive as multipart; keep them as text so a test can look for the attached file names.
    const isJson = (req.headers["content-type"] ?? "").includes("json");
    const parsed = !body.length ? {} : isJson ? JSON.parse(body.toString()) : { multipart: body.toString("latin1") };
    calls.push({ method, body: parsed });
    const result = method === "getFile" ? { file_id: parsed.file_id, file_path: `photos/${parsed.file_id}.jpg` } : true;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, result }));
  });
});
after(async () => {
  await server.close();
  await sql.end();
});
beforeEach(async () => {
  await resetDb();
  calls = [];
  files.clear();
  failDownloads = 0;
});

let nextUpdate = 1000;
const TG_USER = 777001;
const msg = (m: Record<string, unknown>, chat = { id: TG_USER, type: "private" }): TgUpdate =>
  ({ update_id: nextUpdate++, message: { message_id: nextUpdate, from: { id: TG_USER, is_bot: false }, chat, ...m } }) as TgUpdate;
const photo = (fileId: string, extra: Record<string, unknown> = {}) =>
  msg({ photo: [{ file_id: `${fileId}-small`, file_unique_id: "s", width: 90, height: 90 }, { file_id: fileId, file_unique_id: fileId, width: 1600, height: 1000, file_size: 50_000 }], ...extra });
const replies = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));

async function linkedMember() {
  const user = await makeUser("member");
  const { code } = await createLinkCode(user.id);
  await handleUpdate(msg({ text: `/start ${code}` }));
  return { user, code };
}

describe("account linking", () => {
  test("single-use code binds the numeric Telegram id; reuse and wrong codes fail", async () => {
    const { user, code } = await linkedMember();
    const [link] = await sql`select telegram_user_id, user_id from telegram_links`;
    assert.equal(Number(link.telegramUserId), TG_USER);
    assert.equal(link.userId, user.id);
    assert.match(replies()[0], /ulandi/);

    await handleUpdate(msg({ text: `/start ${code}` }));
    assert.match(replies().at(-1)!, /notoʻgʻri yoki muddati oʻtgan/);
    await handleUpdate(msg({ text: "/start ZZZZZZZZ" }));
    assert.match(replies().at(-1)!, /notoʻgʻri/);
  });

  test("expired code is rejected; viewers cannot link", async () => {
    const user = await makeUser("member");
    const { code } = await createLinkCode(user.id);
    await sql`update telegram_link_codes set expires_at = now() - interval '1 minute'`;
    await handleUpdate(msg({ text: `/start ${code}` }));
    assert.equal((await sql`select 1 from telegram_links`).length, 0);

    const viewer = await makeUser("viewer", user.familyId);
    const v = await createLinkCode(viewer.id);
    await handleUpdate(msg({ text: `/start ${v.code}` }));
    assert.equal((await sql`select 1 from telegram_links`).length, 0);
  });

  test("/stop unlinks", async () => {
    await linkedMember();
    await handleUpdate(msg({ text: "/stop" }));
    assert.equal((await sql`select 1 from telegram_links`).length, 0);
  });
});

describe("ingestion", () => {
  test("photo goes to the linked user's family 'Telegram' album; confirmation only after storage", async () => {
    const { user } = await linkedMember();
    files.set("photos/p1.jpg", read(await jpegFixture()));
    const update = photo("p1");
    await handleUpdate(update);
    assert.equal(calls.filter((c) => c.method === "setMessageReaction").length, 0, "no confirmation before processing");
    await drainJobs();

    const [m] = await sql`select family_id, uploaded_by, source, status from media`;
    assert.deepEqual([m.familyId, m.uploadedBy, m.source, m.status], [user.familyId, user.id, "telegram", "ready"]);
    const [album] = await sql`select a.title from album_items ai join albums a on a.id = ai.album_id`;
    assert.equal(album.title, "Telegram");
    assert.equal(calls.filter((c) => c.method === "setMessageReaction").length, 1);
    assert.equal(calls.find((c) => c.method === "getFile")?.body.file_id, "p1", "largest photo size is downloaded");

    // Telegram redelivers the same update: nothing new happens.
    await handleUpdate(update);
    await drainJobs();
    assert.equal(Number((await sql`select count(*) from media`)[0].count), 1);
    assert.equal(Number((await sql`select count(*) from jobs`)[0].count), 1);
  });

  test("Telegram photos and videos are archived as smaller compact copies, photos without EXIF/GPS", async () => {
    await linkedMember();
    const jpeg = read(await jpegFixture({ r: 30, g: 140, b: 90 }, "tg-compact.jpg"));
    const mp4 = read(videoFixture("tg-hq.mp4", ["-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k"]));
    files.set("photos/c1.jpg", jpeg);
    files.set("photos/v1.jpg", mp4); // the fake getFile always answers photos/<id>.jpg
    await handleUpdate(photo("c1"));
    await handleUpdate(msg({ video: { file_id: "v1", file_unique_id: "v1", file_name: "kino.mov", mime_type: "video/mp4", file_size: mp4.length } }));
    await drainJobs();

    const rows = await sql`select id, family_id, kind, mime, size_bytes, original_name, variants, width from media where status = 'ready' order by kind`;
    const [img, vid] = rows;
    assert.deepEqual([img.mime, img.variants, img.width], ["image/webp", ["thumb"], 1600]);
    assert.ok(Number(img.sizeBytes) < jpeg.length, "photo got smaller");
    assert.match(img.originalName, /\.webp$/);
    const stored = Buffer.from(await new Response((await storage().get(mediaKey(img.familyId, img.id, "original")))!.body).arrayBuffer());
    const meta = await sharp(stored).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined, "no EXIF/GPS kept");

    assert.deepEqual([vid.mime, vid.originalName], ["video/mp4", "kino.mp4"]);
    assert.ok(Number(vid.sizeBytes) < mp4.length, "video got smaller");
    assert.ok(!vid.variants.includes("playback"), "the compact copy plays directly");
    assert.ok(vid.variants.includes("preview"), "videos keep their poster preview");
  });

  test("media group with #hashtag lands in one named album", async () => {
    await linkedMember();
    files.set("photos/g1.jpg", read(await jpegFixture({ r: 10, g: 20, b: 30 }, "g1.jpg")));
    files.set("photos/g2.jpg", read(await jpegFixture({ r: 90, g: 20, b: 30 }, "g2.jpg")));
    await handleUpdate(photo("g1", { media_group_id: "G", caption: "Toʻydan #toy_2024" }));
    await handleUpdate(photo("g2", { media_group_id: "G" }));
    await drainJobs();
    const rows = await sql`select a.title from album_items ai join albums a on a.id = ai.album_id`;
    assert.deepEqual(rows.map((r) => r.title), ["toy 2024", "toy 2024"]);
  });

  test("same content sent twice is reported as duplicate", async () => {
    await linkedMember();
    const bytes = read(await jpegFixture());
    files.set("photos/a.jpg", bytes);
    files.set("photos/b.jpg", bytes);
    await handleUpdate(photo("a"));
    await handleUpdate(photo("b"));
    await drainJobs();
    assert.equal(Number((await sql`select count(*) from media`)[0].count), 1);
    assert.ok(replies().some((t) => /allaqachon bor/.test(t)));
  });

  test("transient download failure is retried with bounded attempts", async () => {
    await linkedMember();
    files.set("photos/r.jpg", read(await jpegFixture()));
    failDownloads = 2;
    await handleUpdate(photo("r"));
    await drainJobs(true);
    const [job] = await sql`select status, attempts from jobs`;
    assert.equal(job.status, "done");
    assert.equal(job.attempts, 3);
  });

  test("unsupported, oversized, unlinked, viewer and group messages get actionable replies or are ignored", async () => {
    await handleUpdate(photo("x"));
    assert.match(replies().at(-1)!, /akkauntni ulang/);

    const { user } = await linkedMember();
    await handleUpdate(msg({ document: { file_id: "d", file_unique_id: "d", file_name: "hisobot.pdf", mime_type: "application/pdf" } }));
    assert.match(replies().at(-1)!, /saqlanmaydi/);
    await handleUpdate(msg({ video: { file_id: "v", file_unique_id: "v", file_size: 300 * 1024 * 1024 } }));
    assert.match(replies().at(-1)!, /20 MB dan katta/);

    const before = calls.length;
    await handleUpdate(msg({ photo: [{ file_id: "g", file_unique_id: "g", width: 1, height: 1 }] }, { id: -100, type: "supergroup" }));
    assert.equal(calls.length, before, "group chats are ignored");

    await sql`update users set role = 'viewer' where id = ${user.id}`;
    await handleUpdate(photo("y"));
    assert.match(replies().at(-1)!, /huquqi yoʻq/);
    assert.equal((await sql`select 1 from jobs`).length, 0);
  });

  test("plain text searches the archive (no AI) and sends the found photo back", async () => {
    await linkedMember();
    files.set("photos/s1.jpg", read(await jpegFixture({ r: 220, g: 20, b: 20 }, "search-1.jpg")));
    await handleUpdate(photo("s1"));
    await drainJobs();
    await sql`update media set title = 'Toʻy kuni'`;

    await handleUpdate(msg({ text: "to'y" }));
    await drainJobs();
    const sent = calls.find((c) => c.method === "sendPhoto");
    assert.match(String(sent?.body.multipart), /name="photo"; filename="f0\.jpg"/);
    assert.match(replies().at(-1)!, /1 ta topildi\. Saytda: http:\/\/localhost:3000\/\?q=to%27y/);
  });

  test("“Dilfuzaning 7 yoshdagi rasmlari” sends only the photos tagged with her from when she was 7", async () => {
    const { user } = await linkedMember();
    for (const id of ["a7", "a9"]) {
      files.set(`photos/${id}.jpg`, read(await jpegFixture({ r: id === "a7" ? 30 : 200, g: 90, b: 160 }, `age-${id}.jpg`)));
      await handleUpdate(photo(id));
    }
    await drainJobs();
    const [dilfuza] = await sql`insert into people (family_id, first_name, last_name, birth_date, is_living)
      values (${user.familyId}, 'Dilfuza', 'Jurayeva', '2010-05-01', true) returning id`;
    const media = await sql`select id from media order by created_at`;
    await sql`update media set taken_at = '2017-08-01T12:00:00Z' where id = ${media[0].id}`; // 7 years old
    await sql`update media set taken_at = '2019-08-01T12:00:00Z' where id = ${media[1].id}`; // 9 years old
    await sql`insert into media_people (media_id, person_id) select id, ${dilfuza.id} from media`;
    await sql`update families set ai_enabled = true`;

    let intent: Record<string, unknown> = {};
    const gemini = await fakeServer(45998, (_req, _body, res) => res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }],
    })));
    try {
      intent = { keywords: ["rasm"], kind: "any", yearFrom: null, yearTo: null, person: "Dilfuzaning", ageFrom: 7, ageTo: 7 };
      await handleUpdate(msg({ text: "Dilfuzaning 7 yoshdagi rasmlari" }));
      await drainJobs();
      assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1, "only the photo from age 7");
      assert.match(replies().at(-1)!, new RegExp(`^Dilfuza Jurayeva · 7 yosh: 1 ta topildi\\. Saytda: .*/people/${dilfuza.id}$`));

      intent = { ...intent, person: "Bobur" };
      await handleUpdate(msg({ text: "Boburning rasmlari" }));
      await drainJobs();
      assert.match(replies().at(-1)!, /“Bobur” ismli odam oila daraxtida topilmadi/);
    } finally {
      await gemini.close();
    }
  });

  test("webhook rejects requests without the secret header", async () => {
    const body = JSON.stringify({ update_id: 1 });
    const bad = await webhook(new Request("http://x/api/telegram/webhook", { method: "POST", body }));
    assert.equal(bad.status, 403);
    const wrong = await webhook(new Request("http://x/api/telegram/webhook", {
      method: "POST", body, headers: { "x-telegram-bot-api-secret-token": "nope" },
    }));
    assert.equal(wrong.status, 403);
    const ok = await webhook(new Request("http://x/api/telegram/webhook", {
      method: "POST", body, headers: { "x-telegram-bot-api-secret-token": "test_secret" },
    }));
    assert.equal(ok.status, 200);
  });

  test("caption hashtag parsing", () => {
    assert.equal(albumFromCaption("#Bogʻ_2023 kuz"), "Bogʻ 2023");
    assert.equal(albumFromCaption("hashtagsiz"), null);
  });
});
