import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { after } from "next/server";
import { aiDescribeJob } from "./ai";
import { sql } from "./db";
import { runOneJob, type JobHandler } from "./jobs";
import { purgeMedia, tmpDir } from "./media/ingest";
import { discardUploadData, processUploadJob } from "./media/uploads";
import { telegramIngestJob } from "./telegram";

export const handlers: Record<string, JobHandler> = {
  process_upload: processUploadJob,
  telegram_ingest: telegramIngestJob,
  ai_describe: aiDescribeJob,
  purge_media: async (job) => purgeMedia(String(job.payload.mediaId)),
};

const TRASH_DAYS = 30;

/** Periodic housekeeping: expired uploads, trash, stale locks, old bookkeeping rows, orphan temp files. */
export async function cleanup() {
  const stale = await sql<{ id: string; storageUploadId: string | null }[]>`
    update uploads set status = 'cancelled', error = 'Muddati oʻtdi', updated_at = now()
    where status = 'uploading' and updated_at < now() - interval '24 hours' returning id, storage_upload_id`;
  for (const u of stale) await discardUploadData(u);

  const expired = await sql<{ id: string }[]>`
    select id from media where deleted_at < now() - make_interval(days => ${TRASH_DAYS}) limit 500`;
  for (const m of expired) {
    await sql`insert into jobs (type, payload, dedupe_key) values ('purge_media', ${sql.json({ mediaId: m.id })}, ${`purge:${m.id}`}) on conflict do nothing`;
  }

  // A crashed process leaves jobs "running"; long transcodes are allowed up to 3 hours.
  await sql`update jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - interval '3 hours'`;
  await sql`delete from jobs where status in ('done', 'failed') and updated_at < now() - interval '30 days'`;
  await sql`delete from sessions where expires_at < now()`;
  await sql`delete from telegram_link_codes where expires_at < now() - interval '1 day'`;
  await sql`delete from telegram_updates where received_at < now() - interval '7 days'`;
  await sql`delete from invites where expires_at < now() - interval '30 days'`;

  // Temp files from processes killed mid-job (normal paths delete their own files).
  for (const sub of ["telegram", "work"]) {
    const dir = await tmpDir(sub);
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      const info = await stat(full).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 6 * 3600_000) await rm(full, { recursive: true, force: true });
    }
  }
}

const g = globalThis as unknown as { __workerStarted?: boolean };

export function startWorker({ concurrency = 2, idleMs = 2000 } = {}) {
  if (g.__workerStarted) return;
  g.__workerStarted = true;
  const loop = async () => {
    for (;;) {
      const worked = await runOneJob(handlers).catch((err) => {
        console.error("worker:", (err as Error).message);
        return false;
      });
      if (!worked) await new Promise((r) => setTimeout(r, idleMs));
    }
  };
  for (let i = 0; i < concurrency; i++) void loop();
  const sweep = () => cleanup().catch((err) => console.error("cleanup:", (err as Error).message));
  setTimeout(sweep, 10_000);
  setInterval(sweep, 30 * 60_000).unref();
  console.log(`worker: ${concurrency} ta oqim ishga tushdi`);
}

/** Runs due jobs until none are left or the time budget is spent (serverless: one invocation's spare time). */
export async function drainJobs(budgetMs = 200_000) {
  const started = Date.now();
  // A serverless invocation is killed after maxDuration (300 s); a lock older than that belongs to a dead one.
  await sql`update jobs set status = 'queued', locked_at = null where status = 'running' and locked_at < now() - interval '10 minutes'`;
  while (Date.now() - started < budgetMs) {
    const worked = await runOneJob(handlers).catch((err) => {
      console.error("drain:", (err as Error).message);
      return false;
    });
    if (!worked) break;
  }
}

/**
 * On Vercel nothing runs between requests, so a request that queued work drains the queue right after
 * its response (within the same invocation's maxDuration). Elsewhere the resident worker does it.
 */
export function drainAfterResponse() {
  if (!process.env.VERCEL) return;
  try {
    after(() => drainJobs());
  } catch {
    // Outside a request (scripts): the next request or the daily cron picks the job up.
  }
}
