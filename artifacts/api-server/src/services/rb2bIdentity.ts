// M3.5 — RB2B live signal last-mile: Person/Account identity resolution
// for one already-mapped RB2B behavioral_signal observation payload.
//
// Deliberately reuses the SAME provider-neutral identity primitives
// every other identity path in this repo already uses — never a second
// account/person truth system:
//   - Account: planCanonicalAccountResolution / applyCanonicalAccountResolutionPlan
//     (./canonicalAccountResolution.ts) — the exact functions
//     ./hubSpotCompanyIdentity.ts already calls directly, with zero
//     `signals` table involvement.
//   - Person: planPersonResolution / applyPersonPlan / upsertAccountPerson
//     (./identityResolution.ts) — exported from that module specifically
//     so this file can call them directly, the same way
//     canonicalAccountResolution.ts's own functions are already shared
//     between identityResolution.ts and hubSpotCompanyIdentity.ts.
//
// This module never writes a `signals` row and never appends an
// `identity_resolution_events` row (that table's signal_id column is a
// NOT NULL FK to signals — structurally coupled to the legacy signal
// pipeline this module must not join). The persisted truth this module
// produces is exactly accounts / account_aliases / people / account_people
// — the same tables every other identity path already writes to. The
// binding OUTCOME (resolved/unresolved/conflict, for both account and
// person) is returned to the caller for logging/response visibility, not
// persisted as a second audit trail.
//
// Company-level RB2B events (no contact evidence at all) never attempt
// person resolution and never fabricate one — see buildRb2bPerson below.
// RB2B supplies no stable per-company or per-visitor external id in the
// current bridge contract (../services/rb2bObservationMapping.ts): domain
// is the only strong company identifier, work email is the only strong
// person identifier. Name/title/LinkedIn/phone are context only, exactly
// mirroring lib/identity's own SignalPersonV1/NormalizedSignalV1 "never a
// bare full name or LinkedIn URL" rule.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { normalizeCompanyDomain, normalizeWorkEmail, type SignalCompanyV1, type SignalPersonV1 } from "@workspace/identity";
import {
  applyCanonicalAccountResolutionPlan,
  planCanonicalAccountResolution,
  type AccountResolution,
} from "./canonicalAccountResolution.js";
import {
  applyPersonPlan,
  isKnownRaceViolation,
  planPersonResolution,
  upsertAccountPerson,
  type PersonPlan,
  type PersonResolution,
} from "./identityResolution.js";
import type { Rb2bSignalBridgeRequest } from "./rb2bObservationMapping.js";

type Db = NodePgDatabase<typeof schema>;

export const RB2B_IDENTITY_SOURCE = "rb2b" as const;
const MAX_BINDING_ATTEMPTS = 5;

export interface Rb2bPersonAccountBinding {
  accountResolution: AccountResolution;
  personResolution: PersonResolution;
}

/**
 * Domain is the only strong company identifier RB2B's current bridge
 * contract supplies — externalIds stays the empty map on purpose (RB2B
 * gives no stable per-company id today; inventing one would be a guess).
 * A blank/unnormalizable domain becomes null, which
 * planCanonicalAccountResolution already handles as "no strong company
 * identity" (unresolved, never guessed) — never thrown here.
 */
export function buildRb2bCompany(dto: Rb2bSignalBridgeRequest): SignalCompanyV1 {
  const domain = dto.company_domain ? normalizeCompanyDomain(dto.company_domain) : null;
  return {
    domain,
    name: dto.company_name?.trim() || null,
    externalIds: {},
  };
}

/**
 * A company-level RB2B event (no contact_email/contact_name/contact_title/
 * linkedin/contact_phone at all) must never manufacture a person — this
 * mirrors NormalizedSignalV1's own `person: SignalPersonV1Schema.nullable()`
 * convention exactly: "no contact evidence" is a real, common state, not
 * an empty-but-present person object.
 */
export function buildRb2bPerson(dto: Rb2bSignalBridgeRequest): SignalPersonV1 | null {
  const hasAnyContactEvidence =
    dto.contact_email || dto.contact_name || dto.contact_title || dto.linkedin || dto.contact_phone;
  if (!hasAnyContactEvidence) return null;

  const workEmail = dto.contact_email ? normalizeWorkEmail(dto.contact_email) : null;
  return {
    fullName: dto.contact_name?.trim() || null,
    workEmail,
    title: dto.contact_title?.trim() || null,
    linkedinUrl: dto.linkedin?.trim() || null,
    // RB2B supplies no stable per-visitor external id in the current
    // bridge contract — work email is the only strong person identifier
    // this provider gives us today.
    externalIds: {},
  };
}

/**
 * Resolves (matches or creates) the Account, and — only when the account
 * resolved and contact evidence exists — the Person, then links them via
 * account_people. Bounded-retry around the exact same known-race-
 * violation detection identityResolution.ts's own resolveSignal() uses
 * (covers both the account and person unique-constraint races), since
 * this function can concurrently create either.
 *
 * Never fuzzy-matches (both planCanonicalAccountResolution and
 * planPersonResolution are exact-identifier-only) and never fabricates a
 * result on conflict — an account_identifier_conflict or
 * person_identifier_conflict is returned exactly as those primitives
 * report it, with candidateMatches, never guessed or auto-merged.
 */
export async function resolveRb2bPersonAccount(args: {
  db: Db;
  event: Rb2bSignalBridgeRequest;
}): Promise<Rb2bPersonAccountBinding> {
  const { db, event } = args;
  const company = buildRb2bCompany(event);
  const person = buildRb2bPerson(event);

  for (let attempt = 1; attempt <= MAX_BINDING_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const accountPlan = await planCanonicalAccountResolution(tx, company, RB2B_IDENTITY_SOURCE);

        let personPlan: PersonPlan = { attempted: false };
        if (accountPlan.outcome !== "unresolved" && person !== null) {
          personPlan = await planPersonResolution(tx, person, RB2B_IDENTITY_SOURCE);
        }

        const { accountId, resolution: accountResolution } = await applyCanonicalAccountResolutionPlan(
          tx,
          accountPlan,
          RB2B_IDENTITY_SOURCE,
        );

        let personId: string | null = null;
        let personResolution: PersonResolution = { attempted: false };
        if (personPlan.attempted) {
          const applied = await applyPersonPlan(tx, personPlan, {});
          personId = applied.personId;
          personResolution = applied.resolution;
        }

        if (accountId !== null && personId !== null) {
          const title = person?.title ?? null;
          await upsertAccountPerson(tx, {
            accountId,
            personId,
            title,
            source: RB2B_IDENTITY_SOURCE,
          });
        }

        return { accountResolution, personResolution };
      });
    } catch (error) {
      if (isKnownRaceViolation(error) && attempt < MAX_BINDING_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("resolveRb2bPersonAccount: attempts exhausted unexpectedly.");
}
