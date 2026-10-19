import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImageOff } from "lucide-react";
import { Gallery, GallerySkeleton } from "@/components/gallery/gallery";
import { EmptyState, PageTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatPartialDate, personName } from "@/lib/format";
import { galleryContext } from "@/lib/media/context";
import { listMedia } from "@/lib/media/queries";
import { loadTree } from "@/lib/tree";

export default function PersonPage(props: PageProps<"/people/[id]">) {
  return (
    <Suspense fallback={<GallerySkeleton />}>
      <PersonView params={props.params} />
    </Suspense>
  );
}

async function PersonView({ params }: { params: PageProps<"/people/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  const { people } = await loadTree(user); // already redacted for viewers
  const person = people.find((p) => p.id === id);
  if (!person) notFound();
  const [page, ctx] = await Promise.all([listMedia(user, { personId: id }), galleryContext(user)]);
  const born = formatPartialDate(person.birthDate);
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/tree" className="text-dim hover:text-ink">← Oila daraxti</Link></p>
      <PageTitle sub={[born && `Tugʻilgan: ${born}`, !person.isLiving && (person.deathDate ? `Vafot: ${formatPartialDate(person.deathDate)}` : "Vafot etgan")].filter(Boolean).join(" · ")}>
        {personName(person)}
      </PageTitle>
      {page.items.length === 0
        ? <EmptyState icon={<ImageOff />} title="Rasm belgilanmagan">Rasmni oching va “Rasmdagilar” boʻlimida shu odamni belgilang.</EmptyState>
        : <Gallery initial={page} query={`person=${id}`} ctx={ctx} />}
    </>
  );
}
