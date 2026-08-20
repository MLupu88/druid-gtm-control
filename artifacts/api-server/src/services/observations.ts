// Milestone 3D — candidate observation ingestion write path.
//
// Persists a contract-validated ProviderObservationV1 (lib/observation,
// Milestone 3B/3C) into observations. Deliberately never touches
// account_id/person_id — this table has none (see
// lib/db/src/schema/observations.ts's module comment); subject binding is
// Milestone 3F's job.
//
// Idempotency is insert-first, never pre-check-then-insert: this function
// always attempts the INSERT, and only on a caught 23505 against
// observations_occurrence_uq does it re-read the row that won the race and
// decide duplicate (identical stored content) vs. conflict (same
// occurrence tuple, different content) — the same shape
// ../services/signals.ts's recordSignal uses, adapted here for the
// occurrence-vs-semantic-identity distinction Milestone 3D's design
// introduces: the unique tuple is (provider, observationClass,
// sourceRecordId, semanticKey, importedAt) — semantic identity alone
// (computeObservationIdentityKey, lib/observation) is deliberately NOT
// unique in this table, so a later re-observation with a new importedAt
// (whether the value changed or not) is always a new row, never a
// duplicate/conflict candidate.
//
// semantic_key is derived via lib/observation's exported
// getObservationSemanticKey — never recomputed or parsed out of
// computeObservationIdentityKey's opaque joined string.
//
// importedAt is never generated here: it is part of the caller-supplied,
// contract-validated ProviderObservationV1 and is passed through
// unchanged. The caller (the eventual 3E adapter / ingestion route) is
// responsible for assigning it once per ingestion attempt and reusing the
// identical value on any retry of that same attempt — this function has
// no way to enforce that itself (see observations.ts's module comment).
//
// Only imports from @workspace/db/schema and @workspace/observation, never
// @workspace/db itself — the database instance is always received via
// explicit injection (see RecordObservationArgs), mirroring every other
// service in this package.

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  observations,
  type InsertObservation,
  type Observation,
} from "@workspace/db/schema";
import {
  getObservationSemanticKey,
  type ProviderObservationV1,
} from "@workspace/observation";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------

// Mirrors observations_provider_is_canonical_form's CHECK exactly (and
// signals.ts's own canonicalizeDomain-adjacent provider handling) — the
// database refuses a non-canonical provider value regardless, but
// canonicalizing here means a caller never has to discover that as a
// constraint-violation 500.
function canonicalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

/**
 * Maps a contract-validated ProviderObservationV1 into observations'
 * insert shape. The identity branch carries identitySubjectType/
 * identityValue and neither rawValue nor normalizedValue (the contract
 * has no such fields there); every other branch carries rawValue/
 * normalizedValue and neither identity column — mirrors
 * observations_identity_payload_shape's CHECK exactly, so this mapping
 * can never itself produce a row that CHECK would reject.
 */
export function toInsertObservation(
  observation: ProviderObservationV1,
): InsertObservation {
  const common = {
    provider: canonicalizeProvider(observation.provider),
    sourceRecordId: observation.sourceRecordId,
    observationClass: observation.observationClass,
    semanticKey: getObservationSemanticKey(observation),
    observedAt:
      observation.observedAt === null ? null : new Date(observation.observedAt),
    importedAt: new Date(observation.importedAt),
    confidence: observation.confidence,
    evidenceRefs: observation.evidenceRefs,
    providerMetadata: observation.providerMetadata,
  };

  if (observation.observationClass === "identity") {
    return {
      ...common,
      identitySubjectType: observation.subjectType,
      identityValue: observation.identityValue,
      rawValue: null,
      normalizedValue: null,
    };
  }

  return {
    ...common,
    identitySubjectType: null,
    identityValue: null,
    rawValue: observation.rawValue,
    normalizedValue: observation.normalizedValue,
  };
}

// ---------------------------------------------------------------------
// Structural equality — order-independent object keys, order-sensitive
// arrays. Local copy, not imported from ../services/signals.ts or
// ./attentionItems.ts — this repo's established convention (see
// signals.ts's own comment on findPgConstraintErrorInfo) is a small
// localized copy per call site, not a shared cross-domain utility.
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

function datesEqual(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * Every column NOT part of the occurrence-uniqueness tuple. Two rows
 * sharing that tuple (provider/observationClass/sourceRecordId/
 * semanticKey/importedAt) are a genuine "same ingestion attempt" retry
 * only if every one of these also matches — any difference is a conflict,
 * never silently accepted as either outcome.
 */
function observationContentMatches(
  existing: Observation,
  incoming: InsertObservation,
): boolean {
  return (
    existing.identitySubjectType === incoming.identitySubjectType &&
    existing.identityValue === incoming.identityValue &&
    structurallyEqual(existing.rawValue, incoming.rawValue ?? null) &&
    structurallyEqual(existing.normalizedValue, incoming.normalizedValue ?? null) &&
    datesEqual(existing.observedAt, incoming.observedAt ?? null) &&
    existing.confidence === incoming.confidence &&
    structurallyEqual(existing.evidenceRefs, incoming.evidenceRefs ?? []) &&
    structurallyEqual(existing.providerMetadata, incoming.providerMetadata ?? null)
  );
}

// ---------------------------------------------------------------------
// Constraint-violation detection — local mirror of
// ../services/signals.ts's findPgConstraintErrorInfo (same established
// convention: a small localized copy per call site, not a shared
// cross-domain utility). drizzle-orm's node-postgres driver wraps the raw
// `pg` DatabaseError (which carries `code`/`constraint` directly) inside a
// DrizzleQueryError, exposed only via `.cause`.
// ---------------------------------------------------------------------

const OBSERVATIONS_OCCURRENCE_CONSTRAINT = "observations_occurrence_uq";
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

function isObservationOccurrenceConflict(err: unknown): boolean {
  const info = findPgConstraintErrorInfo(err);
  return (
    info !== null &&
    info.code === "23505" &&
    info.constraint === OBSERVATIONS_OCCURRENCE_CONSTRAINT
  );
}

// ---------------------------------------------------------------------
// Record — the only write path this service exposes.
// ---------------------------------------------------------------------

export interface RecordObservationArgs {
  db: Db;
  /** Already contract-validated by the caller via ProviderObservationV1Schema. */
  observation: ProviderObservationV1;
}

export type RecordObservationResult =
  | { outcome: "created"; observation: Observation }
  | { outcome: "duplicate"; observation: Observation }
  | { outcome: "conflict"; existingObservation: Observation };

async function fetchExistingObservation(
  db: Db,
  values: InsertObservation,
): Promise<Observation | undefined> {
  const [existing] = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.provider, values.provider),
        eq(observations.observationClass, values.observationClass),
        eq(observations.sourceRecordId, values.sourceRecordId),
        eq(observations.semanticKey, values.semanticKey),
        eq(observations.importedAt, values.importedAt),
      ),
    )
    .limit(1);
  return existing;
}

/**
 * Insert-first idempotent write: always attempts the INSERT first (never a
 * pre-check SELECT), so two concurrent requests for the same occurrence
 * tuple are resolved purely by which one wins the database's own UNIQUE
 * constraint — there is no read-then-write window for a race to hide in.
 * The loser (and any later exact/conflicting retry) catches the resulting
 * 23505, re-reads the row the winner committed, and decides duplicate vs.
 * conflict by structural comparison of every non-key column. Never
 * updates or deletes an existing row — observations is append-only by
 * database trigger regardless (see
 * lib/db/drizzle/0013_observations_immutability.sql).
 *
 * A later re-observation of the SAME semantic identity
 * (provider/observationClass/sourceRecordId/semanticKey) with a NEW
 * importedAt — whether the value changed or not — never reaches this
 * conflict path at all: a different importedAt is a different occurrence
 * tuple, so it inserts cleanly as a new immutable row. Reasoning over
 * multiple occurrences sharing one semantic identity (which value is
 * current, how it changed over time) is explicitly Milestone 3F's job,
 * not this function's.
 */
export async function recordObservation(
  args: RecordObservationArgs,
): Promise<RecordObservationResult> {
  const { db } = args;
  const values = toInsertObservation(args.observation);

  try {
    const [inserted] = await db.insert(observations).values(values).returning();

    if (!inserted) {
      throw new Error("recordObservation: insert into observations returned no row.");
    }
    return { outcome: "created", observation: inserted };
  } catch (err) {
    if (!isObservationOccurrenceConflict(err)) {
      throw err;
    }

    const existing = await fetchExistingObservation(db, values);
    if (!existing) {
      // The unique-violation proves a row exists for this occurrence
      // tuple, and observations rows are never deleted (append-only
      // trigger) — a missing re-fetch here would mean something
      // inexplicable happened between the failed insert and this read.
      // Surface the original database error rather than inventing a
      // result.
      throw err;
    }

    if (observationContentMatches(existing, values)) {
      return { outcome: "duplicate", observation: existing };
    }
    return { outcome: "conflict", existingObservation: existing };
  }
}
