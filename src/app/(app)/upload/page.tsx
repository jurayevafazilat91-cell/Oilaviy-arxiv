import { redirect } from "next/navigation";
import { Suspense } from "react";
import { UploadPanel } from "@/components/upload-panel";
import { PageTitle, Spinner } from "@/components/ui";
import { canUpload, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { toSearchParams } from "@/lib/media/context";

export const metadata = { title: "Yuklash" };

export default function UploadPage(props: PageProps<"/upload">) {
  return (
    <>
      <PageTitle sub="Bir nechta faylni birdaniga tanlashingiz mumkin. Boshqa sahifaga oʻtsangiz ham yuklash davom etadi.">Yuklash</PageTitle>
      <Suspense fallback={<Spinner />}>
        <Upload searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Upload({ searchParams }: { searchParams: PageProps<"/upload">["searchParams"] }) {
  const user = await requireUser();
  if (!canUpload(user)) redirect("/");
  const albums = await sql<{ id: string; title: string }[]>`
    select id, title from albums where family_id = ${user.familyId} order by lower(title)`;
  const want = toSearchParams(await searchParams).get("album");
  return (
    <UploadPanel
      albums={albums}
      maxImageMb={env().MAX_IMAGE_MB}
      maxVideoMb={env().MAX_VIDEO_MB}
      defaultAlbum={albums.some((a) => a.id === want) ? want : null}
    />
  );
}
