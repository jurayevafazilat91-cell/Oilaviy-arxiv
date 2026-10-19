"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assert, canUpload, isAdmin, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";
import { createLinkCode } from "@/lib/telegram";
import { run, UserError } from "./result";

export async function renameFamilyAction(name: string) {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user));
    await sql`update families set name = ${z.string().trim().min(1).max(80).parse(name)} where id = ${user.familyId}`;
    refresh();
    return null;
  });
}

/** Only the owner decides whether family photos may be sent to Google; consent is recorded. */
export async function setAiEnabledAction(enabled: boolean, consent: boolean) {
  return run(async () => {
    const user = await requireUser();
    assert(user.role === "owner", "AI sozlamasini faqat oila egasi oʻzgartiradi");
    if (enabled && !consent) throw new UserError("Yoqish uchun shartlarga rozilik belgilang");
    if (enabled && !env().GEMINI_API_KEY) throw new UserError("Serverda GEMINI_API_KEY sozlanmagan");
    await sql`
      update families set ai_enabled = ${enabled},
        ai_consent_at = ${enabled ? new Date() : null}, ai_consent_by = ${enabled ? user.id : null}
      where id = ${user.familyId}`;
    if (!enabled) await sql`update media set ai_status = 'skipped' where family_id = ${user.familyId} and ai_status = 'pending'`;
    refresh();
    return null;
  });
}

/** Queues existing photos that have no AI description yet (bounded by the daily budget). */
export async function backfillAiAction() {
  return run(async () => {
    const user = await requireUser();
    assert(user.role === "owner");
    const [f] = await sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${user.familyId}`;
    if (!f.aiEnabled) throw new UserError("Avval AI ni yoqing");
    const rows = await sql<{ id: string }[]>`
      update media set ai_status = 'pending', ai_error = null
      where family_id = ${user.familyId} and kind = 'image' and status = 'ready' and deleted_at is null
        and (ai_status is null or ai_status in ('skipped', 'failed'))
        and id in (select id from media where family_id = ${user.familyId} and kind = 'image' and status = 'ready'
                   and deleted_at is null and (ai_status is null or ai_status in ('skipped', 'failed')) limit ${env().AI_DAILY_LIMIT})
      returning id`;
    for (const r of rows) await enqueue("ai_describe", { mediaId: r.id }, { dedupeKey: `ai:${r.id}`, maxAttempts: 4 });
    refresh();
    return { queued: rows.length };
  });
}

export async function createTelegramCodeAction() {
  return run(async () => {
    const user = await requireUser();
    assert(canUpload(user), "Koʻruvchilar Telegram orqali yuklay olmaydi");
    if (!rateLimit(`tgcode:${user.id}`, 10, 15 * 60_000)) throw new UserError("Juda koʻp urinish. Birozdan keyin qayta urinib koʻring.");
    const bot = env().TELEGRAM_BOT_USERNAME;
    if (!env().TELEGRAM_BOT_TOKEN || !bot) throw new UserError("Telegram bot serverda sozlanmagan");
    const { code, expiresAt } = await createLinkCode(user.id);
    return { code, expiresAt: expiresAt.toISOString(), deepLink: `https://t.me/${bot}?start=${code}` };
  });
}

export async function unlinkTelegramAction() {
  return run(async () => {
    const user = await requireUser();
    await sql`delete from telegram_links where user_id = ${user.id}`;
    refresh();
    return null;
  });
}
