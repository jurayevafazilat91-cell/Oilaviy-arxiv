import { open, rm } from "node:fs/promises";
import path from "node:path";
import { sql } from "../db";
import { MB } from "../env";
import { HttpError } from "../http";
import { enqueue, isFinalAttempt, PermanentError, type Job } from "../jobs";
import { ingestFile, markIngestFailed, sizeError, sizeLimit, tmpDir } from "./ingest";
import { ALLOWED_EXTENSIONS, extensionOf, isVideoExtension, sniff } from "./sniff";

export const CHUNK_SIZE = 8 * MB;

export type UploadRow = {
  id: string;
  familyId: string;
  userId: string;
  fileName: string;
  sizeBytes: string;
  kind: "image" | "video" | null;
  mime: string | null;
  receivedBytes: string;
  albumId: string | null;
  status: string;
  mediaId: string | null;
  error: string | null;
};

export const uploadPath = async (id: string) => path.join(await tmpDir("uploads"), `${id}.part`);

export function publicUpload(u: UploadRow) {
  return {
    id: u.id,
    status: u.status,
    receivedBytes: Number(u.receivedBytes),
    sizeBytes: Number(u.sizeBytes),
    mediaId: u.mediaId,
    error: u.error,
    chunkSize: CHUNK_SIZE,
  };
}

export async function createUpload(
  user: { id: string; familyId: string },
  input: { fileName: string; size: number; clientKey: string; albumId: string | null },
): Promise<UploadRow> {
  const ext = extensionOf(input.fileName);
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw new HttpError(415, "Bu fayl turi qoʻllab-quvvatlanmaydi (JPEG, PNG, WebP, HEIC, MP4, MOV)");
  const kind = isVideoExtension(input.fileName) ? "video" : "image";
  if (input.size <= 0) throw new HttpError(400, "Fayl boʻsh");
  if (input.size > sizeLimit(kind)) throw new HttpError(413, sizeError(kind));
  if (input.albumId) {
    const [album] = await sql`select 1 from albums where id = ${input.albumId} and family_id = ${user.familyId}`;
    if (!album) throw new HttpError(404, "Albom topilmadi");
  }
  // Same file re-selected after a reload resumes the unfinished upload.
  const [row] = await sql<UploadRow[]>`
    insert into uploads (family_id, user_id, file_name, size_bytes, album_id, client_key)
    values (${user.familyId}, ${user.id}, ${input.fileName.slice(0, 255)}, ${input.size}, ${input.albumId}, ${input.clientKey.slice(0, 300)})
    on conflict (user_id, client_key) where status = 'uploading'
      do update set album_id = excluded.album_id, updated_at = now()
    returning *`;
  return row;
}

export async function getUpload(user: { id: string }, id: string): Promise<UploadRow> {
  const [row] = await sql<UploadRow[]>`select * from uploads where id = ${id} and user_id = ${user.id}`;
  if (!row) throw new HttpError(404, "Yuklash topilmadi");
  return row;
}

async function failUpload(id: string, message: string) {
  await sql`update uploads set status = 'failed', error = ${message}, updated_at = now() where id = ${id}`;
  await rm(await uploadPath(id), { force: true });
}

/** Writes one chunk at `offset`. Rewriting an already received range is allowed so retries are safe. */
export async function writeChunk(upload: UploadRow, offset: number, chunk: Uint8Array): Promise<UploadRow> {
  if (upload.status !== "uploading") throw new HttpError(409, "Bu yuklash yakunlangan yoki bekor qilingan");
  const received = Number(upload.receivedBytes);
  const size = Number(upload.sizeBytes);
  if (!Number.isInteger(offset) || offset < 0 || offset > received) throw new HttpError(409, "Notoʻgʻri boʻlak tartibi");
  if (chunk.byteLength === 0 || offset + chunk.byteLength > size) throw new HttpError(400, "Boʻlak hajmi notoʻgʻri");

  let kind = upload.kind;
  let mime = upload.mime;
  if (offset === 0) {
    // Reject wrong file types on the first chunk instead of after a 2 GB transfer.
    const sniffed = sniff(chunk.subarray(0, 64));
    if (!sniffed) {
      await failUpload(upload.id, "Fayl mazmuni rasm yoki video emas");
      throw new HttpError(415, "Fayl mazmuni rasm yoki video emas (JPEG, PNG, WebP, HEIC, MP4, MOV)");
    }
    if (size > sizeLimit(sniffed.kind)) {
      await failUpload(upload.id, sizeError(sniffed.kind));
      throw new HttpError(413, sizeError(sniffed.kind));
    }
    kind = sniffed.kind;
    mime = sniffed.mime;
  }

  const file = await uploadPath(upload.id);
  const fh = await open(file, offset === 0 && received === 0 ? "w" : "r+");
  try {
    await fh.write(chunk, 0, chunk.byteLength, offset);
  } finally {
    await fh.close();
  }
  const [row] = await sql<UploadRow[]>`
    update uploads set received_bytes = greatest(received_bytes, ${offset + chunk.byteLength}),
      kind = ${kind}, mime = ${mime}, updated_at = now()
    where id = ${upload.id} and status = 'uploading' returning *`;
  if (!row) throw new HttpError(409, "Yuklash bekor qilindi");
  return row;
}

export async function completeUpload(upload: UploadRow): Promise<UploadRow> {
  if (upload.status !== "uploading") return upload; // repeated "complete" calls are harmless
  if (Number(upload.receivedBytes) !== Number(upload.sizeBytes)) throw new HttpError(409, "Fayl toʻliq yuklanmagan");
  const [row] = await sql<UploadRow[]>`
    update uploads set status = 'processing', updated_at = now() where id = ${upload.id} and status = 'uploading' returning *`;
  if (!row) return getUpload({ id: upload.userId }, upload.id);
  await enqueue("process_upload", { uploadId: upload.id }, { dedupeKey: `upload:${upload.id}` });
  return row;
}

export async function cancelUpload(upload: UploadRow) {
  if (upload.status !== "uploading") throw new HttpError(409, "Faqat yuklanayotgan faylni bekor qilish mumkin");
  await sql`update uploads set status = 'cancelled', updated_at = now() where id = ${upload.id} and status = 'uploading'`;
  await rm(await uploadPath(upload.id), { force: true });
}

export async function processUploadJob(job: Job) {
  const uploadId = String(job.payload.uploadId);
  const [upload] = await sql<UploadRow[]>`select * from uploads where id = ${uploadId}`;
  if (!upload || upload.status !== "processing") return;
  const ingestKey = `upload:${uploadId}`;
  const file = await uploadPath(uploadId);
  try {
    const result = await ingestFile({
      ingestKey,
      familyId: upload.familyId,
      userId: upload.userId,
      source: "web",
      filePath: file,
      originalName: upload.fileName,
      albumId: upload.albumId,
    });
    await sql`
      update uploads set status = ${result.outcome === "created" ? "done" : "duplicate"}, media_id = ${result.mediaId}, updated_at = now()
      where id = ${uploadId}`;
    await rm(file, { force: true });
  } catch (err) {
    if (isFinalAttempt(job, err)) {
      const message = err instanceof PermanentError ? err.message : "Faylni qayta ishlab boʻlmadi";
      await markIngestFailed(ingestKey, message);
      await failUpload(uploadId, message);
    }
    throw err;
  }
}

export const MAX_CHUNK_BYTES = CHUNK_SIZE;
