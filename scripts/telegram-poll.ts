// Development alternative to the webhook: long-polls Telegram and feeds updates to the same handler.
// The Next.js server (npm run dev) must be running too — it runs the background jobs that download files.
import { sql } from "../src/lib/db";
import { handleUpdate, tg, type TgUpdate } from "../src/lib/telegram";

async function main() {
  await tg("deleteWebhook", { drop_pending_updates: false });
  console.log("Telegram polling boshlandi (Ctrl+C — toʻxtatish)");
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }, 60_000);
      for (const u of updates) {
        await handleUpdate(u);
        offset = u.update_id + 1;
      }
    } catch (err) {
      console.error("polling:", (err as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().finally(() => sql.end());
