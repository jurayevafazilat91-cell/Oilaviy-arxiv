"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, Info, X } from "lucide-react";
import type { GalleryContext } from "@/lib/media/context";
import type { MediaDetail, MediaItem } from "@/lib/media/queries";
import { cx } from "../ui";
import { MediaInfo } from "./media-info";

type Props = {
  items: MediaItem[];
  index: number;
  ctx: GalleryContext;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRemoved: (id: string) => void;
  onUpdated: (id: string, patch: Partial<MediaItem>) => void;
  nearEnd: () => void;
};

const ease = [0.16, 1, 0.3, 1] as const;

export function Lightbox({ items, index, ctx, onIndex, onClose, onRemoved, onUpdated, nearEnd }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const item = items[index];
  const reduce = useReducedMotion();
  const [infoOpen, setInfoOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  // Keyed by media id so switching items never shows the previous item's details.
  const [loaded, setLoaded] = useState<{ id: string; detail: MediaDetail | null; error: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const detail = loaded?.id === item.id ? loaded.detail : null;
  const detailError = loaded?.id === item.id && loaded.error;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (index >= items.length - 6) nearEnd();
  }, [index, items.length, nearEnd]);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = item.id;
    fetch(`/api/media/${id}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: MediaDetail) => setLoaded({ id, detail: d, error: false }))
      .catch((e) => e?.name !== "AbortError" && setLoaded({ id, detail: null, error: true }));
    return () => ctrl.abort();
  }, [item.id, reload]);

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => index < items.length - 1 && onIndex(index + 1);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (["INPUT", "TEXTAREA", "SELECT", "VIDEO"].includes(tag)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    if (e.key === "i") setInfoOpen((o) => !o);
  };

  const hasPreview = item.variants.includes("preview");

  return (
    <dialog
      ref={dialog}
      className="lightbox fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-[#f4f2ef]"
      aria-label={item.title || "Media koʻrish"}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      <div className="flex h-full">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-5">
            <p className="min-w-0 flex-1 truncate text-sm text-white/70" aria-live="polite">
              {index + 1} / {items.length}{item.title ? ` · ${item.title}` : ""}
            </p>
            <a
              href={`/api/media/${item.id}/original?download`}
              className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Asl faylni yuklab olish"
              title="Asl faylni yuklab olish"
            >
              <Download className="size-5" aria-hidden />
            </a>
            <button type="button" onClick={() => setInfoOpen((o) => !o)} aria-pressed={infoOpen} aria-label="Maʼlumot" title="Maʼlumot (i)"
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-white/10 aria-pressed:bg-white/15">
              <Info className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Yopish" title="Yopish (Esc)" autoFocus
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-white/10">
              <X className="size-6" aria-hidden />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-16"
            onPointerDown={(e) => e.pointerType === "touch" && (swipe.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s) return;
              const dx = e.clientX - s.x;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) (dx > 0 ? prev : next)();
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={item.id}
                className="flex size-full items-center justify-center"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.12 : 0.45, ease }}
              >
                {item.kind === "video" ? (
                  <video
                    key={item.id}
                    controls
                    playsInline
                    preload="metadata"
                    poster={hasPreview ? `/api/media/${item.id}/preview` : undefined}
                    src={`/api/media/${item.id}/${item.variants.includes("playback") ? "playback" : "original"}`}
                    className="max-h-full max-w-full rounded-sm bg-black"
                  >
                    Brauzeringiz bu videoni koʻrsata olmaydi. <a href={`/api/media/${item.id}/original?download`}>Yuklab oling</a>.
                  </video>
                ) : hasPreview ? (
                  <ProgressiveImage id={item.id} alt={detail?.aiCaption ?? item.title ?? ""} />
                ) : (
                  <p className="text-white/70">{item.status === "failed" ? `Qayta ishlashda xato: ${item.error ?? ""}` : "Qayta ishlanmoqda…"}</p>
                )}
              </motion.div>
            </AnimatePresence>

            <NavButton side="left" disabled={index === 0} onClick={prev} />
            <NavButton side="right" disabled={index === items.length - 1} onClick={next} />
          </div>
        </div>

        {infoOpen && (
          <aside
            aria-label="Media maʼlumotlari"
            className="fixed inset-x-0 bottom-0 z-10 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface text-ink lg:static lg:max-h-none lg:w-[380px] lg:rounded-none lg:border-t-0 lg:border-l"
          >
            <MediaInfo
              key={item.id}
              detail={detail}
              error={detailError}
              ctx={ctx}
              onRetry={() => setReload((n) => n + 1)}
              onClose={() => setInfoOpen(false)}
              onRemoved={() => onRemoved(item.id)}
              onUpdated={(p) => { onUpdated(item.id, p); setReload((n) => n + 1); }}
            />
          </aside>
        )}
      </div>
    </dialog>
  );
}

function NavButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Oldingi" : "Keyingi"}
      className={cx(
        "absolute top-1/2 hidden size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 transition-opacity hover:bg-black/60 disabled:pointer-events-none disabled:opacity-0 sm:flex",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-6" aria-hidden />
    </button>
  );
}

/** Shows the cached thumbnail instantly, then swaps in the large preview once decoded. */
function ProgressiveImage({ id, alt }: { id: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative flex size-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, authorized files */}
      <img src={`/api/media/${id}/thumb`} alt="" aria-hidden className={cx("absolute inset-0 size-full object-contain blur-sm transition-opacity duration-300", loaded && "opacity-0")} />
      {/* eslint-disable-next-line @next/next/no-img-element -- private, authorized files */}
      <img
        src={`/api/media/${id}/preview`}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={cx("relative size-full object-contain transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}
