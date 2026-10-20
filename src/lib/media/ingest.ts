import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { sql } from "../db";
import { env, MB } from "../env";
import { enqueue, PermanentError } from "../jobs";
import { mediaKey, mediaPrefix, storage } from "../storage";
import { compressVideo, processMediaFile } from "./process";
import { sniff, type Sniffed } from "./sniff";

export type IngestInput = {
  ingestKey: string;
  familyId: string;
  userId: string;
  source: "web" | "telegram";
  filePath: string;
  originalName: string;
  albumId?: string | null;
  telegramMediaGroup?: string | null;
};
export type IngestResult = { mediaId: string; outcome: "created" | "duplicate" | "restored" };

export const tmpDir = async (sub = "") => {
  const dir = path.resolve(env().TMP_DIR, sub);
  await mkdir(dir, { recursive: true });
  return dir;
};

export async function readHead(file: string, bytes = 64): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function sizeLimit(kind: Sniffed["kind"]): number {
  return (kind === "image" ? env().MAX_IMAGE_MB : env().MAX_VIDEO_MB) * MB;
}

export function sizeError(kind: Sniffed["kind"]): string {
  return kind === "image"
    ? `Rasm ${env().MAX_IMAGE_MB} MB dan katta boʻlmasligi kerak`
    : `Video ${env().MAX_VIDEO_MB} MB dan katta boʻlmasligi kerak`;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export async function addToAlbum(familyId: string, albumId: string, mediaId: string) {
  // The join guarantees both rows belong to the same family.
  await sql`
    insert into album_items (album_id, media_id)
    select a.id, m.id from albums a join media m on m.family_id = a.family_id
    where a.id = ${albumId} and m.id = ${mediaId} and a.family_id = ${familyId}
    on conflict do nothing`;
}

/** Deletes stored objects first, then the row, so a failure never leaves unreachable files behind. */
export async function purgeMedia(mediaId: string) {
  const [row] = await sql<{ familyId: string }[]>`select family_id from media where id = ${mediaId}`;
  if (!row) return;
  await storage().deletePrefix(mediaPrefix(row.familyId, mediaId));
  await sql`delete from media where id = ${mediaId}`;
}

/**
 * Validates, deduplicates, processes and stores one file. Idempotent per `ingestKey`:
 * a retried job resumes the same media row instead of creating another one.
 */
export async function ingestFile(input: IngestInput): Promise<IngestResult> {
  const sniffed = sniff(await readHead(input.filePath));
  if (!sniffed) throw new PermanentError("Bu fayl turi qoʻllab-quvvatlanmaydi (JPEG, PNG, WebP, HEIC, MP4, MOV)");
  const { size } = await stat(input.filePath);
  if (size > sizeLimit(sniffed.kind)) throw new PermanentError(sizeError(sniffed.kind));
  const hash = await sha256File(input.filePath);

  let [row] = await sql<{ id: string; status: string }[]>`select id, status from media where ingest_key = ${input.ingestKey}`;
  if (row?.status === "ready") return { mediaId: row.id, outcome: "created" };

  if (!row) {
    const [dup] = await sql<{ id: string; status: string; deletedAt: Date | null }[]>`
      select id, status, deleted_at from media where family_id = ${input.familyId} and sha256 = ${hash}`;
    if (dup?.status === "failed") await purgeMedia(dup.id);
    else if (dup) {
      if (dup.deletedAt) await sql`update media set deleted_at = null, updated_at = now() where id = ${dup.id}`;
      if (input.albumId) await addToAlbum(input.familyId, input.albumId, dup.id);
      return { mediaId: dup.id, outcome: dup.deletedAt ? "restored" : "duplicate" };
    }

    [row] = await sql<{ id: string; status: string }[]>`
      insert into media (family_id, uploaded_by, ingest_key, source, kind, original_name, mime, size_bytes, sha256, telegram_media_group)
      values (${input.familyId}, ${input.userId}, ${input.ingestKey}, ${input.source}, ${sniffed.kind},
              ${input.originalName.slice(0, 255)}, ${sniffed.mime}, ${size}, ${hash}, ${input.telegramMediaGroup ?? null})
      on conflict do nothing
      returning id, status`;
    if (!row) return ingestFile(input); // lost a race with an identical file; the next pass reports the duplicate
  }

  const work = await mkdtemp(path.join(await tmpDir("work"), "m-"));
  try {
    // Telegram media is archived as a compact copy instead of the original whenever that copy is smaller:
    // the family chose storage over full quality there. Web uploads keep their originals.
    const compact = input.source === "telegram";
    let file = input.filePath;
    let mime: Sniffed["mime"] = sniffed.mime;
    if (compact && sniffed.kind === "video") {
      const small = await compressVideo(input.filePath, work).catch(() => null); // on failure keep the original, never lose the video
      if (small && (await stat(small)).size < size) [file, mime] = [small, "video/mp4"];
    }
    const result = await processMediaFile(file, { kind: sniffed.kind, mime }, work);
    let derivatives = result.derivatives;
    const preview = derivatives.find((d) => d.variant === "preview");
    if (compact && sniffed.kind === "image" && preview && (await stat(preview.path)).size < size) {
      // The ≤2048px WebP preview (EXIF/GPS stripped) becomes the stored file; no second copy as "preview".
      const meta = await sharp(await readFile(preview.path)).metadata(); // a buffer: a path would stay locked on Windows
      [file, mime, result.width, result.height] = [preview.path, "image/webp", meta.width ?? null, meta.height ?? null];
      derivatives = derivatives.filter((d) => d !== preview);
    }
    const replaced = file !== input.filePath;
    const storedSize = replaced ? (await stat(file)).size : size;
    const name = replaced ? `${input.originalName.replace(/\.[^.]*$/, "")}.${mime === "image/webp" ? "webp" : "mp4"}` : input.originalName;

    const store = storage();
    await store.put(mediaKey(input.familyId, row.id, "original"), file, mime);
    for (const d of derivatives) await store.put(mediaKey(input.familyId, row.id, d.variant), d.path, d.contentType);

    const [family] = await sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${input.familyId}`;
    const runAi = Boolean(family?.aiEnabled && env().GEMINI_API_KEY && sniffed.kind === "image");
    await sql`
      update media set status = 'ready', error = null,
        width = ${result.width}, height = ${result.height}, duration_ms = ${result.durationMs},
        taken_at = coalesce(taken_at, ${result.takenAt}),
        mime = ${mime}, size_bytes = ${storedSize}, original_name = ${name.slice(0, 255)},
        variants = ${derivatives.map((d) => d.variant)},
        ai_status = ${runAi ? "pending" : null}, updated_at = now()
      where id = ${row.id}`;
    if (input.albumId) await addToAlbum(input.familyId, input.albumId, row.id);
    if (runAi) await enqueue("ai_describe", { mediaId: row.id }, { dedupeKey: `ai:${row.id}`, maxAttempts: 4 });
    return { mediaId: row.id, outcome: "created" };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Called once retries are exhausted: keep a visible failed row, drop any partial objects. */
export async function markIngestFailed(ingestKey: string, message: string) {
  const [row] = await sql<{ id: string; familyId: string }[]>`
    update media set status = 'failed', error = ${message.slice(0, 500)}, updated_at = now()
    where ingest_key = ${ingestKey} and status <> 'ready' returning id, family_id`;
  if (row) await storage().deletePrefix(mediaPrefix(row.familyId, row.id));
}
