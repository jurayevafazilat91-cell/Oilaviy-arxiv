import type { MediaFilters } from "./queries";

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);
const year = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1800 && n <= 2200 ? n : undefined;
};

/** Shared by the page (server render) and the API (infinite scroll) so both apply identical filters. */
export function filtersFromParams(p: URLSearchParams): MediaFilters {
  const kind = p.get("kind");
  const keywords = p.getAll("kw").map((k) => k.slice(0, 40)).filter(Boolean);
  return {
    q: p.get("q")?.slice(0, 200) || undefined,
    keywords: keywords.length ? keywords : undefined,
    kind: kind === "image" || kind === "video" ? kind : undefined,
    yearFrom: year(p.get("from")),
    yearTo: year(p.get("to")),
    albumId: uuid(p.get("album")),
    personId: uuid(p.get("person")),
    trash: p.get("trash") === "1",
  };
}
