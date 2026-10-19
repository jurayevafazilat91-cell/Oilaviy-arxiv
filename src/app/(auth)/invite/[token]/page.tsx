import Link from "next/link";
import { Suspense } from "react";
import { InviteForm } from "@/components/auth-forms";
import { sha256 } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/format";

export const metadata = { title: "Taklif" };

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <Suspense>
      <Invite params={props.params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const [inv] = /^[A-Za-z0-9_-]{20,100}$/.test(token)
    ? await sql<{ kind: "invite" | "reset"; role: string | null; familyName: string }[]>`
        select i.kind, i.role, f.name as family_name from invites i join families f on f.id = i.family_id
        where i.token_hash = ${sha256(token)} and i.used_at is null and i.expires_at > now()`
    : [];
  if (!inv) {
    return (
      <div className="text-center">
        <h1 className="mb-3 font-serif text-3xl">Havola yaroqsiz</h1>
        <p className="text-dim">Havola ishlatilgan yoki muddati oʻtgan. Oila adminidan yangisini soʻrang.</p>
        <Link href="/login" className="mt-6 inline-block font-medium text-accent underline underline-offset-4">Kirish sahifasi</Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="mb-2 text-center font-serif text-4xl">{inv.kind === "reset" ? "Yangi parol" : inv.familyName}</h1>
      <p className="mb-8 text-center text-dim">
        {inv.kind === "reset" ? "Yangi parol oʻrnating. Boshqa qurilmalardagi sessiyalar yopiladi." : `Sizni “${ROLE_LABELS[inv.role!]}” sifatida taklif qilishdi.`}
      </p>
      <InviteForm token={token} kind={inv.kind} />
    </>
  );
}
