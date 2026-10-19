import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { migrate } from "../scripts/migrate.mjs";
import type { CurrentUser, Role } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { runOneJob } from "../src/lib/jobs";
import { handlers } from "../src/lib/worker";

export { sql };

let migrated = false;
export async function resetDb() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
  await sql`truncate families, jobs, telegram_updates, telegram_media_groups restart identity cascade`;
}

export async function makeUser(role: Role = "owner", familyId?: string, extra: Partial<CurrentUser> = {}): Promise<CurrentUser> {
  if (!familyId) {
    [{ id: familyId }] = await sql<{ id: string }[]>`insert into families (name) values ('Test oila') returning id`;
  }
  const email = `${role}-${Math.random().toString(36).slice(2)}@test.local`;
  const [u] = await sql<{ id: string }[]>`
    insert into users (family_id, email, name, password_hash, role, is_tree_editor)
    values (${familyId!}, ${email}, ${role}, 'x', ${role}, ${extra.isTreeEditor ?? false}) returning id`;
  return { id: u.id, familyId: familyId!, familyName: "Test oila", name: role, email, role, isTreeEditor: extra.isTreeEditor ?? false };
}

/** Runs queued jobs until none are due. `forceRetries` makes backed-off jobs due again. */
export async function drainJobs(forceRetries = false) {
  for (let i = 0; i < 50; i++) {
    if (forceRetries) await sql`update jobs set run_at = now() where status = 'queued'`;
    if (!(await runOneJob(handlers))) return;
  }
}

const fixtureDir = path.resolve(".data/test-fixtures");
mkdirSync(fixtureDir, { recursive: true });

export async function jpegFixture(color = { r: 200, g: 120, b: 40 }, name = "photo.jpg"): Promise<string> {
  const file = path.join(fixtureDir, name);
  await sharp({ create: { width: 1600, height: 1000, channels: 3, background: color } })
    .withExif({
      IFD0: { Make: "TestCam", DateTime: "2019:07:14 14:03:22" },
      IFD2: { DateTimeOriginal: "2019:07:14 14:03:22" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 18/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "69/1 16/1 0/1" },
    })
    .jpeg()
    .toFile(file);
  return file;
}

export function videoFixture(name: string, codecArgs: string[]): string {
  const file = path.join(fixtureDir, name);
  if (!existsSync(file)) {
    execFileSync(ffmpegPath as unknown as string, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", ...codecArgs, "-y", file,
    ]);
  }
  return file;
}

export const read = (file: string) => readFileSync(file);

type Handler = (req: IncomingMessage, body: Buffer, res: ServerResponse) => void;
export async function fakeServer(port: number, handler: Handler) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks), res));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
