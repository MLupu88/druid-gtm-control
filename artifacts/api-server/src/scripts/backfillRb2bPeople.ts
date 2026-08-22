// LS8 — one-off (but safely re-runnable) People pipeline backfill CLI.
// Thin wrapper around ../services/rb2bPeopleBackfill.ts's
// backfillRb2bPeople — see that module for the full rationale and reuse
// guarantees. Defaults to a dry run (rolled back, nothing persisted);
// pass --write to perform the real writes.
//
// Requires DATABASE_URL.
// Run via: pnpm --filter @workspace/api-server exec tsx src/scripts/backfillRb2bPeople.ts [--write]

import { db } from "@workspace/db";
import { backfillRb2bPeople } from "../services/rb2bPeopleBackfill.js";

const write = process.argv.includes("--write");

backfillRb2bPeople(db, { dryRun: !write })
  .then((summary) => {
    console.log(JSON.stringify({ dryRun: !write, ...summary }, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("PEOPLE BACKFILL FAILED:", err);
    process.exit(1);
  });
