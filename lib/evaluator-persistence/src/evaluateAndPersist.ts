// The persistence adapter for the canonical account evaluator.
// @workspace/evaluator stays completely pure (no DB, no network, no
// clock, no randomness) — this is the ONLY place that loads database
// records, validates them against the evaluator's contract, invokes the
// evaluator, and persists exactly one immutable account_evaluations row.
//
// Never creates account_decisions, routing output, actions, outbox
// records, or external requests — that is Phase 3 (decision/routing
// policy), a separate, later slice.

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountEvaluations,
  accountSnapshots,
  evaluatorVersions,
  icpProfileVersions,
  type AccountEvaluation,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  IcpProfileConfigV1Schema,
  NormalizedAccountInputV1Schema,
  getEvaluatorImplementation,
} from "@workspace/evaluator";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "./errors.js";
import { mapEvaluationResultToInsertRow } from "./mapping.js";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — same alias shape as
// ../../artifacts/api-server/src/services/accountEvaluations.ts's own Tx.
// Needed because GTM V2 Stage 4, Unit 2's createAccountEvaluation calls
// this function from inside its own already-open transaction, so
// evaluation persistence and the attention-item lifecycle it triggers
// commit or roll back together.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface EvaluateAndPersistArgs {
  /**
   * The plain pool, or a caller's already-open transaction. Either way
   * this function nests its own db.transaction() call below — a real
   * transaction over the pool, or a SAVEPOINT over an open tx, exactly
   * like ../../artifacts/api-server/src/services/attentionItems.ts's
   * createAttentionItem. Passing a `tx` lets a caller nest this inside a
   * larger transaction.
   */
  db: Db | Tx;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
  // The exact existing DB enum type — never a hand-declared parallel union.
  evaluationMode: AccountEvaluation["evaluationMode"];
  createdBy?: AccountEvaluation["createdBy"];
}

/**
 * Loads the referenced account snapshot, ICP profile version, and
 * evaluator version inside one transaction; validates them; runs the
 * registered pure evaluator implementation; and inserts exactly one
 * immutable account_evaluations row.
 *
 * Returns the persisted row for BOTH outcomes a row can legitimately
 * represent — `status: "completed"` (evaluation ran successfully) and
 * `status: "failed"` (the stored snapshot or profile config was
 * structurally invalid, a truthfully-representable business outcome per
 * the existing schema's own status/error_detail contract). It THROWS
 * (inserting no row at all) only for conditions the existing schema has
 * no way to represent as a row: a referenced record that doesn't exist,
 * a production evaluation requested against a non-published profile
 * version, an evaluator version this running code doesn't implement, or
 * an infrastructure/transaction failure. See the package README-level
 * comment in index.ts for the full failure-semantics table.
 */
export async function evaluateAndPersist(
  args: EvaluateAndPersistArgs,
): Promise<AccountEvaluation> {
  const {
    db,
    snapshotId,
    profileVersionId,
    evaluatorVersionId,
    evaluationMode,
    createdBy = null,
  } = args;

  return db.transaction(async (tx) => {
    const [snapshot] = await tx
      .select()
      .from(accountSnapshots)
      .where(eq(accountSnapshots.id, snapshotId))
      .limit(1);
    if (!snapshot) {
      throw new MissingRecordError("accountSnapshot", snapshotId);
    }

    const [profileVersion] = await tx
      .select()
      .from(icpProfileVersions)
      .where(eq(icpProfileVersions.id, profileVersionId))
      .limit(1);
    if (!profileVersion) {
      throw new MissingRecordError("icpProfileVersion", profileVersionId);
    }

    const [evaluatorVersionRow] = await tx
      .select()
      .from(evaluatorVersions)
      .where(eq(evaluatorVersions.id, evaluatorVersionId))
      .limit(1);
    if (!evaluatorVersionRow) {
      throw new MissingRecordError("evaluatorVersion", evaluatorVersionId);
    }

    // Application-layer pre-check — clear, fast failure before any
    // parsing/evaluation work. The database trigger
    // (account_evaluations_production_requires_published_version) is the
    // FINAL enforcement point and remains authoritative regardless of
    // this check; this is defense-in-depth, not a replacement for it.
    if (
      evaluationMode === "production" &&
      profileVersion.status !== "published"
    ) {
      throw new ProductionRequiresPublishedProfileError(
        profileVersionId,
        profileVersion.status,
      );
    }

    // No fallback evaluator: throws UnsupportedEvaluatorVersionError
    // (from @workspace/evaluator) and inserts no row if
    // evaluatorVersionRow.version isn't in the registry.
    const implementation = getEvaluatorImplementation(
      evaluatorVersionRow.version,
    );

    const snapshotParse = NormalizedAccountInputV1Schema.safeParse(
      snapshot.normalizedInput,
    );
    const configParse = IcpProfileConfigV1Schema.safeParse(
      profileVersion.config,
    );

    if (!snapshotParse.success || !configParse.success) {
      // A truthfully-representable failure per the existing schema
      // (status='failed' + non-blank error_detail) — not an infra error,
      // so we persist one row rather than throwing without a record.
      //
      // profile_config_snapshot ALWAYS preserves the exact object that
      // was actually stored on the profile version — never {} and never
      // a substitute from the current active profile — regardless of
      // which of the two parses failed. If config parsing itself
      // succeeded (only the snapshot was invalid), the validated object
      // is stored, for consistency with the completed-row case below.
      const profileConfigSnapshot = configParse.success
        ? configParse.data
        : profileVersion.config;

      const [failedRow] = await tx
        .insert(accountEvaluations)
        .values({
          accountId: snapshot.accountId,
          snapshotId,
          profileVersionId,
          profileConfigSnapshot,
          evaluatorVersionId,
          evaluationMode,
          status: "failed",
          errorDetail: buildValidationErrorDetail(snapshotParse, configParse),
          createdBy,
        })
        .returning();
      return failedRow!;
    }

    const result = implementation(snapshotParse.data, configParse.data);

    const [completedRow] = await tx
      .insert(accountEvaluations)
      .values(
        mapEvaluationResultToInsertRow(result, {
          accountId: snapshot.accountId,
          snapshotId,
          profileVersionId,
          profileConfigSnapshot: configParse.data,
          evaluatorVersionId,
          evaluationMode,
          createdBy,
        }),
      )
      .returning();
    return completedRow!;
  });
}

function buildValidationErrorDetail(
  snapshotParse: ReturnType<typeof NormalizedAccountInputV1Schema.safeParse>,
  configParse: ReturnType<typeof IcpProfileConfigV1Schema.safeParse>,
): string {
  const parts: string[] = [];
  if (!snapshotParse.success) {
    parts.push(
      `account snapshot failed NormalizedAccountInputV1 validation: ${snapshotParse.error.message}`,
    );
  }
  if (!configParse.success) {
    parts.push(
      `profile config failed IcpProfileConfigV1 validation: ${configParse.error.message}`,
    );
  }
  return parts.join(" | ");
}
