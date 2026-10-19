import Link from "next/link";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { DesktopNav, MobileNav, UserMenu } from "@/components/app-nav";
import { UploadProvider } from "@/components/upload-provider";
import { canUpload, requireUser } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UploadProvider>
      <a href="#main" className="sr-only z-50 rounded-full bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
        Asosiy qismga oʻtish
      </a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="font-serif text-xl tracking-tight whitespace-nowrap">
            Oilaviy <em className="not-italic text-accent">arxiv</em>
          </Link>
          <Suspense>
            <DesktopNav />
          </Suspense>
          <div className="ml-auto flex items-center gap-2">
            <Suspense fallback={<div className="skeleton size-11 rounded-full" />}>
              <HeaderUser />
            </Suspense>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1440px] px-4 pt-6 pb-28 sm:px-6 sm:pt-10 md:pb-16">{children}</main>
      <Suspense>
        <BottomNav />
      </Suspense>
    </UploadProvider>
  );
}

async function HeaderUser() {
  const user = await requireUser();
  return (
    <>
      {canUpload(user) && (
        <Link
          href="/upload"
          className="hidden min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-accent-ink transition-[filter] hover:brightness-110 md:inline-flex"
        >
          <Upload className="size-4" aria-hidden /> Yuklash
        </Link>
      )}
      <UserMenu name={user.name} familyName={user.familyName} />
    </>
  );
}

async function BottomNav() {
  const user = await requireUser();
  return <MobileNav canUpload={canUpload(user)} />;
}
