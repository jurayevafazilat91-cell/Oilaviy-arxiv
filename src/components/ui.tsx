"use client";

import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-danger-ink hover:brightness-110",
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
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition-[filter,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
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
      className={cx("inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-2 disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

const fieldClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-dim/70 transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-danger";

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = [hint && `${fieldId}-hint`, error && `${fieldId}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">{label}</label>
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
  return <section className={cx("rounded-2xl border border-line bg-surface p-5 sm:p-6", className)}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "danger" | "ok" }) {
  const tones = {
    neutral: "bg-surface-2 text-dim",
    accent: "bg-accent/15 text-accent",
    danger: "bg-danger/12 text-danger",
    ok: "bg-ok/12 text-ok",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "ok" | "neutral"; children: ReactNode }) {
  if (!children) return null;
  const tones = { danger: "border-danger/30 bg-danger/8 text-danger", ok: "border-ok/30 bg-ok/8 text-ok", neutral: "border-line bg-surface-2 text-ink" };
  return <p role={tone === "danger" ? "alert" : "status"} className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])}>{children}</p>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-surface-2 text-dim [&_svg]:size-7">{icon}</div>
      <h2 className="font-serif text-2xl">{title}</h2>
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
      className={cx("m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl", className)}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="font-serif text-2xl leading-tight">{title}</h2>
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

export function PageTitle({ children, sub, actions }: { children: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div>
        <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl">{children}</h1>
        {sub && <p className="mt-2 text-dim">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
