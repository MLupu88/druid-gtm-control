// Pure presentation helpers for the accounts list/detail surfaces
// (../pages/accounts.tsx). Kept separate from that page so the display
// logic is unit-testable without a DOM (this package has no
// jsdom/testing-library — see ./accounts-api.limit.test.ts) and so the
// page itself stays a thin rendering layer over these.

import type { AccountEvaluationSummary } from "./accounts-api";

/**
 * The intent line for EvaluationSummaryLine (../pages/accounts.tsx),
 * reused by both the "All accounts" list rows and the separate "Latest
 * production evaluation" line. `summary` here is the lightweight
 * AccountEvaluationSummary — it never carries the full
 * profileConfigSnapshot, so this trusts the server-derived
 * `intentConfigured` boolean (see artifacts/api-server/src/services/
 * accounts.ts's toEvaluationSummary) rather than re-deriving anything.
 *
 * Never returns "Intent: <fallback tier>" when the profile had zero
 * configured intent rules — that tier is a real value the evaluator
 * resolved, but not a real evaluated buying-intent signal.
 */
export function getEvaluationSummaryIntentLabel(
  summary: Pick<AccountEvaluationSummary, "intentConfigured" | "intentTier">,
): string | null {
  if (summary.intentConfigured === false) return "Intent not configured";
  if (summary.intentTier) return `Intent: ${summary.intentTier}`;
  return null;
}
