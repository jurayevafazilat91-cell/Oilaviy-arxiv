// Starts a project-local PostgreSQL cluster for development (no system password needed).
// Data lives in ./.data/pg, listens only on localhost:5433, trust auth for local connections.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/pg");
const port = process.env.DEV_DB_PORT ?? "5433";
const bin = (name) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name);
const run = (cmd, args) => execFileSync(bin(cmd), args, { stdio: "inherit" });

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  mkdirSync(dataDir, { recursive: true });
  run("initdb", ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"]);
}

const status = spawnSync(bin("pg_ctl"), ["status", "-D", dataDir]);
if (status.status !== 0) {
  // stdio ignored: the server inherits handles, and an inherited pipe would keep the caller waiting.
  execFileSync(bin("pg_ctl"), ["start", "-D", dataDir, "-l", path.resolve(".data/pg.log"), "-w",
    "-o", `-p ${port} -c listen_addresses=localhost`], { stdio: "ignore" });
}

for (const db of ["oilaviy", "oilaviy_test"]) {
  const exists = spawnSync(bin("psql"), ["-h", "localhost", "-p", port, "-U", "postgres", "-tAc",
    `select 1 from pg_database where datname='${db}'`], { encoding: "utf8" });
  if (!exists.stdout.trim()) run("createdb", ["-h", "localhost", "-p", port, "-U", "postgres", db]);
}
console.log(`PostgreSQL tayyor: postgres://postgres@localhost:${port}/oilaviy`);
