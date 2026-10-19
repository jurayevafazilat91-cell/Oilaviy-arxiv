export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-10 text-center font-serif text-xl tracking-tight">Oilaviy <em className="not-italic text-accent">arxiv</em></p>
        {children}
      </div>
    </main>
  );
}
