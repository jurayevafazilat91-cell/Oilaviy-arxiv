"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Person, Relationship } from "@/lib/tree";
import { CARD_H, CARD_W, layoutTree } from "@/lib/tree-layout";
import { personName } from "@/lib/format";
import { IconButton } from "../ui";

type View = { x: number; y: number; k: number };
const MIN_K = 0.2;
const MAX_K = 2.5;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export const lifeSpan = (p: Person) => {
  const b = p.birthDate?.slice(0, 4);
  const d = p.deathDate?.slice(0, 4);
  if (b && d) return `${b} – ${d}`;
  if (b) return p.isLiving ? `t. ${b}` : `${b} – ?`;
  if (d) return `v. ${d}`;
  return p.isLiving ? "" : "vafot etgan";
};

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function TreeCanvas({ people, relationships, selectedId, onSelect }: {
  people: Person[]; relationships: Relationship[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  const moved = useRef(false);
  // True only for button-driven zoom/fit, so the view glides there; drag, pinch, wheel and keys stay 1:1.
  const [glide, setGlide] = useState(false);

  const layout = useMemo(() => layoutTree(people.map((p) => p.id), relationships), [people, relationships]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 48;
    const b = layout.bounds;
    const k = clampK(Math.min((width - pad * 2) / b.width, (height - pad * 2) / b.height, 1));
    setView({ k, x: (width - b.width * k) / 2 - b.minX * k, y: Math.max(pad, (height - b.height * k) / 2) });
  }, [layout]);

  useEffect(() => { fit(); }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const rect = box.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      const k = clampK(v.k * factor);
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  // Wheel needs a non-passive listener to stop the page from scrolling while zooming.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setGlide(false);
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    setGlide(false);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = box.current!.getBoundingClientRect();
      const target = clampK(pinch.current.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
      zoomAt(target / view.k, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      moved.current = true;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    if (moved.current) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
      "+": () => zoomAt(1.2),
      "=": () => zoomAt(1.2),
      "-": () => zoomAt(1 / 1.2),
      "0": fit,
    };
    if (e.target === e.currentTarget && keys[e.key]) {
      e.preventDefault();
      setGlide(false);
      keys[e.key]();
    }
  };

  // Tabbing to a card that is off-screen pans it into view.
  const reveal = (x: number, y: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => {
      const sx = x * v.k + v.x;
      const sy = y * v.k + v.y;
      const w = CARD_W * v.k;
      const h = CARD_H * v.k;
      if (sx >= 0 && sy >= 0 && sx + w <= rect.width && sy + h <= rect.height) return v;
      return { ...v, x: rect.width / 2 - (x + CARD_W / 2) * v.k, y: rect.height / 2 - (y + CARD_H / 2) * v.k };
    });
  };

  return (
    <div className="relative">
      <div
        ref={box}
        tabIndex={0}
        role="group"
        aria-label="Oila daraxti. Strelkalar — surish, + va − — kattalashtirish, 0 — sigʻdirish. Tab bilan odamlarni tanlang."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="h-[min(70dvh,760px)] cursor-grab touch-none overflow-hidden border border-line bg-surface bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] bg-[size:22px_22px] select-none active:cursor-grabbing"
      >
        <svg width="100%" height="100%" aria-hidden={false}>
          <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transition: glide ? "transform 400ms var(--ease-in-out)" : undefined }}>
            {layout.edges.map((edge) => (
              <path key={edge.key} d={edge.d} fill="none" stroke="var(--dim)" strokeOpacity={0.55} strokeWidth={1.5}
                strokeDasharray={edge.dashed ? "6 5" : undefined} />
            ))}
            {layout.nodes.map((n) => {
              const p = byId.get(n.id)!;
              const selected = n.id === selectedId;
              const name = personName(p);
              const span = lifeSpan(p);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${name}${span ? `, ${span}` : ""}`}
                  aria-pressed={selected}
                  className="cursor-pointer outline-none [&>rect]:transition-[stroke,stroke-width] [&>rect]:duration-200 [&:focus-visible>rect]:stroke-[var(--ring)] [&:focus-visible>rect]:stroke-[3]"
                  onFocus={() => reveal(n.x, n.y)}
                  onClick={() => !moved.current && onSelect(n.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id))}
                >
                  <title>{name}</title>
                  <rect width={CARD_W} height={CARD_H} fill="var(--surface-2)" stroke={selected ? "var(--accent)" : "var(--line)"} strokeWidth={selected ? 2.5 : 1.5} />
                  {p.avatarMediaId ? (
                    <>
                      <clipPath id={`av-${n.id}`}><circle cx={36} cy={CARD_H / 2} r={22} /></clipPath>
                      <image href={`/api/media/${p.avatarMediaId}/thumb`} x={14} y={CARD_H / 2 - 22} width={44} height={44}
                        preserveAspectRatio="xMidYMid slice" clipPath={`url(#av-${n.id})`} />
                    </>
                  ) : (
                    <>
                      <circle cx={36} cy={CARD_H / 2} r={22} fill="var(--surface-2)" />
                      <text x={36} y={CARD_H / 2 + 6} textAnchor="middle" fontSize={17} fill="var(--dim)" fontFamily="var(--font-display)" fontWeight={600}>
                        {p.firstName.slice(0, 1).toUpperCase()}
                      </text>
                    </>
                  )}
                  <text x={68} y={span ? 32 : 42} fontSize={14.5} fontWeight={600} fill="var(--ink)">{truncate(p.firstName, 13)}</text>
                  {p.lastName && <text x={68} y={span ? 49 : 59} fontSize={12.5} fill="var(--dim)">{truncate(p.lastName, 15)}</text>}
                  {span && <text x={68} y={p.lastName ? 64 : 50} fontSize={11.5} fill="var(--dim)">{span}</text>}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="absolute right-3 bottom-3 flex flex-col bg-surface-2">
        <IconButton label="Kattalashtirish" onClick={() => { setGlide(true); zoomAt(1.25); }}><Plus className="size-5" aria-hidden /></IconButton>
        <IconButton label="Kichiklashtirish" onClick={() => { setGlide(true); zoomAt(0.8); }}><Minus className="size-5" aria-hidden /></IconButton>
        <IconButton label="Ekranga sigʻdirish" onClick={() => { setGlide(true); fit(); }}><Maximize2 className="size-4" aria-hidden /></IconButton>
      </div>
    </div>
  );
}
