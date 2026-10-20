import { z } from "zod";

const optional = z.string().optional().transform((v) => (v ? v : undefined));
const bool = (d: boolean) => z.string().optional().transform((v) => (v ? v === "true" || v === "1" : d));

// Vercel functions get a read-only disk except /tmp (512 MB) and stop after 300 s: smaller videos only.
const onVercel = Boolean(process.env.VERCEL);

const schema = z.object({
  APP_URL: z.url().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  STORAGE_DIR: z.string().default("./.data/storage"),
  TMP_DIR: z.string().default(onVercel ? "/tmp/oilaviy" : "./.data/tmp"),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  MAX_IMAGE_MB: z.coerce.number().int().positive().default(50),
  MAX_VIDEO_MB: z.coerce.number().int().positive().default(onVercel ? 200 : 2048),
  WORKER_ENABLED: bool(true),
  FFMPEG_PATH: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_API_BASE: z.url().default("https://generativelanguage.googleapis.com/v1beta"),
  AI_DAILY_LIMIT: z.coerce.number().int().nonnegative().default(200),
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_BOT_USERNAME: optional,
  TELEGRAM_WEBHOOK_SECRET: optional.refine((v) => !v || /^[A-Za-z0-9_-]{1,256}$/.test(v), "1-256 belgi: A-Z a-z 0-9 _ -"),
  TELEGRAM_API_BASE: z.url().default("https://api.telegram.org"),
  TELEGRAM_LOCAL_SERVER: bool(false),
  TELEGRAM_MAX_DOWNLOAD_MB: z.coerce.number().int().positive().default(20),
  TELEGRAM_LOCAL_FILES_DIR: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` works without runtime secrets. */
export function env(): Env {
  if (!cached) {
    const blanksAsUnset = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    cached = schema.parse(blanksAsUnset);
  }
  return cached;
}

export const MB = 1024 * 1024;
export const isSecureApp = () => env().APP_URL.startsWith("https://");
