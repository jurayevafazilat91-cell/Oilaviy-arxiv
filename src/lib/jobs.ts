import { sql } from "./db";

export type Job = { id: string; type: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number };
export type JobHandler = (job: Job) => Promise<void>;

/** Errors that retrying cannot fix (bad file, missing record). */
export class PermanentError extends Error {}

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
) {
  await sql`
    insert into jobs (type, payload, dedupe_key, run_at, max_attempts)
    values (${type}, ${sql.json(payload as never)}, ${opts.dedupeKey ?? null}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 5})
    on conflict do nothing`;
}

export const backoffSeconds = (attempt: number) => Math.min(15 * 2 ** (attempt - 1), 3600);

/** Claims and runs one due job. Returns false when the queue is empty. */
export async function runOneJob(handlers: Record<string, JobHandler>): Promise<boolean> {
  const [job] = await sql<Job[]>`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at, id limit 1 for update skip locked
    )
    returning id, type, payload, attempts, max_attempts`;
  if (!job) return false;

  const handler = handlers[job.type];
  try {
    if (!handler) throw new PermanentError(`unknown job type ${job.type}`);
    await handler(job);
    await sql`update jobs set status = 'done', locked_at = null, last_error = null, updated_at = now() where id = ${job.id}`;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const final = err instanceof PermanentError || job.attempts >= job.maxAttempts;
    console.error(`job ${job.type}#${job.id} attempt ${job.attempts} failed${final ? " (final)" : ""}: ${message}`);
    await sql`
      update jobs set
        status = ${final ? "failed" : "queued"},
        locked_at = null,
        last_error = ${message},
        run_at = now() + make_interval(secs => ${backoffSeconds(job.attempts)}),
        updated_at = now()
      where id = ${job.id}`;
  }
  return true;
}

export const isFinalAttempt = (job: Job, err: unknown) => err instanceof PermanentError || job.attempts >= job.maxAttempts;
