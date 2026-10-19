import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Gallery, GallerySkeleton } from "@/components/gallery/gallery";
import { requireUser } from "@/lib/auth";
import { galleryContext } from "@/lib/media/context";
import { getMediaDetail } from "@/lib/media/queries";

export const metadata = { title: "Media" };

/** Standalone deep link (/media/<id>): renders the item in the same lightbox used by the gallery. */
export default function MediaPage(props: PageProps<"/media/[id]">) {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <Single params={props.params} />
    </Suspense>
  );
}

async function Single({ params }: { params: PageProps<"/media/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getMediaDetail(user, id);
  if (!detail) notFound();
  const ctx = await galleryContext(user);
  return <Gallery initial={{ items: [detail], nextCursor: null }} query="" ctx={ctx} autoOpen />;
}
