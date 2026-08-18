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

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  accountPeople,
  people,
  signals,
  identityResolutionEvents,
  type IdentityResolutionEvent,
} from "@workspace/db/schema";
import {
  NormalizedSignalV1Schema,
  type SignalPersonV1,
  type SignalResolutionLevelV1,
} from "@workspace/identity";
import {
  applyCanonicalAccountResolutionPlan,
  canonicalSourceKey,
  finalizeCanonicalAccountResolution,
  planCanonicalAccountResolution,
  type AccountCandidateMatch,
  type AccountPlan,
  type AccountResolution,
} from "./canonicalAccountResolution.js";

export {
  buildAccountKey,
  buildCompanyIdentifierPairs,
  buildExternalAccountKey,
  canonicalSourceKey,
  type AccountPlan,
  type AccountResolution,
  type CompanyIdentifierPair,
} from "./canonicalAccountResolution.js";

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
// Pure person helper. Provider-neutral account helpers now live in
// ./canonicalAccountResolution.ts and are re-exported above to preserve
// this module's existing public surface.
// ---------------------------------------------------------------------

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

export interface PersonCandidateMatch {
  entityType: "person";
  identifierType: "external_id" | "work_email";
  matchedId: string;
  source?: string;
}
export type CandidateMatch = AccountCandidateMatch | PersonCandidateMatch;

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
    .map(([personId, m]): PersonCandidateMatch => ({
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
  const accountPlan = await planCanonicalAccountResolution(
    tx,
    canonicalSignal.company,
    signalSource,
  );

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
      accountResolution = finalizeCanonicalAccountResolution(accountPlan, accountPlan.accountId);
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
  const { accountId, resolution: accountResolutionFinal } =
    await applyCanonicalAccountResolutionPlan(tx, accountPlan, signalSource, hooks);

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

// ---------------------------------------------------------------------
// Current-binding read model (read-only) — GTM V2 Stage 2 Unit 4.
//
// The "current identity binding" for a signal is never stored by
// mutating anything (signals and identity_resolution_events are both
// append-only by trigger regardless) — it is always derived, at read
// time, as the latest identity_resolution_events row for that signal,
// ordered by (created_at, id) exactly like attemptResolve's own latest-
// event lookup above, backed by the same
// identity_resolution_events_signal_id_created_at_id_idx index Unit 1
// already created for this purpose. No new table, column, or migration.
// ---------------------------------------------------------------------

export type CurrentIdentityBindingResult =
  | { kind: "signal_not_found" }
  | { kind: "no_binding" }
  | { kind: "bound"; event: IdentityResolutionEvent };

/**
 * Single-statement read: SELECT the signal LEFT JOIN LATERAL the latest
 * identity_resolution_events row for it (ordered created_at DESC, id
 * DESC, limit 1) — one round trip that distinguishes all three states a
 * single plain query cannot tell apart on its own: no signal row at all,
 * a signal row with zero events, and a signal row whose latest event is
 * the current binding. No transaction/lock is taken — this is a read
 * model, not a resolution attempt.
 */
export async function getCurrentIdentityBinding(
  db: Db,
  signalId: string,
): Promise<CurrentIdentityBindingResult> {
  const latestEventForSignal = db
    .select()
    .from(identityResolutionEvents)
    .where(eq(identityResolutionEvents.signalId, signals.id))
    .orderBy(desc(identityResolutionEvents.createdAt), desc(identityResolutionEvents.id))
    .limit(1)
    .as("latest_event");

  // Selects only signals.id (never raw_payload/normalized_payload/
  // company_domain/company_name/etc.) — an unqualified .select() here
  // would otherwise pull the entire signals row, including raw/
  // normalized payload content, out of Postgres on every read even
  // though this endpoint never uses it. The lateral side still selects
  // every identity_resolution_events column (mirrors resolveSignal's own
  // ResolveSignalResult, which likewise returns the full event row from
  // the service layer for the route layer to filter) — see
  // ../routes/signalResolution.ts's serializeEventFields for the actual
  // allow-listed HTTP response.
  const [row] = await db
    .select({
      signalId: signals.id,
      event: {
        id: latestEventForSignal.id,
        signalId: latestEventForSignal.signalId,
        outcome: latestEventForSignal.outcome,
        resolutionLevel: latestEventForSignal.resolutionLevel,
        resolutionMethod: latestEventForSignal.resolutionMethod,
        confidence: latestEventForSignal.confidence,
        resolverVersion: latestEventForSignal.resolverVersion,
        candidateMatches: latestEventForSignal.candidateMatches,
        accountId: latestEventForSignal.accountId,
        accountMatchAction: latestEventForSignal.accountMatchAction,
        personId: latestEventForSignal.personId,
        personMatchAction: latestEventForSignal.personMatchAction,
        matchedAliasType: latestEventForSignal.matchedAliasType,
        matchedAliasValue: latestEventForSignal.matchedAliasValue,
        reason: latestEventForSignal.reason,
        createdAt: latestEventForSignal.createdAt,
      },
    })
    .from(signals)
    .leftJoinLateral(latestEventForSignal, sql`true`)
    .where(eq(signals.id, signalId));

  if (!row) {
    return { kind: "signal_not_found" };
  }

  if (!row.event) {
    return { kind: "no_binding" };
  }

  return { kind: "bound", event: row.event };
}
