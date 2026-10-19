import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SetupForm } from "@/components/auth-forms";
import { sql } from "@/lib/db";

export const metadata = { title: "Sozlash" };

export default function SetupPage() {
  return (
    <>
      <h1 className="mb-2 font-display text-3xl font-bold uppercase">Arxivni yaratish</h1>
      <p className="mb-8 text-dim">Siz oila egasi boʻlasiz va boshqalarni taklif qilasiz.</p>
      <Suspense>
        <Guard />
      </Suspense>
    </>
  );
}

async function Guard() {
  await connection();
  const [any] = await sql`select 1 from users limit 1`;
  if (any) redirect("/login");
  return <SetupForm />;
}
