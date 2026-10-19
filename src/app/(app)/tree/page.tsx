import { Suspense } from "react";
import { TreeExplorer } from "@/components/tree/tree-explorer";
import { PageTitle } from "@/components/ui";
import { canEditTree, isAdmin, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { loadTree } from "@/lib/tree";

export const metadata = { title: "Oila daraxti" };

export default function TreePage() {
  return (
    <>
      <PageTitle sub="Faqat tasdiqlangan qarindoshlik maʼlumotlari. AI qarindoshlikni taxmin qilmaydi.">Oila daraxti</PageTitle>
      <Suspense fallback={<div className="skeleton h-[min(70dvh,760px)]" aria-busy="true" />}>
        <Tree />
      </Suspense>
    </>
  );
}

async function Tree() {
  const user = await requireUser();
  const { people, relationships } = await loadTree(user);
  const members = isAdmin(user)
    ? await sql<{ id: string; name: string }[]>`select id, name from users where family_id = ${user.familyId} and disabled_at is null order by name`
    : [];
  return <TreeExplorer people={people} relationships={relationships} canEdit={canEditTree(user)} isAdmin={isAdmin(user)} members={members} />;
}
