"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createAlbumAction, deleteAlbumAction, updateAlbumAction } from "@/actions/media";
import { Button, Dialog, Field, Input, Notice, Textarea } from "./ui";

function AlbumDialog({ open, onClose, initial, onSubmit, title }: {
  open: boolean; onClose: () => void; title: string;
  initial: { title: string; description: string };
  onSubmit: (v: { title: string; description: string }) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          const err = await onSubmit({ title: String(f.get("title")), description: String(f.get("description")) });
          setBusy(false);
          setError(err);
          if (!err) onClose();
        }}
      >
        <Field label="Nomi">{(id) => <Input id={id} name="title" defaultValue={initial.title} required maxLength={120} autoFocus />}</Field>
        <Field label="Tavsif (ixtiyoriy)">{(id) => <Textarea id={id} name="description" defaultValue={initial.description} maxLength={2000} rows={3} />}</Field>
        <Notice>{error}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Bekor</Button>
          <Button type="submit" variant="primary" loading={busy}>Saqlash</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewAlbumButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />Yangi albom</Button>
      <AlbumDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Yangi albom"
        initial={{ title: "", description: "" }}
        onSubmit={async (v) => {
          const r = await createAlbumAction(v);
          if (!r.ok) return r.error;
          router.push(`/albums/${r.data.id}`);
          return null;
        }}
      />
    </>
  );
}

export function AlbumActions({ album }: { album: { id: string; title: string; description: string } }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden />Tahrirlash</Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          if (!confirm(`“${album.title}” albomi oʻchirilsinmi? Rasmlar arxivda qoladi.`)) return;
          const r = await deleteAlbumAction(album.id);
          if (r.ok) router.push("/albums");
          else setError(r.error);
        }}
      >
        <Trash2 className="size-4" aria-hidden />Oʻchirish
      </Button>
      {error && <Notice>{error}</Notice>}
      <AlbumDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Albomni tahrirlash"
        initial={album}
        onSubmit={async (v) => {
          const r = await updateAlbumAction(album.id, v);
          return r.ok ? null : r.error;
        }}
      />
    </>
  );
}
