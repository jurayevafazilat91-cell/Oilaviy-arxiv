"use client";

import Link from "next/link";
import { useState } from "react";
import { RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import {
  addToAlbumAction, editAiAction, purgeMediaAction, removeFromAlbumAction, rerunAiAction, restoreMediaAction,
  tagPersonAction, trashMediaAction, updateMediaAction,
} from "@/actions/media";
import type { GalleryContext } from "@/lib/media/context";
import type { MediaDetail, MediaItem } from "@/lib/media/queries";
import { formatBytes, formatDate, formatDuration, toDateInput } from "@/lib/format";
import { Badge, Button, Field, IconButton, Input, Notice, Select, Spinner, Textarea } from "../ui";

type Props = {
  detail: MediaDetail | null;
  error: boolean;
  ctx: GalleryContext;
  onRetry: () => void;
  onClose: () => void;
  onRemoved: () => void;
  onUpdated: (patch: Partial<MediaItem>) => void;
};

const splitTags = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

export function MediaInfo({ detail, error, ctx, onRetry, onClose, onRemoved, onUpdated }: Props) {
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) {
    return (
      <div className="space-y-3 p-5">
        <Notice>Maʼlumotni yuklab boʻlmadi.</Notice>
        <Button size="sm" onClick={onRetry}><RotateCcw className="size-4" aria-hidden />Qayta urinish</Button>
      </div>
    );
  }
  if (!detail) return <div className="flex justify-center p-10"><Spinner /></div>;

  const d = detail;
  const act = async (name: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => {
    setBusy(name);
    setMsg(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setMsg({ tone: "danger", text: r.error ?? "Xato" });
    else if (ok) setMsg({ tone: "ok", text: ok });
    return r.ok;
  };

  return (
    <div className="space-y-6 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl leading-tight">{d.title || (d.kind === "video" ? "Video" : "Rasm")}</h2>
          <p className="mt-1 text-sm text-dim">{d.takenAt ? formatDate(d.takenAt, true) : `Yuklangan: ${formatDate(d.createdAt)}`}</p>
        </div>
        <IconButton label="Panelni yopish" onClick={onClose} className="-mt-2 -mr-2 lg:hidden"><X className="size-5" aria-hidden /></IconButton>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {d.canEdit && !d.deletedAt ? (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const patch = {
              title: String(f.get("title")),
              description: String(f.get("description")),
              tags: splitTags(String(f.get("tags"))),
              takenDate: String(f.get("taken")) || null,
            };
            if (await act("save", () => updateMediaAction(d.id, patch), "Saqlandi")) onUpdated({ title: patch.title });
          }}
        >
          <Field label="Sarlavha">{(id) => <Input id={id} name="title" defaultValue={d.title} maxLength={200} />}</Field>
          <Field label="Tavsif">{(id) => <Textarea id={id} name="description" defaultValue={d.description} maxLength={5000} rows={3} />}</Field>
          <Field label="Sana" hint="Olingan kun (EXIF boʻlmasa qoʻlda kiriting)">
            {(id, h) => <Input id={id} name="taken" type="date" defaultValue={toDateInput(d.takenAt)} aria-describedby={h} />}
          </Field>
          <Field label="Teglar" hint="Vergul bilan ajrating">
            {(id, h) => <Input id={id} name="tags" defaultValue={d.tags.join(", ")} aria-describedby={h} />}
          </Field>
          <Button type="submit" variant="primary" size="sm" loading={busy === "save"}>Saqlash</Button>
        </form>
      ) : (
        <div className="space-y-2">
          {d.description && <p className="whitespace-pre-wrap">{d.description}</p>}
          {d.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
        </div>
      )}

      {(d.aiStatus || d.aiCaption) && <AiBlock d={d} ctx={ctx} act={act} busy={busy} />}

      <section aria-labelledby="albums-h" className="space-y-2">
        <h3 id="albums-h" className="text-sm font-medium text-dim">Albomlar</h3>
        <div className="flex flex-wrap gap-1.5">
          {d.albums.length === 0 && <p className="text-sm text-dim">Albomda emas</p>}
          {d.albums.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm">
              <Link href={`/albums/${a.id}`} className="hover:underline">{a.title}</Link>
              {ctx.canUpload && (
                <button type="button" aria-label={`${a.title} albomidan olib tashlash`} className="flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-line"
                  onClick={() => act("album", () => removeFromAlbumAction(a.id, [d.id])).then((ok) => ok && onUpdated({}))}>
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
        {ctx.canUpload && ctx.albums.length > 0 && (
          <PickAndAdd
            label="Albomga qoʻshish"
            options={ctx.albums.filter((a) => !d.albums.some((x) => x.id === a.id)).map((a) => ({ id: a.id, name: a.title }))}
            onAdd={(id) => act("album", () => addToAlbumAction(id, [d.id])).then((ok) => ok && onUpdated({}))}
          />
        )}
      </section>

      <section aria-labelledby="people-h" className="space-y-2">
        <h3 id="people-h" className="text-sm font-medium text-dim">Rasmdagilar</h3>
        <p className="sr-only">Odamlar qoʻlda belgilanadi; avtomatik yuz tanish ishlatilmaydi.</p>
        <div className="flex flex-wrap gap-1.5">
          {d.people.length === 0 && <p className="text-sm text-dim">Hech kim belgilanmagan</p>}
          {d.people.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm">
              <Link href={`/people/${p.id}`} className="hover:underline">{p.name}</Link>
              {ctx.canUpload && (
                <button type="button" aria-label={`${p.name} belgisini olib tashlash`} className="flex size-7 cursor-pointer items-center justify-center rounded-full hover:bg-line"
                  onClick={() => act("person", () => tagPersonAction(d.id, p.id, false)).then((ok) => ok && onUpdated({}))}>
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
        {ctx.canUpload && ctx.people.length > 0 && (
          <PickAndAdd
            label="Odamni belgilash"
            options={ctx.people.filter((p) => !d.people.some((x) => x.id === p.id))}
            onAdd={(id) => act("person", () => tagPersonAction(d.id, id, true)).then((ok) => ok && onUpdated({}))}
          />
        )}
      </section>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-dim">Fayl</dt><dd className="truncate" title={d.originalName}>{d.originalName}</dd>
        <dt className="text-dim">Hajm</dt><dd>{formatBytes(d.sizeBytes)}{d.width ? ` · ${d.width}×${d.height}` : ""}{d.durationMs ? ` · ${formatDuration(d.durationMs)}` : ""}</dd>
        <dt className="text-dim">Manba</dt><dd>{d.source === "telegram" ? "Telegram" : "Sayt"}{d.uploaderName ? ` · ${d.uploaderName}` : ""}</dd>
        {d.kind === "video" && d.variants.includes("playback") && (
          <><dt className="text-dim">Sifat</dt><dd>Koʻrish uchun moslashtirilgan nusxa (≤1080p). Asl fayl oʻzgarmagan.</dd></>
        )}
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <a href={`/api/media/${d.id}/original?download`} className="inline-flex min-h-9 items-center rounded-full border border-line px-3.5 text-sm font-medium hover:bg-surface-2">
          Aslini yuklab olish
        </a>
        {d.canEdit && !d.deletedAt && (
          <Button size="sm" variant="danger" loading={busy === "trash"}
            onClick={async () => (await act("trash", () => trashMediaAction([d.id]))) && onRemoved()}>
            <Trash2 className="size-4" aria-hidden />Savatga
          </Button>
        )}
        {d.canEdit && d.deletedAt && (
          <Button size="sm" loading={busy === "restore"} onClick={async () => (await act("restore", () => restoreMediaAction([d.id]))) && onRemoved()}>
            <RotateCcw className="size-4" aria-hidden />Tiklash
          </Button>
        )}
        {ctx.isAdmin && d.deletedAt && (
          <Button size="sm" variant="danger" loading={busy === "purge"}
            onClick={async () => confirm("Fayl butunlay oʻchiriladi. Qaytarib boʻlmaydi. Davom etasizmi?")
              && (await act("purge", () => purgeMediaAction([d.id]))) && onRemoved()}>
            Butunlay oʻchirish
          </Button>
        )}
      </div>
    </div>
  );
}

function PickAndAdd({ label, options, onAdd }: { label: string; options: { id: string; name: string }[]; onAdd: (id: string) => void }) {
  const [value, setValue] = useState("");
  if (!options.length) return null;
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor={`pick-${label}`}>{label}</label>
      <Select id={`pick-${label}`} value={value} onChange={(e) => setValue(e.target.value)} className="min-h-9 py-1.5 text-sm">
        <option value="">{label}…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Button size="sm" disabled={!value} onClick={() => { onAdd(value); setValue(""); }}>Qoʻshish</Button>
    </div>
  );
}

function AiBlock({ d, ctx, act, busy }: {
  d: MediaDetail; ctx: GalleryContext; busy: string | null;
  act: (n: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(d.aiCaption ?? "");
  const [tags, setTags] = useState(d.aiTags.join(", "));
  return (
    <section aria-labelledby="ai-h" className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="ai-h" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-accent" aria-hidden /> AI tavsifi
        </h3>
        <Badge tone="accent">AI yaratgan · tekshiring</Badge>
      </div>
      {d.aiStatus === "pending" && <p className="text-sm text-dim">Tahlil qilinmoqda…</p>}
      {d.aiStatus === "failed" && <p className="text-sm text-danger">AI xatosi: {d.aiError}</p>}
      {d.aiStatus === "skipped" && d.aiError && <p className="text-sm text-dim">{d.aiError}</p>}
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("ai", () => editAiAction(d.id, { caption, tags: splitTags(tags) }), "AI tavsifi yangilandi")) setEditing(false);
          }}
        >
          <Field label="Tavsif">{(id) => <Textarea id={id} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} rows={2} />}</Field>
          <Field label="Teglar">{(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" loading={busy === "ai"}>Saqlash</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Bekor</Button>
          </div>
        </form>
      ) : (
        <>
          {caption && <p className="text-[15px]">{caption}</p>}
          {tags && <div className="flex flex-wrap gap-1.5">{splitTags(tags).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}</div>}
          {d.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Tahrirlash</Button>
              {(caption || tags) && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (await act("ai", () => editAiAction(d.id, { caption: null, tags: [] }), "AI tavsifi oʻchirildi")) { setCaption(""); setTags(""); }
                }}>Oʻchirish</Button>
              )}
              {ctx.aiEnabled && d.kind === "image" && (
                <Button size="sm" variant="ghost" loading={busy === "rerun"} onClick={() => act("rerun", () => rerunAiAction(d.id), "Qayta tahlilga yuborildi")}>
                  Qayta tahlil
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
