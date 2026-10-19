"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookImage, Images, LogOut, Monitor, Moon, Network, Settings, Sun, Trash2, Upload } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Arxiv", icon: Images },
  { href: "/albums", label: "Albomlar", icon: BookImage },
  { href: "/tree", label: "Oila daraxti", icon: Network },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/media") : pathname.startsWith(href));

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Asosiy" className="hidden items-center gap-1 md:flex">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(pathname, l.href) ? "page" : undefined}
          className="rounded-full px-4 py-2 text-[15px] text-dim transition-colors hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav({ canUpload }: { canUpload: boolean }) {
  const pathname = usePathname();
  const items = [
    LINKS[0],
    LINKS[1],
    ...(canUpload ? [{ href: "/upload", label: "Yuklash", icon: Upload }] : []),
    { ...LINKS[2], label: "Daraxt" },
    { href: "/settings", label: "Sozlamalar", icon: Settings },
  ];
  return (
    <nav aria-label="Asosiy" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-dim aria-[current=page]:text-accent"
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type Theme = "system" | "light" | "dark";
function applyTheme(t: Theme) {
  try {
    if (t === "system") {
      localStorage.removeItem("theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("theme", t);
      document.documentElement.dataset.theme = t;
    }
  } catch {}
}

export function UserMenu({ name, familyName }: { name: string; familyName: string }) {
  const [open, setOpen] = useState(false);
  // Read lazily: the theme buttons only render after the menu is opened on the client.
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = typeof window === "undefined" ? null : localStorage.getItem("theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
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

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "Tizim", icon: Monitor },
    { value: "light", label: "Yorugʻ", icon: Sun },
    { value: "dark", label: "Qorongʻi", icon: Moon },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-surface-2 font-serif text-lg text-ink"
        aria-label={`Menyu: ${name}`}
      >
        {name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-13 z-50 w-64 rounded-2xl border border-line bg-surface p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="font-medium">{name}</p>
            <p className="text-sm text-dim">{familyName}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <Link onClick={() => setOpen(false)} href="/settings" className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-surface-2">
            <Settings className="size-4" aria-hidden /> Sozlamalar
          </Link>
          <Link onClick={() => setOpen(false)} href="/trash" className="flex min-h-11 items-center gap-3 rounded-xl px-3 hover:bg-surface-2">
            <Trash2 className="size-4" aria-hidden /> Savat
          </Link>
          <div className="my-1 border-t border-line" />
          <fieldset className="px-3 py-2">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-dim">Mavzu</legend>
            <div className="flex gap-1 rounded-full bg-surface-2 p-1">
              {themes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => { setTheme(value); applyTheme(value); }}
                  className={cx("flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full text-xs", theme === value ? "bg-surface text-ink shadow-sm" : "text-dim")}
                >
                  <Icon className="size-3.5" aria-hidden />{label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="my-1 border-t border-line" />
          <form action={logoutAction}>
            <button type="submit" className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2">
              <LogOut className="size-4" aria-hidden /> Chiqish
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
