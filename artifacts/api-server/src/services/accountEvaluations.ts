// Application service for canonical account evaluations. Deliberately
// contains no HTTP-specific logic (no req/res, no status codes, no
// header/body parsing) — see ../routes/accountEvaluations.ts for the HTTP
// boundary that wraps this.
//
// Only imports from @workspace/db/schema (table/type definitions), never
// from @workspace/db itself (the singleton `db`/`pool`, which throws at
// import time if DATABASE_URL is unset) — the database instance is always
// received via explicit injection, mirroring the convention already
// established by @workspace/evaluator-persistence's evaluateAndPersist().
// This is what lets these functions (and anything that imports this
// module) be unit-tested without a real Postgres connection.

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountEvaluations,
  type AccountEvaluation,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import { evaluateAndPersist as realEvaluateAndPersist } from "@workspace/evaluator-persistence";
import {
  resolveProfileVersionForEvaluation,
  createCurrentAccountSnapshot,
  resolveCanonicalEvaluatorVersion,
} from "./icpEvaluationResolvers.js";

type Db = NodePgDatabase<typeof schema>;

export type EvaluateAndPersistFn = typeof realEvaluateAndPersist;

export interface CreateAccountEvaluationArgs {
  db: NodePgDatabase<typeof schema>;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
  evaluationMode: AccountEvaluation["evaluationMode"];
  createdBy?: AccountEvaluation["createdBy"];
}

/**
 * Requests one canonical account evaluation. A thin, explicitly
 * dependency-injected wrapper around evaluateAndPersist() — this function
 * calls it exactly once and returns exactly what it returns (the
 * persisted row, whether status is 'completed' or a truthfully
 * representable 'failed'). The evaluateAndPersistFn parameter exists so
 * tests can substitute a fake implementation without a database
 * connection; production callers never need to pass it.
 */
export async function createAccountEvaluation(
  args: CreateAccountEvaluationArgs,
  evaluateAndPersistFn: EvaluateAndPersistFn = realEvaluateAndPersist,
): Promise<AccountEvaluation> {
  return evaluateAndPersistFn({
    db: args.db,
    snapshotId: args.snapshotId,
    profileVersionId: args.profileVersionId,
    evaluatorVersionId: args.evaluatorVersionId,
    evaluationMode: args.evaluationMode,
    createdBy: args.createdBy ?? null,
  });
}

export type GetAccountEvaluationByIdFn = (
  db: NodePgDatabase<typeof schema>,
  evaluationId: string,
) => Promise<AccountEvaluation | undefined>;

/**
 * Retrieves one persisted account_evaluations record by id — the exact
 * canonical table @workspace/evaluator-persistence writes to, queried
 * directly, no re-derivation or joins. Returns undefined when no such row
 * exists; the HTTP layer maps that to 404.
 */
export const getAccountEvaluationById: GetAccountEvaluationByIdFn = async (
  db,
  evaluationId,
) => {
  const [row] = await db
    .select()
    .from(accountEvaluations)
    .where(eq(accountEvaluations.id, evaluationId))
    .limit(1);
  return row;
};

export interface RunPreviewIcpEvaluationForAccountArgs {
  db: Db;
  accountId: string;
  profileId: string;
}

/**
 * Orchestrates one preview ICP evaluation for a canonical account,
 * starting from nothing but an accountId + profileId: resolves the
 * profile's preview version (draft, falling back to its active version),
 * creates a fresh sparse account snapshot, resolves the canonical
 * evaluator version, and persists the evaluation. evaluationMode is not a
 * parameter here — "preview" is hardcoded at both the resolver call and
 * the createAccountEvaluation call below. There is no production branch,
 * override, or generic mode parameter this function could ever take. See
 * ./icpEvaluationResolvers.ts's module comment for why a sparse,
 * account-row-only snapshot must never feed a production evaluation.
 */
export async function runPreviewIcpEvaluationForAccount(
  args: RunPreviewIcpEvaluationForAccountArgs,
): Promise<AccountEvaluation> {
  const { db, accountId, profileId } = args;

  const profileVersion = await resolveProfileVersionForEvaluation(
    db,
    profileId,
    "preview",
  );
  const snapshot = await createCurrentAccountSnapshot(db, accountId);
  const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db);

  return createAccountEvaluation({
    db,
    snapshotId: snapshot.id,
    profileVersionId: profileVersion.id,
    evaluatorVersionId: evaluatorVersion.id,
    evaluationMode: "preview",
  });
}
