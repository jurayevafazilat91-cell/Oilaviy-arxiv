"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, Suspense, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";

export type UploadStatus = "queued" | "uploading" | "processing" | "done" | "duplicate" | "failed" | "cancelled";
export type UploadItem = {
  key: string;
  file: File;
  albumId: string | null;
  status: UploadStatus;
  progress: number;
  error?: string;
  uploadId?: string;
  mediaId?: string;
  preview?: string;
};

type Ctx = {
  items: UploadItem[];
  add: (files: File[], albumId: string | null) => void;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  clearFinished: () => void;
};

const UploadContext = createContext<Ctx | null>(null);
export const useUploads = () => {
  const ctx = use(UploadContext);
  if (!ctx) throw new Error("UploadProvider missing");
  return ctx;
};

const PARALLEL_FILES = 2;
const ACTIVE: UploadStatus[] = ["queued", "uploading", "processing"];

class UploadError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw new UploadError("Tarmoq xatosi", true);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(body.error ?? `Xato ${res.status}`, res.status >= 500 || res.status === 429);
  return body as T;
}

/** XHR (not fetch) so the progress bar moves while a chunk is in flight. */
function putChunk(url: string, blob: Blob, onProgress: (loaded: number) => void, signal: AbortSignal) {
  return new Promise<{ receivedBytes: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: { receivedBytes?: number; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve({ receivedBytes: Number(body.receivedBytes) });
      else reject(new UploadError(body.error ?? `Xato ${xhr.status}`, xhr.status >= 500 || xhr.status === 429));
    };
    xhr.onerror = () => reject(new UploadError("Tarmoq xatosi", true));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
  });

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof UploadError) || !err.retryable || i >= attempts) throw err;
      await sleep(1000 * 2 ** (i - 1), signal);
    }
  }
}

type PublicUpload = { id: string; status: string; receivedBytes: number; sizeBytes: number; chunkSize: number; mediaId: string | null; error: string | null };

export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(new Set<string>()); // started and not finished (includes server processing)
  const transferring = useRef(new Set<string>()); // still sending bytes; limits parallel transfers
  const router = useRouter();

  const patch = useCallback((key: string, p: Partial<UploadItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it))), []);

  const process = useCallback(async (item: UploadItem) => {
    const ctrl = new AbortController();
    controllers.current.set(item.key, ctrl);
    const { signal } = ctrl;
    try {
      patch(item.key, { status: "uploading", error: undefined });
      let up = await withRetry(() => api<PublicUpload>("/api/uploads", {
        method: "POST",
        body: JSON.stringify({ fileName: item.file.name, size: item.file.size, lastModified: item.file.lastModified, albumId: item.albumId }),
        signal,
      }), signal);
      patch(item.key, { uploadId: up.id });

      let offset = up.receivedBytes;
      while (up.status === "uploading" && offset < item.file.size) {
        const end = Math.min(offset + up.chunkSize, item.file.size);
        const start = offset;
        const res = await withRetry(() => putChunk(`/api/uploads/${up.id}?offset=${start}`, item.file.slice(start, end),
          (loaded) => patch(item.key, { progress: Math.min((start + loaded) / item.file.size, 0.99) }), signal), signal);
        offset = res.receivedBytes;
        patch(item.key, { progress: offset / item.file.size });
      }
      if (up.status === "uploading") {
        up = await withRetry(() => api<PublicUpload>(`/api/uploads/${up.id}/complete`, { method: "POST", signal }), signal);
      }
      controllers.current.delete(item.key); // past this point cancelling is not possible
      transferring.current.delete(item.key);
      patch(item.key, { status: "processing", progress: 1 });

      for (let i = 0; i < 1200 && (up.status === "processing" || up.status === "uploading"); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        up = await withRetry(() => api<PublicUpload>(`/api/uploads/${up.id}`), new AbortController().signal).catch(() => up);
      }
      if (up.status === "done" || up.status === "duplicate") {
        patch(item.key, { status: up.status, mediaId: up.mediaId ?? undefined });
        router.refresh();
      } else {
        patch(item.key, { status: "failed", error: up.error ?? "Faylni qayta ishlab boʻlmadi" });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      patch(item.key, { status: "failed", error: (err as Error).message });
    } finally {
      controllers.current.delete(item.key);
      transferring.current.delete(item.key);
      running.current.delete(item.key);
    }
  }, [patch, router]);

  // Scheduler: keeps up to PARALLEL_FILES uploads moving.
  useEffect(() => {
    const free = PARALLEL_FILES - transferring.current.size;
    const next = items.filter((i) => i.status === "queued" && !running.current.has(i.key)).slice(0, Math.max(0, free));
    for (const item of next) {
      running.current.add(item.key);
      transferring.current.add(item.key);
      void process(item);
    }
  }, [items, process]);

  const active = items.some((i) => i.status === "queued" || i.status === "uploading");
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  const add = useCallback((files: File[], albumId: string | null) => {
    setItems((list) => [
      ...list,
      ...files.map((file) => ({
        key: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
        file,
        albumId,
        status: "queued" as const,
        progress: 0,
        preview: file.type.startsWith("image/") && file.size < 30 * 1024 * 1024 ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  }, []);

  const cancel = useCallback((key: string) => {
    const item = items.find((i) => i.key === key);
    controllers.current.get(key)?.abort();
    if (item?.uploadId && item.status === "uploading") void fetch(`/api/uploads/${item.uploadId}`, { method: "DELETE" });
    patch(key, { status: "cancelled" });
  }, [items, patch]);

  const retry = useCallback((key: string) => patch(key, { status: "queued", progress: 0, error: undefined }), [patch]);

  const clearFinished = useCallback(() => setItems((list) => {
    for (const i of list) if (!ACTIVE.includes(i.status) && i.preview) URL.revokeObjectURL(i.preview);
    return list.filter((i) => ACTIVE.includes(i.status));
  }), []);

  return (
    <UploadContext value={{ items, add, cancel, retry, clearFinished }}>
      {children}
      <Suspense>
        <UploadIndicator items={items} />
      </Suspense>
    </UploadContext>
  );
}

function UploadIndicator({ items }: { items: UploadItem[] }) {
  const pathname = usePathname();
  const active = items.filter((i) => ACTIVE.includes(i.status));
  if (!active.length || pathname === "/upload") return null;
  const total = active.reduce((s, i) => s + i.file.size, 0);
  const done = active.reduce((s, i) => s + i.file.size * i.progress, 0);
  return (
    <Link
      href="/upload"
      className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-3 bg-surface px-4 py-2.5 text-sm shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)] md:bottom-6"
    >
      <UploadCloud className="size-4 text-accent" aria-hidden />
      <span role="status">{active.length} ta fayl · {Math.round((done / total) * 100)}%</span>
    </Link>
  );
}
