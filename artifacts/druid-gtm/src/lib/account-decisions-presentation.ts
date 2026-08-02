// Shared, pure error-to-copy mapping for account-decision submission
// failures (POST /api/internal/account-decisions) — used by both
// ../components/decision-controls.tsx (account-detail page) and
// ../components/action-modal.tsx (queue sheet), so neither component
// defines its own copy of this switch and the two surfaces can never
// drift on how a given error code is explained to an operator.

import { AccountDecisionsApiError } from "@/lib/account-decisions-api";

/**
 * Maps a createAccountDecision() rejection to operator-facing copy.
 *
 * "evaluation_not_decision_ready" renders the server-provided `reasons`
 * verbatim when present (see @/lib/accounts-api.ts's MqlNotReadyReason) —
 * never recomputed or reinterpreted client-side. This case is a
 * stale-frontend-state fallback: the Promote to MQL button should already
 * be disabled by mqlDecisionReadiness before a submit is even possible,
 * but the 422 is still handled here in case the displayed evaluation
 * changed between page load and submit.
 *
 * For anything that is NOT an AccountDecisionsApiError (a network
 * failure, a thrown non-Error value, etc.), this deliberately returns
 * `fallbackMessage` rather than the raw error's own message — an
 * arbitrary thrown value's `.message` could leak internal detail an
 * operator should never see. Callers supply their own existing copy.
 */
export function describeAccountDecisionError(
  err: unknown,
  fallbackMessage = "Could not record this decision.",
): string {
  if (err instanceof AccountDecisionsApiError) {
    switch (err.code) {
      case "operator_identity_required":
        return "Your signed-in session doesn't have a usable operator email configured, so this decision can't be attributed to you. Ask an admin to configure a named operator identity.";
      case "evaluation_not_eligible":
      case "record_not_found":
        return "This evaluation has changed or is no longer eligible for a decision. Refresh the page and try again.";
      case "idempotency_conflict":
        return "This submission conflicts with a previous request. Change the reason (or refresh the page) and try again.";
      case "evaluation_not_decision_ready": {
        const reasons = err.reasons?.map((r) => r.message).join(" ");
        return reasons
          ? `This evaluation is not decision-ready for MQL: ${reasons}`
          : "This evaluation is not decision-ready for MQL. Refresh the page to see current reasons.";
      }
      default:
        return err.message;
    }
  }
  return fallbackMessage;
}
