import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { handleUpdate, type TgUpdate } from "@/lib/telegram";

// On Vercel the download/ingest job runs after this response, inside the same invocation.
export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("forbidden", { status: 403 });
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return new Response("bad request", { status: 400 });
  try {
    await handleUpdate(update);
    return new Response("ok");
  } catch (err) {
    console.error("telegram webhook:", (err as Error).message);
    return new Response("retry", { status: 500 }); // Telegram redelivers; handleUpdate is idempotent
  }
}
