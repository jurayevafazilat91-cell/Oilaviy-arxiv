import Link from "next/link";
import { Suspense } from "react";
import { BookImage } from "lucide-react";
import { NewAlbumButton } from "@/components/album-forms";
import { EmptyState, PageTitle } from "@/components/ui";
import { canUpload, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const metadata = { title: "Albomlar" };

export default function AlbumsPage() {
  return (
    <Suspense fallback={<AlbumsSkeleton />}>
      <Albums />
    </Suspense>
  );
}

async function Albums() {
  const user = await requireUser();
  // Cover: chosen one, else the newest ready photo/video in the album.
  const albums = await sql<{ id: string; title: string; count: string; coverId: string | null }[]>`
    select a.id, a.title,
      (select count(*) from album_items ai join media m on m.id = ai.media_id where ai.album_id = a.id and m.deleted_at is null) as count,
      coalesce(
        (select m.id from media m where m.id = a.cover_media_id and m.deleted_at is null and 'thumb' = any(m.variants)),
        (select m.id from album_items ai join media m on m.id = ai.media_id
         where ai.album_id = a.id and m.deleted_at is null and 'thumb' = any(m.variants)
         order by coalesce(m.taken_at, m.created_at) desc limit 1)
      ) as cover_id
    from albums a where a.family_id = ${user.familyId}
    order by lower(a.title)`;
  return (
    <>
      <PageTitle sub={`${albums.length} ta albom`} actions={canUpload(user) && <NewAlbumButton />}>Albomlar</PageTitle>
      {albums.length === 0 ? (
        <EmptyState icon={<BookImage />} title="Albom yoʻq">Albom yarating yoki Telegram’da izohga #albom-nomi yozing.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {albums.map((a) => (
            <li key={a.id}>
              <Link href={`/albums/${a.id}`} className="group block">
                <div className="aspect-[4/3] overflow-hidden rounded-xl bg-surface-2">
                  {a.coverId && (
                    // eslint-disable-next-line @next/next/no-img-element -- private, authorized files
                    <img src={`/api/media/${a.coverId}/thumb`} alt="" loading="lazy"
                      className="size-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]" />
                  )}
                </div>
                <p className="mt-3 font-serif text-lg leading-snug group-hover:underline">{a.title}</p>
                <p className="text-sm text-dim">{a.count} ta</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AlbumsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="skeleton mb-8 h-12 w-56 rounded-lg" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-xl" />)}
      </div>
    </div>
  );
}
