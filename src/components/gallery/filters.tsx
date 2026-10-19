"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Images, Search, Sparkles, X } from "lucide-react";
import { aiSearchAction } from "@/actions/media";
import { Button, cx, Notice } from "../ui";

const KINDS = [
  { value: "", label: "Hammasi" },
  { value: "image", label: "Rasmlar" },
  { value: "video", label: "Videolar" },
];

export function GalleryFilters({ years, aiEnabled }: { years: { year: number; count: number }[]; aiEnabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const aiQuery = params.get("ai");
  const [q, setQ] = useState(aiQuery ?? params.get("q") ?? "");
  const [useAi, setUseAi] = useState(Boolean(aiQuery));
  const [error, setError] = useState<string | null>(null);

  const go = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params);
    p.delete("m");
    mutate(p);
    startTransition(() => router.push(`${pathname}${p.size ? `?${p}` : ""}`));
  };
  const clearSearch = (p: URLSearchParams) => ["q", "ai", "kw", "from", "to"].forEach((k) => p.delete(k));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const text = q.trim();
    if (!useAi || !text) return go((p) => { clearSearch(p); if (text) p.set("q", text); });
    const r = await aiSearchAction(text);
    if (!r.ok) {
      setError(`${r.error}. Oddiy qidiruv ishlatildi.`);
      return go((p) => { clearSearch(p); p.set("q", text); });
    }
    go((p) => {
      clearSearch(p);
      p.set("ai", text);
      for (const k of r.data.keywords) p.append("kw", k);
      if (r.data.yearFrom) p.set("from", String(r.data.yearFrom));
      if (r.data.yearTo) p.set("to", String(r.data.yearTo));
      if (r.data.kind !== "any") p.set("kind", r.data.kind);
      else p.delete("kind");
    });
  };

  const kind = params.get("kind") ?? "";
  const year = params.get("from") && params.get("from") === params.get("to") ? params.get("from")! : "";
  const keywords = params.getAll("kw");
  const hasFilters = ["q", "ai", "kw", "from", "to", "kind"].some((k) => params.has(k));

  const total = years.reduce((n, y) => n + y.count, 0);
  const max = Math.max(1, ...years.map((y) => y.count));
  const setYear = (y: string) => go((p) => {
    if (y) { p.set("from", y); p.set("to", y); }
    else { p.delete("from"); p.delete("to"); }
  });

  return (
    <div className="mb-10 space-y-4">
      {/* Mist card: the family's files counted per year; a bar doubles as the year filter. */}
      <section aria-labelledby="archive-h" className="bg-mist p-5 text-mist-ink [--ring:var(--mist-ink)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h1 id="archive-h" className="font-display text-[1.75rem] leading-none font-bold tracking-tight uppercase sm:text-4xl">Arxiv</h1>
          {years.length > 1 && (
            <>
              <label htmlFor="year" className="sr-only">Yil</label>
              <select id="year" value={year} onChange={(e) => setYear(e.target.value)}
                className="min-h-9 cursor-pointer bg-slate pr-9 pl-3.5 text-sm text-slate-ink">
                <option value="">Barcha yillar</option>
                {years.map(({ year: y }) => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
        </div>
        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-7 sm:mt-10">
          <div>
            <p className="flex items-center gap-4">
              <span className="flex size-11 items-center justify-center bg-mist-ink text-mist"><Images className="size-5" strokeWidth={1.75} aria-hidden /></span>
              <span className="font-display text-4xl leading-none font-semibold tracking-tight tabular-nums">{total.toLocaleString("ru-RU")}</span>
            </p>
            <p className="mt-5 text-sm leading-snug font-semibold tracking-wide uppercase">Oila xotiralari.<br />Yillar boʻyicha.</p>
          </div>
          {years.length > 0 && (
            <div role="group" aria-label="Yil boʻyicha filtr" className="-mx-2 flex max-w-full items-end gap-1 overflow-x-auto px-2 pb-1">
              {[...years].reverse().map(({ year: y, count }) => {
                const on = year === String(y);
                return (
                  <button key={y} type="button" aria-pressed={on} aria-label={`${y}: ${count} ta fayl`} title={`${y}: ${count} ta`}
                    onClick={() => setYear(on ? "" : String(y))}
                    className="group flex w-9 shrink-0 cursor-pointer flex-col items-center gap-2">
                    <span className="flex h-24 w-3 flex-col justify-end gap-0.5">
                      <span className="h-2 bg-mist-dim/30 transition-colors group-hover:bg-mist-dim/60" />
                      <span className={cx("transition-[height,background-color] duration-500 ease-out-expo", on ? "bg-accent outline outline-mist-ink/15" : "bg-white")}
                        style={{ height: `${Math.max(6, Math.round((count / max) * 80))}px` }} />
                    </span>
                    <span className={cx("text-[11px] font-medium tabular-nums", on && "font-bold")}>{String(y).slice(2)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <form role="search" onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-dim" aria-hidden />
          <label htmlFor="gallery-q" className="sr-only">Qidirish</label>
          <input
            id="gallery-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={useAi ? "Masalan: 2019-yil yozida dengizda" : "Sarlavha, teg, odam ismi…"}
            className="min-h-12 w-full border border-transparent bg-surface pr-4 pl-12 text-[15px] placeholder:text-dim/60 hover:border-line focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {aiEnabled && (
            <button
              type="button"
              aria-pressed={useAi}
              onClick={() => setUseAi((v) => !v)}
              className={cx(
                "inline-flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-medium transition-colors",
                useAi ? "bg-accent text-accent-ink" : "bg-surface text-dim hover:text-ink",
              )}
            >
              <Sparkles className="size-4" aria-hidden /> AI qidiruv
            </button>
          )}
          <Button type="submit" variant="secondary" loading={pending} className="min-h-12 flex-1 px-6 sm:flex-none">Qidirish</Button>
        </div>
      </form>

      <Notice>{error}</Notice>

      <div className={cx("flex flex-wrap items-center gap-2", !hasFilters && "md:hidden")}>
        <div role="group" aria-label="Turi" className="flex bg-surface md:hidden">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => go((p) => (k.value ? p.set("kind", k.value) : p.delete("kind")))}
              className={cx("min-h-10 cursor-pointer px-4 text-sm", kind === k.value ? "bg-accent font-medium text-accent-ink" : "text-dim hover:text-ink")}
            >
              {k.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={() => { setQ(""); go((p) => { clearSearch(p); p.delete("kind"); }); }}>
            <X className="size-4" aria-hidden /> Tozalash
          </Button>
        )}
      </div>

      {aiQuery && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-dim">
          <Sparkles className="size-4 text-accent" aria-hidden />
          AI tushundi:
          {keywords.map((k) => <span key={k} className="rounded-full bg-surface px-3 py-1 text-ink">{k}</span>)}
          {params.get("from") && <span className="rounded-full bg-surface px-3 py-1 text-ink">{params.get("from")}{params.get("to") !== params.get("from") ? `–${params.get("to") ?? ""}` : ""}</span>}
        </p>
      )}
    </div>
  );
}
