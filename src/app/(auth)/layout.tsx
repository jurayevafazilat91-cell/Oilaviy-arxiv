import { Logo } from "@/components/app-nav";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="relative w-full max-w-md overflow-hidden bg-surface p-6 sm:p-9">
        <div className="pixels pointer-events-none absolute top-0 right-0 h-[72px] w-[120px]" aria-hidden />
        <Logo className="mb-12" />
        {children}
      </div>
    </main>
  );
}
