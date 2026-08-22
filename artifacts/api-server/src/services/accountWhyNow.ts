// Milestone 4C — deterministic Why Now reason-card detection. No LLM, no
// score, no "hot/warm/cold", no qualification language anywhere in this
// module — every function here answers only "what factual thing
// changed, and when," never "what that means." Human-readable card TEXT
// is built entirely in the frontend (see
// ../../artifacts/druid-gtm/src/lib/account-why-now-presentation.ts,
// mirroring 4B's own backend/frontend split — this module returns
// structured WhyNowEvent objects only.
//
// Deliberately limited to exactly the four reason types the M4/4C
// design settled on as genuinely provable today — no "new account
// claim" reason (the 4B claim registry is still empty; there is no
// production write path creating real claims yet, so that reason type
// waits until one exists), no frequency/acceleration/trend/velocity
// logic (that is M5 Account Shadow's job, not this one's).

import type { AccountPersonDTO } from "./people.js";
import type { AccountActivityItemDTO } from "./accountActivity.js";
import type { ResolvedFactHistoryEntry } from "./accountTruthHistory.js";
import type { ResolvedFactCanonicalField } from "@workspace/db/schema";

// Reuses ../../artifacts/api-server/src/services/overviewTimeframe.ts's
// existing "last N calendar days" convention (7, the same default
// Overview already uses) rather than inventing a new window — see that
// module's own comment on why this repo has exactly one canonical
// recency definition.
export const WHY_NOW_WINDOW_DAYS = 7;

// M4/4C correction: a "returned after inactivity" card requires at
// least this many FULL UTC calendar days with zero recorded activity
// between the two most recent distinct active days — reusing the same
// 7-day convention as the minimum quiet period, not a separately
// invented threshold.
export const MIN_QUIET_DAYS_FOR_RETURN = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Every provider that emits behavioral_signal observations today is
// RB2B, a website-visitor-identification product — so every such
// observation genuinely represents a website visit. This check exists
// so the copy never says "website activity" for a hypothetical future
// non-website behavioral_signal provider; it will need revisiting if one
// is ever added.
const WEBSITE_VISIT_PROVIDERS = new Set(["rb2b"]);
function isWebsiteVisitProvider(provider: string): boolean {
  return WEBSITE_VISIT_PROVIDERS.has(provider);
}

export type WhyNowEvent =
  | { kind: "person_first_identified"; occurredAt: string }
  | { kind: "first_activity"; occurredAt: string; isWebsite: boolean }
  | { kind: "activity_returned"; occurredAt: string; isWebsite: boolean; quietDays: number }
  | { kind: "truth_field_learned"; occurredAt: string; canonicalField: ResolvedFactCanonicalField }
  | {
      kind: "truth_field_changed";
      occurredAt: string;
      canonicalField: ResolvedFactCanonicalField;
      fromValue: string | number | boolean | null;
      toValue: string | number | boolean | null;
    };

function calendarDay(iso: string): string {
  return iso.slice(0, 10);
}

function calendarDayDiff(earlier: string, later: string): number {
  const a = Date.UTC(...(earlier.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(later.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / MS_PER_DAY);
}

/** New people whose firstSeenAt (set once, never mutated — see accountPeople.ts) falls within the window. */
export function detectPersonEvents(
  people: readonly AccountPersonDTO[],
  windowStart: Date,
): WhyNowEvent[] {
  return people
    .filter((p) => new Date(p.firstSeenAt) >= windowStart)
    .map((p): WhyNowEvent => ({ kind: "person_first_identified", occurredAt: p.firstSeenAt }));
}

interface ActivityDayGroup {
  day: string;
  earliestOccurredAt: string;
  providers: Set<string>;
}

function groupActivityByDay(items: readonly AccountActivityItemDTO[]): ActivityDayGroup[] {
  const byDay = new Map<string, ActivityDayGroup>();
  for (const item of items) {
    const day = calendarDay(item.occurredAt);
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { day, earliestOccurredAt: item.occurredAt, providers: new Set([item.provider]) });
    } else {
      existing.providers.add(item.provider);
      if (item.occurredAt < existing.earliestOccurredAt) existing.earliestOccurredAt = item.occurredAt;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function allWebsiteProviders(group: ActivityDayGroup): boolean {
  return [...group.providers].every((p) => isWebsiteVisitProvider(p));
}

/**
 * At most one event: either the account's first-ever recorded activity
 * (if it falls in-window), or a "returned after >= MIN_QUIET_DAYS_FOR_RETURN
 * full quiet days" event — never both, and never a card for ordinary
 * continued activity below the quiet-day threshold (M4/4C correction 4:
 * no card merely because two distinct days exist).
 */
export function detectActivityEvent(
  items: readonly AccountActivityItemDTO[],
  windowStart: Date,
): WhyNowEvent | null {
  const days = groupActivityByDay(items);
  if (days.length === 0) return null;

  // The most recent event overall must fall in-window — the last day
  // bucket is, by construction, the one containing it.
  const mostRecentOccurredAt = items.reduce((max, i) => (i.occurredAt > max ? i.occurredAt : max), items[0]!.occurredAt);
  if (new Date(mostRecentOccurredAt) < windowStart) return null;

  const last = days[days.length - 1]!;
  if (days.length === 1) {
    return { kind: "first_activity", occurredAt: last.earliestOccurredAt, isWebsite: allWebsiteProviders(last) };
  }

  const prev = days[days.length - 2]!;
  const quietDays = calendarDayDiff(prev.day, last.day) - 1;
  if (quietDays < MIN_QUIET_DAYS_FOR_RETURN) return null;

  return {
    kind: "activity_returned",
    occurredAt: last.earliestOccurredAt,
    isWebsite: allWebsiteProviders(last),
    quietDays,
  };
}

type TruthClassification = "known" | "conflicting" | "unknown";

function classifyHistoryEntry(entry: ResolvedFactHistoryEntry): TruthClassification {
  if (entry.canonicalValue !== null) return "known";
  if (entry.resolutionState === "conflict") return "conflicting";
  return "unknown";
}

function displayableScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqualJson(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k, i) => k === bKeys[i] && deepEqualJson(aObj[k], bObj[k]));
  }
  return false;
}

interface HistoryPeriod {
  classification: TruthClassification;
  value: unknown;
  firstResolvedAt: string;
}

/** Collapses consecutive resolved_facts rows sharing the same (classification, value) into one period — a re-affirming snapshot is not a change. History must already be sorted oldest-first (see getResolvedFactHistory). */
function collapseIntoPeriods(entries: readonly ResolvedFactHistoryEntry[]): HistoryPeriod[] {
  const periods: HistoryPeriod[] = [];
  for (const entry of entries) {
    const classification = classifyHistoryEntry(entry);
    const last = periods[periods.length - 1];
    if (last && last.classification === classification && deepEqualJson(last.value, entry.canonicalValue)) {
      continue;
    }
    periods.push({ classification, value: entry.canonicalValue, firstResolvedAt: entry.resolvedAt });
  }
  return periods;
}

/**
 * For each canonical field with history, at most one event: either
 * "we learned X" (the field's canonical understanding just became
 * Known, with no prior Known period) or "X changed" (a prior Known
 * period held a different value) — only when the transition's
 * firstResolvedAt falls in-window. A field re-affirming the same known
 * value across multiple resolved_facts rows produces no event — see
 * collapseIntoPeriods. Regressions (Known -> not-Known) are not
 * reported; no card framing for that direction was specified and none
 * is safely positive.
 */
export function detectTruthFieldEvents(
  history: readonly ResolvedFactHistoryEntry[],
  windowStart: Date,
): WhyNowEvent[] {
  const byField = new Map<ResolvedFactCanonicalField, ResolvedFactHistoryEntry[]>();
  for (const entry of history) {
    const list = byField.get(entry.canonicalField);
    if (list) list.push(entry);
    else byField.set(entry.canonicalField, [entry]);
  }

  const events: WhyNowEvent[] = [];
  for (const [canonicalField, entries] of byField) {
    const periods = collapseIntoPeriods(entries);
    const last = periods[periods.length - 1]!;
    if (last.classification !== "known") continue;
    if (new Date(last.firstResolvedAt) < windowStart) continue;

    const prior = periods[periods.length - 2];
    if (!prior || prior.classification !== "known") {
      events.push({ kind: "truth_field_learned", occurredAt: last.firstResolvedAt, canonicalField });
    } else if (!deepEqualJson(prior.value, last.value)) {
      events.push({
        kind: "truth_field_changed",
        occurredAt: last.firstResolvedAt,
        canonicalField,
        fromValue: displayableScalar(prior.value),
        toValue: displayableScalar(last.value),
      });
    }
  }
  return events;
}

const MAX_WHY_NOW_EVENTS = 5;

export interface BuildWhyNowEventsArgs {
  people: readonly AccountPersonDTO[];
  activityItems: readonly AccountActivityItemDTO[];
  truthHistory: readonly ResolvedFactHistoryEntry[];
  now: Date;
}

/**
 * Merges every detectable event type, sorted newest-first, capped at
 * MAX_WHY_NOW_EVENTS. An empty result is a real, expected outcome — an
 * account with nothing new to report gets an empty array, never a
 * fabricated entry.
 */
export function buildWhyNowEvents(args: BuildWhyNowEventsArgs): WhyNowEvent[] {
  const windowStart = new Date(args.now.getTime() - WHY_NOW_WINDOW_DAYS * MS_PER_DAY);

  const events: WhyNowEvent[] = [
    ...detectPersonEvents(args.people, windowStart),
    ...detectTruthFieldEvents(args.truthHistory, windowStart),
  ];
  const activityEvent = detectActivityEvent(args.activityItems, windowStart);
  if (activityEvent) events.push(activityEvent);

  return events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0)).slice(0, MAX_WHY_NOW_EVENTS);
}
