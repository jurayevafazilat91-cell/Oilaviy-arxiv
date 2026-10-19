import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth-forms";
import { getCurrentUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const metadata = { title: "Kirish" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-2 text-center font-serif text-4xl">Xush kelibsiz</h1>
      <p className="mb-8 text-center text-dim">Oila arxiviga kirish uchun maʼlumotlaringizni kiriting.</p>
      <LoginForm />
      <Suspense>
        <SetupHint />
      </Suspense>
    </>
  );
}

async function SetupHint() {
  await connection();
  if (await getCurrentUser()) redirect("/");
  const [any] = await sql`select 1 from users limit 1`;
  if (any) return <p className="mt-6 text-center text-sm text-dim">Akkaunt yoʻqmi? Oila adminidan taklif havolasini soʻrang.</p>;
  return (
    <p className="mt-6 text-center text-sm text-dim">
      Arxiv hali sozlanmagan. <Link className="font-medium text-accent underline underline-offset-4" href="/setup">Sozlashni boshlash</Link>
    </p>
  );
}
