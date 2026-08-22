// Milestone 4C — pure copy-building for Why Now reason cards. No DOM,
// no React. The backend (see
// ../../artifacts/api-server/src/services/accountWhyNow.ts) emits only
// structured WhyNowEvent objects — this is the ONE place a WhyNowEvent
// becomes a sentence, reusing ./account-truth-presentation.ts's
// fieldLabel so truth-field wording never drifts from how Account Truth
// is labeled everywhere else. Purely factual restatement — no card here
// ever states significance, urgency, or a recommendation; the backend
// detector itself only ever produces factual, provable events (see its
// own module comment), so there is nothing interpretive to strip here.

import { fieldLabel } from "@/lib/account-truth-presentation";
import type { WhyNowEvent } from "@/lib/account-brain-api";

function formatCalendarDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function displayValue(value: string | number | boolean | null): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export interface WhyNowCard {
  text: string;
  date: string;
}

export function whyNowCardText(event: WhyNowEvent): string {
  switch (event.kind) {
    case "person_first_identified":
      return "A new person was identified.";
    case "first_activity":
      return event.isWebsite
        ? "Website activity was recorded for the first time."
        : "Activity was recorded for the first time.";
    case "activity_returned": {
      const label = event.isWebsite ? "Website activity" : "Activity";
      return `${label} was recorded again after ${event.quietDays} days with none recorded.`;
    }
    case "truth_field_learned":
      return `We learned the account's ${fieldLabel(event.canonicalField).toLowerCase()}.`;
    case "truth_field_changed": {
      const label = fieldLabel(event.canonicalField);
      const from = displayValue(event.fromValue);
      const to = displayValue(event.toValue);
      return from !== null && to !== null ? `${label} changed from ${from} to ${to}.` : `${label} changed.`;
    }
  }
}

export function whyNowCard(event: WhyNowEvent): WhyNowCard {
  return { text: whyNowCardText(event), date: formatCalendarDate(event.occurredAt) };
}
