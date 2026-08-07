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

import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountEvaluations,
  accountFactCurrent,
  accounts,
  accountSnapshots,
  ACCOUNT_FACT_FIELDS,
  type AccountEvaluation,
  type AttentionItem,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import { evaluateAndPersist as realEvaluateAndPersist } from "@workspace/evaluator-persistence";
import {
  resolveProfileVersionForEvaluation,
  createCurrentAccountSnapshot,
  resolveCanonicalEvaluatorVersion,
} from "./icpEvaluationResolvers.js";
import { createAttentionItem, findOpenAttentionItems, resolveAttentionItem } from "./attentionItems.js";
import { isAccountFactFieldReferencedInProfileConfig } from "./accountFacts.js";
import { AccountFactsSnapshotEvidenceV1Schema } from "./accountFactsSnapshotEvidence.js";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — structurally the same query-builder surface as Db, but a
// distinct drizzle-orm class. findLatestCompletedProductionEvaluation
// below must accept either, since ../services/accountFacts.ts's
// recordAccountFact calls it from inside its own open transaction (GTM V2
// Stage 4, Unit 1). Exact mirror of ../services/identityResolution.ts's
// own Tx type alias.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type EvaluateAndPersistFn = typeof realEvaluateAndPersist;

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 2 — evaluation resolution lifecycle. Reuses Unit 1's
// attention_items mechanism exclusively (no new table, no stored status);
// see ../services/attentionItems.ts's findOpenAttentionItems/
// createAttentionItem/resolveAttentionItem, and
// ../services/accountFacts.ts's raiseEvaluationStalenessSignalIfNeeded for
// the evaluation_stale item this resolves.
//
// Scope is PRODUCTION evaluations only — evaluationMode is checked first,
// before any query, in applyProductionEvaluationLifecycleEffects below.
// Preview evaluations (any status) and requests that insert no row at all
// (MissingRecordError, ProductionRequiresPublishedProfileError,
// UnsupportedEvaluatorVersionError — thrown out of evaluateAndPersistFn
// before reaching this step) have zero attention-item side effects.
//
// evaluation_stale resolution is deliberately CAUSAL, never timestamp-
// based: it compares the accountFactId identities the evaluation's own
// immutable snapshot evidence recorded against account_fact_current's
// CURRENT identities, for exactly the fields that evaluation's frozen
// profileConfigSnapshot actually cares about (see
// evaluationSnapshotStillReflectsCurrentRelevantFacts below). An earlier
// design compared account_snapshots.capturedAt against
// attention_items.createdAt — rejected: PostgreSQL's now()/
// CURRENT_TIMESTAMP reflects transaction START time, never commit time,
// so no pair of timestamps stamped by two independently-committing
// transactions can soundly prove commit ordering, and a single open
// evaluation_stale item's createdAt only ever describes its FIRST
// trigger, not every later relevant fact change that dedupes/replays
// into it. Comparing immutable identities read fresh at resolution time
// has neither problem. See createAccountEvaluation below for the
// account-row lock this comparison still needs — not for timestamp
// ordering, but to serialize the compare-then-resolve step against a
// concurrent recordAccountFact for the same account (a genuine
// check-then-act race across two statements, even within one
// transaction, that no amount of timestamp cleverness can close).
// ---------------------------------------------------------------------

const EVALUATION_ATTENTION_SOURCE: AttentionItem["source"] = "evaluation";
const SYSTEM_EVALUATION_ACTOR = "system:evaluation";

const EVALUATION_FAILED_REASON_CODE = "evaluation_failed";
const EVALUATION_MISSING_INPUTS_REASON_CODE = "evaluation_missing_inputs";
const EVALUATION_STALE_REASON_CODE = "evaluation_stale";

// Fixed, evaluation-id-agnostic text — deliberately does NOT embed
// evaluation.id or errorDetail/missingInputs content. Every production
// evaluation failure (or every production evaluation still missing the
// same or different inputs) is a fresh account_evaluations row with a
// fresh id, so embedding it here would make reasonDetail differ on every
// replay and defeat createAttentionItem's dedup (isDuplicateOfExisting
// compares reasonDetail/context/createdBy verbatim) — turning "the same
// ongoing operational condition, replayed" into spurious "conflict"
// outcomes instead of clean duplicates. The immutable account_evaluations
// row (via errorDetail / missingInputs, queryable by account + createdAt)
// is the detailed audit record; this item's job is only to say a human
// needs to look, not to duplicate that record.
const EVALUATION_FAILED_REASON_DETAIL =
  "A production evaluation for this account failed; see the account's evaluation history for the failure detail.";
const EVALUATION_MISSING_INPUTS_REASON_DETAIL =
  "The account's latest completed production evaluation is missing required inputs; see that evaluation's missingInputs for detail.";

function evaluationSuccessResolutionReason(evaluationId: string): string {
  return `Resolved by production evaluation ${evaluationId}, which completed successfully.`;
}

function hasMissingInputs(evaluation: AccountEvaluation): boolean {
  return (
    Array.isArray(evaluation.missingInputs) && evaluation.missingInputs.length > 0
  );
}

/**
 * Resolves every currently-open attention item matching
 * (accountId, reasonCode, EVALUATION_ATTENTION_SOURCE) — one
 * findOpenAttentionItems query plus one resolveAttentionItem UPDATE per
 * matching row. resolveAttentionItem's own WHERE status = 'open' guard
 * means a row resolved by a concurrent evaluation between the find and
 * this call is a harmless no-op replay (kind: "replayed"), never an
 * error.
 */
async function resolveOpenAttentionItems(
  tx: Tx,
  accountId: string,
  reasonCode: string,
  resolutionReason: string,
): Promise<void> {
  const items = await findOpenAttentionItems({
    db: tx,
    accountId,
    reasonCode,
    source: EVALUATION_ATTENTION_SOURCE,
  });
  for (const item of items) {
    await resolveAttentionItem({
      db: tx,
      attentionItemId: item.id,
      resolvedBy: SYSTEM_EVALUATION_ACTOR,
      resolutionReason,
    });
  }
}

/**
 * Causal (never timestamp-based) proof that a completed production
 * evaluation's frozen snapshot evidence still matches current reality,
 * for exactly the account-fact fields that evaluation's own
 * profileConfigSnapshot actually references
 * (isAccountFactFieldReferencedInProfileConfig — reused verbatim from
 * ../services/accountFacts.ts, the same relevance rule Unit 1 already
 * uses to decide whether a fact change matters). Compares
 * accountFactId identities — an IMMUTABLE value once the snapshot row
 * exists (account_snapshots is insert-only) — against
 * account_fact_current's identities read fresh, right now. Never
 * compares any timestamp.
 *
 * Vacuously true when no ACCOUNT_FACT_FIELDS field is relevant to this
 * evaluation's own config — nothing account-fact-related could ever have
 * made it stale in the first place, so no query runs at all in that case.
 *
 * Fails CLOSED (returns false, never resolve) whenever currency cannot be
 * proven: the referenced account_snapshots row's rawInput does not parse
 * as AccountFactsSnapshotEvidenceV1Schema. This is reachable in normal
 * operation, not just theoretically — the route accepts an arbitrary
 * caller-supplied snapshotId, so an evaluation's snapshot is not
 * guaranteed to be one createCurrentAccountSnapshot itself built (e.g. an
 * old v1-sourced snapshot from before this envelope existed).
 * isAccountFactFieldReferencedInProfileConfig already fails closed the
 * same way (conservatively "relevant") when profileConfigSnapshot itself
 * fails schema validation — reused as-is, not reimplemented here.
 *
 * MUST be called with the account row already locked FOR UPDATE by the
 * caller (see createAccountEvaluation) — not for timestamp ordering, but
 * to serialize this compare-then-(caller's own)-resolve sequence against
 * a concurrent recordAccountFact for the same account. Without that lock,
 * a fact relevant to this evaluation could commit, and dedupe/replay into
 * an already-open evaluation_stale item, in the gap between this read and
 * the caller's later resolve — a genuine check-then-act race across two
 * statements that no comparison logic alone can close.
 */
async function evaluationSnapshotStillReflectsCurrentRelevantFacts(
  tx: Tx,
  evaluation: AccountEvaluation,
): Promise<boolean> {
  const relevantFields = ACCOUNT_FACT_FIELDS.filter((field) =>
    isAccountFactFieldReferencedInProfileConfig(evaluation.profileConfigSnapshot, field),
  );
  if (relevantFields.length === 0) {
    return true;
  }

  const [snapshotRow] = await tx
    .select({ rawInput: accountSnapshots.rawInput })
    .from(accountSnapshots)
    .where(eq(accountSnapshots.id, evaluation.snapshotId))
    .limit(1);
  if (!snapshotRow) {
    // evaluation.snapshotId is a NOT NULL FK to an existing row — this
    // can only fire on a genuine data-integrity failure, never a normal
    // runtime path.
    throw new Error(
      `evaluationSnapshotStillReflectsCurrentRelevantFacts: account_snapshots row "${evaluation.snapshotId}" referenced by an evaluation was not found (data integrity failure).`,
    );
  }

  const parsedEvidence = AccountFactsSnapshotEvidenceV1Schema.safeParse(snapshotRow.rawInput);
  if (!parsedEvidence.success) {
    return false;
  }

  const snapshotFactIdByField = new Map<string, string>();
  for (const entry of parsedEvidence.data.evidence) {
    snapshotFactIdByField.set(entry.field, entry.accountFactId);
  }

  const currentRows = await tx
    .select({ field: accountFactCurrent.field, factId: accountFactCurrent.factId })
    .from(accountFactCurrent)
    .where(
      and(
        eq(accountFactCurrent.accountId, evaluation.accountId),
        inArray(accountFactCurrent.field, relevantFields),
      ),
    );
  const currentFactIdByField = new Map<string, string>(
    currentRows.map((row) => [row.field, row.factId]),
  );

  return relevantFields.every(
    (field) => snapshotFactIdByField.get(field) === currentFactIdByField.get(field),
  );
}

export type ApplyEvaluationLifecycleEffectsFn = (
  tx: Tx,
  evaluation: AccountEvaluation,
) => Promise<void>;

/**
 * Applies the attention-item side effects a just-persisted PRODUCTION
 * evaluation implies. Called from inside createAccountEvaluation's own
 * transaction (see below), on the exact row evaluateAndPersistFn just
 * returned — so persistence and every lifecycle effect here commit or
 * roll back together. For a "completed" evaluation, the caller must
 * already hold the account's row lock (see createAccountEvaluation) —
 * this function does not acquire it itself.
 *
 *   - evaluationMode !== "production": no-op, unconditionally, before any
 *     query. Preview evaluations never create or resolve anything here.
 *   - status === "failed": create/replay one open evaluation_failed item.
 *     Deliberately does NOT touch evaluation_stale or
 *     evaluation_missing_inputs — a failed evaluation proves nothing
 *     about whether the account's prior completed evaluation is still
 *     current; those conditions (if open) must remain open.
 *   - status === "completed": resolve every open evaluation_failed item
 *     (a completed production evaluation is proof the account is
 *     evaluable again); resolve every open evaluation_stale item only
 *     when evaluationSnapshotStillReflectsCurrentRelevantFacts proves
 *     this evaluation's own snapshot evidence still matches current
 *     account_fact_current identities for every field it cares about
 *     (never a blanket "resolve every open evaluation_stale row"); then,
 *     depending on this evaluation's own missingInputs, either
 *     create/replay an open evaluation_missing_inputs item (non-empty)
 *     or resolve any open one (empty).
 */
export async function applyProductionEvaluationLifecycleEffects(
  tx: Tx,
  evaluation: AccountEvaluation,
): Promise<void> {
  if (evaluation.evaluationMode !== "production") {
    return;
  }

  if (evaluation.status === "failed") {
    await createAttentionItem({
      db: tx,
      accountId: evaluation.accountId,
      reasonCode: EVALUATION_FAILED_REASON_CODE,
      source: EVALUATION_ATTENTION_SOURCE,
      sourceRef: null,
      reasonDetail: EVALUATION_FAILED_REASON_DETAIL,
      context: {},
      createdBy: SYSTEM_EVALUATION_ACTOR,
    });
    return;
  }

  const resolutionReason = evaluationSuccessResolutionReason(evaluation.id);

  await resolveOpenAttentionItems(
    tx,
    evaluation.accountId,
    EVALUATION_FAILED_REASON_CODE,
    resolutionReason,
  );

  if (await evaluationSnapshotStillReflectsCurrentRelevantFacts(tx, evaluation)) {
    await resolveOpenAttentionItems(
      tx,
      evaluation.accountId,
      EVALUATION_STALE_REASON_CODE,
      resolutionReason,
    );
  }

  if (hasMissingInputs(evaluation)) {
    await createAttentionItem({
      db: tx,
      accountId: evaluation.accountId,
      reasonCode: EVALUATION_MISSING_INPUTS_REASON_CODE,
      source: EVALUATION_ATTENTION_SOURCE,
      sourceRef: null,
      reasonDetail: EVALUATION_MISSING_INPUTS_REASON_DETAIL,
      context: {},
      createdBy: SYSTEM_EVALUATION_ACTOR,
    });
  } else {
    await resolveOpenAttentionItems(
      tx,
      evaluation.accountId,
      EVALUATION_MISSING_INPUTS_REASON_CODE,
      resolutionReason,
    );
  }
}

export interface CreateAccountEvaluationArgs {
  db: NodePgDatabase<typeof schema>;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
  evaluationMode: AccountEvaluation["evaluationMode"];
  createdBy?: AccountEvaluation["createdBy"];
}

/**
 * Requests one canonical account evaluation. Opens exactly one outer
 * transaction (a real transaction over the plain pool args.db always is —
 * see CreateAccountEvaluationArgs.db) so evaluation persistence and every
 * GTM V2 Stage 4, Unit 2 attention-item lifecycle effect it implies commit
 * or roll back together as one atomic unit.
 *
 * For a PRODUCTION request only, before calling evaluateAndPersistFn at
 * all: resolves accountId from the supplied snapshotId (the smallest safe
 * read — just the FK column, not the full row) and, if found, acquires
 * SELECT ... FOR UPDATE on that account's row. This must happen FIRST,
 * strictly before evaluateAndPersistFn's own INSERT into
 * account_evaluations — that INSERT's FK to accounts implicitly acquires
 * a FOR KEY SHARE lock on the same row, and acquiring the stronger FOR
 * UPDATE only afterward would make it a same-transaction lock
 * strengthening racing a concurrent recordAccountFact's own FOR UPDATE
 * request — a scenario PostgreSQL can resolve, but only by leaning on
 * same-transaction lock-upgrade internals this codebase has no other
 * reason to depend on. Acquiring the strongest lock first avoids the
 * question entirely: every later implicit FK lock this same transaction
 * takes on that row is trivially compatible. The lock is NOT for
 * timestamp ordering (nothing here reads or compares a timestamp) — it
 * serializes evaluationSnapshotStillReflectsCurrentRelevantFacts's
 * compare-then-resolve sequence (see applyProductionEvaluationLifecycleEffects)
 * against a concurrent fact write for the same account. If the snapshot
 * lookup finds no row, no new error path is invented here — locking is
 * simply skipped, and evaluateAndPersistFn raises its own existing
 * MissingRecordError("accountSnapshot", ...) exactly as before this unit.
 * PREVIEW requests never perform this lookup or acquire anything —
 * evaluationSnapshotStillReflectsCurrentRelevantFacts is never reached
 * for preview evaluations either, so there is nothing to serialize.
 *
 * evaluateAndPersistFn is called with the open tx (not args.db) as its own
 * db, relying on that function's own db.transaction() call becoming a
 * SAVEPOINT rather than a fresh transaction (see
 * @workspace/evaluator-persistence's own module comment).
 * applyLifecycleEffectsFn then runs against the exact row just persisted,
 * inside the same tx, with the lock (when acquired) still held. Any
 * thrown error — from evaluateAndPersistFn (no row persisted at all) or
 * from applyLifecycleEffectsFn (persisted row rolled back too) —
 * propagates out of this function with nothing committed, exactly as
 * before this unit for the evaluateAndPersistFn-throws case. Both
 * function parameters are DI seams so tests can substitute fake
 * implementations without a database connection; production callers never
 * need to pass either.
 */
export async function createAccountEvaluation(
  args: CreateAccountEvaluationArgs,
  evaluateAndPersistFn: EvaluateAndPersistFn = realEvaluateAndPersist,
  applyLifecycleEffectsFn: ApplyEvaluationLifecycleEffectsFn = applyProductionEvaluationLifecycleEffects,
): Promise<AccountEvaluation> {
  return args.db.transaction(async (tx) => {
    if (args.evaluationMode === "production") {
      const [snapshotRow] = await tx
        .select({ accountId: accountSnapshots.accountId })
        .from(accountSnapshots)
        .where(eq(accountSnapshots.id, args.snapshotId))
        .limit(1);
      if (snapshotRow) {
        await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, snapshotRow.accountId))
          .for("update");
      }
    }

    const evaluation = await evaluateAndPersistFn({
      db: tx,
      snapshotId: args.snapshotId,
      profileVersionId: args.profileVersionId,
      evaluatorVersionId: args.evaluatorVersionId,
      evaluationMode: args.evaluationMode,
      createdBy: args.createdBy ?? null,
    });
    await applyLifecycleEffectsFn(tx, evaluation);
    return evaluation;
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

/**
 * Retrieves the single evaluation an account currently has "on the books"
 * for real decision-making purposes — the exact completed+production
 * concept this module's own top-of-file comment on evaluationMode already
 * names as "the only evaluations account_decisions may ever reference" and
 * accountDecisions.ts's createAccountDecision already gates on. Never a
 * preview evaluation (evaluationMode filter) and never a failed one
 * (status filter) — an evaluation that failed or ran in preview mode was
 * never "current" for any decision-relevant purpose, regardless of how
 * recent it is. When the account's most recent production evaluation is
 * itself 'failed' but an older 'completed' production evaluation exists,
 * that older row is still returned here — it remains the account's real
 * official evaluation until a newer one completes.
 *
 * Ties (identical createdAt, which the column's own timestamp resolution
 * makes possible) are broken by id descending — the same deterministic
 * tie-break already used throughout ../services/accounts.ts's DISTINCT ON
 * queries — so exactly one row is ever "the" latest.
 *
 * Accepts either the plain pool or a caller's already-open transaction
 * (see the Tx type above) — GTM V2 Stage 4, Unit 1's staleness trigger
 * (../services/accountFacts.ts's recordAccountFact) calls this from
 * inside its own transaction so the lookup and the resulting
 * evaluation_stale attention item observe a consistent snapshot of
 * account_evaluations.
 */
export async function findLatestCompletedProductionEvaluation(
  db: Db | Tx,
  accountId: string,
): Promise<AccountEvaluation | undefined> {
  const [row] = await db
    .select()
    .from(accountEvaluations)
    .where(
      and(
        eq(accountEvaluations.accountId, accountId),
        eq(accountEvaluations.status, "completed"),
        eq(accountEvaluations.evaluationMode, "production"),
      ),
    )
    .orderBy(desc(accountEvaluations.createdAt), desc(accountEvaluations.id))
    .limit(1);
  return row;
}

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

export interface RunOfficialIcpEvaluationForAccountArgs {
  db: Db;
  accountId: string;
  profileId: string;
  createdBy?: AccountEvaluation["createdBy"];
}

/**
 * Orchestrates one OFFICIAL (production) ICP evaluation for a canonical
 * account, starting from nothing but an accountId + profileId — the
 * production-mode counterpart to runPreviewIcpEvaluationForAccount
 * above. evaluationMode is hardcoded to "production" here (never
 * "preview"); resolveProfileVersionForEvaluation's "production" branch
 * requires the profile's ACTIVE, PUBLISHED version and throws
 * NoActiveProfileVersionError when none exists — there is no fallback to
 * a draft. This is the row ../pages/account-detail.tsx's
 * findLatestCompletedProductionEvaluation (evaluationMode: "production",
 * status: "completed") already treats as an account's official
 * evaluation, and the only kind account_decisions may ever reference
 * (enforced by a database trigger — see accountDecisions.ts). Always
 * creates a fresh snapshot and a fresh evaluation row — there is no
 * idempotency-key mechanism here; double-submission is prevented purely
 * client-side (see ../../druid-gtm/src/components/account-icp-preview-panel.tsx),
 * matching this endpoint's own minimal scope and the preview endpoint's
 * identical lack of one.
 */
export async function runOfficialIcpEvaluationForAccount(
  args: RunOfficialIcpEvaluationForAccountArgs,
): Promise<AccountEvaluation> {
  const { db, accountId, profileId, createdBy } = args;

  const profileVersion = await resolveProfileVersionForEvaluation(
    db,
    profileId,
    "production",
  );
  const snapshot = await createCurrentAccountSnapshot(db, accountId);
  const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db);

  return createAccountEvaluation({
    db,
    snapshotId: snapshot.id,
    profileVersionId: profileVersion.id,
    evaluatorVersionId: evaluatorVersion.id,
    evaluationMode: "production",
    createdBy,
  });
}
