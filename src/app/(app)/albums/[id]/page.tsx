import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { AlbumActions } from "@/components/album-forms";
import { Gallery, GallerySkeleton } from "@/components/gallery/gallery";
import { EmptyState, PageTitle } from "@/components/ui";
import { canUpload, isAdmin, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { galleryContext } from "@/lib/media/context";
import { listMedia } from "@/lib/media/queries";

export default function AlbumPage(props: PageProps<"/albums/[id]">) {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <Album params={props.params} />
    </Suspense>
  );
}

async function Album({ params }: { params: PageProps<"/albums/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [album] = await sql<{ id: string; title: string; description: string; createdBy: string | null }[]>`
    select id, title, description, created_by from albums where id = ${id} and family_id = ${user.familyId}`;
  if (!album) notFound();
  const [page, ctx] = await Promise.all([listMedia(user, { albumId: id }), galleryContext(user)]);
  const canManage = isAdmin(user) || (user.role === "member" && album.createdBy === user.id);
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/albums" className="text-dim hover:text-ink">← Albomlar</Link></p>
      <PageTitle
        sub={album.description || `${page.items.length}${page.nextCursor ? "+" : ""} ta`}
        actions={<>
          {canUpload(user) && (
            <Link href={`/upload?album=${album.id}`} className="inline-flex min-h-9 items-center gap-2 bg-accent px-3.5 text-sm font-medium text-accent-ink transition-[filter,scale] duration-150 ease-out hover:brightness-105 active:scale-[0.97]">
              <Upload className="size-4" aria-hidden />Shu albomga yuklash
            </Link>
          )}
          {canManage && <AlbumActions album={album} />}
        </>}
      >
        {album.title}
      </PageTitle>
      {page.items.length === 0
        ? <EmptyState icon={<ImagePlus />} title="Albom boʻsh">Arxivda “Tanlash” orqali rasmlarni shu albomga qoʻshing yoki yangi fayl yuklang.</EmptyState>
        : <Gallery initial={page} query={`album=${album.id}`} ctx={ctx} mode="album" albumId={album.id} />}
    </>
  );
}
