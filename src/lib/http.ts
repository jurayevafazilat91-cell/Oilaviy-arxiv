import { unstable_rethrow } from "next/navigation";
import { AccessError, getCurrentUser, type CurrentUser } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Cookie-authenticated mutations must come from our own pages (CSRF defence besides SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "Notoʻgʻri manba");
}

export async function apiUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Tizimga kiring");
  return user;
}

export function handleApiError(err: unknown): Response {
  unstable_rethrow(err); // framework signals (prerender bailout, redirects) are not API errors
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  if (err instanceof AccessError) return Response.json({ error: err.message }, { status: 403 });
  console.error("api error:", err instanceof Error ? err.message : err);
  return Response.json({ error: "Server xatosi. Qayta urinib koʻring." }, { status: 500 });
}
