import { createWriteStream } from "node:fs";
import { copyFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { interpretSearch } from "./ai";
import type { CurrentUser } from "./auth";
import { sql } from "./db";
import { env, MB } from "./env";
import { randomCode, sha256 } from "./crypto";
import { enqueue, isFinalAttempt, PermanentError, type Job } from "./jobs";
import { personName } from "./format";
import { ingestFile, markIngestFailed, tmpDir } from "./media/ingest";
import { listMedia, type MediaFilters, type MediaItem } from "./media/queries";
import { ALLOWED_EXTENSIONS, extensionOf } from "./media/sniff";
import { rateLimit } from "./rate-limit";
import { mediaKey, storage } from "./storage";
import { ageWindow, findPeopleByName } from "./tree";

// ---------- Bot API client ----------

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

export class TelegramApiError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

const redact = (s: string) => {
  const token = env().TELEGRAM_BOT_TOKEN;
  return token ? s.replaceAll(token, "<token>") : s;
};

type TgUpload = { field: string; data: Buffer; type: string; filename: string };

/** Calls the Bot API; with `files` the request goes as multipart and each file is referenced as `attach://<field>`. */
export async function tg<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000, files: TgUpload[] = []): Promise<T> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_API_BASE: base } = env();
  if (!token) throw new TelegramApiError("TELEGRAM_BOT_TOKEN sozlanmagan");
  let body: string | FormData = JSON.stringify(params);
  if (files.length) {
    body = new FormData();
    for (const [k, v] of Object.entries(params)) body.append(k, typeof v === "string" ? v : JSON.stringify(v));
    for (const f of files) body.append(f.field, new Blob([new Uint8Array(f.data)], { type: f.type }), f.filename);
  }
  let res: Response;
  try {
    res = await fetch(`${base}/bot${token}/${method}`, {
      method: "POST",
      headers: files.length ? undefined : { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TelegramApiError(redact(`network: ${(err as Error).message}`));
  }
  const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
  if (!data.ok) throw new TelegramApiError(redact(data.description ?? "Telegram error"), data.error_code ?? res.status);
  return data.result as T;
}

export const sendMessage = (chatId: number, text: string, replyTo?: number) =>
  tg("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  }).catch((e) => console.error("telegram sendMessage:", (e as Error).message));

const react = (chatId: number, messageId: number) =>
  tg("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: "👍" }] })
    .catch(() => sendMessage(chatId, "Saqlandi.", messageId));

// ---------- Update types (only fields we read) ----------

type TgFile = { file_id: string; file_unique_id: string; file_size?: number; file_name?: string; mime_type?: string };
type TgPhoto = TgFile & { width: number; height: number };
export type TgMessage = {
  message_id: number;
  from?: { id: number; is_bot: boolean };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: TgPhoto[];
  video?: TgFile;
  document?: TgFile;
  animation?: TgFile;
  video_note?: TgFile;
  sticker?: unknown;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

// ---------- Account linking ----------

const LINK_CODE_MINUTES = 10;

export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = randomCode(8);
  const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60_000);
  await sql.begin(async (tx) => {
    await tx`delete from telegram_link_codes where user_id = ${userId}`; // only the latest code is valid
    await tx`insert into telegram_link_codes (code_hash, user_id, expires_at) values (${sha256(code)}, ${userId}, ${expiresAt})`;
  });
  return { code, expiresAt };
}

/** Consumes a code exactly once and binds the Telegram numeric user id (never the username). */
async function linkAccount(code: string, telegramUserId: number, chatId: number): Promise<"linked" | "invalid" | "taken"> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ userId: string }[]>`
      update telegram_link_codes set used_at = now()
      where code_hash = ${sha256(code.toUpperCase())} and used_at is null and expires_at > now()
      returning user_id`;
    if (!row) return "invalid";
    const [user] = await tx`select 1 from users where id = ${row.userId} and disabled_at is null and role <> 'viewer'`;
    if (!user) return "invalid";
    const [other] = await tx`select 1 from telegram_links where telegram_user_id = ${telegramUserId} and user_id <> ${row.userId}`;
    if (other) return "taken";
    await tx`
      insert into telegram_links (user_id, telegram_user_id, chat_id) values (${row.userId}, ${telegramUserId}, ${chatId})
      on conflict (user_id) do update set telegram_user_id = excluded.telegram_user_id, chat_id = excluded.chat_id, linked_at = now()`;
    return "linked";
  });
}

// ---------- Incoming updates ----------

const HELP = [
  "Bu bot rasm va videolaringizni oilaviy arxivga saqlaydi va arxivdan qidiradi.",
  "",
  "1. Saytda Sozlamalar → Telegram boʻlimidan ulanish kodini oling.",
  "2. Shu yerga rasm, video yoki fayl yuboring.",
  "",
  "Albom tanlash: izohga #albom-nomi yozing (masalan #toy-2024). Aks holda fayl “Telegram” albomiga tushadi.",
  "Joyni tejash uchun rasm 2048 px, video 720p qilib siqib saqlanadi.",
  "",
  "Qidirish: oddiy gap yozing, masalan “2023-yil dengizdagi rasmlar” yoki “Dilfuzaning 7 yoshdagi rasm va videolari”.",
  "/stop — ulanishni uzish.",
].join("\n");

type MediaPick = { file: TgFile; name: string };

function pickMedia(msg: TgMessage): MediaPick | "unsupported" | null {
  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    return { file: best, name: `telegram-${msg.message_id}.jpg` };
  }
  if (msg.video) return { file: msg.video, name: msg.video.file_name ?? `telegram-${msg.message_id}.mp4` };
  if (msg.document) {
    const name = msg.document.file_name ?? "";
    const mime = msg.document.mime_type ?? "";
    const ok = ALLOWED_EXTENSIONS.includes(extensionOf(name)) || /^(image|video)\//.test(mime);
    return ok ? { file: msg.document, name: name || `telegram-${msg.message_id}` } : "unsupported";
  }
  if (msg.animation || msg.video_note || msg.sticker) return "unsupported";
  return null;
}

/** `#albom-nomi` in a caption selects (or creates) the album; underscores and dashes become spaces. */
export function albumFromCaption(caption?: string): string | null {
  const m = caption ? /#([\p{L}\p{N}_ʻʼ'-]{1,60})/u.exec(caption) : null;
  return m ? m[1].replace(/[_-]+/g, " ").trim() : null;
}

async function findOrCreateAlbum(familyId: string, userId: string, title: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into albums (family_id, title, created_by) values (${familyId}, ${title}, ${userId})
    on conflict (family_id, lower(title)) do update set title = albums.title
    returning id`;
  return row.id;
}

async function resolveAlbum(msg: TgMessage, familyId: string, userId: string): Promise<string> {
  const tagged = albumFromCaption(msg.caption);
  const fallback = () => findOrCreateAlbum(familyId, userId, "Telegram");
  if (!msg.media_group_id) return tagged ? findOrCreateAlbum(familyId, userId, tagged) : fallback();

  // Album parts arrive as separate updates; the caption normally sits on the first one.
  // shortcut: a hashtag on a later part only redirects that part and the ones after it.
  if (tagged) {
    const albumId = await findOrCreateAlbum(familyId, userId, tagged);
    await sql`
      insert into telegram_media_groups (chat_id, media_group_id, album_id) values (${msg.chat.id}, ${msg.media_group_id}, ${albumId})
      on conflict (chat_id, media_group_id) do update set album_id = excluded.album_id`;
    return albumId;
  }
  const [group] = await sql<{ albumId: string | null }[]>`
    select album_id from telegram_media_groups where chat_id = ${msg.chat.id} and media_group_id = ${msg.media_group_id}`;
  if (group?.albumId) return group.albumId;
  const albumId = await fallback();
  await sql`
    insert into telegram_media_groups (chat_id, media_group_id, album_id) values (${msg.chat.id}, ${msg.media_group_id}, ${albumId})
    on conflict do nothing`;
  return albumId;
}

/** Handles one update. Safe to call repeatedly with the same update (webhook redelivery, polling restarts). */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (!Number.isSafeInteger(update?.update_id)) return;
  const fresh = await sql`insert into telegram_updates (update_id) values (${update.update_id}) on conflict do nothing returning update_id`;
  if (!fresh.length) return;
  try {
    await handleMessage(update.message);
  } catch (err) {
    // Forget the update so Telegram's redelivery (or the next poll) retries it.
    await sql`delete from telegram_updates where update_id = ${update.update_id}`;
    throw err;
  }
}

async function handleMessage(msg: TgMessage | undefined): Promise<void> {
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (msg.chat.type !== "private") return; // groups are out of scope for v1
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code) return void (await sendMessage(chatId, HELP));
    const result = /^[A-Za-z0-9]{8}$/.test(code) ? await linkAccount(code, msg.from.id, chatId) : "invalid";
    const reply = {
      linked: "Telegram akkauntingiz arxivga ulandi. Endi rasm va video yuborishingiz mumkin.\n\n" + HELP,
      invalid: "Kod notoʻgʻri yoki muddati oʻtgan. Saytda yangi kod oling (kod 10 daqiqa amal qiladi).",
      taken: "Bu Telegram akkaunt boshqa foydalanuvchiga ulangan. Avval oʻsha akkauntda /stop yuboring.",
    }[result];
    return void (await sendMessage(chatId, reply));
  }

  const [link] = await sql<{ userId: string; familyId: string; role: string }[]>`
    select l.user_id, u.family_id, u.role
    from telegram_links l join users u on u.id = l.user_id
    where l.telegram_user_id = ${msg.from.id} and u.disabled_at is null`;

  if (text === "/stop") {
    await sql`delete from telegram_links where telegram_user_id = ${msg.from.id}`;
    return void (await sendMessage(chatId, link ? "Ulanish uzildi. Qayta ulash uchun saytdan yangi kod oling." : "Akkaunt ulanmagan."));
  }
  if (text === "/help") return void (await sendMessage(chatId, HELP));

  const picked = pickMedia(msg);
  if (!picked) {
    if (!text) return;
    if (!link || text.startsWith("/")) return void (await sendMessage(chatId, HELP));
    // Plain text searches the family archive; the files go out from a job, after this webhook has answered.
    await enqueue("telegram_search", { chatId, messageId: msg.message_id, userId: link.userId, text: text.slice(0, 200) },
      { dedupeKey: `tgs:${chatId}:${msg.message_id}`, maxAttempts: 1 }); // one attempt: a retry would send the files twice
    return;
  }
  if (!link) return void (await sendMessage(chatId, "Avval akkauntni ulang: saytda Sozlamalar → Telegram.", msg.message_id));
  if (link.role === "viewer") return void (await sendMessage(chatId, "Sizda yuklash huquqi yoʻq.", msg.message_id));
  if (picked === "unsupported") {
    return void (await sendMessage(chatId, "Bu turdagi fayl saqlanmaydi. Qoʻllanadi: JPEG, PNG, WebP, HEIC, MP4, MOV.", msg.message_id));
  }
  const maxBytes = env().TELEGRAM_MAX_DOWNLOAD_MB * MB;
  if (picked.file.file_size && picked.file.file_size > maxBytes) {
    return void (await sendMessage(chatId,
      `Fayl ${env().TELEGRAM_MAX_DOWNLOAD_MB} MB dan katta — bot uni yuklab ololmaydi. Iltimos, sayt orqali yuklang.`, msg.message_id));
  }

  const albumId = await resolveAlbum(msg, link.familyId, link.userId);
  await enqueue("telegram_ingest", {
    chatId,
    messageId: msg.message_id,
    userId: link.userId,
    familyId: link.familyId,
    fileId: picked.file.file_id,
    fileName: picked.name,
    albumId,
    mediaGroupId: msg.media_group_id ?? null,
  }, { dedupeKey: `tg:${chatId}:${msg.message_id}` });
}

// ---------- Background download + ingest ----------

const SAFE_FILE_PATH = /^[A-Za-z0-9_\-./]+$/;

async function downloadTelegramFile(fileId: string, dest: string): Promise<void> {
  const e = env();
  const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new PermanentError("Telegram faylni bermadi");
  const maxBytes = e.TELEGRAM_MAX_DOWNLOAD_MB * MB;

  if (e.TELEGRAM_LOCAL_SERVER && path.isAbsolute(file.file_path)) {
    // Local Bot API server returns a path on its own disk, shared with us as a volume.
    const root = path.resolve(/*turbopackIgnore: true*/ e.TELEGRAM_LOCAL_FILES_DIR ?? "/var/lib/telegram-bot-api");
    const resolved = path.resolve(/*turbopackIgnore: true*/ file.file_path);
    if (!resolved.startsWith(root + path.sep)) throw new PermanentError("Telegram fayl yoʻli ruxsat etilmagan");
    if ((await stat(resolved)).size > maxBytes) throw new PermanentError("Fayl juda katta");
    await copyFile(resolved, dest);
    return;
  }

  // The URL is always built from our configured API base, so update content cannot redirect the fetch (no SSRF).
  if (!SAFE_FILE_PATH.test(file.file_path) || file.file_path.includes("..")) throw new PermanentError("Telegram fayl yoʻli notoʻgʻri");
  const res = await fetch(`${e.TELEGRAM_API_BASE}/file/bot${e.TELEGRAM_BOT_TOKEN}/${file.file_path}`, {
    signal: AbortSignal.timeout(10 * 60_000),
    redirect: "error",
  }).catch((err) => {
    throw new TelegramApiError(redact(`download: ${(err as Error).message}`));
  });
  if (!res.ok || !res.body) throw new TelegramApiError(`download HTTP ${res.status}`);
  let seen = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      cb(seen > maxBytes ? new PermanentError("Fayl juda katta") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as never), cap, createWriteStream(dest));
}

export async function telegramIngestJob(job: Job) {
  const p = job.payload as {
    chatId: number; messageId: number; userId: string; familyId: string; fileId: string; fileName: string;
    albumId: string | null; mediaGroupId: string | null;
  };
  const ingestKey = `tg:${p.chatId}:${p.messageId}`;
  const file = path.join(await tmpDir("telegram"), `${p.chatId}-${p.messageId}`);
  try {
    // Permissions may have changed since the update arrived.
    const [user] = await sql`select 1 from users where id = ${p.userId} and family_id = ${p.familyId} and disabled_at is null and role <> 'viewer'`;
    if (!user) throw new PermanentError("Foydalanuvchi faol emas yoki yuklash huquqi yoʻq");
    await downloadTelegramFile(p.fileId, file);
    const result = await ingestFile({
      ingestKey, familyId: p.familyId, userId: p.userId, source: "telegram",
      filePath: file, originalName: p.fileName, albumId: p.albumId, telegramMediaGroup: p.mediaGroupId,
    });
    // Confirm only after storage + database writes succeeded.
    if (result.outcome === "created") await react(p.chatId, p.messageId);
    else await sendMessage(p.chatId, result.outcome === "restored"
      ? "Bu fayl savatda edi — tiklandi."
      : "Bu fayl arxivda allaqachon bor.", p.messageId);
  } catch (err) {
    if (isFinalAttempt(job, err)) {
      const reason = err instanceof PermanentError ? err.message : "vaqtinchalik xato, keyinroq qayta yuboring";
      await markIngestFailed(ingestKey, reason);
      await sendMessage(p.chatId, `Saqlab boʻlmadi: ${reason}.`, p.messageId);
    }
    throw err;
  } finally {
    await rm(file, { force: true });
  }
}

// ---------- Search from the chat ----------

const SEARCH_LIMIT = 10; // one Telegram album
const MAX_VIDEO_SEND = 20 * MB; // a bigger video goes as its poster, with the site link below

type ChatSearch = { filters: MediaFilters; label: string; link: string };

/** Turns the chat text into archive filters, the same way as the site's AI search; a string is a reply to send instead. */
async function chatSearch(user: CurrentUser, text: string): Promise<ChatSearch | string> {
  const [family] = await sql<{ aiEnabled: boolean }[]>`select ai_enabled from families where id = ${user.familyId}`;
  const useAi = family.aiEnabled && Boolean(env().GEMINI_API_KEY) && rateLimit(`aisearch:${user.id}`, 30, 60_000);
  const intent = useAi ? await interpretSearch(text).catch(() => null) : null;
  const link = new URL(env().APP_URL);
  if (!intent) {
    link.searchParams.set("q", text);
    return { filters: { q: text }, label: `“${text}”`, link: link.href };
  }

  const filters: MediaFilters = {
    kind: intent.kind === "any" ? undefined : intent.kind,
    yearFrom: intent.yearFrom ?? undefined,
    yearTo: intent.yearTo ?? undefined,
  };
  if (!intent.person) {
    filters.keywords = intent.keywords;
    link.searchParams.set("ai", text);
    for (const k of intent.keywords) link.searchParams.append("kw", k);
    if (filters.yearFrom) link.searchParams.set("from", String(filters.yearFrom));
    if (filters.yearTo) link.searchParams.set("to", String(filters.yearTo));
    if (filters.kind) link.searchParams.set("kind", filters.kind);
    return { filters, label: `“${text}”`, link: link.href };
  }

  // A named person: their tagged files, not keyword matches (a caption rarely says "Dilfuza").
  const people = await findPeopleByName(user, intent.person);
  if (!people.length) return `“${intent.person}” ismli odam oila daraxtida topilmadi. Uni daraxtga qoʻshing va rasmlarda belgilang.`;
  if (people.length > 1) return `Bu ismli bir nechta odam bor: ${people.map(personName).join(", ")}. Familiyasi bilan yozing.`;
  const [person] = people;
  filters.personId = person.id;
  link.pathname = `/people/${person.id}`;
  let label = personName(person);
  if (intent.ageFrom != null || intent.ageTo != null) {
    if (!person.birthDate) return `${personName(person)}ning tugʻilgan sanasi daraxtda yoʻq, yoshini hisoblab boʻlmaydi. Sanani daraxtda kiriting.`;
    const [from, to] = [intent.ageFrom ?? intent.ageTo!, intent.ageTo ?? intent.ageFrom!].sort((a, b) => a - b);
    const window = ageWindow(person.birthDate, from, to);
    filters.dateFrom = window.from;
    filters.dateTo = window.to;
    label += from === to ? ` · ${from} yosh` : ` · ${from}–${to} yosh`;
  }
  return { filters, label, link: link.href };
}

const readStored = async (key: string) => {
  const obj = await storage().get(key);
  return obj ? Buffer.from(await new Response(obj.body).arrayBuffer()) : null;
};

type ChatFile = { media: { type: "photo" | "video"; media: string; caption?: string; supports_streaming?: boolean }; file: TgUpload };

/** One file for the chat: a playable video when small enough, otherwise a JPEG of the photo or of the video's poster. */
async function chatFile(familyId: string, m: MediaItem, field: string): Promise<ChatFile | null> {
  if (m.kind === "video") {
    const key = mediaKey(familyId, m.id, m.variants.includes("playback") ? "playback" : "original");
    const size = await storage().size(key);
    const data = size && size <= MAX_VIDEO_SEND ? await readStored(key) : null;
    if (data) {
      return { media: { type: "video", media: `attach://${field}`, supports_streaming: true }, file: { field, data, type: "video/mp4", filename: `${field}.mp4` } };
    }
  }
  const src = await readStored(mediaKey(familyId, m.id, m.variants.includes("preview") ? "preview" : "original"));
  if (!src) return null;
  const data = await sharp(src).resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const media: ChatFile["media"] = { type: "photo", media: `attach://${field}` };
  if (m.kind === "video") media.caption = "▶️ Video katta, saytda koʻring";
  return { media, file: { field, data, type: "image/jpeg", filename: `${field}.jpg` } };
}

export async function telegramSearchJob(job: Job) {
  const p = job.payload as { chatId: number; messageId: number; userId: string; text: string };
  const reply = (text: string) => sendMessage(p.chatId, text, p.messageId);
  try {
    const [user] = await sql<CurrentUser[]>`
      select u.id, u.family_id, f.name as family_name, u.name, u.email, u.role, u.is_tree_editor
      from users u join families f on f.id = u.family_id where u.id = ${p.userId} and u.disabled_at is null`;
    if (!user) return;
    await tg("sendChatAction", { chat_id: p.chatId, action: "upload_photo" }).catch(() => {});
    const search = await chatSearch(user, p.text);
    if (typeof search === "string") return void (await reply(search));

    const { items, nextCursor } = await listMedia(user, { ...search.filters, limit: SEARCH_LIMIT });
    const ready = items.filter((m) => m.status === "ready");
    if (!ready.length) {
      return void (await reply(`${search.label}: hech narsa topilmadi. Rasm sanasi yoki belgilangan odamlar notoʻgʻri boʻlsa, saytda tuzating.`));
    }
    const parts = (await Promise.all(ready.map((m, i) => chatFile(user.familyId, m, `f${i}`)))).filter((x) => x !== null);
    if (parts.length === 1) {
      // A single file cannot be an album; sendPhoto/sendVideo take it under the field named after its type.
      const [{ media, file }] = parts;
      await tg(media.type === "photo" ? "sendPhoto" : "sendVideo", { chat_id: p.chatId, ...(media.caption ? { caption: media.caption } : {}) },
        120_000, [{ ...file, field: media.type }]);
    } else if (parts.length > 1) {
      await tg("sendMediaGroup", { chat_id: p.chatId, media: parts.map((x) => x.media) }, 120_000, parts.map((x) => x.file));
    }
    await reply(`${search.label}: ${ready.length}${nextCursor ? "+" : ""} ta topildi. ${nextCursor ? "Hammasi" : "Saytda"}: ${search.link}`);
  } catch (err) {
    console.error("telegram search:", (err as Error).message);
    await reply("Qidirishda xato yuz berdi. Birozdan keyin qayta urinib koʻring.");
  }
}
