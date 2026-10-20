"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Person, Relationship } from "@/lib/tree";
import { CARD_H, CARD_W, layoutTree, lineageOf, MEDAL_CY, MEDAL_R } from "@/lib/tree-layout";
import { personName } from "@/lib/format";
import { cx, IconButton } from "../ui";

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

// Suzani rosette: a ring of scalloped lobes around each portrait, like the medallions of an embroidered suzani.
const ROSETTE = (() => {
  const n = 16;
  const r = MEDAL_R - 3;
  const pt = (i: number) => {
    const a = (i / n) * Math.PI * 2;
    return `${(CARD_W / 2 + r * Math.cos(a)).toFixed(2)},${(MEDAL_CY + r * Math.sin(a)).toFixed(2)}`;
  };
  const lobe = (2 * r * Math.sin(Math.PI / n) * 0.62).toFixed(2);
  return `M${pt(0)} ${Array.from({ length: n }, (_, i) => `A${lobe},${lobe} 0 0 1 ${pt(i + 1)}`).join(" ")}Z`;
})();
const PORTRAIT_R = MEDAL_R - 10;

// Khatam (eight-pointed star) lattice that pans and zooms with the tree.
const KHATAM_TILE = 64;
const KHATAM = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' fill='none' stroke='white' stroke-opacity='0.055'><path d='M18 18h28v28H18zM32 12.2 51.8 32 32 51.8 12.2 32z'/></svg>",
)}")`;
const STEP_MS = 160; // the tree grows one generation at a time on first paint

const initials = (p: Person) => `${p.firstName.slice(0, 1)}${p.lastName.slice(0, 1)}`.toUpperCase();

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
  const lineage = useMemo(() => (selectedId ? lineageOf(selectedId, relationships) : null), [selectedId, relationships]);
  // One label per generation row, left of the tree; a single row needs none.
  const rows = useMemo(() => {
    const ys = new Map(layout.nodes.map((n) => [n.gen, n.y + MEDAL_CY]));
    return ys.size > 1 ? [...ys].sort((a, b) => a[0] - b[0]) : [];
  }, [layout]);
  const labelX = layout.bounds.minX - 28;

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 48;
    const gutter = rows.length ? 96 : 0;
    const b = { ...layout.bounds, minX: layout.bounds.minX - gutter, width: layout.bounds.width + gutter };
    const k = clampK(Math.min((width - pad * 2) / b.width, (height - pad * 2) / b.height, 1));
    setView({ k, x: (width - b.width * k) / 2 - b.minX * k, y: Math.max(pad, (height - b.height * k) / 2) });
  }, [layout, rows]);

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
        style={{ backgroundImage: KHATAM, backgroundSize: `${KHATAM_TILE * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        className="h-[min(70dvh,760px)] cursor-grab touch-none overflow-hidden border border-line bg-surface select-none active:cursor-grabbing"
      >
        <svg width="100%" height="100%" aria-hidden={false}>
          <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transition: glide ? "transform 400ms var(--ease-in-out)" : undefined }}>
            {rows.map(([gen, y]) => (
              <text key={gen} x={labelX} y={y + 4} textAnchor="end" fontSize={11} fontWeight={600} letterSpacing="0.14em" fill="var(--dim)" opacity={0.6}>
                {gen + 1}-AVLOD
              </text>
            ))}
            {layout.edges.map((edge) => {
              const lit = lineage ? edge.from.some((id) => lineage.has(id)) && edge.to.some((id) => lineage.has(id)) : false;
              const delay = `${edge.knot ? edge.gen * STEP_MS + 120 : (edge.gen - 1) * STEP_MS + 80}ms`;
              const color = lit ? "var(--accent)" : "var(--dim)";
              return (
                <g key={edge.key}>
                  <path d={edge.d} fill="none" strokeLinecap="round" pathLength={edge.dashed ? undefined : 1}
                    strokeDasharray={edge.dashed ? "6 5" : "1 1"}
                    className={cx("transition-[stroke,stroke-opacity,stroke-width] duration-300", edge.dashed ? "tree-fade" : "tree-draw")}
                    style={{ animationDelay: delay }}
                    stroke={color} strokeOpacity={lit ? 1 : lineage ? 0.16 : 0.45} strokeWidth={lit ? 2.4 : 1.6} />
                  {edge.knot && (
                    <rect x={-4.5} y={-4.5} width={9} height={9} transform={`translate(${edge.knot.x},${edge.knot.y}) rotate(45)`}
                      className="tree-fade transition-[stroke] duration-300" style={{ animationDelay: delay }}
                      fill="var(--surface)" stroke={color} strokeOpacity={lit ? 1 : lineage ? 0.3 : 0.7} strokeWidth={1.5} />
                  )}
                </g>
              );
            })}
            {layout.nodes.map((n) => {
              const p = byId.get(n.id)!;
              const selected = n.id === selectedId;
              const kin = lineage?.has(n.id) ?? false;
              const name = personName(p);
              const span = lifeSpan(p);
              const mid = CARD_W / 2;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${name}${span ? `, ${span}` : ""}`}
                  aria-pressed={selected}
                  className="group cursor-pointer outline-none"
                  onFocus={() => reveal(n.x, n.y)}
                  onClick={() => !moved.current && onSelect(n.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(n.id))}
                >
                  <title>{name}</title>
                  <g className="tree-bloom" style={{ animationDelay: `${n.gen * STEP_MS}ms` }}>
                    <g className="transition-opacity duration-300" opacity={lineage && !kin ? 0.32 : 1}>
                      {/* Transparent hit area: the gap between medallion and name still selects. */}
                      <rect width={CARD_W} height={CARD_H} fill="transparent" />
                      <g className="origin-center transition-transform duration-200 ease-out [transform-box:fill-box] group-hover:scale-[1.05]">
                        {selected && <circle cx={mid} cy={MEDAL_CY} r={MEDAL_R + 12} fill="var(--accent)" opacity={0.16} />}
                        <path d={ROSETTE} fill="var(--surface-2)" strokeWidth={selected ? 2.5 : 1.5}
                          stroke={kin ? "var(--accent)" : "var(--mist)"} strokeOpacity={selected ? 1 : kin ? 0.7 : 0.35}
                          className="transition-[stroke,stroke-opacity] duration-300 group-focus-visible:stroke-[var(--ring)] group-focus-visible:[stroke-opacity:1] group-focus-visible:[stroke-width:3]" />
                        <circle cx={mid} cy={MEDAL_CY} r={PORTRAIT_R + 4} fill="none" stroke="var(--mist)" strokeOpacity={0.45}
                          strokeWidth={1.2} strokeDasharray="1.2 3.6" strokeLinecap="round" />
                        {p.avatarMediaId ? (
                          <>
                            <clipPath id={`av-${n.id}`}><circle cx={mid} cy={MEDAL_CY} r={PORTRAIT_R} /></clipPath>
                            <image href={`/api/media/${p.avatarMediaId}/thumb`} x={mid - PORTRAIT_R} y={MEDAL_CY - PORTRAIT_R}
                              width={PORTRAIT_R * 2} height={PORTRAIT_R * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#av-${n.id})`}
                              style={p.isLiving ? undefined : { filter: "grayscale(1)" }} />
                          </>
                        ) : (
                          <>
                            {/* Living: light disc; remembered: deep disc, matching the grey portraits. */}
                            <circle cx={mid} cy={MEDAL_CY} r={PORTRAIT_R} fill={p.isLiving ? "var(--mist)" : "var(--night)"} />
                            <text x={mid} y={MEDAL_CY + 7} textAnchor="middle" fontSize={20} letterSpacing="0.04em" fontWeight={600}
                              fontFamily="var(--font-display)" fill={p.isLiving ? "var(--mist-ink)" : "var(--dim)"}>
                              {initials(p)}
                            </text>
                          </>
                        )}
                      </g>
                      <text x={mid} y={MEDAL_CY + MEDAL_R + 22} textAnchor="middle" fontSize={15} fontWeight={600}
                        fontFamily="var(--font-display)" fill={selected ? "var(--accent)" : "var(--ink)"}>{truncate(p.firstName, 17)}</text>
                      {p.lastName && <text x={mid} y={MEDAL_CY + MEDAL_R + 39} textAnchor="middle" fontSize={12.5} fill="var(--dim)">{truncate(p.lastName, 20)}</text>}
                      {span && (
                        <text x={mid} y={MEDAL_CY + MEDAL_R + (p.lastName ? 55 : 39)} textAnchor="middle" fontSize={11.5} fill="var(--dim)"
                          opacity={0.8} style={{ fontVariantNumeric: "tabular-nums" }}>{span}</text>
                      )}
                    </g>
                  </g>
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
