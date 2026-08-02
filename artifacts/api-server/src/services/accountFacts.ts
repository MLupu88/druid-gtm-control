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
import { AccountNotFoundError } from "./icpEvaluationResolvers.js";
import { parseAccountFactValue } from "./accountFactValueValidation.js";

type Db = NodePgDatabase<typeof schema>;

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
