// Milestone 4B/4C — pure, DOM-free logic for
// ../components/account-brain-panel.tsx. Mirrors
// ./account-truth-presentation.ts's own module comment discipline (no
// jsdom/testing-library in this package).
//
// Truth field classification (Known/Conflicting/Unknown) lives in
// ./account-known-unknown-presentation.ts, not here — this module keeps
// only what isn't specific to that classification: activity copy and
// narrative-unavailable copy.

import type { AccountActivitySummary } from "@/lib/account-brain-api";

function formatCalendarDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One factual sentence describing activity coverage — never a fabricated
 * claim, never displayed as an account_claims row (see
 * ../../artifacts/api-server/src/services/accountActivitySummary.ts's
 * own module comment: this is analysis metadata, computed fresh, never
 * persisted).
 */
export function activitySummaryLine(summary: AccountActivitySummary): string {
  if (summary.totalEvents === 0) {
    return "No activity has been observed for this account yet.";
  }
  const providerList = summary.providers.join(", ");
  const first = formatCalendarDate(summary.firstObservedAt);
  const last = formatCalendarDate(summary.lastObservedAt);
  const dayWord = summary.distinctDaysObserved === 1 ? "day" : "days";
  const eventWord = summary.totalEvents === 1 ? "event" : "events";
  const range = first && last && first !== last ? ` between ${first} and ${last}` : first ? ` on ${first}` : "";
  return `${summary.totalEvents} ${eventWord} observed across ${summary.distinctDaysObserved} distinct ${dayWord}${range}, via ${providerList}.`;
}

export type NarrativeUnavailableCopy = string;

const UNAVAILABLE_COPY: Record<string, NarrativeUnavailableCopy> = {
  not_configured: "Grounded synthesis is not configured for this environment.",
  api_error: "Grounded synthesis is temporarily unavailable.",
  invalid_json: "Grounded synthesis returned an unusable response.",
  invalid_shape: "Grounded synthesis returned an unusable response.",
  forbidden_language: "Grounded synthesis was withheld — it did not meet this account's evidence-grounding rules.",
  ungrounded: "Grounded synthesis was withheld — it did not meet this account's evidence-grounding rules.",
};

/** Human copy for a narrativeUnavailableReason — never the raw enum value shown to a user. */
export function narrativeUnavailableCopy(reason: string): NarrativeUnavailableCopy {
  return UNAVAILABLE_COPY[reason] ?? "Grounded synthesis is currently unavailable.";
}
