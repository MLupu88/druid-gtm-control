// Hand-written types + fetch function for the Milestone 3H current-truth
// API (GET /api/internal/accounts/:accountId/truth). Shapes here are
// verified directly against
// artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/accountTruth.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./account-facts-api.ts.

// Exactly lib/db/src/schema/resolvedFacts.ts's own
// RESOLVED_FACT_CANONICAL_FIELDS (all 11 fields Milestone 3F can
// reconcile) — deliberately NOT the evaluator's own narrower
// EVALUATOR_CANONICAL_FIELDS (10 fields,
// ../../../api-server/src/services/canonicalFactEvaluatorInput.ts),
// which excludes crm.lifecycleStage only because the ICP evaluator has
// no input slot for it yet. Account Truth is not an evaluator view: it
// shows every canonical scalar field 3F has actually resolved, including
// crm.lifecycleStage. Every identity/behavioral_signal/
// research_intelligence field remains intentionally absent (those are
// never scalar-fact reconciliation targets at all) — this app never
// invents a wider canonical-field list than the backend actually
// resolves, it just must not silently narrow it to the evaluator's own
// subset either.
export const CANONICAL_TRUTH_FIELDS = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
  "crm.owner",
  "crm.lifecycleStage",
  "crm.openOpportunity",
  "crm.existingCustomer",
  "crm.competitorFlag",
  "crm.partnerFlag",
] as const;
export type CanonicalTruthField = (typeof CANONICAL_TRUTH_FIELDS)[number];

export type ResolutionState = "single_source" | "agreement" | "conflict" | "unresolved";

export type EvidenceDTO =
  | {
      kind: "observation";
      id: string;
      provider: string;
      value: unknown;
      observedAt: string | null;
      importedAt: string;
      /** Human-readable override for `value` when the ingesting adapter
       * resolved one (e.g. crm.owner's stable id vs. the owner's real
       * name) — null when no such metadata exists; `value` itself is
       * never replaced. */
      displayName: string | null;
    }
  | {
      kind: "manual_account_fact";
      id: string;
      value: string;
      recordedBy: string;
      observedAt: string;
    }
  | { kind: "unknown"; id: string };

export interface AccountTruthField {
  canonicalField: CanonicalTruthField;
  canonicalValue: unknown | null;
  resolutionState: ResolutionState;
  policyVersion: string;
  rationale: string;
  computedAt: string;
  selectedEvidence: EvidenceDTO | null;
  supportingEvidence: EvidenceDTO[];
  conflictingEvidence: EvidenceDTO[];
  /** Mirrors selectedEvidence's own displayName when present — see
   * accountTruth.ts's identical field for the full rationale. */
  canonicalDisplayValue: string | null;
}

export interface AccountTruthResponse {
  fields: AccountTruthField[];
}

export class AccountTruthApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountTruthApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountTruthApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountTruth(accountId: string): Promise<AccountTruthResponse> {
  const res = await fetch(`/api/internal/accounts/${accountId}/truth`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load current account truth.");
  }
  return res.json() as Promise<AccountTruthResponse>;
}

export function accountTruthQueryKey(accountId: string) {
  return ["account-truth", accountId] as const;
}
