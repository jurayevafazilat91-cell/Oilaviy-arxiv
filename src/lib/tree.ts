import { z } from "zod";
import { sql, type Tx } from "./db";
import { isAdmin, type CurrentUser } from "./auth";

export class TreeError extends Error {}

const partialDate = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Sana YYYY, YYYY-MM yoki YYYY-MM-DD koʻrinishida boʻlsin")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    if (m !== undefined && (m < 1 || m > 12)) return false;
    if (d !== undefined && (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())) return false;
    return y >= 1000 && y <= new Date().getFullYear() + 1;
  }, "Bunday sana yoʻq")
  .nullable()
  .optional()
  .transform((v) => v || null);

export const personInput = z.object({
  firstName: z.string().trim().min(1, "Ism kiriting").max(80),
  lastName: z.string().trim().max(80).default(""),
  patronymic: z.string().trim().max(80).default(""),
  gender: z.enum(["male", "female"]).nullable().optional().transform((v) => v ?? null),
  birthDate: partialDate,
  deathDate: partialDate,
  isLiving: z.boolean(),
  birthPlace: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(4000).default(""),
});
export type PersonInput = z.infer<typeof personInput>;

export type Person = PersonInput & {
  id: string;
  userId: string | null;
  avatarMediaId: string | null;
};
export type Relationship = {
  id: string;
  type: "parent" | "spouse";
  personA: string;
  personB: string;
  subtype: string;
  startDate: string | null;
  endDate: string | null;
};

const PARENT_SUBTYPES = ["biological", "adoptive", "step", "foster"] as const;
const SPOUSE_SUBTYPES = ["married", "divorced", "widowed", "partner"] as const;

export const relationshipInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("parent"), parentId: z.uuid(), childId: z.uuid(), subtype: z.enum(PARENT_SUBTYPES) }),
  z.object({
    type: z.literal("spouse"), aId: z.uuid(), bId: z.uuid(), subtype: z.enum(SPOUSE_SUBTYPES),
    startDate: partialDate, endDate: partialDate,
  }),
]);
export type RelationshipInput = z.infer<typeof relationshipInput>;

/** Living people are private: viewers only see the birth year, never places or notes. */
export function redactPerson(p: Person, viewer: Pick<CurrentUser, "role">): Person {
  if (!p.isLiving || viewer.role !== "viewer") return p;
  return { ...p, birthDate: p.birthDate?.slice(0, 4) ?? null, birthPlace: "", notes: "" };
}

export async function loadTree(user: CurrentUser): Promise<{ people: Person[]; relationships: Relationship[] }> {
  // Avatar: the chosen photo, else the newest photo the person is tagged in.
  const people = await sql<Person[]>`
    select p.id, p.first_name, p.last_name, p.patronymic, p.gender, p.birth_date, p.death_date, p.is_living, p.birth_place, p.notes,
      p.user_id,
      coalesce(p.avatar_media_id, (
        select m.id from media_people mp join media m on m.id = mp.media_id
        where mp.person_id = p.id and m.kind = 'image' and m.deleted_at is null and 'thumb' = any(m.variants)
        order by coalesce(m.taken_at, m.created_at) desc limit 1
      )) as avatar_media_id
    from people p where p.family_id = ${user.familyId} order by p.birth_date nulls last, p.first_name`;
  const relationships = await sql<Relationship[]>`
    select id, type, person_a, person_b, subtype, start_date, end_date from relationships where family_id = ${user.familyId}`;
  return { people: people.map((p) => redactPerson(p, user)), relationships };
}

const lockFamily = (tx: Tx, familyId: string) => tx`select pg_advisory_xact_lock(hashtextextended(${familyId}, 42))`;

async function assertPeopleInFamily(tx: Tx, familyId: string, ids: string[]) {
  const rows = await tx`select id from people where family_id = ${familyId} and id = any(${ids}::uuid[])`;
  if (rows.length !== new Set(ids).size) throw new TreeError("Odam topilmadi");
}

/**
 * Adds a confirmed relationship. Rejects self-links, duplicates, ancestry cycles and a third biological parent.
 * Runs under a per-family lock so two concurrent edits cannot create a cycle together.
 */
export async function addRelationship(user: CurrentUser, input: RelationshipInput): Promise<string> {
  return sql.begin(async (tx) => {
    await lockFamily(tx, user.familyId);
    if (input.type === "parent") {
      const { parentId, childId, subtype } = input;
      if (parentId === childId) throw new TreeError("Odam oʻziga ota-ona boʻla olmaydi");
      await assertPeopleInFamily(tx, user.familyId, [parentId, childId]);
      const [existing] = await tx`
        select 1 from relationships where type = 'parent' and person_a = ${parentId} and person_b = ${childId}`;
      if (existing) throw new TreeError("Bu bogʻlanish allaqachon bor");
      // Cycle: the new parent must not already descend from the child.
      const [cycle] = await tx`
        with recursive descendants(id) as (
          select person_b from relationships where type = 'parent' and person_a = ${childId}
          union
          select r.person_b from relationships r join descendants d on r.person_a = d.id where r.type = 'parent'
        )
        select 1 from descendants where id = ${parentId}`;
      if (cycle) throw new TreeError("Bu bogʻlanish ajdodlar tsiklini hosil qiladi (odam oʻz avlodiga ota-ona boʻlib qoladi)");
      if (subtype === "biological") {
        const [{ count }] = await tx<{ count: string }[]>`
          select count(*) from relationships where type = 'parent' and subtype = 'biological' and person_b = ${childId}`;
        if (Number(count) >= 2) throw new TreeError("Bu odamning ikkita biologik ota-onasi allaqachon koʻrsatilgan");
      }
      const [row] = await tx<{ id: string }[]>`
        insert into relationships (family_id, type, person_a, person_b, subtype)
        values (${user.familyId}, 'parent', ${parentId}, ${childId}, ${subtype}) returning id`;
      return row.id;
    }

    const [a, b] = [input.aId, input.bId].sort();
    if (a === b) throw new TreeError("Odam oʻziga turmush oʻrtoq boʻla olmaydi");
    await assertPeopleInFamily(tx, user.familyId, [a, b]);
    const [existing] = await tx`select 1 from relationships where type = 'spouse' and person_a = ${a} and person_b = ${b}`;
    if (existing) throw new TreeError("Bu bogʻlanish allaqachon bor");
    const [row] = await tx<{ id: string }[]>`
      insert into relationships (family_id, type, person_a, person_b, subtype, start_date, end_date)
      values (${user.familyId}, 'spouse', ${a}, ${b}, ${input.subtype}, ${input.startDate}, ${input.endDate}) returning id`;
    return row.id;
  });
}

export async function removeRelationship(user: CurrentUser, id: string) {
  await sql`delete from relationships where id = ${id} and family_id = ${user.familyId}`;
}

export async function savePerson(user: CurrentUser, input: PersonInput, id?: string): Promise<string> {
  if (input.deathDate && input.isLiving) throw new TreeError("Vafot sanasi bor odam tirik deb belgilanmaydi");
  if (input.birthDate && input.deathDate && input.deathDate < input.birthDate) throw new TreeError("Vafot sanasi tugʻilgan sanadan oldin boʻla olmaydi");
  if (id) {
    const [row] = await sql<{ id: string }[]>`
      update people set first_name = ${input.firstName}, last_name = ${input.lastName}, patronymic = ${input.patronymic},
        gender = ${input.gender}, birth_date = ${input.birthDate}, death_date = ${input.deathDate}, is_living = ${input.isLiving},
        birth_place = ${input.birthPlace}, notes = ${input.notes}, updated_at = now()
      where id = ${id} and family_id = ${user.familyId} returning id`;
    if (!row) throw new TreeError("Odam topilmadi");
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into people (family_id, first_name, last_name, patronymic, gender, birth_date, death_date, is_living, birth_place, notes, created_by)
    values (${user.familyId}, ${input.firstName}, ${input.lastName}, ${input.patronymic}, ${input.gender}, ${input.birthDate},
            ${input.deathDate}, ${input.isLiving}, ${input.birthPlace}, ${input.notes}, ${user.id})
    returning id`;
  return row.id;
}

export async function deletePerson(user: CurrentUser, id: string) {
  await sql`delete from people where id = ${id} and family_id = ${user.familyId}`;
}

/** Person ↔ account link is optional and admin-only: it reveals who an account belongs to. */
export async function linkPersonToUser(user: CurrentUser, personId: string, userId: string | null) {
  if (!isAdmin(user)) throw new TreeError("Faqat admin bogʻlay oladi");
  await sql.begin(async (tx) => {
    if (userId) {
      const [u] = await tx`select 1 from users where id = ${userId} and family_id = ${user.familyId}`;
      if (!u) throw new TreeError("Foydalanuvchi topilmadi");
      await tx`update people set user_id = null where user_id = ${userId} and family_id = ${user.familyId}`;
    }
    const rows = await tx`update people set user_id = ${userId} where id = ${personId} and family_id = ${user.familyId} returning id`;
    if (!rows.length) throw new TreeError("Odam topilmadi");
  });
}

export async function tagPerson(user: CurrentUser, mediaId: string, personId: string, on: boolean) {
  if (on) {
    await sql`
      insert into media_people (media_id, person_id)
      select m.id, p.id from media m join people p on p.family_id = m.family_id
      where m.id = ${mediaId} and p.id = ${personId} and m.family_id = ${user.familyId}
      on conflict do nothing`;
  } else {
    await sql`
      delete from media_people mp using media m
      where mp.media_id = m.id and m.family_id = ${user.familyId} and mp.media_id = ${mediaId} and mp.person_id = ${personId}`;
  }
}
