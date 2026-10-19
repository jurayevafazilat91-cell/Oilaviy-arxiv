// Uzbek (Latin) formatting without relying on ICU locale data being present.
export const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const TZ_OFFSET_MS = 5 * 3600_000; // Asia/Tashkent, no DST

const local = (iso: string) => new Date(new Date(iso).getTime() + TZ_OFFSET_MS);

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "";
  const d = local(iso);
  const date = `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
  if (!withTime) return date;
  return `${date}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function monthKey(iso: string): { key: string; label: string } {
  const d = local(iso);
  const m = MONTHS[d.getUTCMonth()];
  return { key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: `${m[0].toUpperCase()}${m.slice(1)} ${d.getUTCFullYear()}` };
}

/** `YYYY-MM-DD` in the family's zone, for `<input type="date">`. */
export const toDateInput = (iso: string | null) => (iso ? local(iso).toISOString().slice(0, 10) : "");

export function formatPartialDate(value: string | null | undefined): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  if (d) return `${d}-${MONTHS[m - 1]}, ${y}`;
  if (m) return `${MONTHS[m - 1]} ${y}`;
  return String(y);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

export const personName = (p: { firstName: string; lastName?: string }) => [p.firstName, p.lastName].filter(Boolean).join(" ");

export const ROLE_LABELS: Record<string, string> = { owner: "Egasi", admin: "Admin", member: "Aʼzo", viewer: "Koʻruvchi" };
