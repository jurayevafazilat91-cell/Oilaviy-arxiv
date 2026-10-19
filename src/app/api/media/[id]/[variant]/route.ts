import { apiUser, handleApiError, HttpError } from "@/lib/http";
import { getMediaForFile } from "@/lib/media/queries";
import { mediaKey, storage, type ByteRange, type Variant } from "@/lib/storage";

const VARIANTS = new Set<Variant>(["original", "thumb", "preview", "playback"]);

function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

const contentDisposition = (name: string, inline: boolean) =>
  `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Streams a stored file after checking the viewer belongs to the media's family. Supports Range for video seeking. */
export async function GET(req: Request, ctx: RouteContext<"/api/media/[id]/[variant]">) {
  try {
    const user = await apiUser();
    const { id, variant } = await ctx.params;
    if (!VARIANTS.has(variant as Variant)) throw new HttpError(404, "Topilmadi");
    const media = await getMediaForFile(user, id);
    if (!media) throw new HttpError(404, "Topilmadi");
    if (variant !== "original" && !media.variants.includes(variant)) throw new HttpError(404, "Topilmadi");

    const key = mediaKey(media.familyId, media.id, variant as Variant);
    const store = storage();
    const size = variant === "original" ? Number(media.sizeBytes) : await store.size(key);
    if (size == null) throw new HttpError(404, "Topilmadi");

    const range = parseRange(req.headers.get("range"), size);
    if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const obj = await store.get(key, range ?? undefined);
    if (!obj) throw new HttpError(404, "Topilmadi");

    const contentType = variant === "original" ? media.mime : variant === "playback" ? "video/mp4" : "image/webp";
    const download = new URL(req.url).searchParams.has("download");
    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Length": String(obj.length),
      "Accept-Ranges": "bytes",
      // Content never changes for a given id+variant; keep it out of shared caches.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition(variant === "original" ? media.originalName : `${media.id}-${variant}`, !download),
    });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${obj.size}`);
    return new Response(obj.body, { status: range ? 206 : 200, headers });
  } catch (err) {
    return handleApiError(err);
  }
}
