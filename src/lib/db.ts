import postgres from "postgres";

const g = globalThis as unknown as { __sql?: postgres.Sql };

// One pool per process (survives dev hot reloads). Result columns arrive camelCased.
export const sql: postgres.Sql =
  g.__sql ??
  (g.__sql = postgres(process.env.DATABASE_URL ?? "", {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    transform: { column: { from: postgres.toCamel } },
    onnotice: () => {},
  }));

export type Tx = postgres.TransactionSql;
