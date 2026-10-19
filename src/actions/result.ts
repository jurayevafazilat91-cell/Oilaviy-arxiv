import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AccessError } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { TreeError } from "@/lib/tree";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Runs an action body; known validation/permission errors become user-facing messages, others are logged. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() through
    if (err instanceof AccessError || err instanceof TreeError || err instanceof HttpError || err instanceof UserError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Maʼlumot notoʻgʻri" };
    console.error("action error:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Kutilmagan xato. Qayta urinib koʻring." };
  }
}

export class UserError extends Error {}
