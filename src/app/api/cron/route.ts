import { safeEqual } from "@/lib/crypto";
import { cleanup, drainJobs } from "@/lib/worker";

export const maxDuration = 300;

/** Daily Vercel Cron (vercel.json): housekeeping plus any jobs that are still waiting (retries, backoff). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("forbidden", { status: 403 });
  await cleanup();
  await drainJobs(240_000);
  return Response.json({ ok: true });
}
