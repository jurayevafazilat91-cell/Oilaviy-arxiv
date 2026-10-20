import { createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "../db";
import { MB } from "../env";
import { HttpError } from "../http";
import { enqueue, isFinalAttempt, PermanentError, type Job } from "../jobs";
import { storage, type UploadedPart } from "../storage";
import { ingestFile, markIngestFailed, sizeError, sizeLimit, tmpDir } from "./ingest";
import { ALLOWED_EXTENSIONS, extensionOf, isVideoExtension, sniff } from "./sniff";

// Also the multipart part size for direct uploads: S3/R2 require parts of at least 5 MB (except the last).
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
  /** Set when parts go straight to the bucket (object storage); null for chunks written to local disk. */
  storageUploadId: string | null;
};

export const uploadPath = async (id: string) => path.join(await tmpDir("uploads"), `${id}.part`);
/** Bucket key holding a direct upload until it is processed. */
export const stagingKey = (id: string) => `uploads/${id}`;

export function publicUpload(u: UploadRow) {
  return {
    id: u.id,
    status: u.status,
    receivedBytes: Number(u.receivedBytes),
    sizeBytes: Number(u.sizeBytes),
    mediaId: u.mediaId,
    error: u.error,
    chunkSize: CHUNK_SIZE,
    direct: Boolean(u.storageUploadId),
  };
}

/** Bytes safely stored: consecutive full-size parts from part 1 (the last part may be shorter). */
export function contiguousBytes(parts: UploadedPart[], size: number): number {
  const sizes = new Map(parts.map((p) => [p.part, p.size]));
  let received = 0;
  for (let n = 1; received < size && sizes.get(n) === Math.min(CHUNK_SIZE, size - received); n++) received += sizes.get(n)!;
  return received;
}

/** Drops whatever bytes an upload left behind: the local temp file or the bucket's multipart/staging object. */
export async function discardUploadData(u: Pick<UploadRow, "id" | "storageUploadId">) {
  await rm(await uploadPath(u.id), { force: true });
  const direct = storage().direct;
  if (!u.storageUploadId || !direct) return;
  await direct.abortMultipart(stagingKey(u.id), u.storageUploadId).catch(() => {}); // already completed or gone
  await storage().deletePrefix(stagingKey(u.id));
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
  const direct = storage().direct;
  if (!direct) return row;
  if (row.storageUploadId) {
    // Resuming after a reload: the bucket knows which parts already arrived.
    const received = contiguousBytes(await direct.listParts(stagingKey(row.id), row.storageUploadId), Number(row.sizeBytes));
    return { ...row, receivedBytes: String(received) };
  }
  const started = await direct.startMultipart(stagingKey(row.id));
  const [updated] = await sql<UploadRow[]>`
    update uploads set storage_upload_id = coalesce(storage_upload_id, ${started}) where id = ${row.id} returning *`;
  if (updated.storageUploadId !== started) await direct.abortMultipart(stagingKey(row.id), started); // a parallel request won
  return updated;
}

/** Signed URL the browser PUTs one part to. Part numbers start at 1; each covers CHUNK_SIZE bytes. */
export async function partUploadUrl(upload: UploadRow, part: number): Promise<string> {
  const direct = storage().direct;
  if (upload.status !== "uploading") throw new HttpError(409, "Bu yuklash yakunlangan yoki bekor qilingan");
  if (!direct || !upload.storageUploadId) throw new HttpError(409, "Bu yuklash toʻgʻridan-toʻgʻri rejimda emas");
  if (!Number.isInteger(part) || part < 1 || part > Math.ceil(Number(upload.sizeBytes) / CHUNK_SIZE)) throw new HttpError(400, "Notoʻgʻri boʻlak raqami");
  await sql`update uploads set updated_at = now() where id = ${upload.id}`; // keeps the stale-upload sweep away
  return direct.partUrl(stagingKey(upload.id), upload.storageUploadId, part);
}

export async function getUpload(user: { id: string }, id: string): Promise<UploadRow> {
  const [row] = await sql<UploadRow[]>`select * from uploads where id = ${id} and user_id = ${user.id}`;
  if (!row) throw new HttpError(404, "Yuklash topilmadi");
  return row;
}

async function failUpload(id: string, message: string) {
  const [row] = await sql<UploadRow[]>`update uploads set status = 'failed', error = ${message}, updated_at = now() where id = ${id} returning *`;
  if (row) await discardUploadData(row);
}

/** Writes one chunk at `offset`. Rewriting an already received range is allowed so retries are safe. */
export async function writeChunk(upload: UploadRow, offset: number, chunk: Uint8Array): Promise<UploadRow> {
  if (upload.status !== "uploading") throw new HttpError(409, "Bu yuklash yakunlangan yoki bekor qilingan");
  if (upload.storageUploadId) throw new HttpError(409, "Bu yuklash boʻlaklari toʻgʻridan-toʻgʻri omborga yuboriladi");
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
  const size = Number(upload.sizeBytes);
  const direct = storage().direct;
  if (upload.storageUploadId && direct) {
    // The browser's word is not enough: the bucket must hold every part, adding up to the declared size.
    const key = stagingKey(upload.id);
    const parts = await direct.listParts(key, upload.storageUploadId).catch(() => null);
    if (parts) {
      if (contiguousBytes(parts, size) !== size || parts.length !== Math.ceil(size / CHUNK_SIZE)) throw new HttpError(409, "Fayl toʻliq yuklanmagan");
      await direct.completeMultipart(key, upload.storageUploadId, parts);
    } else if ((await storage().size(key)) !== size) {
      throw new HttpError(409, "Fayl toʻliq yuklanmagan"); // neither the multipart nor an assembled object exists
    } // otherwise an earlier call already assembled it and only its response was lost
  } else if (Number(upload.receivedBytes) !== size) {
    throw new HttpError(409, "Fayl toʻliq yuklanmagan");
  }
  const [row] = await sql<UploadRow[]>`
    update uploads set status = 'processing', received_bytes = size_bytes, updated_at = now()
    where id = ${upload.id} and status = 'uploading' returning *`;
  if (!row) return getUpload({ id: upload.userId }, upload.id);
  await enqueue("process_upload", { uploadId: upload.id }, { dedupeKey: `upload:${upload.id}` });
  return row;
}

export async function cancelUpload(upload: UploadRow) {
  if (upload.status !== "uploading") throw new HttpError(409, "Faqat yuklanayotgan faylni bekor qilish mumkin");
  await sql`update uploads set status = 'cancelled', updated_at = now() where id = ${upload.id} and status = 'uploading'`;
  await discardUploadData(upload);
}

export async function processUploadJob(job: Job) {
  const uploadId = String(job.payload.uploadId);
  const [upload] = await sql<UploadRow[]>`select * from uploads where id = ${uploadId}`;
  if (!upload || upload.status !== "processing") return;
  const ingestKey = `upload:${uploadId}`;
  const file = await uploadPath(uploadId);
  try {
    if (upload.storageUploadId && !(await stat(file).catch(() => null))) {
      // Direct uploads live in the bucket; processing needs a local copy (sharp and ffmpeg read files).
      const obj = await storage().get(stagingKey(uploadId));
      if (!obj) throw new PermanentError("Yuklangan fayl omborda topilmadi");
      await pipeline(Readable.fromWeb(obj.body as never), createWriteStream(file));
    }
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
    await discardUploadData(upload);
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
