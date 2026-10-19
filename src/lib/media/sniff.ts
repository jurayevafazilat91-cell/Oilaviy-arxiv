export type Sniffed = {
  kind: "image" | "video";
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "video/mp4" | "video/quicktime";
};

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "dash", "mmp4", "MSNV", "3gp4", "3gp5", "3g2a"]);
const QT_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

/** Identifies a supported file from its first bytes; never trusts names or browser-declared types. */
export function sniff(head: Uint8Array): Sniffed | null {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return { kind: "image", mime: "image/png" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return { kind: "image", mime: "image/webp" };

  const box = ascii(head, 4, 8);
  if (box === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (HEIC_BRANDS.has(brand)) return { kind: "image", mime: "image/heic" };
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime" };
    if (MP4_BRANDS.has(brand)) return { kind: "video", mime: "video/mp4" };
    return null;
  }
  if (QT_ATOMS.has(box)) return { kind: "video", mime: "video/quicktime" };
  return null;
}

export const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "mp4", "mov", "m4v"];
export const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const isVideoExtension = (name: string) => ["mp4", "mov", "m4v"].includes(extensionOf(name));
