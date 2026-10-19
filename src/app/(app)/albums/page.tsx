import Link from "next/link";
import { Suspense } from "react";
import { BookImage, Images } from "lucide-react";
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
      <PageTitle count={albums.length} actions={canUpload(user) && <NewAlbumButton />}>Albomlar</PageTitle>
      {albums.length === 0 ? (
        <EmptyState icon={<BookImage />} title="Albom yoʻq">Albom yarating yoki Telegram’da izohga #albom-nomi yozing.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 2xl:grid-cols-5">
          {albums.map((a, i) => (
            <li key={a.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <Link href={`/albums/${a.id}`} className="group block transition-[scale] duration-150 ease-out active:scale-[0.98]">
                {/* Portrait cover with the title on a charcoal tab, as on a profile photo. */}
                <div className="relative aspect-[6/7] overflow-hidden bg-surface">
                  {a.coverId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private, authorized files
                    <img src={`/api/media/${a.coverId}/thumb`} alt="" loading="lazy"
                      className="size-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]" />
                  ) : (
                    <BookImage className="absolute top-1/2 left-1/2 size-8 -translate-1/2 text-dim/50" aria-hidden />
                  )}
                  <p className="absolute bottom-0 left-0 max-w-[88%] truncate bg-surface/90 px-3 py-2.5 font-display text-sm font-medium uppercase transition-colors group-hover:bg-accent group-hover:text-accent-ink sm:px-4 sm:py-3 sm:text-base">
                    {a.title}
                  </p>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm text-dim"><Images className="size-4" aria-hidden />{a.count} ta fayl</p>
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
      <div className="skeleton mb-8 h-12 w-56" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[6/7]" />)}
      </div>
    </div>
  );
}
