// Milestone 3H — read-only "current canonical truth" for one account,
// with human-resolvable provenance. This is a GET-side PREVIEW: it calls
// ../services/factResolutionRun.ts's computeCanonicalResolution (the
// exact same candidate-loading/binding/policy logic Milestone 3F/3G
// already use) and NEVER writes to resolved_facts — opening an account
// in the UI must never itself create resolution history. Persisted
// resolved_facts rows remain history/audit only (written exclusively by
// 3G's createCurrentAccountSnapshot at evaluation time); this module
// answers "what would resolve right now," always freshly computed, never
// a possibly-stale existing row (see
// ../services/canonicalFactEvaluatorInput.ts's own module comment for
// the identical recompute-not-cache reasoning this reuses).
//
// FIELD SET: RESOLVED_FACT_CANONICAL_FIELDS (11 fields, @workspace/db/schema)
// — deliberately NOT EVALUATOR_CANONICAL_FIELDS (10 fields,
// ../services/canonicalFactEvaluatorInput.ts). Those are two genuinely
// different questions: EVALUATOR_CANONICAL_FIELDS answers "what does the
// ICP evaluator currently read" (excludes crm.lifecycleStage — no
// evaluator input slot exists for it yet, a 3G-specific limitation);
// this module answers "what canonical scalar truth has Milestone 3F
// resolved for this account," which is everything 3F CAN reconcile,
// regardless of what any one downstream consumer happens to read.
// crm.lifecycleStage is real 3F output (HubSpot crm_state observations
// already carry it) and must be visible here even though 3G doesn't
// consume it. Never use EVALUATOR_CANONICAL_FIELDS in this module —
// that would silently hide real resolved truth from the operator for a
// reason (no evaluator slot) that has nothing to do with 3H's own job.
//
// EvidenceReference ({kind, id}) is not itself display-ready — this
// module's own job is resolving each reference into a human-readable DTO
// (provider/value/timestamps for an observation, "manual confirmation"
// context for a manual fact) via one batched lookup per kind, never N+1
// queries per field.

import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  RESOLVED_FACT_CANONICAL_FIELDS,
  accountFacts,
  accounts,
  observations,
  type EvidenceReference,
  type ResolvedFactCanonicalField,
} from "@workspace/db/schema";
import type { ReconciliationResult } from "./factReconciliation.js";
import { computeCanonicalResolution } from "./factResolutionRun.js";

type Db = NodePgDatabase<typeof schema>;

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

export type ResolvedEvidenceDTO =
  | {
      kind: "observation";
      id: string;
      provider: string;
      value: unknown;
      observedAt: string | null;
      importedAt: string;
      /**
       * M3.5 real-data defect fix: a human-readable override for `value`,
       * when the ingesting adapter already resolved one into
       * providerMetadata.displayName (string) — e.g. crm.owner's stable
       * HubSpot owner ID paired with the owner's actual name, captured
       * during ingestion (see
       * ../services/hubSpotCompanySync.ts/hubSpotObservationMapping.ts).
       * Null whenever no such metadata exists — `value` (the real,
       * stable canonical value) is never replaced, only supplemented.
       */
      displayName: string | null;
    }
  | {
      kind: "manual_account_fact";
      id: string;
      value: string;
      recordedBy: string;
      observedAt: string;
    }
  // A referenced row could not be found. Immutability + FK constraints
  // make this practically unreachable for real data, but a display
  // adapter must still fail safe rather than throw or fabricate content
  // for a corrupted/unexpected reference.
  | { kind: "unknown"; id: string };

export interface AccountTruthFieldDTO {
  canonicalField: ResolvedFactCanonicalField;
  canonicalValue: unknown | null;
  resolutionState: "single_source" | "agreement" | "conflict" | "unresolved";
  policyVersion: string;
  rationale: string;
  /** When THIS preview was computed — never a persisted resolved_facts.resolvedAt. */
  computedAt: string;
  selectedEvidence: ResolvedEvidenceDTO | null;
  supportingEvidence: ResolvedEvidenceDTO[];
  conflictingEvidence: ResolvedEvidenceDTO[];
  /**
   * M3.5 real-data defect fix: mirrors selectedEvidence's own
   * displayName (when selectedEvidence is an observation carrying one),
   * hoisted to the top level purely so the frontend's primary row value
   * never needs to branch on evidence shape to find it. canonicalValue
   * itself stays the real, stable canonical value untouched — this is an
   * additive display hint only, null whenever no such metadata exists.
   */
  canonicalDisplayValue: string | null;
}

function dedupeRefsByKind(
  refs: readonly EvidenceReference[],
): { observationIds: string[]; manualFactIds: string[] } {
  const observationIds = new Set<string>();
  const manualFactIds = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "observation") observationIds.add(ref.id);
    else manualFactIds.add(ref.id);
  }
  return { observationIds: [...observationIds], manualFactIds: [...manualFactIds] };
}

async function loadEvidenceLookup(
  db: Db,
  refs: readonly EvidenceReference[],
): Promise<Map<string, ResolvedEvidenceDTO>> {
  const { observationIds, manualFactIds } = dedupeRefsByKind(refs);
  const lookup = new Map<string, ResolvedEvidenceDTO>();

  const [observationRows, manualFactRows] = await Promise.all([
    observationIds.length
      ? db
          .select({
            id: observations.id,
            provider: observations.provider,
            rawValue: observations.rawValue,
            normalizedValue: observations.normalizedValue,
            observedAt: observations.observedAt,
            importedAt: observations.importedAt,
            providerMetadata: observations.providerMetadata,
          })
          .from(observations)
          .where(inArray(observations.id, observationIds))
      : Promise.resolve([]),
    manualFactIds.length
      ? db
          .select({
            id: accountFacts.id,
            value: accountFacts.value,
            recordedBy: accountFacts.recordedBy,
            observedAt: accountFacts.observedAt,
          })
          .from(accountFacts)
          .where(inArray(accountFacts.id, manualFactIds))
      : Promise.resolve([]),
  ]);

  for (const row of observationRows) {
    const metadataDisplayName = row.providerMetadata?.["displayName"];
    lookup.set(`observation:${row.id}`, {
      kind: "observation",
      id: row.id,
      provider: row.provider,
      value: row.normalizedValue ?? row.rawValue,
      observedAt: row.observedAt ? row.observedAt.toISOString() : null,
      importedAt: row.importedAt.toISOString(),
      displayName: typeof metadataDisplayName === "string" ? metadataDisplayName : null,
    });
  }
  for (const row of manualFactRows) {
    lookup.set(`manual_account_fact:${row.id}`, {
      kind: "manual_account_fact",
      id: row.id,
      value: row.value,
      recordedBy: row.recordedBy,
      observedAt: row.observedAt.toISOString(),
    });
  }
  return lookup;
}

function resolveRef(
  lookup: ReadonlyMap<string, ResolvedEvidenceDTO>,
  ref: EvidenceReference,
): ResolvedEvidenceDTO {
  return lookup.get(`${ref.kind}:${ref.id}`) ?? { kind: "unknown", id: ref.id };
}

/**
 * Pure: shapes one field's already-computed ReconciliationResult (see
 * ../services/factReconciliation.ts) plus an already-loaded evidence
 * lookup into the display-ready DTO. Exported so its DTO-shaping rules
 * (canonical value only when usable, selected evidence always resolved
 * consistently with supporting evidence, an unresolvable reference
 * degrading to `{kind: "unknown"}` rather than throwing) are unit-
 * testable without a database — see accountTruth.test.ts.
 */
export function toFieldDTO(
  canonicalField: ResolvedFactCanonicalField,
  result: ReconciliationResult,
  lookup: ReadonlyMap<string, ResolvedEvidenceDTO>,
  computedAt: string,
): AccountTruthFieldDTO {
  const selectedEvidence = result.selectedEvidence ? resolveRef(lookup, result.selectedEvidence) : null;
  return {
    canonicalField,
    canonicalValue: result.canonicalValue,
    resolutionState: result.state,
    policyVersion: result.policyVersion,
    rationale: result.rationale,
    computedAt,
    selectedEvidence,
    supportingEvidence: result.supportingEvidence.map((ref) => resolveRef(lookup, ref)),
    conflictingEvidence: result.conflictingEvidence.map((ref) => resolveRef(lookup, ref)),
    canonicalDisplayValue:
      selectedEvidence?.kind === "observation" ? selectedEvidence.displayName : null,
  };
}

/**
 * Current canonical truth for every field Milestone 3F can resolve
 * (RESOLVED_FACT_CANONICAL_FIELDS — all 11 firmographic_fact/crm_state
 * canonical fields, including crm.lifecycleStage), freshly computed
 * (never a possibly-stale resolved_facts read, never written). Sorted by
 * canonicalField for deterministic rendering. Throws AccountNotFoundError
 * when the account itself does not exist — callers (routes/accounts.ts's
 * /truth route) map that to 404, matching GET /internal/accounts/:accountId's
 * own convention.
 */
export async function getAccountCanonicalTruth(
  db: Db,
  accountId: string,
): Promise<AccountTruthFieldDTO[]> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const computedAt = new Date().toISOString();

  const results = await Promise.all(
    RESOLVED_FACT_CANONICAL_FIELDS.map(async (canonicalField) => {
      const result = await computeCanonicalResolution({ db, accountId, canonicalField });
      return { canonicalField, result };
    }),
  );

  const allEvidence = results.flatMap(({ result }) => result.consideredEvidence);
  const lookup = await loadEvidenceLookup(db, allEvidence);

  return results
    .map(({ canonicalField, result }) => toFieldDTO(canonicalField, result, lookup, computedAt))
    .sort((a, b) => a.canonicalField.localeCompare(b.canonicalField));
}
