// Application service for manual account facts (Unit 2 Slice 1) — the
// operator-confirmed company attributes (industry, country, region,
// employee range, revenue range) that Unit 1's MQL decision-readiness
// gate (../services/mqlDecisionReadiness.ts) needs real evidence for.
//
// account_facts is immutable and insert-only (every row is a frozen
// assertion — see @workspace/db/schema/accountFacts.ts); "current value"
// is tracked separately by the mutable account_fact_current pointer
// table, updated here via a transactional compare-and-swap so two
// concurrent corrections of the same value can never both "win". Only
// imports from @workspace/db/schema, never @workspace/db itself — the
// database instance is always received via explicit injection, mirroring
// every other service in this package.
//
// GTM V2 Stage 4, Unit 1 — evaluation staleness signal. recordAccountFact
// also raises an `evaluation_stale` attention item (source: "evaluation",
// see ../services/attentionItems.ts) whenever an accepted fact write
// touches a field the account's latest completed, production
// evaluation's frozen fit config actually references — every such write
// is a trigger, with no same-value or identity-based suppression (see
// raiseEvaluationStalenessSignalIfNeeded's own comment below for why).
// This never rewrites or invalidates that evaluation row itself
// (account_evaluations stays exactly as immutable as before) — it only
// records, via the existing Stage 3 attention-item mechanism, that the
// evaluation may no longer reflect current facts. See
// isAccountFactFieldReferencedInProfileConfig below for the exact
// relevance rule, and the module comment on
// ../services/attentionItems.ts's createAttentionItem for why that call is
// safe to make from inside this function's own open transaction.

import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountFacts,
  accountFactCurrent,
  accounts,
  MANUAL_OPERATOR_FACT_SOURCE,
  type AccountFact,
  type AccountFactField,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import { IcpProfileConfigV1Schema, type RuleCondition } from "@workspace/evaluator";
import { AccountNotFoundError } from "./icpEvaluationResolvers.js";
import { parseAccountFactValue } from "./accountFactValueValidation.js";
import { findLatestCompletedProductionEvaluation } from "./accountEvaluations.js";
import { createAttentionItem } from "./attentionItems.js";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — see ../services/identityResolution.ts's own Tx type alias,
// which this mirrors exactly. Needed here because
// raiseEvaluationStalenessSignalIfNeeded below is called with the open
// transaction recordAccountFact's own db.transaction() callback receives,
// not with Db itself.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class CorrectionReasonRequiredError extends Error {
  constructor(public readonly field: AccountFactField) {
    super(
      `A correction reason is required when replacing the current value of "${field}".`,
    );
    this.name = "CorrectionReasonRequiredError";
  }
}

export class CorrectionReasonNotAllowedError extends Error {
  constructor(public readonly field: AccountFactField) {
    super(
      `A correction reason is not allowed when confirming "${field}" for the first time.`,
    );
    this.name = "CorrectionReasonNotAllowedError";
  }
}

export class InvalidAccountFactValueError extends Error {
  constructor(
    public readonly field: AccountFactField,
    public readonly issue: string,
  ) {
    super(`The value supplied for "${field}" is not valid: ${issue}`);
    this.name = "InvalidAccountFactValueError";
  }
}

/**
 * Thrown when the transactional compare-and-swap loses a race — either a
 * competing write already claimed the "first assertion" slot for this
 * (account, field) (account_facts_one_root_per_account_field), a
 * competing correction already superseded the same predecessor
 * (account_facts_supersedes_fact_id_uq), or the account_fact_current
 * pointer had already moved by the time this call's conditional update
 * ran. All three are indistinguishable to the caller — a stale read,
 * requiring a re-fetch and retry — and none of them ever leave a
 * persisted account_facts row behind: recordAccountFact's transaction
 * (see below) is rolled back in every case, per this class's own
 * guarantee.
 */
export class StaleFactCorrectionError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly field: AccountFactField,
  ) {
    super(
      `The current value of "${field}" for account "${accountId}" changed since it was last read; reload and retry.`,
    );
    this.name = "StaleFactCorrectionError";
  }
}

// ---------------------------------------------------------------------
// Record — the only write path this service exposes.
// ---------------------------------------------------------------------

export interface RecordAccountFactArgs {
  db: Db;
  accountId: string;
  field: AccountFactField;
  value: string;
  /** Server-derived operator identity — never accepted from the client. */
  recordedBy: string;
  /** null => this must be the first-ever confirmation for this (account, field). */
  expectedCurrentFactId: string | null;
  /** Required, non-blank iff expectedCurrentFactId is set; must be null/blank otherwise. */
  correctionReason: string | null;
}

// The only two constraints whose violation genuinely means "a competing
// write already happened" (see StaleFactCorrectionError above) — both
// fire during the account_facts INSERT itself, before the pointer table
// is ever touched. Any other constraint violation (e.g. a CHECK on
// value/field shape, which application-layer validation above should
// already have caught) is a real bug or data-integrity issue and must
// propagate unchanged, never be reinterpreted as a 409-worthy conflict.
const KNOWN_CONCURRENCY_VIOLATION_CONSTRAINTS = new Set([
  "account_facts_supersedes_fact_id_uq",
  "account_facts_one_root_per_account_field",
]);

// Maximum guard against a pathological/malformed cause chain — real pg/
// drizzle error chains are 1-2 levels deep (raw pg DatabaseError, or that
// same error wrapped once in drizzle-orm's DrizzleQueryError via
// `.cause`); this is a generous ceiling, not a tuned value.
const MAX_ERROR_CAUSE_DEPTH = 5;

interface PgConstraintErrorInfo {
  code: string;
  constraint: string;
}

/**
 * Walks an unknown thrown value's `cause` chain looking for a real
 * Postgres constraint-violation error — one with both a string `code`
 * (SQLSTATE) and a string `constraint` name on the SAME object. Needed
 * because drizzle-orm's node-postgres driver wraps the raw `pg`
 * DatabaseError (which carries `code`/`constraint` directly) inside a
 * DrizzleQueryError, exposing the original only via `.cause` — a plain
 * `err.code` read on the caught error misses it entirely. Handles a
 * direct (unwrapped) pg error just as well: it matches on the very first
 * iteration, since `.cause` is only followed when the current object
 * itself doesn't already carry both fields.
 *
 * Bounded by both a depth limit and identity-based cycle detection so a
 * malformed or self-referential cause chain can never loop forever —
 * returns null (never crashes) for anything that doesn't resolve to a
 * genuine constraint-violation shape within that bound.
 */
function findPgConstraintErrorInfo(err: unknown): PgConstraintErrorInfo | null {
  const visited = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.constraint === "string") {
      return { code: candidate.code, constraint: candidate.constraint };
    }

    current = candidate.cause;
  }
  return null;
}

// Requires an EXACT match on both SQLSTATE 23505 (unique_violation) and
// one of the two known constraint names — deliberately not "any 23505",
// so an unrelated unique-violation elsewhere is never misclassified as a
// stale-correction conflict.
function isKnownConcurrencyViolation(err: unknown): boolean {
  const info = findPgConstraintErrorInfo(err);
  return (
    info !== null &&
    info.code === "23505" &&
    KNOWN_CONCURRENCY_VIOLATION_CONSTRAINTS.has(info.constraint)
  );
}

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 1 — evaluation staleness relevance rule. Kept
// local to this service (not exported from @workspace/evaluator): this is
// a one-off relevance check for the staleness signal, not a
// general-purpose evaluator capability.
// ---------------------------------------------------------------------

/**
 * Recursively walks a fit-dimension RuleCondition tree (and/or/not
 * composition) for a reference to `field` — mirrors
 * lib/evaluator/src/conditions.ts's own `walk`/`conditionDepth` switch
 * shape exactly, just answering a different question (field membership,
 * not depth or type validity).
 */
function conditionReferencesField(condition: RuleCondition, field: string): boolean {
  switch (condition.op) {
    case "exists":
    case "eq":
    case "in":
    case "gte":
    case "includesAny":
      return condition.field === field;
    case "not":
      return conditionReferencesField(condition.condition, field);
    case "and":
    case "or":
      return condition.conditions.some((c) => conditionReferencesField(c, field));
  }
}

/**
 * Whether an accepted change to `field` could truthfully change a
 * production evaluation's output — i.e. whether `field` is referenced
 * anywhere inside the frozen profileConfigSnapshot's fit.rules conditions.
 *
 * Proven, not assumed: every one of the five ACCOUNT_FACT_FIELDS values
 * (@workspace/db/schema's accountFacts.ts) is only ever allowlisted for
 * the "fit" dimension (lib/evaluator/src/profileConfig.ts's
 * FIT_FIELD_ALLOWLIST) — intent/actionability/eligibility's own
 * allowlists contain none of them — and every persisted profile config
 * was validated against its dimension's allowlist at authoring time
 * (profileConfig.ts's superRefine blocks). So checking fit.rules alone is
 * exhaustive for these fields; no other dimension needs inspecting.
 *
 * Returns true (conservatively relevant) when profileConfigSnapshot fails
 * IcpProfileConfigV1Schema validation — the DB's own CHECK on that column
 * only requires a JSON object, not conformance to this stricter,
 * possibly-since-tightened schema (mirrors ../services/accounts.ts's
 * toEvaluationSummary, which parses the same column just as defensively).
 * Relevance cannot be disproven in that case, and silently suppressing a
 * possibly-real staleness signal would be worse than an occasional false
 * positive.
 */
export function isAccountFactFieldReferencedInProfileConfig(
  profileConfigSnapshot: unknown,
  field: AccountFactField,
): boolean {
  const parsed = IcpProfileConfigV1Schema.safeParse(profileConfigSnapshot);
  if (!parsed.success) {
    return true;
  }
  return parsed.data.fit.rules.some((rule) =>
    conditionReferencesField(rule.condition, field),
  );
}

// Evaluation-scoped, deliberately never field-specific — so any number of
// distinct triggering fields against the SAME still-open item replay as a
// clean duplicate via createAttentionItem's own dedup (see
// ../services/attentionItems.ts's isDuplicateOfExisting, which compares
// reasonDetail/context/createdBy verbatim against the existing open row).
// A field-specific payload would make a second, different triggering
// field misclassify as a conflict purely because its context differs,
// even though both describe the exact same "this evaluation is stale"
// condition.
function evaluationStaleReasonDetail(evaluationId: string): string {
  return `A confirmed account fact changed after production evaluation ${evaluationId} was completed; its fit inputs may no longer reflect current facts.`;
}

function evaluationStaleContext(evaluationId: string): Record<string, unknown> {
  return { trigger: "account_fact_changed", evaluationId };
}

/**
 * Raises (or replays into) an open `evaluation_stale` attention item for
 * the account's latest completed, production evaluation, when that
 * evaluation's frozen fit config actually references `field`. A no-op
 * when no such evaluation exists (preview-only or failed-only accounts —
 * see findLatestCompletedProductionEvaluation) or when the field isn't
 * referenced — those are the ONLY two conditions gating this call.
 * Deliberately does NOT compare the new value against the value being
 * superseded: a same-value correction is not provably a no-op for
 * evaluation purposes (fact identity/provenance is meaningful elsewhere in
 * this codebase — see recordAccountFact's own call site comment), so Unit
 * 1 treats every accepted write to a referenced field as a trigger, full
 * stop. Always called with the SAME open transaction recordAccountFact's
 * own fact write ran in, relying on createAttentionItem's
 * nested-transaction/savepoint support (see ../services/attentionItems.ts)
 * — a genuine (non-dedup) failure here propagates out and rolls back the
 * fact write too; a benign dedup race/replay never does.
 */
async function raiseEvaluationStalenessSignalIfNeeded(
  tx: Tx,
  accountId: string,
  field: AccountFactField,
): Promise<void> {
  const evaluation = await findLatestCompletedProductionEvaluation(tx, accountId);
  if (!evaluation) {
    return;
  }
  if (
    !isAccountFactFieldReferencedInProfileConfig(
      evaluation.profileConfigSnapshot,
      field,
    )
  ) {
    return;
  }

  await createAttentionItem({
    db: tx,
    accountId,
    reasonCode: "evaluation_stale",
    source: "evaluation",
    sourceRef: evaluation.id,
    reasonDetail: evaluationStaleReasonDetail(evaluation.id),
    context: evaluationStaleContext(evaluation.id),
    createdBy: "system:evaluation",
  });
}

/**
 * Records one manual account-fact assertion. Application-layer mirror of
 * account_facts' correction-reason-iff-supersedes CHECK (defense in
 * depth — the CHECK remains the final authority), then a transactional
 * compare-and-swap:
 *
 *   1. INSERT the new, immutable account_facts row. For a correction,
 *      this alone can lose a race — see
 *      KNOWN_CONCURRENCY_VIOLATION_CONSTRAINTS above.
 *   2. Move the account_fact_current pointer to the new row —
 *      onConflictDoNothing for a first-time confirmation (any existing
 *      row at all means someone else confirmed first), or
 *      onConflictDoUpdate...setWhere(fact_id = expectedCurrentFactId)
 *      for a correction (a 0-row result means the pointer already moved
 *      since the caller last read it).
 *
 * Either failure shape throws StaleFactCorrectionError from inside the
 * db.transaction() callback, which rolls back the whole transaction —
 * the just-inserted account_facts row is never persisted on conflict, so
 * no orphan assertion is ever left behind.
 */
export async function recordAccountFact(
  args: RecordAccountFactArgs,
): Promise<AccountFact> {
  const { db, accountId, field, recordedBy, expectedCurrentFactId } = args;
  const isCorrection = expectedCurrentFactId !== null;
  const correctionReason = args.correctionReason?.trim() || null;

  if (isCorrection && !correctionReason) {
    throw new CorrectionReasonRequiredError(field);
  }
  if (!isCorrection && correctionReason) {
    throw new CorrectionReasonNotAllowedError(field);
  }

  const parsedValue = parseAccountFactValue(field, args.value);
  if (!parsedValue.success) {
    throw new InvalidAccountFactValueError(
      field,
      parsedValue.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  try {
    return await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(accountFacts)
        .values({
          accountId,
          field,
          value: parsedValue.data,
          source: MANUAL_OPERATOR_FACT_SOURCE,
          recordedBy,
          supersedesFactId: expectedCurrentFactId,
          correctionReason,
        })
        .returning();
      if (!inserted) {
        throw new Error(
          "recordAccountFact: insert into account_facts returned no row.",
        );
      }

      const pointerResult = isCorrection
        ? await tx
            .insert(accountFactCurrent)
            .values({ accountId, field, factId: inserted.id })
            .onConflictDoUpdate({
              target: [accountFactCurrent.accountId, accountFactCurrent.field],
              set: { factId: inserted.id, updatedAt: sql`now()` },
              setWhere: eq(
                accountFactCurrent.factId,
                expectedCurrentFactId as string,
              ),
            })
            .returning()
        : await tx
            .insert(accountFactCurrent)
            .values({ accountId, field, factId: inserted.id })
            .onConflictDoNothing({
              target: [accountFactCurrent.accountId, accountFactCurrent.field],
            })
            .returning();

      if (pointerResult.length === 0) {
        throw new StaleFactCorrectionError(accountId, field);
      }

      // GTM V2 Stage 4, Unit 1: every successfully accepted fact row for a
      // referenced field is a staleness trigger — root assertion or
      // correction alike, with no same-value suppression. A same-value
      // correction is NOT provably a no-op here: fact IDENTITY (not just
      // its string value) is meaningful elsewhere in this codebase — see
      // ../services/accountFactsSnapshotEvidence.ts, whose frozen evidence
      // envelope keys each entry by accountFactId specifically, not by
      // value alone. Unit 1 does not attempt the judgment call of deciding
      // when identity/provenance differences are safe to ignore.
      await raiseEvaluationStalenessSignalIfNeeded(tx, accountId, field);

      return inserted;
    });
  } catch (err) {
    if (err instanceof StaleFactCorrectionError) {
      throw err;
    }
    if (isKnownConcurrencyViolation(err)) {
      throw new StaleFactCorrectionError(accountId, field);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// Read — current facts (via the pointer table) plus the full history of
// superseded assertions, for one account.
// ---------------------------------------------------------------------

export interface ListAccountFactsResult {
  /** At most one row per Slice 1 field — the account_fact_current-winning assertion. */
  current: AccountFact[];
  /** Every assertion no longer current, newest first — never empty-vs-hidden: superseded rows always remain visible. */
  history: AccountFact[];
}

export async function listAccountFacts(
  db: Db,
  accountId: string,
): Promise<ListAccountFactsResult> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const currentRows = await db
    .select({ fact: accountFacts })
    .from(accountFactCurrent)
    .innerJoin(accountFacts, eq(accountFactCurrent.factId, accountFacts.id))
    .where(eq(accountFactCurrent.accountId, accountId));

  const allRows = await db
    .select()
    .from(accountFacts)
    .where(eq(accountFacts.accountId, accountId))
    .orderBy(desc(accountFacts.recordedAt));

  const currentIds = new Set(currentRows.map((row) => row.fact.id));
  const history = allRows.filter((row) => !currentIds.has(row.id));

  return { current: currentRows.map((row) => row.fact), history };
}
