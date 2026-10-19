import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "./db";
import { isSecureApp } from "./env";
import { randomToken, sha256 } from "./crypto";

export type Role = "owner" | "admin" | "member" | "viewer";

export type CurrentUser = {
  id: string;
  familyId: string;
  familyName: string;
  name: string;
  email: string;
  role: Role;
  isTreeEditor: boolean;
};

const SESSION_DAYS = 30;
export const sessionCookieName = () => (isSecureApp() ? "__Host-sid" : "sid");

export async function createSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, ${expires})`;
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureApp(),
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
  jar.delete(sessionCookieName());
}

/** Resolves the signed-in user once per request; null when signed out, expired or disabled. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  const rows = await sql<CurrentUser[]>`
    select u.id, u.family_id, f.name as family_name, u.name, u.email, u.role, u.is_tree_editor
    from sessions s
    join users u on u.id = s.user_id
    join families f on f.id = u.family_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now() and u.disabled_at is null`;
  return rows[0] ?? null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const isAdmin = (u: Pick<CurrentUser, "role">) => u.role === "owner" || u.role === "admin";
export const canUpload = (u: Pick<CurrentUser, "role">) => u.role !== "viewer";
export const canEditTree = (u: Pick<CurrentUser, "role" | "isTreeEditor">) =>
  isAdmin(u) || (u.role === "member" && u.isTreeEditor);
export const canEditMedia = (u: Pick<CurrentUser, "role" | "id">, uploadedBy: string | null) =>
  isAdmin(u) || (u.role === "member" && uploadedBy === u.id);

/** Thrown for authorization failures inside actions and route handlers. */
export class AccessError extends Error {
  constructor(message = "Bu amal uchun ruxsatingiz yoʻq") {
    super(message);
  }
}

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new AccessError(message);
}
