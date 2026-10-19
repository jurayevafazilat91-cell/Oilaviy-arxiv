import { Logo } from "@/components/app-nav";

// Lit squares of the brand card [x, y, colour]; they switch on one by one, the lime one last.
const PIXELS: [number, number, string][] = [
  [34, 36, "bg-white/5"], [98, 4, "bg-white/5"], [50, 20, "bg-white/8"],
  [66, 52, "bg-accent/20"], [82, 36, "bg-accent/40"], [82, 52, "bg-accent"],
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="relative w-full max-w-md animate-rise-slow overflow-hidden bg-surface p-6 sm:p-9">
        <div className="pointer-events-none absolute top-0 right-0 h-[72px] w-[120px]" aria-hidden>
          {PIXELS.map(([x, y, c], i) => (
            <span key={i} className={`absolute size-2.5 animate-blink ${c}`} style={{ left: x, top: y, animationDelay: `${300 + i * 90}ms` }} />
          ))}
        </div>
        <Logo className="mb-12" />
        {children}
      </div>
    </main>
  );
}
