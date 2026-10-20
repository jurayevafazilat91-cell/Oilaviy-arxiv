import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import exifr from "exifr";
import decodeHeic from "heic-decode";
import ffmpegStatic from "ffmpeg-static";
import { env } from "../env";
import type { Variant } from "../storage";
import type { Sniffed } from "./sniff";

export type Derivative = { variant: Exclude<Variant, "original">; path: string; contentType: string };
export type Processed = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  takenAt: Date | null;
  derivatives: Derivative[];
};

// shortcut: EXIF times carry no zone; we assume the family's zone (Tashkent, UTC+5, no DST). Make configurable if families span zones.
const DEFAULT_OFFSET = "+05:00";
const THUMB = 640;
const PREVIEW = 2048;

const ffmpegPath = () => env().FFMPEG_PATH ?? (ffmpegStatic as unknown as string);

function runFfmpeg(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stderr)));
  });
}

async function writeImageVariants(input: () => Sharp, dir: string): Promise<Derivative[]> {
  const thumb = path.join(dir, "thumb.webp");
  const preview = path.join(dir, "preview.webp");
  // sharp drops EXIF/XMP (incl. GPS) unless asked to keep it, so derivatives never leak location.
  await input().resize(THUMB, THUMB, { fit: "inside", withoutEnlargement: true }).webp({ quality: 74 }).toFile(thumb);
  await input().resize(PREVIEW, PREVIEW, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(preview);
  return [
    { variant: "thumb", path: thumb, contentType: "image/webp" },
    { variant: "preview", path: preview, contentType: "image/webp" },
  ];
}

export function exifToDate(raw: unknown, offset: unknown): Date | null {
  const m = typeof raw === "string" ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  if (!m || m[1] === "0000") return null;
  const zone = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : DEFAULT_OFFSET;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function processImage(file: string, mime: Sniffed["mime"], dir: string): Promise<Processed> {
  const exif = await exifr
    .parse(file, { pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal"], reviveValues: false })
    .catch(() => null);
  const takenAt = exifToDate(exif?.DateTimeOriginal ?? exif?.CreateDate, exif?.OffsetTimeOriginal);

  if (mime === "image/heic") {
    const decoded = await decodeHeic({ buffer: await readFile(file) });
    const raw = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    const input = () => sharp(raw, { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
    return { width: decoded.width, height: decoded.height, durationMs: null, takenAt, derivatives: await writeImageVariants(input, dir) };
  }

  const meta = await sharp(file).metadata();
  const input = () => sharp(file, { failOn: "error" }).rotate();
  return {
    width: meta.autoOrient?.width ?? meta.width ?? null,
    height: meta.autoOrient?.height ?? meta.height ?? null,
    durationMs: null,
    takenAt,
    derivatives: await writeImageVariants(input, dir),
  };
}

export type VideoProbe = {
  durationMs: number | null;
  codec: string | null;
  pixFmt: string | null;
  audio: string | null;
  width: number | null;
  height: number | null;
  rotated: boolean;
  createdAt: Date | null;
};

/** Parses `ffmpeg -i` output (avoids shipping a separate ffprobe binary). */
export function parseProbe(out: string): VideoProbe {
  const dur = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(out);
  const videoLine = out.split("\n").find((l) => /Stream #.*: Video:/.test(l)) ?? "";
  const audioLine = out.split("\n").find((l) => /Stream #.*: Audio:/.test(l));
  const size = /, (\d{2,5})x(\d{2,5})[ ,\n]/.exec(videoLine + "\n");
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(out) ?? /rotate\s*:\s*(-?\d+)/.exec(out);
  const rotated = rotation ? Math.abs(Number(rotation[1])) % 180 === 90 : false;
  const created = /creation_time\s*:\s*(\S+)/.exec(out);
  const createdAt = created ? new Date(created[1]) : null;
  const w = size ? Number(size[1]) : null;
  const h = size ? Number(size[2]) : null;
  return {
    durationMs: dur ? Math.round((Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) * 1000) : null,
    codec: /Video: (\w+)/.exec(videoLine)?.[1] ?? null,
    pixFmt: /Video: \w+[^,]*, (\w+)/.exec(videoLine)?.[1] ?? null,
    audio: audioLine ? (/Audio: (\w+)/.exec(audioLine)?.[1] ?? null) : null,
    width: rotated ? h : w,
    height: rotated ? w : h,
    rotated,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) && createdAt.getUTCFullYear() > 1970 ? createdAt : null,
  };
}

/** Browsers reliably play H.264 (8-bit 4:2:0) with AAC/MP3 audio in MP4; everything else gets a playback copy. */
export function playbackPlan(p: VideoProbe, mime: Sniffed["mime"]): "none" | "remux" | "transcode" {
  const videoOk = p.codec === "h264" && (p.pixFmt?.startsWith("yuv420p") ?? false) && p.pixFmt !== "yuv420p10le";
  const audioOk = !p.audio || p.audio === "aac" || p.audio === "mp3";
  if (!videoOk || !audioOk) return "transcode";
  return mime === "video/quicktime" ? "remux" : "none";
}

async function processVideo(file: string, mime: Sniffed["mime"], dir: string): Promise<Processed> {
  // `ffmpeg -i` with no output exits non-zero by design; the stream info is on stderr.
  const info = await runFfmpeg(["-i", file], 60_000).catch((e: { stderr?: string }) => e.stderr ?? "");
  const probe = parseProbe(info);
  if (!probe.codec) throw new Error("Videoda koʻrish mumkin boʻlgan oqim topilmadi");

  const poster = path.join(dir, "poster.jpg");
  const at = probe.durationMs && probe.durationMs > 2000 ? 1 : 0;
  await runFfmpeg(["-ss", String(at), "-i", file, "-frames:v", "1", "-q:v", "2", "-y", poster], 120_000);
  const derivatives = await writeImageVariants(() => sharp(poster), dir);

  const plan = playbackPlan(probe, mime);
  if (plan !== "none") {
    const out = path.join(dir, "playback.mp4");
    const args = plan === "remux"
      ? ["-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-y", out]
      : ["-i", file, "-map", "0:v:0", "-map", "0:a:0?",
         "-vf", "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", out];
    await runFfmpeg(args, 2 * 60 * 60_000);
    derivatives.push({ variant: "playback", path: out, contentType: "video/mp4" });
  }

  return { width: probe.width, height: probe.height, durationMs: probe.durationMs, takenAt: probe.createdAt, derivatives };
}

/** Small browser-playable copy (H.264, ≤1280px, CRF 28) that Telegram videos are archived as instead of the original. */
export async function compressVideo(file: string, dir: string): Promise<string> {
  const out = path.join(dir, "compact.mp4");
  await runFfmpeg(["-i", file, "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", out], 4 * 60_000); // inside Vercel's 300 s
  return out;
}

export function processMediaFile(file: string, sniffed: Sniffed, workDir: string): Promise<Processed> {
  return sniffed.kind === "image" ? processImage(file, sniffed.mime, workDir) : processVideo(file, sniffed.mime, workDir);
}
