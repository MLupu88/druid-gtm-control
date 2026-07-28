// Applies tracked SQL migrations from ./drizzle against DATABASE_URL.
// Used in CI (against the ephemeral Postgres service container) and
// optionally in local dev when testing the real migration path rather
// than using `drizzle-kit push` for fast iteration. See README.md.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run migrations.");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
} finally {
  await pool.end();
}
