// LS4 — pure presentation helpers for the canonical global Recent
// Activity feed. Deliberately factual only: describes what the
// underlying observation actually recorded, never "engagement",
// "intent", or "hot account" language. Reads only well-known optional
// fields that may be present on rawValue (the complete, unmodified
// inbound provider payload — see
// ../../api-server/src/services/rb2bObservationMapping.ts's module
// comment) and falls back to the observation's own eventType label when
// none are present — never a fabricated description.

import { providerDisplayName } from "./account-truth-presentation";
import type { GlobalActivityItem } from "./global-activity-api";

function readStringField(rawValue: unknown, field: string): string | null {
  if (rawValue === null || typeof rawValue !== "object") return null;
  const value = (rawValue as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function humanizeEventType(eventType: string): string {
  const words = eventType.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return "Activity";
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

/** e.g. "visited /pricing", or a provider-supplied signal_detail, or a factual fallback naming the provider and event type — never invented. */
export function describeActivityEvent(item: GlobalActivityItem): string {
  const pageVisited = readStringField(item.rawValue, "page_visited");
  if (pageVisited) return `visited ${pageVisited}`;

  const signalDetail = readStringField(item.rawValue, "signal_detail");
  if (signalDetail) return signalDetail;

  return `${providerDisplayName(item.provider)} activity: ${humanizeEventType(item.eventType)}`;
}

/** The account's company name, falling back to its domain, then a truthful "Unknown account" — never the raw accountId. */
export function activityAccountLabel(item: GlobalActivityItem): string {
  if (item.accountName) return item.accountName;
  if (item.companyDomain) return item.companyDomain;
  return "Unknown account";
}
