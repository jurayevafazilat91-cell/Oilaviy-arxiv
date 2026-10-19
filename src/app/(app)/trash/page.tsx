import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { Gallery, GallerySkeleton } from "@/components/gallery/gallery";
import { EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { galleryContext } from "@/lib/media/context";
import { listMedia } from "@/lib/media/queries";

export const metadata = { title: "Savat" };

export default function TrashPage() {
  return (
    <>
      <PageTitle sub="Oʻchirilgan fayllar 30 kundan keyin butunlay oʻchiriladi. Undan oldin tiklash mumkin.">Savat</PageTitle>
      <Suspense fallback={<GallerySkeleton />}>
        <Trash />
      </Suspense>
    </>
  );
}

async function Trash() {
  const user = await requireUser();
  const [page, ctx] = await Promise.all([listMedia(user, { trash: true }), galleryContext(user)]);
  if (!page.items.length) return <EmptyState icon={<Trash2 />} title="Savat boʻsh" />;
  return <Gallery initial={page} query="trash=1" ctx={ctx} mode="trash" />;
}
