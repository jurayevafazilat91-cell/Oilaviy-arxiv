"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, FileVideo, RotateCcw, UploadCloud, X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { useUploads, type UploadItem } from "./upload-provider";
import { Button, cx, IconButton, Select } from "./ui";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov,.m4v";

export function UploadPanel({ albums, maxImageMb, maxVideoMb, defaultAlbum }: {
  albums: { id: string; title: string }[]; maxImageMb: number; maxVideoMb: number; defaultAlbum: string | null;
}) {
  const { items, add, cancel, retry, clearFinished } = useUploads();
  const [albumId, setAlbumId] = useState(defaultAlbum ?? "");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (files: FileList | null) => {
    if (files?.length) add([...files], albumId || null);
    if (input.current) input.current.value = "";
  };

  const finished = items.filter((i) => ["done", "duplicate", "failed", "cancelled"].includes(i.status)).length;
  const summary = {
    done: items.filter((i) => i.status === "done").length,
    dup: items.filter((i) => i.status === "duplicate").length,
    failed: items.filter((i) => i.status === "failed").length,
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
        <div>
          <label htmlFor="album" className="mb-1.5 block text-sm font-medium">Albom</label>
          <Select id="album" value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
            <option value="">Albomsiz</option>
            {albums.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </Select>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
          className={cx(
            "flex flex-col items-center border-2 border-dashed px-6 py-12 text-center transition-colors",
            drag ? "border-accent bg-surface-2" : "border-line bg-surface",
          )}
        >
          <UploadCloud className="mb-4 size-10 text-accent" aria-hidden />
          <p className="font-display text-xl font-medium uppercase">Fayllarni shu yerga tashlang</p>
          <p className="mt-1 mb-5 text-sm text-dim">yoki kompyuter/telefondan tanlang</p>
          <Button variant="primary" onClick={() => input.current?.click()}>Fayllarni tanlash</Button>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files)} />
        </div>
        <ul className="space-y-1 text-sm text-dim">
          <li>Rasmlar: JPEG, PNG, WebP, HEIC — {maxImageMb} MB gacha</li>
          <li>Videolar: MP4, MOV — {maxVideoMb >= 1024 ? `${(maxVideoMb / 1024).toFixed(0)} GB` : `${maxVideoMb} MB`} gacha</li>
          <li>Asl fayllar oʻzgartirilmasdan saqlanadi. Brauzer ochmaydigan videolar uchun koʻrish nusxasi yaratiladi.</li>
          <li>Joylashuv (GPS) koʻrish nusxalaridan olib tashlanadi.</li>
        </ul>
      </div>

      <section aria-labelledby="queue-h">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="queue-h" className="font-display text-xl font-medium uppercase">Navbat</h2>
          {finished > 0 && <Button size="sm" variant="ghost" onClick={clearFinished}>Tugaganlarni tozalash</Button>}
        </div>
        {items.length === 0 ? (
          <p className="bg-surface px-5 py-10 text-center text-dim">Hali fayl tanlanmagan.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-dim" aria-live="polite">
              {summary.done} ta saqlandi{summary.dup ? `, ${summary.dup} ta dublikat` : ""}{summary.failed ? `, ${summary.failed} ta xato` : ""} · jami {items.length}
            </p>
            <ul className="divide-y divide-line overflow-hidden bg-surface">
              {items.map((item) => <Row key={item.key} item={item} onCancel={() => cancel(item.key)} onRetry={() => retry(item.key)} />)}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

const STATUS: Record<UploadItem["status"], string> = {
  queued: "Navbatda",
  uploading: "Yuklanmoqda",
  processing: "Qayta ishlanmoqda",
  done: "Saqlandi",
  duplicate: "Arxivda bor edi",
  failed: "Xato",
  cancelled: "Bekor qilindi",
};

function Row({ item, onCancel, onRetry }: { item: UploadItem; onCancel: () => void; onRetry: () => void }) {
  const pct = Math.round(item.progress * 100);
  return (
    <li className="flex items-center gap-3 p-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        {item.preview ? <img src={item.preview} alt="" className="size-full object-cover" /> : <FileVideo className="size-6 text-dim" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium" title={item.file.name}>{item.file.name}</p>
        <p className={cx("flex items-center gap-1.5 text-sm", item.status === "failed" ? "text-danger" : "text-dim")}>
          {item.status === "done" && <CheckCircle2 className="size-4 text-ok" aria-hidden />}
          {item.status === "duplicate" && <Copy className="size-4" aria-hidden />}
          {item.status === "failed" && <AlertTriangle className="size-4" aria-hidden />}
          <span>{STATUS[item.status]}{item.status === "uploading" ? ` · ${pct}%` : ""}{item.error ? `: ${item.error}` : ""}</span>
          <span className="text-dim">· {formatBytes(item.file.size)}</span>
        </p>
        {(item.status === "uploading" || item.status === "processing") && (
          <div
            role="progressbar"
            aria-label={`${item.file.name} yuklanishi`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-2 h-1.5 overflow-hidden bg-surface-2"
          >
            <div className={cx("h-full bg-accent transition-[width] duration-300", item.status === "processing" && "animate-pulse")} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {(item.status === "queued" || item.status === "uploading") && (
        <IconButton label={`${item.file.name}: bekor qilish`} onClick={onCancel}><X className="size-5" aria-hidden /></IconButton>
      )}
      {(item.status === "failed" || item.status === "cancelled") && (
        <IconButton label={`${item.file.name}: qayta urinish`} onClick={onRetry}><RotateCcw className="size-5" aria-hidden /></IconButton>
      )}
      {(item.status === "done" || item.status === "duplicate") && item.mediaId && (
        <Link href={`/media/${item.mediaId}`} className="px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2">Koʻrish</Link>
      )}
    </li>
  );
}
