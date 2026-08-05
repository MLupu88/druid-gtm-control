// GTM V2 Unit 1 — pure deterministic identity-normalization helpers.
//
// No database writes, no network calls — string transforms only. These
// exist so identity matching (company-domain/alias/work-email lookups)
// and duplicate-delivery rejection can rely on a single, independently
// testable definition of "canonical form" instead of every future
// caller reimplementing (or forgetting to apply) the same trim/lowercase
// logic.

import { createHash } from "node:crypto";

// Trim, lowercase, strip a leading http(s):// scheme, strip a leading
// www., strip everything from the first /, ?, or # onward (path/query/
// fragment), strip a trailing dot. Returns null for blank/whitespace-
// only/undefined input — "no domain" is a legitimate, common state, not
// an error.
//
// Idempotent: normalizeCompanyDomain(normalizeCompanyDomain(x)) ===
// normalizeCompanyDomain(x) — both lib/db's domain-format CHECK and
// account_aliases' strong-alias uniqueness depend on this holding.
export function normalizeCompanyDomain(
  input: string | null | undefined,
): string | null {
  if (input == null) {
    return null;
  }
  let value = input.trim().toLowerCase();
  if (value === "") {
    return null;
  }
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  const cutIndex = value.search(/[/?#]/);
  if (cutIndex !== -1) {
    value = value.slice(0, cutIndex);
  }
  value = value.replace(/\.$/, "");
  value = value.trim();
  return value === "" ? null : value;
}

// Trim, lowercase; returns null unless the result has exactly one '@'
// with non-blank local and domain parts. Deliberately not a full
// RFC 5322 validator and deliberately has no free-mail-provider
// denylist — that's a business/eligibility decision, out of scope here.
export function normalizeWorkEmail(
  input: string | null | undefined,
): string | null {
  if (input == null) {
    return null;
  }
  const value = input.trim().toLowerCase();
  if (value === "") {
    return null;
  }
  const atIndex = value.indexOf("@");
  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) {
    return null;
  }
  const localPart = value.slice(0, atIndex);
  const domainPart = value.slice(atIndex + 1);
  if (localPart.trim() === "" || domainPart.trim() === "") {
    return null;
  }
  return value;
}

// Collision-safe idempotency-key construction. NOT a simple
// `${source}::${sourceEventId}` join — either value could legitimately
// contain any delimiter, which would let two different (source,
// sourceEventId) pairs collide. Canonicalizes both inputs (source
// trimmed+lowercased; sourceEventId trimmed but case-preserved — event
// IDs are often case-sensitive), encodes them unambiguously via
// JSON.stringify (JSON's own string escaping means no crafted value can
// make two different pairs serialize identically), then returns the hex
// sha256 digest of that canonical string.
//
// This is a general-purpose idempotency-key utility, not the database's
// actual dedup guarantee — lib/db's `signals` table enforces
// UNIQUE(source, source_event_id) directly (a composite constraint,
// tuple-compared, with no concatenation ambiguity possible) and does not
// store this key as a column, so there is exactly one authority for "is
// this a duplicate."
//
// Throws on blank source/sourceEventId — a caller bug, not a legitimate
// "unknown" state (contrast with the two normalizers above, which
// return null for "no value").
export function buildSignalDedupeKey(
  source: string,
  sourceEventId: string,
): string {
  const normalizedSource = source.trim().toLowerCase();
  const trimmedEventId = sourceEventId.trim();
  if (normalizedSource === "" || trimmedEventId === "") {
    throw new Error(
      "buildSignalDedupeKey requires non-blank source and sourceEventId",
    );
  }
  const canonical = JSON.stringify([normalizedSource, trimmedEventId]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// Mirrors lib/db's account_aliases.normalization_strategy enum
// (redeclared, not imported — this package stays free of any lib/db
// dependency).
export type AliasNormalizationStrategy =
  | "domain"
  | "case_insensitive"
  | "exact";

// Dispatches alias-value normalization by strategy:
//   - "domain": same rules as normalizeCompanyDomain (case-insensitive
//     identifiers where the identifier is itself a domain).
//   - "case_insensitive": trim + lowercase (case-insensitive identifiers
//     that aren't domain-shaped, e.g. a company name).
//   - "exact": trim only, case preserved — for source/provider
//     identifiers that may be case-sensitive; lowercasing these could
//     silently merge two distinct IDs.
//
// Throws if the normalized result would be blank (a caller bug — an
// alias row must always carry a real value).
export function normalizeAliasValue(
  rawValue: string,
  strategy: AliasNormalizationStrategy,
): string {
  switch (strategy) {
    case "domain": {
      const normalized = normalizeCompanyDomain(rawValue);
      if (normalized === null) {
        throw new Error(
          "normalizeAliasValue: rawValue did not normalize to a non-blank domain",
        );
      }
      return normalized;
    }
    case "case_insensitive": {
      const normalized = rawValue.trim().toLowerCase();
      if (normalized === "") {
        throw new Error("normalizeAliasValue: rawValue is blank");
      }
      return normalized;
    }
    case "exact": {
      const normalized = rawValue.trim();
      if (normalized === "") {
        throw new Error("normalizeAliasValue: rawValue is blank");
      }
      return normalized;
    }
  }
}
