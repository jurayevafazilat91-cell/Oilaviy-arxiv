"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { assert, createSession, destroySession, isAdmin, requireUser, type Role } from "@/lib/auth";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { run, UserError, type ActionResult } from "./result";

/** `fields` echoes non-secret inputs so React 19's post-action form reset does not wipe them. */
export type FormState = { error?: string; ok?: boolean; fields?: Record<string, string> } | undefined;

const email = z.email("Email notoʻgʻri").max(200).transform((e) => e.trim().toLowerCase());
const password = z.string().min(10, "Parol kamida 10 belgidan iborat boʻlsin").max(200);
const name = z.string().trim().min(1, "Ismingizni kiriting").max(80);
const INVITE_DAYS = 7;
// Keeps login timing similar whether or not the email exists.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

async function guard(key: string, limit: number) {
  const ip = clientIp(await headers());
  if (!rateLimit(`${key}:${ip}`, limit, 15 * 60_000)) throw new UserError("Juda koʻp urinish. 15 daqiqadan keyin qayta urinib koʻring.");
}

const KEEP = ["email", "name", "familyName"];
const formError = (r: ActionResult<unknown>, form?: FormData): FormState =>
  r.ok ? undefined : {
    error: r.error,
    fields: form ? Object.fromEntries(KEEP.filter((k) => typeof form.get(k) === "string").map((k) => [k, String(form.get(k))])) : undefined,
  };

export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async () => {
    await guard("setup", 10);
    const input = z.object({ familyName: z.string().trim().min(1, "Oila nomini kiriting").max(80), name, email, password })
      .parse(Object.fromEntries(form));
    const hash = await hashPassword(input.password);
    const userId = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(4242)`;
      const [existing] = await tx`select 1 from users limit 1`;
      if (existing) throw new UserError("Arxiv allaqachon sozlangan. Tizimga kiring.");
      const [family] = await tx<{ id: string }[]>`insert into families (name) values (${input.familyName}) returning id`;
      const [user] = await tx<{ id: string }[]>`
        insert into users (family_id, email, name, password_hash, role, is_tree_editor)
        values (${family.id}, ${input.email}, ${input.name}, ${hash}, 'owner', true) returning id`;
      return user.id;
    });
    await createSession(userId);
  });
  if (r.ok) redirect("/");
  return formError(r, form);
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async () => {
    const input = z.object({ email, password: z.string().min(1, "Parolni kiriting").max(200) }).parse(Object.fromEntries(form));
    await guard(`login:${input.email}`, 8);
    const [user] = await sql<{ id: string; passwordHash: string; disabledAt: Date | null }[]>`
      select id, password_hash, disabled_at from users where lower(email) = ${input.email}`;
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.disabledAt) throw new UserError("Email yoki parol notoʻgʻri");
    await createSession(user.id);
  });
  if (r.ok) redirect("/");
  return formError(r, form);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function acceptInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async () => {
    await guard("invite", 20);
    const token = z.string().min(20).max(100).parse(form.get("token"));
    const userId = await sql.begin(async (tx) => {
      const [inv] = await tx<{ id: string; familyId: string; kind: string; role: Role; userId: string | null }[]>`
        update invites set used_at = now()
        where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
        returning id, family_id, kind, role, user_id`;
      if (!inv) throw new UserError("Havola notoʻgʻri, ishlatilgan yoki muddati oʻtgan. Admindan yangisini soʻrang.");
      if (inv.kind === "reset") {
        const pw = password.parse(form.get("password"));
        await tx`update users set password_hash = ${await hashPassword(pw)} where id = ${inv.userId} and disabled_at is null`;
        await tx`delete from sessions where user_id = ${inv.userId}`;
        return inv.userId!;
      }
      const input = z.object({ name, email, password }).parse(Object.fromEntries(form));
      const [taken] = await tx`select 1 from users where lower(email) = ${input.email}`;
      if (taken) throw new UserError("Bu email bilan akkaunt allaqachon bor");
      const [user] = await tx<{ id: string }[]>`
        insert into users (family_id, email, name, password_hash, role)
        values (${inv.familyId}, ${input.email}, ${input.name}, ${await hashPassword(input.password)}, ${inv.role}) returning id`;
      return user.id;
    });
    await createSession(userId);
  });
  if (r.ok) redirect("/");
  return formError(r, form);
}

export async function createInviteAction(role: "admin" | "member" | "viewer") {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user));
    z.enum(["admin", "member", "viewer"]).parse(role);
    assert(role !== "admin" || user.role === "owner", "Admin taklifini faqat oila egasi yarata oladi");
    const token = randomToken();
    await sql`
      insert into invites (family_id, token_hash, kind, role, created_by, expires_at)
      values (${user.familyId}, ${sha256(token)}, 'invite', ${role}, ${user.id}, now() + make_interval(days => ${INVITE_DAYS}))`;
    refresh();
    return { url: `${env().APP_URL}/invite/${token}` };
  });
}

export async function createResetLinkAction(userId: string) {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user));
    const [target] = await sql<{ role: Role }[]>`select role from users where id = ${z.uuid().parse(userId)} and family_id = ${user.familyId}`;
    assert(target, "Foydalanuvchi topilmadi");
    assert(target.role !== "owner" || user.role === "owner", "Egasining parolini faqat egasi tiklay oladi");
    const token = randomToken();
    await sql`
      insert into invites (family_id, token_hash, kind, user_id, created_by, expires_at)
      values (${user.familyId}, ${sha256(token)}, 'reset', ${userId}, ${user.id}, now() + interval '24 hours')`;
    return { url: `${env().APP_URL}/invite/${token}` };
  });
}

export async function revokeInviteAction(id: string) {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user));
    await sql`delete from invites where id = ${z.uuid().parse(id)} and family_id = ${user.familyId} and used_at is null`;
    refresh();
    return null;
  });
}

export async function updateMemberAction(userId: string, patch: { role?: Role; disabled?: boolean; isTreeEditor?: boolean }) {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user));
    const p = z.object({
      role: z.enum(["admin", "member", "viewer"]).optional(),
      disabled: z.boolean().optional(),
      isTreeEditor: z.boolean().optional(),
    }).parse(patch);
    const [target] = await sql<{ role: Role }[]>`select role from users where id = ${z.uuid().parse(userId)} and family_id = ${user.familyId}`;
    assert(target, "Foydalanuvchi topilmadi");
    assert(target.role !== "owner", "Oila egasini oʻzgartirib boʻlmaydi");
    assert(userId !== user.id, "Oʻz rolingizni oʻzgartira olmaysiz");
    assert(user.role === "owner" || (target.role !== "admin" && p.role !== "admin"), "Adminlarni faqat egasi boshqaradi");
    await sql.begin(async (tx) => {
      if (p.role) await tx`update users set role = ${p.role} where id = ${userId}`;
      if (p.isTreeEditor !== undefined) await tx`update users set is_tree_editor = ${p.isTreeEditor} where id = ${userId}`;
      if (p.disabled !== undefined) {
        await tx`update users set disabled_at = ${p.disabled ? new Date() : null} where id = ${userId}`;
        if (p.disabled) {
          await tx`delete from sessions where user_id = ${userId}`;
          await tx`delete from telegram_links where user_id = ${userId}`;
        }
      }
      if (p.role === "viewer") await tx`delete from telegram_links where user_id = ${userId}`;
    });
    refresh();
    return null;
  });
}

export async function updateProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async () => {
    const user = await requireUser();
    await sql`update users set name = ${name.parse(form.get("name"))} where id = ${user.id}`;
    refresh();
  });
  return r.ok ? { ok: true } : formError(r);
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await run(async () => {
    const user = await requireUser();
    await guard(`pw:${user.id}`, 10);
    const current = z.string().min(1, "Joriy parolni kiriting").parse(form.get("current"));
    const next = password.parse(form.get("next"));
    const [row] = await sql<{ passwordHash: string }[]>`select password_hash from users where id = ${user.id}`;
    if (!(await verifyPassword(current, row.passwordHash))) throw new UserError("Joriy parol notoʻgʻri");
    await sql`update users set password_hash = ${await hashPassword(next)} where id = ${user.id}`;
    await sql`delete from sessions where user_id = ${user.id}`;
    await createSession(user.id); // other devices are signed out
  });
  return r.ok ? { ok: true } : formError(r);
}
