// LS8 — People pipeline backfill: repairs already-ingested RB2B
// behavioral_signal observations that never resolved into a canonical
// Person, by reusing the EXACT same functions the live RB2B ingest route
// (../routes/rb2bSignalBridge.ts -> ./rb2bIdentity.ts) already calls for
// every new event. Never a parallel resolution algorithm.
//
// Reused, unmodified:
//   - Rb2bSignalBridgeRequestSchema (./rb2bObservationMapping.js) — the
//     stored observation rawValue IS the complete validated inbound DTO
//     (see that module's own comment), so re-parsing it here recovers
//     the exact same typed object the live route had.
//   - buildRb2bCompany / buildRb2bPerson (./rb2bIdentity.js) — the same
//     pure mapping from DTO to SignalCompanyV1/SignalPersonV1.
//   - planCanonicalAccountResolution (./canonicalAccountResolution.js) —
//     read-only; ONLY proceeds when the account is already "matched"
//     (never creates a new account here — this backfill's job is the
//     person pipeline, not historical RB2B account reconciliation,
//     which is already complete and explicitly out of scope).
//   - planPersonResolution / applyPersonPlan / upsertAccountPerson
//     (./identityResolution.js) — the exact person create/match/
//     associate primitives, including their own exact-identifier-only
//     rules (work email or provider external id; RB2B supplies no
//     external id, so in practice this is work-email-only, exactly like
//     the live path).
//
// No observation is ever written, modified, or fabricated by this
// module — it only reads existing observations and writes to
// people/account_people, the same two tables the live path writes to.
// Idempotent and safe to rerun: a second run over the same observations
// resolves every person as "matched" (0 new people, 0 new
// associations beyond upsertAccountPerson's own no-op update path),
// exactly mirroring rb2bIdentity.integration.test.ts's own proof of
// resolveRb2bPersonAccount's idempotency.

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { observations } from "@workspace/db/schema";
import { Rb2bSignalBridgeRequestSchema } from "./rb2bObservationMapping.js";
import { buildRb2bCompany, buildRb2bPerson, RB2B_IDENTITY_SOURCE } from "./rb2bIdentity.js";
import { planCanonicalAccountResolution } from "./canonicalAccountResolution.js";
import { planPersonResolution, applyPersonPlan, upsertAccountPerson } from "./identityResolution.js";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Rb2bPeopleBackfillSummary {
  scanned: number;
  invalidPayload: number;
  noContactEvidence: number;
  accountNotMatched: number;
  personUnresolvedNoIdentity: number;
  personAmbiguous: number;
  personCreated: number;
  personMatched: number;
  associated: number;
  distinctPersonIds: number;
}

async function runBackfill(tx: Tx): Promise<Rb2bPeopleBackfillSummary> {
  const rows = await tx
    .select({ id: observations.id, rawValue: observations.rawValue })
    .from(observations)
    .where(
      and(eq(observations.provider, "rb2b"), eq(observations.observationClass, "behavioral_signal")),
    );

  const summary = {
    scanned: rows.length,
    invalidPayload: 0,
    noContactEvidence: 0,
    accountNotMatched: 0,
    personUnresolvedNoIdentity: 0,
    personAmbiguous: 0,
    personCreated: 0,
    personMatched: 0,
    associated: 0,
  };
  const distinctPersonIds = new Set<string>();

  for (const row of rows) {
    const parsedDto = Rb2bSignalBridgeRequestSchema.safeParse(row.rawValue);
    if (!parsedDto.success) {
      summary.invalidPayload += 1;
      continue;
    }
    const dto = parsedDto.data;

    const person = buildRb2bPerson(dto);
    if (person === null) {
      summary.noContactEvidence += 1;
      continue;
    }

    const company = buildRb2bCompany(dto);
    const accountPlan = await planCanonicalAccountResolution(tx, company, RB2B_IDENTITY_SOURCE);
    if (accountPlan.outcome !== "matched") {
      // "create" (a genuinely new account) and "unresolved" are both out
      // of scope here — this backfill only associates people with
      // ALREADY-resolved canonical accounts; it never creates one.
      summary.accountNotMatched += 1;
      continue;
    }
    const accountId = accountPlan.accountId;

    const personPlan = await planPersonResolution(tx, person, RB2B_IDENTITY_SOURCE);
    if (!personPlan.attempted) {
      // planPersonResolution never actually returns this variant (it is
      // only produced by callers that skip calling it at all, e.g. when
      // person is null) — unreachable here since `person` is already
      // known non-null at this point, but PersonPlan's declared type
      // still includes it, so this narrows it away rather than casting.
      summary.personUnresolvedNoIdentity += 1;
      continue;
    }
    if (personPlan.outcome === "unresolved") {
      if (personPlan.reasonToken === "person_identifier_conflict") {
        summary.personAmbiguous += 1;
      } else {
        summary.personUnresolvedNoIdentity += 1;
      }
      continue;
    }

    const applied = await applyPersonPlan(tx, personPlan, {});
    if (applied.personId === null) {
      // Unreachable for a matched/create plan — defensive only.
      summary.personUnresolvedNoIdentity += 1;
      continue;
    }
    if (personPlan.outcome === "create") {
      summary.personCreated += 1;
    } else {
      summary.personMatched += 1;
    }
    distinctPersonIds.add(applied.personId);

    const title = dto.contact_title?.trim() || null;
    await upsertAccountPerson(tx, {
      accountId,
      personId: applied.personId,
      title,
      source: RB2B_IDENTITY_SOURCE,
    });
    summary.associated += 1;
  }

  return { ...summary, distinctPersonIds: distinctPersonIds.size };
}

class DryRunRollback extends Error {}

/**
 * Scans every existing rb2b behavioral_signal observation and, for those
 * with trustworthy person evidence, resolves/creates the canonical
 * Person and associates it with the already-resolved canonical Account —
 * exactly what the live route already does for new events. dryRun=true
 * (the default) runs the entire scan inside a transaction that is always
 * rolled back at the end, so nothing is persisted; dryRun=false performs
 * the real writes.
 */
export async function backfillRb2bPeople(
  db: Db,
  args: { dryRun: boolean } = { dryRun: true },
): Promise<Rb2bPeopleBackfillSummary> {
  if (!args.dryRun) {
    return db.transaction(runBackfill);
  }
  let result: Rb2bPeopleBackfillSummary | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await runBackfill(tx);
      throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  if (!result) {
    throw new Error("backfillRb2bPeople: dry run did not produce a summary.");
  }
  return result;
}
