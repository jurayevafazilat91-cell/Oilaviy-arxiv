"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckSquare, FolderPlus, Loader2, Play, RotateCcw, Trash2, X } from "lucide-react";
import { addToAlbumAction, purgeMediaAction, removeFromAlbumAction, restoreMediaAction, trashMediaAction } from "@/actions/media";
import type { GalleryContext } from "@/lib/media/context";
import type { MediaItem } from "@/lib/media/queries";
import { formatDate, formatDuration, monthKey } from "@/lib/format";
import { Button, cx, Select } from "../ui";
import { Lightbox } from "./lightbox";

export type GalleryMode = "archive" | "trash" | "album";

type Props = {
  initial: { items: MediaItem[]; nextCursor: string | null };
  query: string;
  ctx: GalleryContext;
  mode?: GalleryMode;
  albumId?: string;
  /** Standalone /media/<id> page: open immediately, closing goes back to the archive. */
  autoOpen?: boolean;
};

export function Gallery({ initial, query, ctx, mode = "archive", albumId, autoOpen }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Server re-render (after an upload or edit) replaces the first page.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/media?${query}${query ? "&" : ""}cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error();
      const page = (await res.json()) as Props["initial"];
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    } catch {
      setLoadError("Keyingi sahifani yuklab boʻlmadi.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !loadError && loadMore(), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore, loadError]);

  // Deep link: ?m=<id> opens the lightbox; Back closes it.
  useEffect(() => {
    const sync = () => {
      const id = new URLSearchParams(window.location.search).get("m");
      const idx = id ? items.findIndex((i) => i.id === id) : autoOpen ? 0 : -1;
      setOpen(idx >= 0 ? idx : null);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [items, autoOpen]);

  const openAt = (idx: number) => {
    const url = new URL(window.location.href);
    const replace = url.searchParams.has("m");
    url.searchParams.set("m", items[idx].id);
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    setOpen(idx);
  };
  const close = () => {
    if (autoOpen) return router.push("/");
    const url = new URL(window.location.href);
    url.searchParams.delete("m");
    window.history.replaceState(null, "", url);
    setOpen(null);
  };

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: { item: MediaItem; idx: number }[] }[] = [];
    items.forEach((item, idx) => {
      const { key, label } = monthKey(item.sortAt);
      if (out.at(-1)?.key !== key) out.push({ key, label, items: [] });
      out.at(-1)!.items.push({ item, idx });
    });
    return out;
  }, [items]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const endSelect = () => { setSelecting(false); setSelected(new Set()); };
  const removeLocal = (ids: string[]) => setItems((list) => list.filter((i) => !ids.includes(i.id)));

  const bulk = async (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, removes: boolean) => {
    const ids = [...selected];
    const r = await fn();
    if (!r.ok) return setNotice(r.error ?? "Xato");
    if (removes) removeLocal(ids);
    setNotice(success);
    endSelect();
  };

  const canBulk = ctx.canUpload;

  return (
    <div>
      {canBulk && items.length > 0 && (
        <div className="mb-4 flex justify-end">
          {selecting
            ? <Button size="sm" variant="ghost" onClick={endSelect}><X className="size-4" aria-hidden />Bekor qilish</Button>
            : <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}><CheckSquare className="size-4" aria-hidden />Tanlash</Button>}
        </div>
      )}

      <p role="status" aria-live="polite" className={cx("mb-4 rounded-xl bg-surface-2 px-4 py-2.5 text-sm", !notice && "sr-only")}>{notice}</p>

      {groups.map((g) => (
        <section key={g.key} className="cv-auto mb-8" aria-labelledby={`m-${g.key}`}>
          <h2 id={`m-${g.key}`} className="sticky top-16 z-10 -mx-1 mb-3 bg-bg/90 px-1 py-2 font-serif text-xl backdrop-blur">{g.label}</h2>
          <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-6 xl:grid-cols-7">
            {g.items.map(({ item, idx }) => (
              <li key={item.id}>
                <Tile
                  item={item}
                  selecting={selecting}
                  selected={selected.has(item.id)}
                  onActivate={() => (selecting ? toggle(item.id) : openAt(idx))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div ref={sentinel} className="flex min-h-16 items-center justify-center">
        {loading && <Loader2 className="size-5 animate-spin text-dim" aria-label="Yuklanmoqda" />}
        {loadError && (
          <div className="flex items-center gap-3 text-sm text-danger" role="alert">
            {loadError}
            <Button size="sm" onClick={loadMore}><RotateCcw className="size-4" aria-hidden />Qayta urinish</Button>
          </div>
        )}
        {!cursor && items.length > 40 && <p className="text-sm text-dim">Hammasi koʻrsatildi</p>}
      </div>

      {selecting && (
        <SelectionBar
          count={selected.size}
          mode={mode}
          ctx={ctx}
          onAddToAlbum={(id) => bulk(() => addToAlbumAction(id, [...selected]), "Albomga qoʻshildi", false)}
          onRemoveFromAlbum={() => bulk(() => removeFromAlbumAction(albumId!, [...selected]), "Albomdan olib tashlandi", true)}
          onTrash={() => bulk(() => trashMediaAction([...selected]), "Savatga oʻtkazildi. Savatdan 30 kun ichida tiklash mumkin.", true)}
          onRestore={() => bulk(() => restoreMediaAction([...selected]), "Tiklandi", true)}
          onPurge={() => confirm("Tanlangan fayllar butunlay oʻchiriladi. Bu amalni qaytarib boʻlmaydi. Davom etasizmi?")
            && bulk(() => purgeMediaAction([...selected]), "Butunlay oʻchirildi", true)}
        />
      )}

      {open !== null && items[open] && (
        <Lightbox
          items={items}
          index={open}
          ctx={ctx}
          onIndex={openAt}
          onClose={close}
          onRemoved={(id) => { removeLocal([id]); close(); }}
          onUpdated={(id, p) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)))}
          nearEnd={() => cursor && loadMore()}
        />
      )}
    </div>
  );
}

function Tile({ item, selecting, selected, onActivate }: { item: MediaItem; selecting: boolean; selected: boolean; onActivate: () => void }) {
  const label = `${item.title || (item.kind === "video" ? "Video" : "Rasm")}${item.takenAt ? `, ${formatDate(item.takenAt)}` : ""}`;
  const hasThumb = item.variants.includes("thumb");
  return (
    <a
      href={`/media/${item.id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onActivate();
      }}
      aria-label={selecting ? `${label} — ${selected ? "tanlangan" : "tanlanmagan"}` : label}
      aria-pressed={selecting ? selected : undefined}
      role={selecting ? "button" : undefined}
      className="group relative block aspect-square overflow-hidden rounded-[6px] bg-surface-2"
    >
      {hasThumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- authorized private files; next/image would cache them in a shared optimizer
        <img
          src={`/api/media/${item.id}/thumb`}
          alt=""
          loading="lazy"
          decoding="async"
          className={cx("size-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]", selected && "scale-[0.92] rounded-md")}
        />
      ) : item.status === "failed" ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-danger">
          <AlertTriangle className="size-5" aria-hidden />Xato
        </span>
      ) : (
        <span className="skeleton flex size-full items-center justify-center p-2 text-center text-xs text-dim">Qayta ishlanmoqda…</span>
      )}
      {item.kind === "video" && hasThumb && (
        <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
          <Play className="size-3 fill-current" aria-hidden />{formatDuration(item.durationMs)}
        </span>
      )}
      {selecting && (
        <span className={cx("absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white shadow", selected ? "bg-accent" : "bg-black/30")}>
          {selected && <Check className="size-3.5 text-accent-ink" aria-hidden />}
        </span>
      )}
    </a>
  );
}

function SelectionBar(props: {
  count: number; mode: GalleryMode; ctx: GalleryContext;
  onAddToAlbum: (id: string) => void; onRemoveFromAlbum: () => void; onTrash: () => void; onRestore: () => void; onPurge: () => void;
}) {
  const { count, mode, ctx } = props;
  const [album, setAlbum] = useState("");
  const none = count === 0;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-3 md:bottom-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-2xl">
        <span className="px-2 text-sm font-medium" aria-live="polite">{count} ta tanlandi</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mode !== "trash" && ctx.albums.length > 0 && (
            <>
              <label className="sr-only" htmlFor="bulk-album">Albom</label>
              <Select id="bulk-album" value={album} onChange={(e) => setAlbum(e.target.value)} className="min-h-9 w-44 py-1.5 text-sm">
                <option value="">Albom tanlang…</option>
                {ctx.albums.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </Select>
              <Button size="sm" disabled={none || !album} onClick={() => props.onAddToAlbum(album)}><FolderPlus className="size-4" aria-hidden />Qoʻshish</Button>
            </>
          )}
          {mode === "album" && <Button size="sm" disabled={none} onClick={props.onRemoveFromAlbum}>Albomdan olish</Button>}
          {mode !== "trash" && <Button size="sm" variant="danger" disabled={none} onClick={props.onTrash}><Trash2 className="size-4" aria-hidden />Savatga</Button>}
          {mode === "trash" && <Button size="sm" disabled={none} onClick={props.onRestore}><RotateCcw className="size-4" aria-hidden />Tiklash</Button>}
          {mode === "trash" && ctx.isAdmin && <Button size="sm" variant="danger" disabled={none} onClick={props.onPurge}>Butunlay oʻchirish</Button>}
        </div>
      </div>
    </div>
  );
}

export function GallerySkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda">
      <div className="skeleton mb-3 h-7 w-40 rounded-md" />
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-6 xl:grid-cols-7">
        {Array.from({ length: 18 }, (_, i) => <div key={i} className="skeleton aspect-square rounded-[6px]" />)}
      </div>
    </div>
  );
}
