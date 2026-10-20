// Gemini is replaced by a local test double (GEMINI_API_BASE in .env.test); this checks our handling, not Google's model.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { interpretSearch } from "../src/lib/ai";
import { createUpload, completeUpload, writeChunk } from "../src/lib/media/uploads";
import { addRelationship, addSampleRelatives, loadTree, redactPerson, savePerson, setPersonAvatar, type Person } from "../src/lib/tree";
import { layoutTree, lineageOf } from "../src/lib/tree-layout";
import { drainJobs, fakeServer, jpegFixture, makeUser, read, resetDb, sql } from "./helpers";

let reply: { status: number; body: unknown } = { status: 200, body: {} };
let requests: { url: string; body: Record<string, unknown> }[] = [];
let server: Awaited<ReturnType<typeof fakeServer>>;
const geminiText = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

before(async () => {
  server = await fakeServer(45998, (req, body, res) => {
    requests.push({ url: req.url ?? "", body: JSON.parse(body.toString() || "{}") });
    res.writeHead(reply.status, { "Content-Type": "application/json" }).end(JSON.stringify(reply.body));
  });
});
after(async () => {
  await server.close();
  await sql.end();
});
beforeEach(async () => {
  await resetDb();
  requests = [];
});

async function uploadPhoto(user: Awaited<ReturnType<typeof makeUser>>) {
  const bytes = read(await jpegFixture());
  let up = await createUpload(user, { fileName: "a.jpg", size: bytes.length, clientKey: String(Math.random()), albumId: null });
  up = await writeChunk(up, 0, bytes);
  await completeUpload(up);
  await drainJobs(true);
  const [m] = await sql`select id, ai_status, ai_caption, ai_tags, ai_error from media`;
  return m;
}

describe("AI descriptions", () => {
  test("no request is made while the family has not consented", async () => {
    const owner = await makeUser("owner");
    const m = await uploadPhoto(owner);
    assert.equal(m.aiStatus, null);
    assert.equal(requests.length, 0);
  });

  test("with consent: small JPEG sent, output sanitised and stored as AI-labelled fields", async () => {
    const owner = await makeUser("owner");
    await sql`update families set ai_enabled = true`;
    reply = { status: 200, body: geminiText({ caption: "  Dengiz boʻyida   quyosh botishi. ", tags: ["Dengiz", "dengiz", "#plyaj", "x".repeat(90)] }) };
    const m = await uploadPhoto(owner);
    assert.equal(m.aiStatus, "done");
    assert.equal(m.aiCaption, "Dengiz boʻyida quyosh botishi.");
    assert.deepEqual(m.aiTags, ["dengiz", "plyaj", "x".repeat(40)]);
    const sent = requests[0].body as { contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[] };
    const image = sent.contents[0].parts.find((p) => p.inlineData)!.inlineData!;
    assert.equal(image.mimeType, "image/jpeg");
    const buf = Buffer.from(image.data, "base64");
    const { default: sharp } = await import("sharp");
    const meta = await sharp(buf).metadata();
    assert.ok(meta.width! <= 1024 && meta.exif === undefined, "only a downscaled, EXIF-free copy leaves the server");
    assert.match(requests[0].url, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
  });

  test("provider errors are retried then recorded; core upload still succeeds", async () => {
    const owner = await makeUser("owner");
    await sql`update families set ai_enabled = true`;
    reply = { status: 503, body: { error: "overloaded" } };
    const m = await uploadPhoto(owner);
    assert.equal(m.aiStatus, "failed");
    assert.equal(requests.length, 4, "bounded retries");
    const [media] = await sql`select status from media`;
    assert.equal(media.status, "ready");
  });

  test("malformed model output is rejected without retry; daily budget is enforced", async () => {
    const owner = await makeUser("owner");
    await sql`update families set ai_enabled = true`;
    reply = { status: 200, body: geminiText({ unexpected: true }) };
    const m = await uploadPhoto(owner);
    assert.equal(m.aiStatus, "failed");
    assert.equal(requests.length, 1);

    await sql`insert into ai_usage (family_id, day, requests) values (${owner.familyId}, current_date, 100000)
              on conflict (family_id, day) do update set requests = 100000`;
    await sql`truncate media cascade`;
    const m2 = await uploadPhoto(owner);
    assert.equal(m2.aiStatus, "skipped");
    assert.match(m2.aiError, /limiti/);
  });

  test("search intent output is clamped to safe filters", async () => {
    reply = { status: 200, body: geminiText({ keywords: ["Dengiz", "plyaj"], kind: "spaceship", yearFrom: 2019, yearTo: 99999 }) };
    const intent = await interpretSearch("2019-yil dengizdagi rasmlar");
    assert.deepEqual(intent, { keywords: ["dengiz", "plyaj"], kind: "any", yearFrom: 2019, yearTo: null });
  });
});

describe("family tree", () => {
  const person = (firstName: string, extra: Partial<Parameters<typeof savePerson>[1]> = {}) => ({
    firstName, lastName: "", patronymic: "", gender: null, birthDate: null, deathDate: null, isLiving: true, birthPlace: "", notes: "", ...extra,
  });

  test("sample relatives fill grandparents to grandchildren around an unlinked person, once", async () => {
    const editor = await makeUser("admin");
    const me = await savePerson(editor, person("Abdullox", { lastName: "Jurayev", gender: "male" }));
    await addSampleRelatives(editor, me);
    const { people, relationships } = await loadTree(editor);
    assert.equal(people.length, 10);
    const by = Object.fromEntries(people.map((p) => [p.id, p]));
    const name = (id: string) => `${by[id].firstName} ${by[id].lastName}`.trim();
    const parentsOf = (id: string) => relationships.filter((r) => r.type === "parent" && r.personB === id).map((r) => name(r.personA)).sort();
    const id = (first: string) => people.find((p) => p.firstName === first)!.id;
    assert.deepEqual(parentsOf(me), ["Ona Jurayeva", "Ota Jurayev"]);
    assert.deepEqual(parentsOf(id("Ota")), ["Bobo Jurayev", "Buvi Jurayeva"]);
    assert.deepEqual(parentsOf(id("Qiz")), ["Abdullox Jurayev", "Turmush oʻrtogʻi Jurayeva"]);
    assert.equal(people.filter((p) => p.firstName === "Nevara").every((p) => parentsOf(p.id)[0] === "Oʻgʻil Jurayev"), true);
    const { nodes } = layoutTree(people.map((p) => p.id), relationships);
    assert.equal(new Set(nodes.map((n) => n.gen)).size, 5, "bobo-buvi → ota-ona → me → children → grandchildren");
    await assert.rejects(addSampleRelatives(editor, me), /bogʻlanmagan/);
  });

  test("a portrait becomes the person's avatar and tags them; another family's photo is refused", async () => {
    const editor = await makeUser("admin");
    const me = await savePerson(editor, person("Abdullox"));
    const photo = await uploadPhoto(editor);
    await setPersonAvatar(editor, me, photo.id);
    const { people } = await loadTree(editor);
    assert.equal(people[0].avatarMediaId, photo.id);
    assert.equal((await sql`select 1 from media_people where person_id = ${me}`).length, 1);
    const stranger = await makeUser("admin");
    const theirs = await savePerson(stranger, person("Begona"));
    await assert.rejects(setPersonAvatar(stranger, theirs, photo.id), /topilmadi/);
  });

  test("rejects self-links, duplicates, cycles and a third biological parent; allows step/adoptive", async () => {
    const editor = await makeUser("admin");
    const [grand, father, mother, child, step] = await Promise.all(
      ["Bobo", "Ota", "Ona", "Bola", "Oʻgay ota"].map((n) => savePerson(editor, person(n))),
    );
    await addRelationship(editor, { type: "parent", parentId: grand, childId: father, subtype: "biological" });
    await addRelationship(editor, { type: "parent", parentId: father, childId: child, subtype: "biological" });
    await addRelationship(editor, { type: "parent", parentId: mother, childId: child, subtype: "biological" });
    await addRelationship(editor, { type: "spouse", aId: father, bId: mother, subtype: "married", startDate: "1990", endDate: null });

    await assert.rejects(addRelationship(editor, { type: "parent", parentId: child, childId: child, subtype: "biological" }), /oʻziga/);
    await assert.rejects(addRelationship(editor, { type: "parent", parentId: father, childId: child, subtype: "biological" }), /allaqachon/);
    await assert.rejects(addRelationship(editor, { type: "spouse", aId: mother, bId: father, subtype: "married", startDate: null, endDate: null }), /allaqachon/);
    await assert.rejects(addRelationship(editor, { type: "parent", parentId: child, childId: grand, subtype: "biological" }), /tsikl/);
    await assert.rejects(addRelationship(editor, { type: "parent", parentId: step, childId: child, subtype: "biological" }), /ikkita biologik/);
    await addRelationship(editor, { type: "parent", parentId: step, childId: child, subtype: "step" });

    const other = await makeUser("admin");
    await assert.rejects(addRelationship(other, { type: "parent", parentId: grand, childId: step, subtype: "biological" }), /topilmadi/);
  });

  test("partial dates are validated", async () => {
    const editor = await makeUser("admin");
    await savePerson(editor, person("A", { birthDate: "1950" }));
    await savePerson(editor, person("B", { birthDate: "1950-03" }));
    await assert.rejects(savePerson(editor, person("C", { deathDate: "2000", isLiving: true })), /tirik/);
  });

  test("living people are redacted for viewers only", () => {
    const p = { id: "1", firstName: "A", lastName: "", patronymic: "", gender: null, birthDate: "1990-05-17", deathDate: null,
      isLiving: true, birthPlace: "Toshkent", notes: "telefon", userId: null, avatarMediaId: null } satisfies Person;
    assert.deepEqual(
      [redactPerson(p, { role: "viewer" }).birthDate, redactPerson(p, { role: "viewer" }).birthPlace, redactPerson(p, { role: "viewer" }).notes],
      ["1990", "", ""],
    );
    assert.equal(redactPerson(p, { role: "member" }).birthDate, "1990-05-17");
    assert.equal(redactPerson({ ...p, isLiving: false }, { role: "viewer" }).notes, "telefon");
  });

  test("layout puts children below parents and spouses on one row", () => {
    const { nodes } = layoutTree(["g", "f", "m", "c1", "c2"], [
      { type: "parent", personA: "g", personB: "f", subtype: "biological" },
      { type: "spouse", personA: "f", personB: "m", subtype: "married" },
      { type: "parent", personA: "f", personB: "c1", subtype: "biological" },
      { type: "parent", personA: "m", personB: "c1", subtype: "biological" },
      { type: "parent", personA: "f", personB: "c2", subtype: "adoptive" },
    ]);
    const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
    assert.equal(by.f.gen, 1);
    assert.equal(by.m.gen, 1, "spouse shares the row even without parents");
    assert.equal(by.c1.gen, 2);
    const row = nodes.filter((n) => n.gen === 2);
    assert.equal(new Set(row.map((n) => n.x)).size, row.length, "no overlapping cards");
  });

  test("lineage covers ancestors, descendants and spouses, not in-laws' families", () => {
    const rels = [
      { type: "parent", personA: "g", personB: "f", subtype: "biological" },
      { type: "parent", personA: "g", personB: "u", subtype: "biological" }, // uncle
      { type: "spouse", personA: "f", personB: "m", subtype: "married" },
      { type: "parent", personA: "mg", personB: "m", subtype: "biological" }, // mother's father
      { type: "parent", personA: "f", personB: "c", subtype: "biological" },
    ] as const;
    assert.deepEqual([...lineageOf("f", [...rels])].sort(), ["c", "f", "g", "m"]);
    assert.deepEqual([...lineageOf("c", [...rels])].sort(), ["c", "f", "g"]);
  });
});
