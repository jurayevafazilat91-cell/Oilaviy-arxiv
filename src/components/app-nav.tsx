"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookImage, Images, LogOut, Network, Settings, Trash2, Upload, UserRound } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { Glider } from "./ui";

const LINKS = [
  { href: "/", label: "Arxiv", icon: Images },
  { href: "/albums", label: "Albomlar", icon: BookImage },
  { href: "/tree", label: "Oila daraxti", icon: Network },
];

const KINDS = [
  { value: null, label: "Hammasi" },
  { value: "image", label: "Rasmlar" },
  { value: "video", label: "Videolar" },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/media") : pathname.startsWith(href));

/** Marks a clicked link current right away, so the highlight moves on click instead of after the server answers. */
function useOptimisticNav() {
  const pathname = usePathname();
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  if (pending && pending.from !== pathname) setPending(null);
  const isCurrent = (href: string) => (pending ? pending.href === href : isActive(pathname, href));
  const onNavigate = (href: string) => (e: React.MouseEvent) => {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) setPending({ href, from: pathname });
  };
  return { pathname, isCurrent, onNavigate };
}

/** Lime tile with a nested frame: a photo inside the family album. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-3 font-display text-[1.375rem] leading-none font-bold tracking-tight whitespace-nowrap uppercase ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="5" fill="var(--accent)" />
        <path d="M8 8h12v4h-8v8H8z" fill="var(--surface)" />
        <rect x="14" y="14" width="10" height="10" fill="var(--surface)" />
      </svg>
      Oilaviy arxiv
    </Link>
  );
}

const iconSquare = "flex size-10 items-center justify-center bg-surface-2 text-ink transition-[background-color,color,scale] duration-150 ease-out hover:bg-night active:scale-95 aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink";

export function SideNav({ canUpload, name, familyName }: { canUpload: boolean; name: string; familyName: string }) {
  const { pathname, isCurrent, onNavigate } = useOptimisticNav();
  const params = useSearchParams();
  const kind = params.get("kind");
  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] lg:px-7">
      <Logo className="border-b border-line pb-6" />

      <div className="flex items-center gap-2 border-b border-line py-5">
        {canUpload && (
          <Link href="/upload" aria-current={pathname === "/upload" ? "page" : undefined}
            className="group inline-flex min-h-10 items-center gap-2 bg-slate px-4 text-sm text-slate-ink transition-[filter,background-color,color,scale] duration-150 ease-out hover:brightness-110 active:scale-[0.97] aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink">
            Yuklash <ArrowRight className="size-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
        <div className="ml-auto flex gap-2">
          <Link href="/trash" aria-label="Savat" title="Savat" aria-current={pathname === "/trash" ? "page" : undefined} className={iconSquare}>
            <Trash2 className="size-[18px]" aria-hidden />
          </Link>
          <Link href="/settings" aria-label="Sozlamalar" title="Sozlamalar" aria-current={pathname === "/settings" ? "page" : undefined} className={iconSquare}>
            <Settings className="size-[18px]" aria-hidden />
          </Link>
        </div>
      </div>

      <p className="mt-7 mb-4 font-display text-lg leading-none font-medium uppercase">Boʻlimlar</p>
      <nav aria-label="Asosiy">
        <ul className="space-y-3">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = isCurrent(href);
            return (
              <li key={href}>
                <Link href={href} onClick={onNavigate(href)} aria-current={active ? "page" : undefined}
                  className="group relative flex min-h-16 items-center gap-3.5 bg-surface-2 px-3 text-[15px] font-medium transition-[background-color,color,scale] duration-300 ease-out hover:bg-night active:scale-[0.98] aria-[current=page]:text-accent-ink">
                  {active && <Glider id="side-nav" />}
                  <span className="relative flex size-11 shrink-0 items-center justify-center bg-mist text-mist-ink transition-colors duration-300 group-aria-[current=page]:bg-surface group-aria-[current=page]:text-accent">
                    <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="relative">{label}</span>
                </Link>
                {active && href === "/" && (
                  <ul className="mt-3 mb-1 ml-3 border-l border-line">
                    {KINDS.map((k, i) => (
                      <li key={k.label} className="animate-rise" style={{ animationDelay: `${60 + i * 40}ms` }}>
                        <Link href={k.value ? `/?kind=${k.value}` : "/"} aria-current={pathname === "/" && kind === k.value ? "true" : undefined}
                          className="relative flex min-h-9 items-center pl-6 text-[15px] text-dim transition-colors before:absolute before:top-1/2 before:left-0 before:w-3 before:border-t before:border-line hover:text-ink aria-[current=true]:text-accent aria-[current=true]:before:border-accent">
                          {k.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto pt-6">
        <div className="bg-slate px-5 py-5 text-slate-ink">
          <p className="truncate font-display text-[15px] font-semibold tracking-wide uppercase">{familyName}</p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <UserRound className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 truncate">{name}</span>
            <form action={logoutAction} className="ml-auto">
              <button type="submit" aria-label="Chiqish" title="Chiqish" className="-mr-2 flex size-9 cursor-pointer items-center justify-center hover:bg-white/10">
                <LogOut className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileNav({ canUpload }: { canUpload: boolean }) {
  const { isCurrent, onNavigate } = useOptimisticNav();
  const items = [
    LINKS[0],
    LINKS[1],
    ...(canUpload ? [{ href: "/upload", label: "Yuklash", icon: Upload }] : []),
    { ...LINKS[2], label: "Daraxt" },
    { href: "/settings", label: "Sozlamalar", icon: Settings },
  ];
  return (
    <nav aria-label="Asosiy" className="fixed inset-x-0 bottom-0 z-40 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              onClick={onNavigate(href)}
              aria-current={isCurrent(href) ? "page" : undefined}
              className="group relative flex min-h-15 flex-col items-center justify-center gap-1 text-[11px] text-dim transition-colors duration-200 aria-[current=page]:text-accent"
            >
              {isCurrent(href) && <Glider id="mobile-nav" className="absolute inset-x-3 top-0 h-0.5 bg-accent" />}
              <Icon className="size-5 transition-transform duration-150 ease-out group-active:scale-90" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function UserMenu({ name, familyName }: { name: string; familyName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex min-h-11 items-center gap-3 px-3 hover:bg-surface-2";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-slate font-display font-semibold text-slate-ink uppercase transition-[scale] duration-150 ease-out active:scale-95"
        aria-label={`Menyu: ${name}`}
      >
        {name.slice(0, 1)}
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-64 origin-top-right animate-pop bg-surface p-2 shadow-[0_24px_60px_-16px_rgb(0_0_0/0.7)] ring-1 ring-line">
          <div className="bg-slate px-3 py-3 text-slate-ink">
            <p className="truncate font-display text-sm font-semibold tracking-wide uppercase">{familyName}</p>
            <p className="mt-1 truncate text-sm">{name}</p>
          </div>
          <Link onClick={() => setOpen(false)} href="/settings" className={`mt-2 ${item}`}>
            <Settings className="size-4" aria-hidden /> Sozlamalar
          </Link>
          <Link onClick={() => setOpen(false)} href="/trash" className={item}>
            <Trash2 className="size-4" aria-hidden /> Savat
          </Link>
          <div className="my-1 border-t border-line" />
          <form action={logoutAction}>
            <button type="submit" className={`w-full cursor-pointer text-left ${item}`}>
              <LogOut className="size-4" aria-hidden /> Chiqish
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
