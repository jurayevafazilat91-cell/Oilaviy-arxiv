import { sql } from "../db";
import { canEditMedia, isAdmin, type CurrentUser } from "../auth";

export type MediaFilters = {
  q?: string;
  keywords?: string[]; // AI-interpreted search terms, matched with OR
  kind?: "image" | "video";
  yearFrom?: number;
  yearTo?: number;
  albumId?: string;
  personId?: string;
  trash?: boolean;
  cursor?: string;
  limit?: number;
};

export type MediaItem = {
  id: string;
  kind: "image" | "video";
  status: "processing" | "ready" | "failed";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sortAt: string;
  takenAt: string | null;
  title: string;
  originalName: string;
  variants: string[];
  error: string | null;
};

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

function wordMatch(word: string) {
  const p = likeEscape(word);
  return sql`(m.title ilike ${p} or m.description ilike ${p} or m.original_name ilike ${p}
    or coalesce(m.ai_caption, '') ilike ${p}
    or array_to_string(m.tags, ' ') ilike ${p} or array_to_string(m.ai_tags, ' ') ilike ${p}
    or exists (select 1 from media_people mp join people pe on pe.id = mp.person_id
               where mp.media_id = m.id and (pe.first_name ilike ${p} or pe.last_name ilike ${p})))`;
}

const encodeCursor = (sortAt: string, id: string) => Buffer.from(`${sortAt}|${id}`).toString("base64url");
function decodeCursor(cursor?: string): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const date = new Date(at);
  return Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? "") ? null : { at: date, id };
}

export async function listMedia(user: CurrentUser, f: MediaFilters): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 120);
  const cursor = decodeCursor(f.cursor);
  const words = (f.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const keywords = (f.keywords ?? []).filter(Boolean).slice(0, 10);
  const admin = isAdmin(user);
  const sortExpr = sql`coalesce(m.taken_at, m.created_at)`;
  const tz = "Asia/Tashkent";

  const rows = await sql<(MediaItem & { sortAtRaw: Date })[]>`
    select m.id, m.kind, m.status, m.width, m.height, m.duration_ms, m.taken_at, m.title, m.original_name, m.variants, m.error,
      ${sortExpr} as sort_at_raw
    from media m
    where m.family_id = ${user.familyId}
      ${f.trash
        ? sql`and m.deleted_at is not null ${admin ? sql`` : sql`and m.uploaded_by = ${user.id}`}`
        : sql`and m.deleted_at is null and (m.status = 'ready' ${admin ? sql`or true` : sql`or m.uploaded_by = ${user.id}`})`}
      ${f.kind ? sql`and m.kind = ${f.kind}` : sql``}
      ${f.yearFrom ? sql`and ${sortExpr} >= make_timestamptz(${f.yearFrom}, 1, 1, 0, 0, 0, ${tz})` : sql``}
      ${f.yearTo ? sql`and ${sortExpr} < make_timestamptz(${f.yearTo + 1}, 1, 1, 0, 0, 0, ${tz})` : sql``}
      ${f.albumId ? sql`and exists (select 1 from album_items ai where ai.media_id = m.id and ai.album_id = ${f.albumId})` : sql``}
      ${f.personId ? sql`and exists (select 1 from media_people mp where mp.media_id = m.id and mp.person_id = ${f.personId})` : sql``}
      ${words.length ? sql`and ${words.map(wordMatch).reduce((a, b) => sql`${a} and ${b}`)}` : sql``}
      ${keywords.length ? sql`and (${keywords.map(wordMatch).reduce((a, b) => sql`${a} or ${b}`)})` : sql``}
      ${cursor ? sql`and (${sortExpr}, m.id) < (${cursor.at}, ${cursor.id})` : sql``}
    order by ${sortExpr} desc, m.id desc
    limit ${limit + 1}`;

  const page = rows.slice(0, limit).map(({ sortAtRaw, ...r }) => ({
    ...r,
    sortAt: sortAtRaw.toISOString(),
    takenAt: r.takenAt ? new Date(r.takenAt).toISOString() : null,
  }));
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeCursor(last.sortAt, last.id) : null };
}

export type MediaDetail = MediaItem & {
  description: string;
  tags: string[];
  mime: string;
  sizeBytes: number;
  source: "web" | "telegram";
  createdAt: string;
  deletedAt: string | null;
  uploadedBy: string | null;
  uploaderName: string | null;
  aiStatus: "pending" | "done" | "failed" | "skipped" | null;
  aiCaption: string | null;
  aiTags: string[];
  aiError: string | null;
  albums: { id: string; title: string }[];
  people: { id: string; name: string }[];
  canEdit: boolean;
};

export async function getMediaDetail(user: CurrentUser, id: string): Promise<MediaDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [m] = await sql<(MediaDetail & { sizeBytes: string })[]>`
    select m.id, m.kind, m.status, m.width, m.height, m.duration_ms, m.taken_at, m.title, m.original_name, m.variants, m.error,
      coalesce(m.taken_at, m.created_at) as sort_at, m.description, m.tags, m.mime, m.size_bytes, m.source, m.created_at,
      m.deleted_at, m.uploaded_by, u.name as uploader_name, m.ai_status, m.ai_caption, m.ai_tags, m.ai_error
    from media m left join users u on u.id = m.uploaded_by
    where m.id = ${id} and m.family_id = ${user.familyId}`;
  if (!m) return null;
  const canEdit = canEditMedia(user, m.uploadedBy);
  // Trashed or unfinished items are only visible to those who could restore or retry them.
  if ((m.deletedAt || m.status !== "ready") && !canEdit) return null;
  const albums = await sql<{ id: string; title: string }[]>`
    select a.id, a.title from album_items ai join albums a on a.id = ai.album_id where ai.media_id = ${id} order by a.title`;
  const people = await sql<{ id: string; name: string }[]>`
    select p.id, trim(p.first_name || ' ' || p.last_name) as name
    from media_people mp join people p on p.id = mp.person_id where mp.media_id = ${id} order by p.first_name`;
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return {
    ...m,
    sizeBytes: Number(m.sizeBytes),
    sortAt: iso(m.sortAt)!,
    takenAt: iso(m.takenAt),
    createdAt: iso(m.createdAt)!,
    deletedAt: iso(m.deletedAt),
    albums,
    people,
    canEdit,
  };
}

/** Rows a user may access through the file route: same family; trashed/unfinished only for editors. */
export async function getMediaForFile(user: CurrentUser, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [m] = await sql<{ id: string; familyId: string; mime: string; originalName: string; variants: string[];
    status: string; deletedAt: Date | null; uploadedBy: string | null; sizeBytes: string; kind: string }[]>`
    select id, family_id, mime, original_name, variants, status, deleted_at, uploaded_by, size_bytes, kind
    from media where id = ${id} and family_id = ${user.familyId}`;
  if (!m) return null;
  if ((m.deletedAt || m.status !== "ready") && !canEditMedia(user, m.uploadedBy)) return null;
  return m;
}
