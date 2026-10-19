import { sql } from "../db";
import { canUpload, isAdmin, type CurrentUser } from "../auth";
import { env } from "../env";

export type GalleryContext = {
  userId: string;
  isAdmin: boolean;
  canUpload: boolean;
  aiEnabled: boolean;
  albums: { id: string; title: string }[];
  people: { id: string; name: string }[];
  /** Newest first, with the number of files in each year. */
  years: { year: number; count: number }[];
};

/** Lists the pickers and permissions the gallery UI needs; all scoped to the user's family. */
export async function galleryContext(user: CurrentUser): Promise<GalleryContext> {
  const [albums, people, years, family] = await Promise.all([
    sql<{ id: string; title: string }[]>`select id, title from albums where family_id = ${user.familyId} order by lower(title)`,
    sql<{ id: string; name: string }[]>`
      select id, trim(first_name || ' ' || last_name) as name from people where family_id = ${user.familyId} order by first_name, last_name`,
    sql<{ year: number; count: number }[]>`
      select extract(year from coalesce(taken_at, created_at) at time zone 'Asia/Tashkent')::int as year, count(*)::int as count
      from media where family_id = ${user.familyId} and deleted_at is null group by 1 order by 1 desc`,
    sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${user.familyId}`,
  ]);
  return {
    userId: user.id,
    isAdmin: isAdmin(user),
    canUpload: canUpload(user),
    aiEnabled: Boolean(family[0]?.aiEnabled && env().GEMINI_API_KEY),
    albums,
    people,
    years: [...years],
  };
}

export function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v != null ? [v] : []) out.append(k, one);
  return out;
}
