import { Suspense } from "react";
import { Logo, MobileNav, SideNav, UserMenu } from "@/components/app-nav";
import { UploadProvider } from "@/components/upload-provider";
import { canUpload, requireUser } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UploadProvider>
      <a href="#main" className="sr-only z-50 bg-accent px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-4">
        Asosiy qismga oʻtish
      </a>
      <div className="md:grid md:grid-cols-[272px_minmax(0,1fr)] lg:grid-cols-[304px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh bg-surface md:block">
          <Suspense fallback={<div className="skeleton h-full" />}>
            <Side />
          </Suspense>
        </aside>
        <header className="sticky top-0 z-40 bg-surface pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Logo className="text-lg" />
            <Suspense fallback={<div className="skeleton size-10 rounded-full" />}>
              <HeaderUser />
            </Suspense>
          </div>
        </header>
        <main id="main" className="min-w-0 px-4 pt-6 pb-28 sm:px-6 md:px-8 md:pt-9 md:pb-16 lg:px-11">
          <div className="mx-auto max-w-[1320px]">{children}</div>
        </main>
      </div>
      <Suspense>
        <BottomNav />
      </Suspense>
    </UploadProvider>
  );
}

async function Side() {
  const user = await requireUser();
  return <SideNav canUpload={canUpload(user)} name={user.name} familyName={user.familyName} />;
}

async function HeaderUser() {
  const user = await requireUser();
  return <UserMenu name={user.name} familyName={user.familyName} />;
}

async function BottomNav() {
  const user = await requireUser();
  return <MobileNav canUpload={canUpload(user)} />;
}
