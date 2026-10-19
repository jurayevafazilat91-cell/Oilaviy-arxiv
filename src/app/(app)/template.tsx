/** Re-mounts on every navigation: the new page settles in with a short fade-up. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
