// Minimal connectivity smoke test for the operational ledger database.
// Prints only ok/fail — never the connection string or a raw driver error.
import { checkDatabaseConnection, closeDatabaseConnection } from "../src/index.js";

async function main() {
  const result = await checkDatabaseConnection();

  if (!result.ok) {
    console.error("db:smoke FAILED —", result.error);
    await closeDatabaseConnection();
    process.exit(1);
  }

  console.log("db:smoke OK — database is reachable.");
  await closeDatabaseConnection();
}

main().catch(async (err) => {
  console.error("db:smoke FAILED —", err instanceof Error ? err.message : "unknown error");
  await closeDatabaseConnection();
  process.exit(1);
});
