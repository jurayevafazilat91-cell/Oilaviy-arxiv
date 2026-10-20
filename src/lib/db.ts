import postgres from "postgres";

const g = globalThis as unknown as { __sql?: postgres.Sql };

const url = withoutChannelBinding(process.env.DATABASE_URL ?? "");

// Neon's connection strings carry channel_binding=require; postgres.js would forward it to the server as an unknown setting and fail.
function withoutChannelBinding(raw: string) {
  if (!raw.includes("channel_binding")) return raw;
  const u = new URL(raw);
  u.searchParams.delete("channel_binding");
  return u.href;
}

// One pool per process (survives dev hot reloads). Result columns arrive camelCased.
export const sql: postgres.Sql =
  g.__sql ??
  (g.__sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // Neon's pooled URL (PgBouncer, transaction mode) cannot keep prepared statements between queries.
    prepare: !url.includes("-pooler."),
    // Serverless instances sit frozen between requests; release idle connections instead of holding them.
    idle_timeout: 20,
    transform: { column: { from: postgres.toCamel } },
    onnotice: () => {},
  }));

export type Tx = postgres.TransactionSql;
