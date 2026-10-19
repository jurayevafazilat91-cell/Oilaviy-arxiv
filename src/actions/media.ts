"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { assert, canEditMedia, canUpload, isAdmin, requireUser, type CurrentUser } from "@/lib/auth";
import { interpretSearch } from "@/lib/ai";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs";
import { addToAlbum, purgeMedia } from "@/lib/media/ingest";
import { rateLimit } from "@/lib/rate-limit";
import { tagPerson } from "@/lib/tree";
import { run, UserError } from "./result";

const ids = z.array(z.uuid()).min(1).max(200);
const tagList = z.array(z.string().trim().toLowerCase().max(40)).max(30)
  .transform((t) => [...new Set(t.filter(Boolean))]);

/** Returns only the ids this user may modify; anything else in the request is an authorization failure. */
async function editable(user: CurrentUser, mediaIds: string[]) {
  const rows = await sql<{ id: string; uploadedBy: string | null }[]>`
    select id, uploaded_by from media where family_id = ${user.familyId} and id = any(${mediaIds}::uuid[])`;
  assert(rows.length === new Set(mediaIds).size && rows.every((r) => canEditMedia(user, r.uploadedBy)));
  return rows.map((r) => r.id);
}

export async function updateMediaAction(id: string, patch: { title: string; description: string; tags: string[]; takenDate: string | null }) {
  return run(async () => {
    const user = await requireUser();
    const [mediaId] = await editable(user, [z.uuid().parse(id)]);
    const p = z.object({
      title: z.string().trim().max(200),
      description: z.string().trim().max(5000),
      tags: tagList,
      takenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }).parse(patch);
    // A date chosen by hand means noon in the family's zone, so it never slips to another day.
    const takenAt = p.takenDate ? new Date(`${p.takenDate}T12:00:00+05:00`) : null;
    await sql`
      update media set title = ${p.title}, description = ${p.description}, tags = ${p.tags},
        taken_at = ${takenAt}, updated_at = now()
      where id = ${mediaId}`;
    refresh();
    return null;
  });
}

export async function trashMediaAction(mediaIds: string[]) {
  return run(async () => {
    const user = await requireUser();
    const ok = await editable(user, ids.parse(mediaIds));
    await sql`update media set deleted_at = now(), updated_at = now() where id = any(${ok}::uuid[]) and deleted_at is null`;
    refresh();
    return null;
  });
}

export async function restoreMediaAction(mediaIds: string[]) {
  return run(async () => {
    const user = await requireUser();
    const ok = await editable(user, ids.parse(mediaIds));
    await sql`update media set deleted_at = null, updated_at = now() where id = any(${ok}::uuid[])`;
    refresh();
    return null;
  });
}

export async function purgeMediaAction(mediaIds: string[]) {
  return run(async () => {
    const user = await requireUser();
    assert(isAdmin(user), "Butunlay oʻchirish faqat admin uchun");
    const rows = await sql<{ id: string }[]>`
      select id from media where family_id = ${user.familyId} and id = any(${ids.parse(mediaIds)}::uuid[]) and deleted_at is not null`;
    for (const r of rows) await purgeMedia(r.id);
    refresh();
    return null;
  });
}

export async function editAiAction(id: string, patch: { caption: string | null; tags: string[] }) {
  return run(async () => {
    const user = await requireUser();
    const [mediaId] = await editable(user, [z.uuid().parse(id)]);
    const caption = z.string().trim().max(300).nullable().parse(patch.caption);
    await sql`update media set ai_caption = ${caption || null}, ai_tags = ${tagList.parse(patch.tags)} where id = ${mediaId}`;
    return null;
  });
}

export async function rerunAiAction(id: string) {
  return run(async () => {
    const user = await requireUser();
    const [mediaId] = await editable(user, [z.uuid().parse(id)]);
    const [f] = await sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${user.familyId}`;
    if (!f.aiEnabled || !env().GEMINI_API_KEY) throw new UserError("AI yoqilmagan");
    await sql`update media set ai_status = 'pending', ai_error = null where id = ${mediaId} and kind = 'image'`;
    await enqueue("ai_describe", { mediaId }, { dedupeKey: `ai:${mediaId}`, maxAttempts: 4 });
    return null;
  });
}

export async function tagPersonAction(mediaId: string, personId: string, on: boolean) {
  return run(async () => {
    const user = await requireUser();
    assert(canUpload(user));
    await tagPerson(user, z.uuid().parse(mediaId), z.uuid().parse(personId), on);
    return null;
  });
}

export async function aiSearchAction(query: string) {
  return run(async () => {
    const user = await requireUser();
    const q = z.string().trim().min(2).max(200).parse(query);
    const [f] = await sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${user.familyId}`;
    if (!f.aiEnabled || !env().GEMINI_API_KEY) throw new UserError("AI qidiruv oʻchiq");
    if (!rateLimit(`aisearch:${user.id}`, 30, 60_000)) throw new UserError("Juda koʻp soʻrov. Bir daqiqadan keyin urinib koʻring.");
    return interpretSearch(q);
  });
}

// ---------- Albums ----------

const albumInput = z.object({ title: z.string().trim().min(1, "Albom nomini kiriting").max(120), description: z.string().trim().max(2000) });

export async function createAlbumAction(input: { title: string; description: string }) {
  return run(async () => {
    const user = await requireUser();
    assert(canUpload(user));
    const p = albumInput.parse(input);
    const [row] = await sql<{ id: string }[]>`
      insert into albums (family_id, title, description, created_by) values (${user.familyId}, ${p.title}, ${p.description}, ${user.id})
      on conflict (family_id, lower(title)) do nothing returning id`;
    if (!row) throw new UserError("Bunday nomli albom bor");
    refresh();
    return { id: row.id };
  });
}

async function ownAlbum(user: CurrentUser, albumId: string) {
  const [a] = await sql<{ createdBy: string | null }[]>`select created_by from albums where id = ${z.uuid().parse(albumId)} and family_id = ${user.familyId}`;
  assert(a, "Albom topilmadi");
  assert(isAdmin(user) || (user.role === "member" && a.createdBy === user.id));
}

export async function updateAlbumAction(albumId: string, input: { title: string; description: string }) {
  return run(async () => {
    const user = await requireUser();
    await ownAlbum(user, albumId);
    const p = albumInput.parse(input);
    const [dup] = await sql`select 1 from albums where family_id = ${user.familyId} and lower(title) = lower(${p.title}) and id <> ${albumId}`;
    if (dup) throw new UserError("Bunday nomli albom bor");
    await sql`update albums set title = ${p.title}, description = ${p.description} where id = ${albumId}`;
    refresh();
    return null;
  });
}

/** Deleting an album never deletes its photos. */
export async function deleteAlbumAction(albumId: string) {
  return run(async () => {
    const user = await requireUser();
    await ownAlbum(user, albumId);
    await sql`delete from albums where id = ${albumId}`;
    refresh();
    return null;
  });
}

export async function addToAlbumAction(albumId: string, mediaIds: string[]) {
  return run(async () => {
    const user = await requireUser();
    assert(canUpload(user));
    for (const id of ids.parse(mediaIds)) await addToAlbum(user.familyId, z.uuid().parse(albumId), id);
    refresh();
    return null;
  });
}

export async function removeFromAlbumAction(albumId: string, mediaIds: string[]) {
  return run(async () => {
    const user = await requireUser();
    assert(canUpload(user));
    await sql`
      delete from album_items ai using albums a
      where ai.album_id = a.id and a.family_id = ${user.familyId} and a.id = ${z.uuid().parse(albumId)}
        and ai.media_id = any(${ids.parse(mediaIds)}::uuid[])`;
    refresh();
    return null;
  });
}

export async function setAlbumCoverAction(albumId: string, mediaId: string) {
  return run(async () => {
    const user = await requireUser();
    await ownAlbum(user, albumId);
    await sql`
      update albums set cover_media_id = m.id from media m
      where albums.id = ${albumId} and m.id = ${z.uuid().parse(mediaId)} and m.family_id = ${user.familyId}`;
    refresh();
    return null;
  });
}
