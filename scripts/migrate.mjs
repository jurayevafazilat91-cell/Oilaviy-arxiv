// Applies db/migrations/*.sql in order, once each. Plain JS so production images need no TypeScript runner.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// Vercel's Neon integration also provides a direct (non-pooled) URL; DDL is safest over a direct connection.
export async function migrate(url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.resolve("db/migrations");
    const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(path.join(dir, file), "utf8"));
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      console.log(`migratsiya: ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.mjs")) {
  migrate().then(() => console.log("Migratsiyalar bajarildi")).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
