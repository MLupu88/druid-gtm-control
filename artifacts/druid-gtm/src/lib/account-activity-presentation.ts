// LS8 — pure, DOM-free extraction of the useful, factual RB2B fields
// buried inside a behavioral_signal observation's rawValue, so
// ../components/account-recent-activity-panel.tsx can surface them
// directly on the Activity row instead of trapping them only inside the
// collapsed "Raw event data" view. Field names verified directly against
// real production observations.raw_value key names (see
// ../../api-server/src/services/rb2bObservationMapping.ts's
// Rb2bSignalBridgeRequestSchema for the explicit/known subset, and the
// same payload's .passthrough() for the rest, e.g. city/state/position) —
// not guessed.
//
// Deliberately provider-scoped: the caller must only invoke this for
// provider === "rb2b" rows (see AccountActivityItem.provider) — this
// module has no opinion on any other provider's rawValue shape and must
// never be applied to one, which would silently misread unrelated JSON as
// if it were RB2B's.
//
// Never fabricates a value: every field is genuinely optional and reads
// as null when absent from the payload, exactly mirroring the observation
// itself never inventing evidence it wasn't given.

export interface Rb2bActivityFields {
  personName: string | null;
  title: string | null;
  pageVisited: string | null;
  city: string | null;
  state: string | null;
  hasEmail: boolean;
  hasLinkedin: boolean;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Returns null when rawValue isn't a plain JSON object at all (never
 * throws, never guesses) — the caller's own provider === "rb2b" gate is
 * what makes calling this in the first place safe, not any shape check
 * performed here.
 */
export function extractRb2bActivityFields(rawValue: unknown): Rb2bActivityFields | null {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
    return null;
  }
  const record = rawValue as Record<string, unknown>;
  return {
    personName: readOptionalString(record, "contact_name"),
    // Both keys have been observed in real production payloads (see
    // module comment) — prefer contact_title, fall back to position.
    title: readOptionalString(record, "contact_title") ?? readOptionalString(record, "position"),
    pageVisited: readOptionalString(record, "page_visited") ?? readOptionalString(record, "page_url"),
    city: readOptionalString(record, "city"),
    state: readOptionalString(record, "state"),
    hasEmail: readOptionalString(record, "contact_email") !== null,
    hasLinkedin: readOptionalString(record, "linkedin") !== null,
  };
}

/** A compact "City, State" (or just one, or null) — never fabricates a comma with only one side present. */
export function formatRb2bLocation(fields: Rb2bActivityFields): string | null {
  if (fields.city && fields.state) return `${fields.city}, ${fields.state}`;
  return fields.city ?? fields.state ?? null;
}

/** True only when at least one field this module can extract is actually present — lets the caller decide whether the structured summary line is worth rendering at all, vs. falling back to just the existing provider/eventType/timestamp header. */
export function hasAnyRb2bActivityFields(fields: Rb2bActivityFields): boolean {
  return (
    fields.personName !== null ||
    fields.title !== null ||
    fields.pageVisited !== null ||
    fields.city !== null ||
    fields.state !== null ||
    fields.hasEmail ||
    fields.hasLinkedin
  );
}
