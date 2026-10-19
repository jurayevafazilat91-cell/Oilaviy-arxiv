"use client";

import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-105",
  secondary: "bg-slate text-slate-ink hover:brightness-110",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-danger-ink hover:brightness-105",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-[filter,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "min-h-9 px-3.5 text-sm" : "min-h-11 px-5 text-[15px]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/** Icon-only buttons always carry an accessible name. */
export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("inline-flex size-11 shrink-0 cursor-pointer items-center justify-center transition-colors hover:bg-surface-2 disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "w-full border border-transparent bg-surface-2 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-dim/60 transition-colors hover:border-line focus:border-accent focus:outline-none aria-invalid:border-danger";

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = [hint && `${fieldId}-hint`, error && `${fieldId}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm text-dim">{label}</label>
      {children(fieldId, describedBy)}
      {hint && !error && <p id={`${fieldId}-hint`} className="text-sm text-dim">{hint}</p>}
      {error && <p id={`${fieldId}-err`} className="flex items-center gap-1.5 text-sm text-danger"><AlertCircle className="size-4" aria-hidden />{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(fieldClass, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(fieldClass, "min-h-24 resize-y", className)} {...p} />;
});
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldClass, "cursor-pointer pr-9", className)} {...p} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("bg-surface p-5 sm:p-7", className)}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "danger" | "ok" }) {
  const tones = {
    neutral: "bg-slate text-slate-ink",
    accent: "bg-accent text-accent-ink",
    danger: "bg-danger text-danger-ink",
    ok: "bg-accent text-accent-ink",
  };
  return <span className={cx("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "ok" | "neutral"; children: ReactNode }) {
  if (!children) return null;
  const tones = { danger: "border-danger text-danger", ok: "border-ok text-ink", neutral: "border-slate text-ink" };
  return <p role={tone === "danger" ? "alert" : "status"} className={cx("border-l-2 bg-surface-2 px-4 py-3 text-sm", tones[tone])}>{children}</p>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <div className="mb-6 flex size-16 items-center justify-center bg-surface text-accent [&_svg]:size-7">{icon}</div>
      <h2 className="font-display text-xl font-medium uppercase">{title}</h2>
      {children && <div className="mt-2 text-dim">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Native <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={cx("m-auto w-[min(92vw,32rem)] bg-surface p-0 text-ink shadow-[0_40px_80px_-24px_rgb(0_0_0/0.7)]", className)}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="font-display text-xl font-medium uppercase leading-tight">{title}</h2>
            <IconButton label="Yopish" onClick={onClose} className="-mr-2 -mt-2"><X className="size-5" aria-hidden /></IconButton>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Spinner({ label = "Yuklanmoqda" }: { label?: string }) {
  return <Loader2 className="size-5 animate-spin text-dim" role="status" aria-label={label} />;
}

/** Count chip next to an uppercase heading (slate square with the number). */
export function Count({ n }: { n: number | string }) {
  return <span className="inline-flex h-6 min-w-6 items-center justify-center bg-slate px-1.5 font-sans text-xs font-medium text-slate-ink">{n}</span>;
}

export function PageTitle({ children, sub, actions, count }: { children: ReactNode; sub?: ReactNode; actions?: ReactNode; count?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5 sm:mb-8 sm:pt-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 font-display text-[1.75rem] leading-none font-bold tracking-tight text-balance uppercase sm:text-4xl">
          {children}{count !== undefined && <Count n={count} />}
        </h1>
        {sub && <p className="mt-3 max-w-2xl text-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
