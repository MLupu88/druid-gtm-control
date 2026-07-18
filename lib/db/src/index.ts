import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Importing this module must never connect on its own — connection is lazy,
// established on first use, so code can import @workspace/db (e.g. for
// types) without requiring a live database or a configured DATABASE_URL.
let pool: pg.Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure it before using the database.",
    );
  }
  return url;
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      // Bounded pool + timeouts so a slow/unreachable Postgres degrades
      // (readyz returns 503) instead of the server hanging or exhausting
      // connections under load.
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

/** Lazily-initialized Drizzle client. Creates the connection pool on first call. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

/**
 * Runs a trivial query to confirm the database is reachable. Never throws —
 * callers get a plain ok/error result, never a raw driver error (which can
 * include the connection string) or a stack trace.
 */
export async function checkDatabaseConnection(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    await getPool().query("SELECT 1");
    return { ok: true };
  } catch {
    // Deliberately do not include the caught error: driver errors for a
    // failed Postgres connection can echo back the connection string.
    return { ok: false, error: "Database connection check failed." };
  }
}

/** Closes the pool, if one was ever opened. Safe to call multiple times. */
export async function closeDatabaseConnection(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    dbInstance = undefined;
    await closing.end();
  }
}

export * from "./schema";
