// GTM V2 Unit 3 — deterministic runtime identity resolution.
//
// Turns one already-persisted, immutable signals row into a canonical
// account/person binding: matches or creates exactly one account from
// strong company identifiers (domain, provider external IDs — never a
// bare company name), optionally matches or creates exactly one person
// from strong person identifiers (work email, provider external IDs —
// never a bare full name or LinkedIn URL), upserts the account_people
// relationship when a person resolves, and appends exactly one
// identity_resolution_events row recording the outcome. Never updates or
// deletes a signal (signals is append-only by trigger regardless — see
// lib/db/drizzle/0009_signals_identity_resolution_immutability.sql) and
// never touches evaluations, decisions, actions, or any outbox.
//
// Two-phase per attempt, inside one transaction (see attemptResolve):
//   1. PLANNING (read-only) — locks the signal, reads the latest event,
//      and queries aliases/accounts/people to build a deterministic
//      AccountPlan/PersonPlan. Never inserts anything.
//   2. APPLY (writes) — runs ONLY when the planned binding is not
//      semantically equivalent to the latest event. A pure replay
//      performs zero INSERT/UPDATE/DELETE statements beyond the initial
//      SELECT ... FOR UPDATE lock (which itself mutates nothing).
//
// Legacy/bootstrap compatibility: accounts.ts predates this unit and
// artifacts/api-server/src/scripts/bootstrapProductionData.ts seeds
// accounts with account_key="dom:<domain>" and company_domain set, but
// never an account_aliases row. Account planning therefore also matches
// directly against accounts.account_key/company_domain for a supplied
// domain (see planAccountResolution) — never just account_aliases —
// so this resolver reuses (and backfills aliases onto) those rows
// instead of creating a duplicate canonical account.
//
// SELECT ... FOR UPDATE on the signal row is the per-signal
// serialization lock — never the account row, since an anonymous,
// name-only, or conflicting signal may resolve to no account at all.
// Cross-signal races (two different signals concurrently creating the
// same new account/person) are resolved by the database's own unique
// constraints: this service always attempts the write first, and a
// small bounded retry loop re-plans and converges on the winner when a
// known unique-violation constraint (or a transient deadlock) fires —
// the same insert-first shape ../services/signals.ts and
// ../services/accountFacts.ts already use.
//
// Only imports from @workspace/db/schema and @workspace/identity, never
// @workspace/db itself — the database instance is always received via
// explicit injection, mirroring every other service in this package.

import { createHash } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  accounts,
  accountAliases,
  accountPeople,
  people,
  signals,
  identityResolutionEvents,
  type Account,
  type AccountAlias,
  type IdentityResolutionEvent,
} from "@workspace/db/schema";
import {
  NormalizedSignalV1Schema,
  type SignalCompanyV1,
  type SignalPersonV1,
  type SignalResolutionLevelV1,
} from "@workspace/identity";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — structurally the same query-builder surface as Db, but a
// distinct drizzle-orm class, so helpers that accept either must use
// this rather than Db itself.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const RESOLVER_VERSION = "identity-resolver-v1";

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Deliberately carries no dynamic payload — this is an infrastructure
// inconsistency (Unit 2 already validated normalized_payload before
// insert; signals is append-only, so it cannot have degraded since), not
// a business outcome this schema's outcome enum has a slot for.
export class CorruptSignalPayloadError extends Error {
  constructor(signalId: string) {
    super(
      `identityResolution: stored normalized_payload for signal ${signalId} failed schema validation.`,
    );
    this.name = "CorruptSignalPayloadError";
  }
}

// ---------------------------------------------------------------------
// Constraint-violation / deadlock detection — local copy of the same
// walk ../services/accountFacts.ts and ../services/signals.ts each
// already carry (this repo's convention is a small localized copy per
// call site, not a shared cross-domain utility), extended to also
// surface a bare SQLSTATE with no constraint name (needed for deadlocks,
// which carry no specific constraint).
// ---------------------------------------------------------------------

const MAX_ERROR_CAUSE_DEPTH = 5;

interface PgConstraintErrorInfo {
  code: string;
  constraint: string | null;
}

function findPgConstraintErrorInfo(err: unknown): PgConstraintErrorInfo | null {
  const visited = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : null,
      };
    }

    current = candidate.cause;
  }
  return null;
}

// The only 23505 unique-violations that genuinely mean "a competing
// resolution already happened" — every one of them fires on the exact
// insert that decides whether *this* attempt is the winner of a
// cross-signal create race. Any other constraint violation is a real bug
// and must propagate unchanged, never be reinterpreted as a race.
const KNOWN_RACE_VIOLATION_CONSTRAINTS = new Set([
  "accounts_account_key_unique",
  "account_aliases_strong_type_normalized_value_uq",
  "people_work_email_uq",
  "people_external_id_source_id_uq",
]);

// A deadlock has no single "losing constraint" — it's a lock-ordering
// cycle between two transactions, one of which Postgres kills outright.
// Since this resolver's only real deadlock exposure is exactly the kind
// of legitimate cross-signal creation race the constraint list above
// already treats as retryable, a bounded retry is the correct response
// here too — never for any other SQLSTATE.
const POSTGRES_DEADLOCK_DETECTED = "40P01";

function isKnownRaceViolation(err: unknown): boolean {
  const info = findPgConstraintErrorInfo(err);
  if (!info) return false;
  if (info.code === POSTGRES_DEADLOCK_DETECTED) return true;
  return info.code === "23505" && info.constraint !== null && KNOWN_RACE_VIOLATION_CONSTRAINTS.has(info.constraint);
}

// ---------------------------------------------------------------------
// Pure helpers — identifier collection, key/token construction. No db
// access; each is independently unit-testable. Every collection here is
// returned in a fixed, deterministic order (never raw JSON/object key
// iteration order) so multi-row inserts derived from them acquire
// unique-index locks in the same order across concurrent transactions,
// reducing deadlock risk (see isKnownRaceViolation above for the
// remaining, now-retryable exposure).
// ---------------------------------------------------------------------

export function canonicalSourceKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface CompanyIdentifierPair {
  aliasType: string;
  normalizedValue: string;
  rawValue: string;
  identifierType: "domain" | "external_id";
  source?: string;
}

function comparePairs(a: CompanyIdentifierPair, b: CompanyIdentifierPair): number {
  return (
    a.aliasType.localeCompare(b.aliasType) ||
    a.normalizedValue.localeCompare(b.normalizedValue) ||
    a.rawValue.localeCompare(b.rawValue)
  );
}

/** Every strong company identifier the signal carries, sorted deterministically (aliasType, then normalizedValue, then rawValue) — company.name is deliberately never included, per Core Rule 2 (company-name-only must never auto-bind). */
export function buildCompanyIdentifierPairs(company: SignalCompanyV1): CompanyIdentifierPair[] {
  const pairs: CompanyIdentifierPair[] = [];
  if (company.domain) {
    pairs.push({ aliasType: "domain", normalizedValue: company.domain, rawValue: company.domain, identifierType: "domain" });
  }
  for (const [rawSource, value] of Object.entries(company.externalIds)) {
    const source = canonicalSourceKey(rawSource);
    pairs.push({
      aliasType: `external_id:${source}`,
      normalizedValue: value,
      rawValue: value,
      identifierType: "external_id",
      source,
    });
  }
  return pairs.sort(comparePairs);
}

/**
 * Collision-safe, delimiter-free, fixed-length key for an external-only
 * account — SHA-256 over the JSON-encoded (canonicalSource, externalId)
 * tuple, exactly mirroring @workspace/identity's own
 * buildSignalDedupeKey (JSON.stringify, not raw string concatenation,
 * so neither input's content can make two different pairs collide).
 * Independent of provider value length and never exposes the raw
 * source/external-ID value in the key itself — those remain visible
 * only on the strong account_aliases row, the actual identity
 * authority.
 */
export function buildExternalAccountKey(canonicalSource: string, externalId: string): string {
  const canonical = JSON.stringify([canonicalSource, externalId]);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `ext:v1:${hash}`;
}

/**
 * account_key construction: `dom:<normalized-domain>` when a domain
 * exists — the pre-existing repository convention (see
 * bootstrapProductionData.ts), not a bare domain — otherwise
 * `buildExternalAccountKey` over the external ID whose source key
 * matches the signal's own source, or (when several external IDs exist
 * and none aligns) the lexicographically-first source key. account_key
 * is a human-legible label only — strong account_aliases rows remain
 * the actual binding authority, never this key.
 */
export function buildAccountKey(
  domain: string | null,
  externalIds: Record<string, string>,
  signalSource: string,
): string {
  if (domain) return `dom:${domain}`;

  const entries = Object.entries(externalIds)
    .map(([rawSource, value]) => ({ source: canonicalSourceKey(rawSource), value }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.value.localeCompare(b.value));
  const canonicalSignalSource = canonicalSourceKey(signalSource);
  const aligned = entries.find((e) => e.source === canonicalSignalSource);
  const chosen = aligned ?? entries[0];
  if (!chosen) {
    throw new Error("buildAccountKey: no domain or external identifier available.");
  }
  return buildExternalAccountKey(chosen.source, chosen.value);
}

/**
 * The single external_id/external_id_source pair a new/matched person row
 * may persist, given people's current schema only stores one pair (see
 * lib/db/src/schema/people.ts). Prefers the entry whose source matches
 * the signal's own source; if exactly one entry exists at all, uses it
 * regardless of source; otherwise (multiple entries, none aligned)
 * returns null — deliberately not an arbitrary pick, per Core Rule 2.
 * Entries are sorted deterministically before selection.
 */
export function selectPersonExternalIdForPersistence(
  signalSource: string,
  externalIds: Record<string, string>,
): { source: string; value: string } | null {
  const entries = Object.entries(externalIds)
    .map(([rawSource, value]) => ({ source: canonicalSourceKey(rawSource), value }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.value.localeCompare(b.value));
  if (entries.length === 0) return null;

  const canonicalSignalSource = canonicalSourceKey(signalSource);
  const aligned = entries.find((e) => e.source === canonicalSignalSource);
  if (aligned) return aligned;
  if (entries.length === 1) return entries[0]!;
  return null;
}

// ---------------------------------------------------------------------
// candidateMatches — structured, non-PII conflict evidence only.
// ---------------------------------------------------------------------

export interface CandidateMatch {
  entityType: "account" | "person";
  identifierType: "domain" | "external_id" | "work_email";
  matchedId: string;
  source?: string;
}

/**
 * Merges alias-table candidates with legacy/bootstrap direct-account
 * candidates (accounts matched by account_key/company_domain with no
 * alias row at all) into one deduplicated, deterministically-ordered
 * candidate list. Direct-account candidates are always domain-shaped,
 * since the compatibility lookup itself is domain-only.
 */
function buildAccountConflictCandidates(aliasRows: AccountAlias[], directRows: Account[]): CandidateMatch[] {
  const byAccount = new Map<string, CandidateMatch>();
  for (const row of aliasRows) {
    const isDomain = row.aliasType === "domain";
    const candidate: CandidateMatch = {
      entityType: "account",
      identifierType: isDomain ? "domain" : "external_id",
      matchedId: row.accountId,
      ...(isDomain ? {} : { source: row.aliasType.slice("external_id:".length) }),
    };
    const existing = byAccount.get(row.accountId);
    if (!existing || (isDomain && existing.identifierType !== "domain")) {
      byAccount.set(row.accountId, candidate);
    }
  }
  for (const row of directRows) {
    if (!byAccount.has(row.id)) {
      byAccount.set(row.id, { entityType: "account", identifierType: "domain", matchedId: row.id });
    }
  }
  return [...byAccount.values()].sort((a, b) => a.matchedId.localeCompare(b.matchedId));
}

interface PersonMatchRow {
  personId: string;
  kind: "work_email" | "external_id";
  source?: string;
}

function buildPersonConflictCandidates(matches: PersonMatchRow[]): CandidateMatch[] {
  const byPerson = new Map<string, PersonMatchRow>();
  for (const m of matches) {
    const existing = byPerson.get(m.personId);
    if (!existing || (m.kind === "work_email" && existing.kind !== "work_email")) {
      byPerson.set(m.personId, m);
    }
  }
  return [...byPerson.entries()]
    .map(([personId, m]): CandidateMatch => ({
      entityType: "person",
      identifierType: m.kind === "work_email" ? "work_email" : "external_id",
      matchedId: personId,
      ...(m.kind === "external_id" && m.source ? { source: m.source } : {}),
    }))
    .sort((a, b) => a.matchedId.localeCompare(b.matchedId));
}

function extractCandidateIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) =>
      v && typeof v === "object" && "matchedId" in v ? String((v as { matchedId: unknown }).matchedId) : null,
    )
    .filter((v): v is string => v !== null)
    .sort();
}

// ---------------------------------------------------------------------
// Finalized resolution shapes — used both for the pre-apply replay
// equivalence check (when nothing needs creating) and for the final
// event composed after APPLY. Unchanged shape/semantics from before this
// correction: outcome/resolutionLevel/accountId/personId are the only
// fields real-ID equivalence ever hinges on for resolved outcomes.
// ---------------------------------------------------------------------

export type AccountResolution =
  | {
      outcome: "unresolved";
      reasonToken: "no_strong_company_identity" | "account_identifier_conflict";
      candidateMatches: CandidateMatch[] | null;
    }
  | {
      outcome: "resolved";
      accountId: string;
      matchAction: "matched" | "created";
      methodToken: "account_domain" | "account_external_id" | "account_created";
    };

export type PersonResolution =
  | { attempted: false }
  | {
      attempted: true;
      outcome: "unresolved";
      reasonToken: "no_strong_person_identity" | "person_identifier_conflict";
      candidateMatches: CandidateMatch[] | null;
    }
  | {
      attempted: true;
      outcome: "resolved";
      personId: string;
      matchAction: "matched" | "created";
      methodToken: "person_work_email" | "person_external_id" | "person_created";
    };

export interface ComputedBinding {
  outcome: "unresolved" | "account_resolved" | "person_resolved";
  resolutionLevel: "anonymous" | "company" | "contact" | "known_crm_contact";
  accountId: string | null;
  accountMatchAction: "matched" | "created" | null;
  personId: string | null;
  personMatchAction: "matched" | "created" | null;
  resolutionMethod: string;
  reason: string | null;
  candidateMatches: CandidateMatch[] | null;
  confidence: "low" | "high";
}

export function composeBinding(
  accountResolution: AccountResolution,
  personResolution: PersonResolution,
  observedResolutionLevel: SignalResolutionLevelV1,
): ComputedBinding {
  if (accountResolution.outcome === "unresolved") {
    return {
      outcome: "unresolved",
      resolutionLevel: "anonymous",
      accountId: null,
      accountMatchAction: null,
      personId: null,
      personMatchAction: null,
      resolutionMethod: accountResolution.reasonToken,
      reason: accountResolution.reasonToken,
      candidateMatches: accountResolution.candidateMatches,
      confidence: "low",
    };
  }

  const { accountId, matchAction: accountMatchAction, methodToken: accountToken } = accountResolution;

  if (!personResolution.attempted) {
    return {
      outcome: "account_resolved",
      resolutionLevel: "company",
      accountId,
      accountMatchAction,
      personId: null,
      personMatchAction: null,
      resolutionMethod: accountToken,
      reason: null,
      candidateMatches: null,
      confidence: "high",
    };
  }

  if (personResolution.outcome === "unresolved") {
    return {
      outcome: "account_resolved",
      resolutionLevel: "company",
      accountId,
      accountMatchAction,
      personId: null,
      personMatchAction: null,
      resolutionMethod: `${accountToken}+${personResolution.reasonToken}`,
      reason: personResolution.reasonToken,
      candidateMatches: personResolution.candidateMatches,
      confidence: "high",
    };
  }

  return {
    outcome: "person_resolved",
    resolutionLevel: observedResolutionLevel === "known_crm_contact" ? "known_crm_contact" : "contact",
    accountId,
    accountMatchAction,
    personId: personResolution.personId,
    personMatchAction: personResolution.matchAction,
    resolutionMethod: `${accountToken}+${personResolution.methodToken}`,
    reason: null,
    candidateMatches: null,
    confidence: "high",
  };
}

// ---------------------------------------------------------------------
// Idempotency equivalence
// ---------------------------------------------------------------------

/**
 * Semantic equivalence between the latest persisted event and a freshly
 * computed binding — deliberately ignores accountMatchAction/
 * personMatchAction (a first run may record "created" while an identical
 * recomputation naturally sees "matched"; that difference alone must
 * never append a duplicate event). For resolved outcomes (account_
 * resolved/person_resolved), only outcome/resolutionLevel/accountId/
 * personId are compared. For unresolved outcomes, the stable reason
 * token and the set of candidate ids are compared too, so a genuinely
 * changed conflict/candidate set still appends a new event.
 */
export function isSemanticallyEquivalent(
  latest: Pick<IdentityResolutionEvent, "outcome" | "resolutionLevel" | "accountId" | "personId" | "reason" | "candidateMatches">,
  candidate: ComputedBinding,
): boolean {
  if (latest.outcome !== candidate.outcome) return false;
  if (latest.resolutionLevel !== candidate.resolutionLevel) return false;
  if (latest.accountId !== candidate.accountId) return false;
  if (latest.personId !== candidate.personId) return false;

  if (candidate.outcome === "unresolved") {
    if (latest.reason !== candidate.reason) return false;
    const latestIds = extractCandidateIds(latest.candidateMatches);
    const candidateIds = extractCandidateIds(candidate.candidateMatches);
    if (latestIds.length !== candidateIds.length) return false;
    if (!latestIds.every((id, i) => id === candidateIds[i])) return false;
  }

  return true;
}

// ---------------------------------------------------------------------
// PLANNING (read-only) — account
// ---------------------------------------------------------------------

export type AccountPlan =
  | {
      outcome: "unresolved";
      reasonToken: "no_strong_company_identity" | "account_identifier_conflict";
      candidateMatches: CandidateMatch[] | null;
    }
  | {
      outcome: "matched";
      accountId: string;
      methodToken: "account_domain" | "account_external_id";
      missingAliasPairs: CompanyIdentifierPair[];
    }
  | {
      outcome: "create";
      accountKey: string;
      companyDomain: string | null;
      companyName: string | null;
      aliasPairs: CompanyIdentifierPair[];
      methodToken: "account_created";
    };

function aliasPairKey(aliasType: string, normalizedValue: string): string {
  return `${aliasType} ${normalizedValue}`;
}

function aliasInsertValues(accountId: string, pair: CompanyIdentifierPair, signalSource: string) {
  return {
    accountId,
    aliasType: pair.aliasType,
    rawValue: pair.rawValue,
    normalizedValue: pair.normalizedValue,
    normalizationStrategy: pair.identifierType === "domain" ? ("domain" as const) : ("exact" as const),
    isStrong: true,
    source: signalSource,
  };
}

/**
 * Read-only: never inserts anything. Evaluates every strong-alias match
 * PLUS (when a domain is supplied) a direct accounts.account_key/
 * company_domain lookup — the legacy/bootstrap compatibility path (see
 * this file's module comment) — before deciding match vs. create.
 * Deduplicates every candidate account id from both sources; more than
 * one distinct id (whether alias-vs-alias or alias-vs-direct) is an
 * account_identifier_conflict, never a guess.
 */
async function planAccountResolution(
  tx: Tx,
  company: SignalCompanyV1,
  signalSource: string,
): Promise<AccountPlan> {
  const pairs = buildCompanyIdentifierPairs(company);
  if (pairs.length === 0) {
    return { outcome: "unresolved", reasonToken: "no_strong_company_identity", candidateMatches: null };
  }

  const aliasRows = await tx
    .select()
    .from(accountAliases)
    .where(
      and(
        eq(accountAliases.isStrong, true),
        or(
          ...pairs.map((p) =>
            and(eq(accountAliases.aliasType, p.aliasType), eq(accountAliases.normalizedValue, p.normalizedValue)),
          ),
        ),
      ),
    );

  let directRows: Account[] = [];
  if (company.domain) {
    const domain = company.domain;
    directRows = await tx
      .select()
      .from(accounts)
      .where(or(eq(accounts.accountKey, `dom:${domain}`), eq(accounts.accountKey, domain), eq(accounts.companyDomain, domain)));
  }

  const distinctAccountIds = new Set<string>([
    ...aliasRows.map((r) => r.accountId),
    ...directRows.map((r) => r.id),
  ]);

  if (distinctAccountIds.size > 1) {
    return {
      outcome: "unresolved",
      reasonToken: "account_identifier_conflict",
      candidateMatches: buildAccountConflictCandidates(aliasRows, directRows),
    };
  }

  if (distinctAccountIds.size === 1) {
    const accountId = [...distinctAccountIds][0]!;
    const methodToken =
      directRows.length > 0 || aliasRows.some((r) => r.aliasType === "domain") ? "account_domain" : "account_external_id";

    const matchedKeys = new Set(aliasRows.map((r) => aliasPairKey(r.aliasType, r.normalizedValue)));
    const missingAliasPairs = pairs.filter((p) => !matchedKeys.has(aliasPairKey(p.aliasType, p.normalizedValue)));

    return { outcome: "matched", accountId, methodToken, missingAliasPairs };
  }

  // No candidate at all — create. Any unique-violation (or deadlock) on
  // the writes this plan implies is a genuine cross-signal race,
  // deliberately left uncaught here so it propagates out of the whole
  // transaction — see resolveSignal's retry loop.
  const accountKey = buildAccountKey(company.domain, company.externalIds, signalSource);
  return {
    outcome: "create",
    accountKey,
    companyDomain: company.domain,
    companyName: company.name,
    aliasPairs: pairs,
    methodToken: "account_created",
  };
}

// ---------------------------------------------------------------------
// PLANNING (read-only) — person. Attempted only when the caller already
// resolved (matched or planned-to-create) an account.
// ---------------------------------------------------------------------

export type PersonPlan =
  | { attempted: false }
  | {
      attempted: true;
      outcome: "unresolved";
      reasonToken: "no_strong_person_identity" | "person_identifier_conflict";
      candidateMatches: CandidateMatch[] | null;
    }
  | {
      attempted: true;
      outcome: "matched";
      personId: string;
      methodToken: "person_work_email" | "person_external_id";
    }
  | {
      attempted: true;
      outcome: "create";
      fullName: string | null;
      workEmail: string | null;
      linkedinUrl: string | null;
      externalId: string | null;
      externalIdSource: string | null;
      methodToken: "person_created";
    };

async function planPersonResolution(tx: Tx, person: SignalPersonV1, signalSource: string): Promise<PersonPlan> {
  const workEmail = person.workEmail;
  const externalIdEntries = Object.entries(person.externalIds)
    .map(([rawSource, value]) => ({ source: canonicalSourceKey(rawSource), value }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.value.localeCompare(b.value));

  if (!workEmail && externalIdEntries.length === 0) {
    // fullName/linkedinUrl-only (or a fully empty person object, which
    // the NormalizedSignalV1 contract itself already forbids) — context
    // only, never sole authority.
    return { attempted: true, outcome: "unresolved", reasonToken: "no_strong_person_identity", candidateMatches: null };
  }

  const conditions = [
    ...(workEmail ? [eq(people.workEmail, workEmail)] : []),
    ...externalIdEntries.map((e) => and(eq(people.externalIdSource, e.source), eq(people.externalId, e.value))),
  ];
  const rows = await tx.select().from(people).where(or(...conditions));

  const matches: PersonMatchRow[] = [];
  for (const row of rows) {
    if (workEmail && row.workEmail === workEmail) {
      matches.push({ personId: row.id, kind: "work_email" });
    } else if (row.externalIdSource !== null && row.externalId !== null) {
      matches.push({ personId: row.id, kind: "external_id", source: row.externalIdSource });
    }
  }

  const distinctPersonIds = new Set(matches.map((m) => m.personId));

  if (distinctPersonIds.size > 1) {
    return {
      attempted: true,
      outcome: "unresolved",
      reasonToken: "person_identifier_conflict",
      candidateMatches: buildPersonConflictCandidates(matches),
    };
  }

  if (distinctPersonIds.size === 1) {
    const personId = [...distinctPersonIds][0]!;
    const methodToken = matches.some((m) => m.kind === "work_email") ? "person_work_email" : "person_external_id";
    return { attempted: true, outcome: "matched", personId, methodToken };
  }

  // No existing match. The single external_id/external_id_source pair
  // people currently supports is the reason a multi-external-ID,
  // no-email signal with none aligned to the signal's own source cannot
  // deterministically plan a creation (rather than silently dropping
  // evidence by picking one arbitrarily).
  const selected = selectPersonExternalIdForPersistence(signalSource, person.externalIds);
  if (!workEmail && !selected) {
    return { attempted: true, outcome: "unresolved", reasonToken: "no_strong_person_identity", candidateMatches: null };
  }

  return {
    attempted: true,
    outcome: "create",
    fullName: person.fullName,
    workEmail,
    linkedinUrl: person.linkedinUrl,
    externalId: selected?.value ?? null,
    externalIdSource: selected?.source ?? null,
    methodToken: "person_created",
  };
}

// ---------------------------------------------------------------------
// Finalizing a plan into a real AccountResolution/PersonResolution —
// used both for the pre-apply replay check (matched/unresolved plans
// only — see attemptResolve) and for the post-apply final event (any
// plan, using the id APPLY actually produced or matched).
// ---------------------------------------------------------------------

function finalizeAccountResolution(
  plan: Extract<AccountPlan, { outcome: "matched" } | { outcome: "create" }>,
  accountId: string,
): AccountResolution {
  return {
    outcome: "resolved",
    accountId,
    matchAction: plan.outcome === "create" ? "created" : "matched",
    methodToken: plan.outcome === "create" ? "account_created" : plan.methodToken,
  };
}

function finalizePersonResolution(
  plan: Extract<PersonPlan, { outcome: "matched" } | { outcome: "create" }>,
  personId: string,
): PersonResolution {
  return {
    attempted: true,
    outcome: "resolved",
    personId,
    matchAction: plan.outcome === "create" ? "created" : "matched",
    methodToken: plan.outcome === "create" ? "person_created" : plan.methodToken,
  };
}

// ---------------------------------------------------------------------
// Test-only hooks — no production behavior change. The HTTP route never
// supplies these (see ../routes/signalResolution.ts, whose
// ResolveSignalFn signature carries no hooks parameter at all); they
// exist solely so an integration test can force genuine, deterministic
// overlap between two concurrent resolveSignal() calls instead of
// relying on incidental timing. They cannot alter resolver inputs or
// outputs — each is a bare notify/await point, never given the ability
// to change any value the resolver reads or writes.
// ---------------------------------------------------------------------

export interface ResolveSignalTestHooks {
  /** Invoked immediately after the signal row's SELECT ... FOR UPDATE succeeds, before anything else — lets a test pause a transaction while it still holds the lock. */
  afterSignalLock?: (signalId: string) => Promise<void>;
  /** Invoked immediately before a brand-new account (and its aliases) is inserted. */
  beforeAccountAliasInsert?: () => Promise<void>;
  /** Invoked immediately before a brand-new person is inserted. */
  beforePersonInsert?: () => Promise<void>;
}

// ---------------------------------------------------------------------
// APPLY (writes) — account
// ---------------------------------------------------------------------

async function applyAccountPlan(
  tx: Tx,
  plan: AccountPlan,
  signalSource: string,
  hooks: ResolveSignalTestHooks,
): Promise<{ accountId: string | null; resolution: AccountResolution }> {
  if (plan.outcome === "unresolved") {
    return {
      accountId: null,
      resolution: { outcome: "unresolved", reasonToken: plan.reasonToken, candidateMatches: plan.candidateMatches },
    };
  }

  if (plan.outcome === "matched") {
    if (plan.missingAliasPairs.length > 0) {
      await tx
        .insert(accountAliases)
        .values(plan.missingAliasPairs.map((p) => aliasInsertValues(plan.accountId, p, signalSource)))
        .onConflictDoNothing({
          target: [accountAliases.aliasType, accountAliases.normalizedValue],
          where: sql`${accountAliases.isStrong} = true`,
        });
    }
    return { accountId: plan.accountId, resolution: finalizeAccountResolution(plan, plan.accountId) };
  }

  // plan.outcome === "create"
  await hooks.beforeAccountAliasInsert?.();
  const [createdAccount] = await tx
    .insert(accounts)
    .values({ accountKey: plan.accountKey, companyDomain: plan.companyDomain, companyName: plan.companyName })
    .returning();
  if (!createdAccount) {
    throw new Error("identityResolution: insert into accounts returned no row.");
  }
  await tx.insert(accountAliases).values(plan.aliasPairs.map((p) => aliasInsertValues(createdAccount.id, p, signalSource)));

  return { accountId: createdAccount.id, resolution: finalizeAccountResolution(plan, createdAccount.id) };
}

// ---------------------------------------------------------------------
// APPLY (writes) — person
// ---------------------------------------------------------------------

async function applyPersonPlan(
  tx: Tx,
  plan: PersonPlan,
  hooks: ResolveSignalTestHooks,
): Promise<{ personId: string | null; resolution: PersonResolution }> {
  if (!plan.attempted) {
    return { personId: null, resolution: { attempted: false } };
  }
  if (plan.outcome === "unresolved") {
    return {
      personId: null,
      resolution: { attempted: true, outcome: "unresolved", reasonToken: plan.reasonToken, candidateMatches: plan.candidateMatches },
    };
  }
  if (plan.outcome === "matched") {
    return { personId: plan.personId, resolution: finalizePersonResolution(plan, plan.personId) };
  }

  // plan.outcome === "create"
  await hooks.beforePersonInsert?.();
  const [createdPerson] = await tx
    .insert(people)
    .values({
      fullName: plan.fullName,
      workEmail: plan.workEmail,
      linkedinUrl: plan.linkedinUrl,
      externalId: plan.externalId,
      externalIdSource: plan.externalIdSource,
    })
    .returning();
  if (!createdPerson) {
    throw new Error("identityResolution: insert into people returned no row.");
  }

  return { personId: createdPerson.id, resolution: finalizePersonResolution(plan, createdPerson.id) };
}

// ---------------------------------------------------------------------
// account_people upsert
// ---------------------------------------------------------------------

async function upsertAccountPerson(
  tx: Tx,
  args: { accountId: string; personId: string; title: string | null; source: string },
): Promise<void> {
  const { accountId, personId, title, source } = args;
  await tx
    .insert(accountPeople)
    .values({ accountId, personId, title, isCurrent: true, source })
    .onConflictDoUpdate({
      target: [accountPeople.accountId, accountPeople.personId],
      set: {
        lastSeenAt: sql`now()`,
        isCurrent: true,
        ...(title !== null ? { title } : {}),
      },
    });
}

// ---------------------------------------------------------------------
// Single attempt — one transaction: lock the signal, plan (read-only),
// decide replay-vs-apply, then (only if not replaying) apply and append.
// ---------------------------------------------------------------------

export type ResolveSignalResult =
  | { kind: "signal_not_found" }
  | { kind: "completed"; status: "resolved" | "replayed"; event: IdentityResolutionEvent };

async function attemptResolve(
  tx: Tx,
  signalId: string,
  hooks: ResolveSignalTestHooks,
): Promise<ResolveSignalResult> {
  // The per-signal serialization lock — never the account row, since an
  // anonymous/name-only/conflicting signal may resolve to no account at
  // all. Does not mutate the signal; it only serializes concurrent
  // resolution transactions for this one signal.
  const [signalRow] = await tx.select().from(signals).where(eq(signals.id, signalId)).for("update");
  if (!signalRow) {
    return { kind: "signal_not_found" };
  }

  await hooks.afterSignalLock?.(signalId);

  const [latestEvent] = await tx
    .select()
    .from(identityResolutionEvents)
    .where(eq(identityResolutionEvents.signalId, signalId))
    .orderBy(desc(identityResolutionEvents.createdAt), desc(identityResolutionEvents.id))
    .limit(1);

  const parsed = NormalizedSignalV1Schema.safeParse(signalRow.normalizedPayload);
  if (!parsed.success) {
    throw new CorruptSignalPayloadError(signalId);
  }
  const canonicalSignal = parsed.data;
  const signalSource = canonicalSignal.source;

  // ---- PLANNING (read-only; no writes below this point until APPLY) ----
  const accountPlan = await planAccountResolution(tx, canonicalSignal.company, signalSource);

  let personPlan: PersonPlan = { attempted: false };
  if (accountPlan.outcome !== "unresolved" && canonicalSignal.person !== null) {
    personPlan = await planPersonResolution(tx, canonicalSignal.person, signalSource);
  }

  // A plan that requires creating a brand-new account or person has no
  // real id yet, so it can never be proven equivalent to an existing
  // event — apply unconditionally rather than attempt a comparison with
  // a placeholder id.
  const forceApply = accountPlan.outcome === "create" || (personPlan.attempted && personPlan.outcome === "create");

  if (!forceApply) {
    let accountResolution: AccountResolution;
    if (accountPlan.outcome === "unresolved") {
      accountResolution = { outcome: "unresolved", reasonToken: accountPlan.reasonToken, candidateMatches: accountPlan.candidateMatches };
    } else if (accountPlan.outcome === "matched") {
      accountResolution = finalizeAccountResolution(accountPlan, accountPlan.accountId);
    } else {
      throw new Error("identityResolution: unreachable — forceApply must be true for a create plan.");
    }

    let personResolution: PersonResolution;
    if (!personPlan.attempted) {
      personResolution = { attempted: false };
    } else if (personPlan.outcome === "unresolved") {
      personResolution = { attempted: true, outcome: "unresolved", reasonToken: personPlan.reasonToken, candidateMatches: personPlan.candidateMatches };
    } else if (personPlan.outcome === "matched") {
      personResolution = finalizePersonResolution(personPlan, personPlan.personId);
    } else {
      throw new Error("identityResolution: unreachable — forceApply must be true for a create plan.");
    }

    const candidateBinding = composeBinding(accountResolution, personResolution, canonicalSignal.observedResolutionLevel);

    if (latestEvent && isSemanticallyEquivalent(latestEvent, candidateBinding)) {
      // Pure replay: no INSERT/UPDATE/DELETE below this point in this
      // attempt — aliases are not backfilled, account_people is not
      // touched, and no event is appended.
      return { kind: "completed", status: "replayed", event: latestEvent };
    }
  }

  // ---- APPLY (writes) — reached only when a new event will actually be appended ----
  const { accountId, resolution: accountResolutionFinal } = await applyAccountPlan(tx, accountPlan, signalSource, hooks);

  let personId: string | null = null;
  let personResolutionFinal: PersonResolution = { attempted: false };
  if (personPlan.attempted) {
    const applied = await applyPersonPlan(tx, personPlan, hooks);
    personId = applied.personId;
    personResolutionFinal = applied.resolution;
  }

  if (accountId !== null && personId !== null) {
    const title = canonicalSignal.person?.title?.trim() || null;
    await upsertAccountPerson(tx, { accountId, personId, title, source: signalSource });
  }

  const finalBinding = composeBinding(accountResolutionFinal, personResolutionFinal, canonicalSignal.observedResolutionLevel);

  const [inserted] = await tx
    .insert(identityResolutionEvents)
    .values({
      signalId,
      outcome: finalBinding.outcome,
      resolutionLevel: finalBinding.resolutionLevel,
      resolutionMethod: finalBinding.resolutionMethod,
      confidence: finalBinding.confidence,
      resolverVersion: RESOLVER_VERSION,
      candidateMatches: finalBinding.candidateMatches,
      accountId: finalBinding.accountId,
      accountMatchAction: finalBinding.accountMatchAction,
      personId: finalBinding.personId,
      personMatchAction: finalBinding.personMatchAction,
      reason: finalBinding.reason,
    })
    .returning();
  if (!inserted) {
    throw new Error("identityResolution: insert into identity_resolution_events returned no row.");
  }

  return { kind: "completed", status: "resolved", event: inserted };
}

// ---------------------------------------------------------------------
// Public entry point — bounded cross-signal race retry around one
// transaction attempt each time.
// ---------------------------------------------------------------------

const MAX_RESOLUTION_ATTEMPTS = 5;

export interface ResolveSignalArgs {
  db: Db;
  signalId: string;
  /** Test-only override for the bounded retry count; defaults to MAX_RESOLUTION_ATTEMPTS. */
  maxAttempts?: number;
  /** Test-only hooks (see ResolveSignalTestHooks) — never supplied by production callers. */
  testHooks?: ResolveSignalTestHooks;
}

/**
 * Resolves one signal into a canonical account/person binding. Each
 * attempt runs entirely inside its own transaction (see attemptResolve);
 * a caught known-unique-violation or deadlock (see isKnownRaceViolation)
 * rolls that attempt back completely — no orphan account/alias/person is
 * ever left behind — and retries in a small bounded loop, re-planning
 * from fresh reads each time, until it either converges on the winner of
 * the race or (having exhausted its attempts) rethrows. Any other error
 * is never treated as a race and propagates immediately.
 */
export async function resolveSignal(args: ResolveSignalArgs): Promise<ResolveSignalResult> {
  const { db, signalId, maxAttempts = MAX_RESOLUTION_ATTEMPTS, testHooks = {} } = args;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction((tx) => attemptResolve(tx, signalId, testHooks));
    } catch (err) {
      if (isKnownRaceViolation(err) && attempt < maxAttempts) {
        continue;
      }
      throw err;
    }
  }

  // Unreachable — the loop above always returns or throws.
  throw new Error("identityResolution: resolution attempts exhausted unexpectedly.");
}
