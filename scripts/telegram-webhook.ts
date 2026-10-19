// Registers the production webhook: APP_URL/api/telegram/webhook with the secret header.
import { env } from "../src/lib/env";
import { tg } from "../src/lib/telegram";

async function main() {
  const e = env();
  if (!e.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET sozlanmagan");
  if (!e.APP_URL.startsWith("https://") && !e.TELEGRAM_LOCAL_SERVER) throw new Error("Webhook uchun APP_URL https boʻlishi kerak");
  const url = `${e.APP_URL}/api/telegram/webhook`;
  // max_connections 1 keeps album parts in order (their caption usually arrives first).
  await tg("setWebhook", { url, secret_token: e.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], max_connections: 1 });
  console.log("Webhook oʻrnatildi:", url);
  console.log(await tg("getWebhookInfo"));
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
