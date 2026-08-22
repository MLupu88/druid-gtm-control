// Milestone 4A — pure, DOM-free logic for
// ../components/account-claims-panel.tsx. Mirrors
// ./account-truth-presentation.ts's own discipline (no jsdom/testing-
// library in this package, so every non-visual decision lives here,
// unit-tested without a DOM).
//
// NO CLAIM-KEY LABEL MAP: unlike account-truth-presentation.ts's
// FIELD_LABELS (a fixed, closed vocabulary), account_claims.claimKey is
// a deliberately OPEN vocabulary (see @workspace/db/schema's
// accountClaims.ts) — 4E's eventual research-question library curates
// real key values, not this milestone. claimKeyLabel below is therefore
// a GENERIC humanizer (split on ".", capitalize each segment) with no
// per-key lookup table, so this file never has to be updated as new
// claim keys appear, and never invents/hardcodes DRUID-specific claim
// vocabulary — see the M4 product-boundary rules this milestone was
// built under.

import { providerDisplayName } from "@/lib/account-truth-presentation";
import type { AccountClaim, ClaimEvidence, ClaimOrigin, ClaimValueType } from "@/lib/account-claims-api";

const MISSING_VALUE_TEXT = "—";

/** "cx.vendor" -> "Cx · Vendor". Generic, no per-key knowledge — see module comment. */
export function claimKeyLabel(claimKey: string): string {
  return claimKey
    .split(".")
    .map((segment) => (segment.length === 0 ? segment : segment[0]!.toUpperCase() + segment.slice(1)))
    .join(" · ");
}

const ORIGIN_LABELS: Record<ClaimOrigin, string> = {
  observed: "Observed",
  derived: "Derived",
  research: "Research",
  human_confirmed: "Confirmed by operator",
  human_corrected: "Corrected by operator",
};

export function originLabel(origin: ClaimOrigin): string {
  return ORIGIN_LABELS[origin];
}

export type ClaimStatusBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface ClaimLifecycleView {
  text: string;
  badgeVariant: ClaimStatusBadgeVariant;
}

/**
 * "Current"/"Superseded"/"Contradicted"/"Rejected" — derived from
 * isCurrent + status, never a stored field (account_claims itself never
 * stores "current"-ness, see the schema's own module comment).
 * "Contradicted" specifically flags an active, non-current, non-
 * superseded row (a disagreeing claim Mission Control never invented a
 * winner for) so it reads differently on screen from an ordinary
 * superseded correction, even though both are simply "not current."
 */
export function claimLifecycle(claim: AccountClaim): ClaimLifecycleView {
  if (claim.status === "rejected") {
    return { text: "Rejected", badgeVariant: "destructive" };
  }
  if (claim.isCurrent) {
    return { text: "Current", badgeVariant: "default" };
  }
  if (claim.supersedesClaimId !== null) {
    return { text: "Superseded", badgeVariant: "outline" };
  }
  return { text: "Contradicted", badgeVariant: "secondary" };
}

function displayScalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return MISSING_VALUE_TEXT;
}

export function displayClaimValue(valueType: ClaimValueType | null, value: unknown): string {
  if (valueType === null || value === null || value === undefined) return MISSING_VALUE_TEXT;
  switch (valueType) {
    case "boolean":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : MISSING_VALUE_TEXT;
    case "number":
    case "string":
      return displayScalar(value);
    case "list":
      return Array.isArray(value) && value.length > 0
        ? value.map((v) => displayScalar(v)).join(", ")
        : MISSING_VALUE_TEXT;
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${displayScalar(v)}`)
            .join(", ") || MISSING_VALUE_TEXT
        : MISSING_VALUE_TEXT;
  }
}

export function claimEvidenceSourceLabel(evidence: ClaimEvidence): string {
  switch (evidence.kind) {
    case "manual_account_fact":
      return "Manual confirmation";
    case "observation":
      return providerDisplayName(evidence.provider);
    case "unknown":
      return "Evidence unavailable";
  }
}

export function formatClaimTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

/**
 * Groups claims by claimKey, each group sorted current-first then
 * newest-first — the API itself already sorts claimKey asc / createdAt
 * desc (see accountClaims.ts's getAccountClaims), so this only needs to
 * partition, never re-sort within a group.
 */
export function groupClaimsByKey(claims: readonly AccountClaim[]): Map<string, AccountClaim[]> {
  const groups = new Map<string, AccountClaim[]>();
  for (const claim of claims) {
    const existing = groups.get(claim.claimKey);
    if (existing) {
      existing.push(claim);
    } else {
      groups.set(claim.claimKey, [claim]);
    }
  }
  return groups;
}
