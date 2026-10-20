"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Images, List, Network, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import {
  addRelationshipAction, deletePersonAction, linkPersonUserAction, removeRelationshipAction, savePersonAction,
} from "@/actions/tree";
import type { Person, Relationship } from "@/lib/tree";
import { formatPartialDate, personName } from "@/lib/format";
import { Badge, Button, cx, Dialog, EmptyState, Field, Glider, IconButton, Input, Notice, Select, Textarea } from "../ui";
import { lifeSpan, TreeCanvas } from "./tree-canvas";

type Props = {
  people: Person[];
  relationships: Relationship[];
  canEdit: boolean;
  isAdmin: boolean;
  members: { id: string; name: string }[];
};

const PARENT_LABEL: Record<string, string> = { biological: "", adoptive: "asrab olgan", step: "oʻgay", foster: "tarbiyachi" };
const SPOUSE_LABEL: Record<string, string> = { married: "turmush oʻrtogʻi", divorced: "ajrashgan", widowed: "beva qolgan", partner: "hamroh" };

function relationsOf(id: string, rels: Relationship[]) {
  return {
    parents: rels.filter((r) => r.type === "parent" && r.personB === id).map((r) => ({ rel: r, other: r.personA })),
    children: rels.filter((r) => r.type === "parent" && r.personA === id).map((r) => ({ rel: r, other: r.personB })),
    spouses: rels.filter((r) => r.type === "spouse" && (r.personA === id || r.personB === id))
      .map((r) => ({ rel: r, other: r.personA === id ? r.personB : r.personA })),
  };
}

export function TreeExplorer({ people, relationships, canEdit, isAdmin, members }: Props) {
  const [view, setView] = useState<"tree" | "list">("tree");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Koʻrinish" className="flex bg-surface-2">
          {([["tree", "Daraxt", Network], ["list", "Roʻyxat", List]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cx("relative flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium transition-colors duration-300", view === v ? "text-accent-ink" : "text-dim hover:text-ink")}>
              {view === v && <Glider id="tree-view" />}
              <Icon className="relative size-4" aria-hidden /><span className="relative">{label}</span>
            </button>
          ))}
        </div>
        {canEdit && <Button className="ml-auto" variant="primary" onClick={() => setEditing("new")}><UserPlus className="size-4" aria-hidden />Odam qoʻshish</Button>}
      </div>

      {people.length === 0 ? (
        <EmptyState icon={<Network />} title="Daraxt hali boʻsh">
          {canEdit ? "Oʻzingiz yoki eng katta avloddan boshlang, keyin ota-ona, farzand va turmush oʻrtoqlarni bogʻlang." : "Daraxtni tahrirlovchilar hali hech kimni qoʻshmagan."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            {view === "tree"
              ? <TreeCanvas people={people} relationships={relationships} selectedId={selectedId} onSelect={setSelectedId} />
              : <PeopleList people={people} relationships={relationships} byId={byId} onSelect={setSelectedId} selectedId={selectedId} />}
            <p className="mt-2 text-sm text-dim">
              Odamni tanlang — uning ajdodlari va avlodlari yoritiladi. Toʻq yoki kulrang medalyon — vafot etgan.
              Uzuq chiziq — asrab olingan/oʻgay bogʻlanish yoki ajrashgan juftlik.
            </p>
          </div>
          {selected ? (
            <PersonPanel
              key={selected.id}
              person={selected}
              people={people}
              relationships={relationships}
              byId={byId}
              canEdit={canEdit}
              isAdmin={isAdmin}
              members={members}
              onSelect={setSelectedId}
              onEdit={() => setEditing(selected)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <aside className="hidden border border-dashed border-line p-6 text-center text-dim lg:block lg:self-start">
              Batafsil koʻrish uchun odamni tanlang.
            </aside>
          )}
        </div>
      )}

      <PersonDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        person={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(id) => { setEditing(null); setSelectedId(id); }}
      />
    </div>
  );
}

function PeopleList({ people, relationships, byId, onSelect, selectedId }: {
  people: Person[]; relationships: Relationship[]; byId: Map<string, Person>; onSelect: (id: string) => void; selectedId: string | null;
}) {
  const names = (ids: string[]) => ids.map((i) => byId.get(i)).filter(Boolean).map((p) => personName(p!)).join(", ");
  return (
    <ul className="divide-y divide-line overflow-hidden bg-surface">
      {people.map((p) => {
        const r = relationsOf(p.id, relationships);
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onSelect(p.id)} aria-pressed={selectedId === p.id}
              className="w-full cursor-pointer px-4 py-3 text-left hover:bg-surface-2 aria-pressed:bg-accent aria-pressed:text-accent-ink [&[aria-pressed=true]_.text-dim]:text-accent-ink/75">
              <span className="font-medium">{personName(p)}</span>
              {lifeSpan(p) && <span className="ml-2 text-sm text-dim">{lifeSpan(p)}</span>}
              <span className="mt-0.5 block text-sm text-dim">
                {[
                  r.parents.length && `Ota-onasi: ${names(r.parents.map((x) => x.other))}`,
                  r.spouses.length && `Turmush oʻrtogʻi: ${names(r.spouses.map((x) => x.other))}`,
                  r.children.length && `Farzandlari: ${names(r.children.map((x) => x.other))}`,
                ].filter(Boolean).join(" · ") || "Bogʻlanish yoʻq"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PersonPanel({ person: p, people, relationships, byId, canEdit, isAdmin, members, onSelect, onEdit, onClose }: {
  person: Person; people: Person[]; relationships: Relationship[]; byId: Map<string, Person>;
  canEdit: boolean; isAdmin: boolean; members: { id: string; name: string }[];
  onSelect: (id: string) => void; onEdit: () => void; onClose: () => void;
}) {
  const r = relationsOf(p.id, relationships);
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    const res = await removeRelationshipAction(id);
    if (!res.ok) setError(res.error);
  };
  const relProps = { byId, canEdit, onSelect, onRemove: remove };


  return (
    <aside aria-label={personName(p)} className="animate-rise space-y-5 bg-surface p-5 lg:sticky lg:top-6 lg:self-start lg:animate-enter-x">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl font-semibold uppercase leading-tight">{personName(p)}</h2>
          {p.patronymic && <p className="text-dim">{p.patronymic}</p>}
        </div>
        <IconButton label="Yopish" onClick={onClose} className="-mt-2 -mr-2"><X className="size-5" aria-hidden /></IconButton>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {p.birthDate && (<><dt className="text-dim">Tugʻilgan</dt><dd>{formatPartialDate(p.birthDate)}{p.birthPlace ? `, ${p.birthPlace}` : ""}</dd></>)}
        {!p.isLiving && (<><dt className="text-dim">Vafot etgan</dt><dd>{formatPartialDate(p.deathDate) || "sanasi nomaʼlum"}</dd></>)}
      </dl>
      {p.notes && <p className="whitespace-pre-wrap text-[15px]">{p.notes}</p>}

      <RelList title="Ota-onasi" list={r.parents} label={(rel) => PARENT_LABEL[rel.subtype]} {...relProps} />
      <RelList title="Turmush oʻrtogʻi" list={r.spouses} label={(rel) => [SPOUSE_LABEL[rel.subtype], rel.startDate?.slice(0, 4)].filter(Boolean).join(" · ")} {...relProps} />
      <RelList title="Farzandlari" list={r.children} label={(rel) => PARENT_LABEL[rel.subtype]} {...relProps} />
      <Notice>{error}</Notice>

      <div className="flex flex-wrap gap-2">
        <Link href={`/people/${p.id}`} className="inline-flex min-h-9 items-center gap-2 bg-slate px-3.5 text-sm font-medium text-slate-ink transition-[filter,scale] duration-150 ease-out hover:brightness-110 active:scale-[0.97]">
          <Images className="size-4" aria-hidden />Rasmlari
        </Link>
        {canEdit && <Button size="sm" onClick={onEdit}><Pencil className="size-4" aria-hidden />Tahrirlash</Button>}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={async () => {
            if (!confirm(`${personName(p)} daraxtdan oʻchirilsinmi? Uning barcha bogʻlanishlari ham oʻchadi. Rasmlar qoladi.`)) return;
            const res = await deletePersonAction(p.id);
            if (res.ok) onClose();
            else setError(res.error);
          }}><Trash2 className="size-4" aria-hidden />Oʻchirish</Button>
        )}
      </div>

      {canEdit && <AddRelation person={p} people={people} />}
      {isAdmin && <LinkAccount person={p} members={members} />}
    </aside>
  );
}

function RelList({ title, list, label, byId, canEdit, onSelect, onRemove }: {
  title: string; list: { rel: Relationship; other: string }[]; label: (r: Relationship) => string;
  byId: Map<string, Person>; canEdit: boolean; onSelect: (id: string) => void; onRemove: (relId: string) => void;
}) {
  if (!list.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-medium text-dim">{title}</h3>
      <ul className="space-y-1">
        {list.map(({ rel, other }) => {
          const o = byId.get(other);
          if (!o) return null;
          return (
            <li key={rel.id} className="flex items-center gap-2">
              <button type="button" onClick={() => onSelect(other)} className="cursor-pointer text-left hover:underline">{personName(o)}</button>
              {label(rel) && <Badge>{label(rel)}</Badge>}
              {canEdit && (
                <IconButton label={`${personName(o)} bilan bogʻlanishni oʻchirish`} className="ml-auto size-9"
                  onClick={() => confirm("Bu bogʻlanish oʻchirilsinmi?") && onRemove(rel.id)}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddRelation({ person, people }: { person: Person; people: Person[] }) {
  const [kind, setKind] = useState<"parent" | "child" | "spouse">("parent");
  const [other, setOther] = useState("");
  const [subtype, setSubtype] = useState("biological");
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSpouse = kind === "spouse";

  return (
    <form
      className="space-y-3 border-t border-line pt-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setOk(null);
        const input = isSpouse
          ? { type: "spouse", aId: person.id, bId: other, subtype, startDate: startDate || null, endDate: null }
          : kind === "parent"
            ? { type: "parent", parentId: other, childId: person.id, subtype }
            : { type: "parent", parentId: person.id, childId: other, subtype };
        const r = await addRelationshipAction(input);
        setBusy(false);
        if (!r.ok) return setError(r.error);
        setOk("Bogʻlanish qoʻshildi");
        setOther("");
      }}
    >
      <h3 className="flex items-center gap-2 font-medium"><Plus className="size-4" aria-hidden />Bogʻlanish qoʻshish</h3>
      <Field label="Kim">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => {
            const k = e.target.value as typeof kind;
            setKind(k);
            setSubtype(k === "spouse" ? "married" : "biological");
          }}>
            <option value="parent">Ota yoki onasi</option>
            <option value="child">Farzandi</option>
            <option value="spouse">Turmush oʻrtogʻi</option>
          </Select>
        )}
      </Field>
      <Field label="Odam">
        {(id) => (
          <Select id={id} value={other} onChange={(e) => setOther(e.target.value)} required>
            <option value="">Tanlang…</option>
            {people.filter((x) => x.id !== person.id).map((x) => <option key={x.id} value={x.id}>{personName(x)}{lifeSpan(x) ? ` (${lifeSpan(x)})` : ""}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Turi">
        {(id) => (
          <Select id={id} value={subtype} onChange={(e) => setSubtype(e.target.value)}>
            {isSpouse ? (
              <><option value="married">Nikohda</option><option value="divorced">Ajrashgan</option><option value="widowed">Beva qolgan</option><option value="partner">Hamroh</option></>
            ) : (
              <><option value="biological">Tugʻishgan</option><option value="adoptive">Asrab olingan</option><option value="step">Oʻgay</option><option value="foster">Tarbiyadagi</option></>
            )}
          </Select>
        )}
      </Field>
      {isSpouse && (
        <Field label="Nikoh sanasi (ixtiyoriy)" hint="YYYY, YYYY-MM yoki YYYY-MM-DD">
          {(id, h) => <Input id={id} value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="1985" aria-describedby={h} inputMode="numeric" />}
        </Field>
      )}
      <Notice>{error}</Notice>
      <Notice tone="ok">{ok}</Notice>
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!other}>Qoʻshish</Button>
    </form>
  );
}

function LinkAccount({ person, members }: { person: Person; members: { id: string; name: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 border-t border-line pt-5">
      <Field label="Akkaunt bilan bogʻlash" hint="Ixtiyoriy: bu odam saytdagi qaysi foydalanuvchi">
        {(id, h) => (
          <Select id={id} aria-describedby={h} value={person.userId ?? ""} onChange={async (e) => {
            const r = await linkPersonUserAction(person.id, e.target.value || null);
            setError(r.ok ? null : r.error);
          }}>
            <option value="">Bogʻlanmagan</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        )}
      </Field>
      <Notice>{error}</Notice>
    </div>
  );
}

function PersonDialog({ person, open, onClose, onSaved }: { person: Person | null; open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [living, setLiving] = useState(person?.isLiving ?? true);
  return (
    <Dialog open={open} onClose={onClose} title={person ? "Tahrirlash" : "Yangi odam"} className="w-[min(94vw,36rem)]">
      <form
        key={person?.id ?? "new"}
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const input = {
            firstName: f.get("firstName"), lastName: f.get("lastName"), patronymic: f.get("patronymic"),
            gender: f.get("gender") || null, birthDate: f.get("birthDate") || null,
            deathDate: f.get("isLiving") ? null : f.get("deathDate") || null, isLiving: Boolean(f.get("isLiving")),
            birthPlace: f.get("birthPlace"), notes: f.get("notes"),
          };
          setBusy(true);
          const r = await savePersonAction(input, person?.id);
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setError(null);
          onSaved(r.data.id);
        }}
      >
        <Field label="Ism">{(id) => <Input id={id} name="firstName" defaultValue={person?.firstName} required maxLength={80} autoFocus />}</Field>
        <Field label="Familiya">{(id) => <Input id={id} name="lastName" defaultValue={person?.lastName} maxLength={80} />}</Field>
        <Field label="Otasining ismi">{(id) => <Input id={id} name="patronymic" defaultValue={person?.patronymic} maxLength={80} />}</Field>
        <Field label="Jinsi">
          {(id) => (
            <Select id={id} name="gender" defaultValue={person?.gender ?? ""}>
              <option value="">Koʻrsatilmagan</option><option value="male">Erkak</option><option value="female">Ayol</option>
            </Select>
          )}
        </Field>
        <Field label="Tugʻilgan sana" hint="YYYY, YYYY-MM yoki YYYY-MM-DD">
          {(id, h) => <Input id={id} name="birthDate" defaultValue={person?.birthDate ?? ""} placeholder="1950" aria-describedby={h} />}
        </Field>
        <Field label="Tugʻilgan joy">{(id) => <Input id={id} name="birthPlace" defaultValue={person?.birthPlace} maxLength={120} />}</Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 sm:col-span-2">
          <input type="checkbox" name="isLiving" checked={living} onChange={(e) => setLiving(e.target.checked)} className="size-5 accent-[var(--accent)]" />
          Tirik
        </label>
        {!living && (
          <Field label="Vafot sanasi (ixtiyoriy)">{(id) => <Input id={id} name="deathDate" defaultValue={person?.deathDate ?? ""} placeholder="2010" />}</Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Izoh" hint="Tirik odamlar uchun izoh va joy “Koʻruvchi”larga koʻrinmaydi">
            {(id, h) => <Textarea id={id} name="notes" defaultValue={person?.notes} maxLength={4000} rows={3} aria-describedby={h} />}
          </Field>
        </div>
        <div className="sm:col-span-2"><Notice>{error}</Notice></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Bekor</Button>
          <Button type="submit" variant="primary" loading={busy}>Saqlash</Button>
        </div>
      </form>
    </Dialog>
  );
}
