// GTM V2 Unit 2 — signal ingestion write path.
//
// Canonicalizes a contract-validated NormalizedSignalV1 (source lowercased/
// trimmed, sourceEventId trimmed, company.domain/person.workEmail passed
// through @workspace/identity's own normalizers) into exactly one object,
// then stores THAT SAME canonical object as signals.normalized_payload —
// the flattened company_domain/company_name/campaign_id/campaign_name
// columns are derived from it too, so there is never a mixed-case original
// alongside canonicalized flattened columns (see canonicalizeNormalizedSignal
// below).
//
// Idempotency is insert-first, never pre-check-then-insert: this function
// always attempts the INSERT, and only on a caught 23505 against
// signals_source_source_event_id_uq does it re-read the row that won the
// race and decide duplicate (identical content) vs. conflict (same key,
// different content) — see recordSignal. This is the same shape
// ../services/accountFacts.ts uses for its own compare-and-swap, adapted
// here for an append-only table with no mutable pointer to move.
//
// Only imports from @workspace/db/schema and @workspace/identity, never
// @workspace/db itself — the database instance is always received via
// explicit injection (see RecordSignalArgs), mirroring every other service
// in this package.

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { signals, type Signal } from "@workspace/db/schema";
import {
  normalizeCompanyDomain,
  normalizeWorkEmail,
  type NormalizedSignalV1,
} from "@workspace/identity";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Deliberately carry no dynamic data (no raw domain/email value on the
// error object) — these are surfaced to callers as a generic 400, and an
// error object is exactly the kind of thing a naive `req.log.error({err})`
// could dump wholesale; a static message keeps that impossible.
export class InvalidSignalDomainError extends Error {
  constructor() {
    super("company.domain could not be normalized into a valid domain value.");
    this.name = "InvalidSignalDomainError";
  }
}

export class InvalidSignalWorkEmailError extends Error {
  constructor() {
    super(
      "person.workEmail could not be normalized into a valid work email value.",
    );
    this.name = "InvalidSignalWorkEmailError";
  }
}

// ---------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------

// Mirrors signals_company_domain_is_normalized_domain_shape's CHECK
// exactly. @workspace/identity's normalizeCompanyDomain only strips a
// leading scheme/www — a pathological input like "www.www.example.com"
// normalizes to "www.example.com", which still fails that CHECK. Catching
// that here turns it into a clean 400 instead of a 500 from a database
// constraint violation.
function isNormalizedDomainShape(value: string): boolean {
  return (
    value === value.trim().toLowerCase() &&
    !value.includes("://") &&
    !/[/?#]/.test(value) &&
    !value.startsWith("www.")
  );
}

function canonicalizeDomain(rawDomain: string | null): string | null {
  if (rawDomain === null) return null;
  const normalized = normalizeCompanyDomain(rawDomain);
  if (normalized === null || !isNormalizedDomainShape(normalized)) {
    throw new InvalidSignalDomainError();
  }
  return normalized;
}

function canonicalizeWorkEmail(rawEmail: string | null): string | null {
  if (rawEmail === null) return null;
  const normalized = normalizeWorkEmail(rawEmail);
  if (normalized === null) {
    throw new InvalidSignalWorkEmailError();
  }
  return normalized;
}

/**
 * Produces the single canonical NormalizedSignalV1 used for both storage
 * (normalized_payload) and duplicate/conflict comparison. Only source,
 * sourceEventId, company.domain, and person.workEmail are transformed;
 * every other contract-validated field is carried through unchanged.
 * Throws InvalidSignalDomainError/InvalidSignalWorkEmailError when a
 * supplied non-null domain/email cannot be normalized into a value that
 * would satisfy the database's own shape constraints — the caller (see
 * ../routes/signals.ts) maps both to a 400, never a 500.
 */
export function canonicalizeNormalizedSignal(
  input: NormalizedSignalV1,
): NormalizedSignalV1 {
  return {
    ...input,
    source: input.source.trim().toLowerCase(),
    sourceEventId: input.sourceEventId.trim(),
    company: {
      ...input.company,
      domain: canonicalizeDomain(input.company.domain),
    },
    person:
      input.person === null
        ? null
        : {
            ...input.person,
            workEmail: canonicalizeWorkEmail(input.person.workEmail),
          },
  };
}

// ---------------------------------------------------------------------
// Structural equality — order-independent object keys, order-sensitive
// arrays. Needed because jsonb round-trips through Postgres with key
// order not preserved, so a literal string/stringify comparison of
// normalized_payload/raw_payload against a freshly-canonicalized request
// would be a false negative for a genuinely identical retry.
// ---------------------------------------------------------------------

export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!structurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
    }
    return aKeys.every((key) => structurallyEqual(aObj[key], bObj[key]));
  }

  return false;
}

// ---------------------------------------------------------------------
// Constraint-violation detection — local mirror of
// ../services/accountFacts.ts's findPgConstraintErrorInfo (not imported;
// that helper is a module-private production internal for a different
// table, and this repo's existing convention — see that file's tests — is
// a small localized copy per call site rather than a shared cross-domain
// utility). drizzle-orm's node-postgres driver wraps the raw `pg`
// DatabaseError (which carries `code`/`constraint` directly) inside a
// DrizzleQueryError, exposed only via `.cause`.
// ---------------------------------------------------------------------

const SIGNAL_DEDUPE_CONSTRAINT = "signals_source_source_event_id_uq";
const MAX_ERROR_CAUSE_DEPTH = 5;

export interface PgConstraintErrorInfo {
  code: string;
  constraint: string;
}

export function findPgConstraintErrorInfo(
  err: unknown,
): PgConstraintErrorInfo | null {
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

function isSignalDedupeConflict(err: unknown): boolean {
  const info = findPgConstraintErrorInfo(err);
  return (
    info !== null &&
    info.code === "23505" &&
    info.constraint === SIGNAL_DEDUPE_CONSTRAINT
  );
}

// ---------------------------------------------------------------------
// Record — the only write path this service exposes.
// ---------------------------------------------------------------------

export interface RecordSignalArgs {
  db: Db;
  /** Already contract-validated by the route via NormalizedSignalV1Schema. */
  normalizedSignal: NormalizedSignalV1;
  rawPayload: Record<string, unknown>;
}

export type RecordSignalResult =
  | { outcome: "created"; signal: Signal }
  | { outcome: "duplicate"; signal: Signal }
  | { outcome: "conflict"; existingSignal: Signal };

async function fetchExistingSignal(
  db: Db,
  source: string,
  sourceEventId: string,
): Promise<Signal | undefined> {
  const [existing] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.source, source), eq(signals.sourceEventId, sourceEventId)))
    .limit(1);
  return existing;
}

/**
 * Insert-first idempotent write: always attempts the INSERT first (never
 * a pre-check SELECT), so two concurrent requests for the same
 * (source, sourceEventId) are resolved purely by which one wins the
 * database's own UNIQUE constraint — there is no read-then-write window
 * for a race to hide in. The loser (and any later exact/conflicting
 * retry) catches the resulting 23505, re-reads the row the winner
 * committed, and decides duplicate vs. conflict by structural comparison
 * of both the canonical normalized payload and the raw payload. Never
 * updates or deletes an existing row — signals is append-only by
 * database trigger regardless (see
 * lib/db/drizzle/0009_signals_identity_resolution_immutability.sql).
 */
export async function recordSignal(
  args: RecordSignalArgs,
): Promise<RecordSignalResult> {
  const { db, rawPayload } = args;
  const canonicalSignal = canonicalizeNormalizedSignal(args.normalizedSignal);

  try {
    const [inserted] = await db
      .insert(signals)
      .values({
        source: canonicalSignal.source,
        sourceEventId: canonicalSignal.sourceEventId,
        occurredAt: new Date(canonicalSignal.occurredAt),
        signalType: canonicalSignal.signalType,
        observedResolutionLevel: canonicalSignal.observedResolutionLevel,
        companyDomain: canonicalSignal.company.domain,
        companyName: canonicalSignal.company.name,
        campaignId: canonicalSignal.activity.campaignId,
        campaignName: canonicalSignal.activity.campaignName,
        schemaVersion: canonicalSignal.schemaVersion,
        rawPayload,
        normalizedPayload: canonicalSignal,
      })
      .returning();

    if (!inserted) {
      throw new Error("recordSignal: insert into signals returned no row.");
    }
    return { outcome: "created", signal: inserted };
  } catch (err) {
    if (!isSignalDedupeConflict(err)) {
      throw err;
    }

    const existing = await fetchExistingSignal(
      db,
      canonicalSignal.source,
      canonicalSignal.sourceEventId,
    );
    if (!existing) {
      // The unique-violation proves a row exists for this key, and
      // signals rows are never deleted (append-only trigger) — a missing
      // re-fetch here would mean something inexplicable happened between
      // the failed insert and this read. Surface the original database
      // error rather than inventing a result.
      throw err;
    }

    const normalizedMatches = structurallyEqual(
      existing.normalizedPayload,
      canonicalSignal,
    );
    const rawMatches = structurallyEqual(existing.rawPayload, rawPayload);

    if (normalizedMatches && rawMatches) {
      return { outcome: "duplicate", signal: existing };
    }
    return { outcome: "conflict", existingSignal: existing };
  }
}
