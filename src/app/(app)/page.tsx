import Link from "next/link";
import { Suspense } from "react";
import { ImagePlus, SearchX } from "lucide-react";
import { Gallery, GallerySkeleton } from "@/components/gallery/gallery";
import { GalleryFilters } from "@/components/gallery/filters";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { galleryContext, toSearchParams } from "@/lib/media/context";
import { filtersFromParams } from "@/lib/media/filters";
import { listMedia } from "@/lib/media/queries";

export default function ArchivePage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <Archive searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Archive({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await requireUser();
  const params = toSearchParams(await searchParams);
  params.delete("m");
  const filters = filtersFromParams(params);
  const [page, ctx] = await Promise.all([listMedia(user, filters), galleryContext(user)]);
  const filtered = ["q", "kw", "kind", "from", "to"].some((k) => params.has(k));
  return (
    <>
      <GalleryFilters years={ctx.years} aiEnabled={ctx.aiEnabled} />
      {page.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={<SearchX />} title="Hech narsa topilmadi">Boshqa soʻz yoki yilni sinab koʻring.</EmptyState>
        ) : (
          <EmptyState
            icon={<ImagePlus />}
            title="Arxiv hali boʻsh"
            action={ctx.canUpload && (
              <Link href="/upload" className="inline-flex min-h-11 items-center bg-accent px-6 font-medium text-accent-ink transition-[filter,scale] duration-150 ease-out hover:brightness-105 active:scale-[0.97]">
                Birinchi rasmlarni yuklash
              </Link>
            )}
          >
            Rasm va videolarni sayt orqali yoki Telegram bot orqali yuklang.
          </EmptyState>
        )
      ) : (
        <Gallery initial={page} query={params.toString()} ctx={ctx} />
      )}
    </>
  );
}
