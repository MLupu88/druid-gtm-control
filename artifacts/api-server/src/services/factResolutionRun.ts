// Milestone 3F — DB-touching fact-reconciliation orchestrator.
//
// The only place this milestone reads observations/account_aliases/
// account_facts together and writes resolved_facts. Deliberately thin:
// every actual decision (subject binding, comparison, policy) lives in
// ./observationSubjectBinding.ts and ./factReconciliation.ts, both pure
// and independently tested — this module's only job is fetching rows,
// adapting them into the shapes those pure modules expect, and
// persisting the result.
//
// No current-pointer table (no resolved_fact_current) — see
// resolvedFacts.ts's own header comment. getLatestResolvedFact below is
// the narrow read helper the same file explicitly allows in its place.
//
// Milestone 3H: computeCanonicalResolution is the compute-only core
// (candidate loading + pure policy, no persistence) both
// resolveAccountCanonicalField (persists) and
// ../services/accountTruth.ts's read-only "current truth" preview (never
// persists, never inserts on a GET) share — one algorithm, two callers.
//
// Known, documented limitation: identity observations are queried
// broadly (every `identity`/account-subject row in the table, not
// scoped to one provider fetch) rather than narrowed by an index on
// (observation_class, semantic_key) alone — acceptable for this
// milestone's narrow internal scope, not optimized for scale. See
// NEXT_SESSION.md's 3F checkpoint.

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  ACCOUNT_FACT_FIELDS,
  accountAliases,
  accountFactCurrent,
  accountFacts,
  observations,
  resolvedFacts,
  type ResolvedFact,
  type ResolvedFactCanonicalField,
} from "@workspace/db/schema";
import { FirmographicCanonicalFieldV1 } from "@workspace/observation";
import type { FactCandidate, ReconciliationResult } from "./factReconciliation.js";
import { reconcileFactCandidates } from "./factReconciliation.js";
import {
  FACT_RECONCILIATION_POLICY_V1,
  type FactResolutionPolicyV1,
} from "./factResolutionPolicy.js";
import {
  selectFieldObservationsBoundToAccount,
  type IdentityLinkObservation,
} from "./observationSubjectBinding.js";

type Db = NodePgDatabase<typeof schema>;

const FIRMOGRAPHIC_FIELD_SET = new Set<string>(FirmographicCanonicalFieldV1.options);
const MANUAL_SUPPORTED_FIELDS = new Set<string>(ACCOUNT_FACT_FIELDS);

function observationClassForField(
  canonicalField: ResolvedFactCanonicalField,
): "firmographic_fact" | "crm_state" {
  return FIRMOGRAPHIC_FIELD_SET.has(canonicalField) ? "firmographic_fact" : "crm_state";
}

async function loadManualCandidate(
  db: Db,
  accountId: string,
  canonicalField: ResolvedFactCanonicalField,
): Promise<FactCandidate | null> {
  if (!MANUAL_SUPPORTED_FIELDS.has(canonicalField)) return null;

  const [row] = await db
    .select({ fact: accountFacts })
    .from(accountFactCurrent)
    .innerJoin(accountFacts, eq(accountFactCurrent.factId, accountFacts.id))
    .where(
      and(
        eq(accountFactCurrent.accountId, accountId),
        eq(accountFactCurrent.field, canonicalField),
      ),
    )
    .limit(1);
  if (!row) return null;

  return {
    evidence: { kind: "manual_account_fact", id: row.fact.id },
    provider: "manual",
    canonicalField,
    value: row.fact.value,
    observedAt: row.fact.observedAt,
    // account_facts has no ingestion-boundary concept — never fabricated.
    importedAt: null,
    // account_facts has no confidence column — never fabricated.
    confidence: null,
    isManual: true,
  };
}

async function loadBoundObservationCandidates(
  db: Db,
  accountId: string,
  canonicalField: ResolvedFactCanonicalField,
): Promise<FactCandidate[]> {
  const aliasRows = await db
    .select({
      aliasType: accountAliases.aliasType,
      normalizedValue: accountAliases.normalizedValue,
    })
    .from(accountAliases)
    .where(eq(accountAliases.accountId, accountId));

  const identityRows = await db
    .select({
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      semanticKey: observations.semanticKey,
      identityValue: observations.identityValue,
    })
    .from(observations)
    .where(
      and(
        eq(observations.observationClass, "identity"),
        eq(observations.identitySubjectType, "account"),
      ),
    );
  const identityObservations: IdentityLinkObservation[] = identityRows
    .filter((row) => row.identityValue !== null)
    .map((row) => ({
      provider: row.provider,
      sourceRecordId: row.sourceRecordId,
      identityKey: row.semanticKey as "domain" | "external_id",
      identityValue: row.identityValue!,
    }));

  const observationClass = observationClassForField(canonicalField);
  const fieldRows = await db
    .select({
      id: observations.id,
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      rawValue: observations.rawValue,
      normalizedValue: observations.normalizedValue,
      observedAt: observations.observedAt,
      importedAt: observations.importedAt,
      confidence: observations.confidence,
    })
    .from(observations)
    .where(
      and(
        eq(observations.observationClass, observationClass),
        eq(observations.semanticKey, canonicalField),
      ),
    );

  const bound = selectFieldObservationsBoundToAccount({
    accountAliases: aliasRows,
    identityObservations,
    fieldObservations: fieldRows,
  });

  return bound.map((row) => ({
    evidence: { kind: "observation", id: row.id },
    provider: row.provider,
    canonicalField,
    value: row.normalizedValue ?? row.rawValue,
    observedAt: row.observedAt,
    importedAt: row.importedAt,
    confidence: row.confidence,
    isManual: false,
  }));
}

export interface ResolveAccountCanonicalFieldArgs {
  db: Db;
  accountId: string;
  canonicalField: ResolvedFactCanonicalField;
  policy?: FactResolutionPolicyV1;
}

/**
 * The shared core both resolveAccountCanonicalField (below, persists) and
 * Milestone 3H's read-only "current truth" preview (../services/
 * accountTruth.ts, never persists) call — loads the exact same
 * candidates (current manual fact + bound provider observations) and
 * runs the exact same pure policy through factReconciliation.ts. No DB
 * write happens here; this function's only side effect is reads. Callers
 * that need a durable resolved_facts row still call
 * resolveAccountCanonicalField, not this function directly — this exists
 * so 3H never re-implements (or drifts from) 3F's own candidate-loading/
 * binding/policy logic.
 */
export async function computeCanonicalResolution(
  args: ResolveAccountCanonicalFieldArgs,
): Promise<ReconciliationResult> {
  const { db, accountId, canonicalField } = args;
  const policy = args.policy ?? FACT_RECONCILIATION_POLICY_V1;

  const [manualCandidate, observationCandidates] = await Promise.all([
    loadManualCandidate(db, accountId, canonicalField),
    loadBoundObservationCandidates(db, accountId, canonicalField),
  ]);

  const candidates: FactCandidate[] = manualCandidate
    ? [...observationCandidates, manualCandidate]
    : observationCandidates;

  return reconcileFactCandidates(candidates, policy);
}

/**
 * Computes (via computeCanonicalResolution above) and persists ONE new
 * resolved_facts row for (accountId, canonicalField). Never updates a
 * prior resolved_facts row — recomputation always appends a new one (see
 * resolvedFacts.ts's immutability trigger).
 */
export async function resolveAccountCanonicalField(
  args: ResolveAccountCanonicalFieldArgs,
): Promise<ResolvedFact> {
  const { db, accountId, canonicalField } = args;
  const policy = args.policy ?? FACT_RECONCILIATION_POLICY_V1;

  const result = await computeCanonicalResolution({ db, accountId, canonicalField, policy });

  const [row] = await db
    .insert(resolvedFacts)
    .values({
      accountId,
      canonicalField,
      resolutionState: result.state,
      canonicalValue: result.canonicalValue,
      selectedObservationId:
        result.selectedEvidence?.kind === "observation" ? result.selectedEvidence.id : null,
      selectedManualAccountFactId:
        result.selectedEvidence?.kind === "manual_account_fact"
          ? result.selectedEvidence.id
          : null,
      supportingEvidence: result.supportingEvidence,
      conflictingEvidence: result.conflictingEvidence,
      consideredEvidence: result.consideredEvidence,
      policyVersion: result.policyVersion,
      rationale: result.rationale,
    })
    .returning();

  if (!row) {
    throw new Error(
      `resolveAccountCanonicalField: insert into resolved_facts returned no row for account "${accountId}", field "${canonicalField}".`,
    );
  }
  return row;
}

/**
 * Read-only convenience helper — "latest resolution computation for this
 * (account, field)". Not wired into any route/UI/evaluator in this
 * milestone; see module comment.
 */
export async function getLatestResolvedFact(
  db: Db,
  accountId: string,
  canonicalField: ResolvedFactCanonicalField,
): Promise<ResolvedFact | null> {
  const [row] = await db
    .select()
    .from(resolvedFacts)
    .where(
      and(
        eq(resolvedFacts.accountId, accountId),
        eq(resolvedFacts.canonicalField, canonicalField),
      ),
    )
    .orderBy(desc(resolvedFacts.resolvedAt), desc(resolvedFacts.id))
    .limit(1);
  return row ?? null;
}
