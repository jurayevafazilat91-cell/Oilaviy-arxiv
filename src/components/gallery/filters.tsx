"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { aiSearchAction } from "@/actions/media";
import { Button, cx, Notice, Select } from "../ui";

const KINDS = [
  { value: "", label: "Hammasi" },
  { value: "image", label: "Rasmlar" },
  { value: "video", label: "Videolar" },
];

export function GalleryFilters({ years, aiEnabled }: { years: number[]; aiEnabled: boolean }) {
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

  return (
    <div className="mb-8 space-y-3">
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
            className="min-h-12 w-full rounded-full border border-line bg-surface pr-4 pl-12 text-[15px] placeholder:text-dim/70 focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {aiEnabled && (
            <button
              type="button"
              aria-pressed={useAi}
              onClick={() => setUseAi((v) => !v)}
              className={cx(
                "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                useAi ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-dim hover:text-ink",
              )}
            >
              <Sparkles className="size-4" aria-hidden /> AI qidiruv
            </button>
          )}
          <Button type="submit" variant="primary" loading={pending} className="min-h-12 flex-1 sm:flex-none">Qidirish</Button>
        </div>
      </form>

      <Notice>{error}</Notice>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Turi" className="flex rounded-full bg-surface-2 p-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => go((p) => (k.value ? p.set("kind", k.value) : p.delete("kind")))}
              className={cx("min-h-9 cursor-pointer rounded-full px-4 text-sm", kind === k.value ? "bg-surface text-ink shadow-sm" : "text-dim hover:text-ink")}
            >
              {k.label}
            </button>
          ))}
        </div>
        {years.length > 1 && (
          <>
            <label htmlFor="year" className="sr-only">Yil</label>
            <Select
              id="year"
              value={year}
              onChange={(e) => go((p) => {
                if (e.target.value) { p.set("from", e.target.value); p.set("to", e.target.value); }
                else { p.delete("from"); p.delete("to"); }
              })}
              className="min-h-11 w-auto rounded-full py-2"
            >
              <option value="">Barcha yillar</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </>
        )}
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
          {keywords.map((k) => <span key={k} className="rounded-full bg-accent/10 px-2.5 py-0.5 text-accent">{k}</span>)}
          {params.get("from") && <span className="rounded-full bg-surface-2 px-2.5 py-0.5">{params.get("from")}{params.get("to") !== params.get("from") ? `–${params.get("to") ?? ""}` : ""}</span>}
        </p>
      )}
    </div>
  );
}
