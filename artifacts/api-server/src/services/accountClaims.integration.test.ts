// Milestone 4A — integration tests for ./accountClaims.ts against a
// real, migrated Postgres instance: real account_claims/
// account_claim_current rows, real CHECK constraints, real
// account_claims_immutable trigger. Proves recordClaim()'s precedence
// rules (idempotency, human precedence, contradiction preservation,
// rejection reverting to Unknown) and getAccountClaims()'s batched
// evidence resolution, all against actual database behavior rather than
// mocked expectations.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset — mirrors ./people.integration.test.ts exactly.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountClaims.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { AccountNotFoundError, getAccountClaims, recordClaim } from "./accountClaims.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:claims-test-${RUN_ID}-${crypto.randomUUID()}.example` })
    .returning();
  return account!;
}

async function makeObservation(overrides: Partial<typeof schema.observations.$inferInsert> = {}) {
  const [observation] = await db!
    .insert(schema.observations)
    .values({
      provider: "test-provider",
      sourceRecordId: crypto.randomUUID(),
      observationClass: "research_intelligence",
      semanticKey: "cx.vendor",
      rawValue: { note: "seed evidence" },
      importedAt: new Date(),
      evidenceRefs: [],
      ...overrides,
    })
    .returning();
  return observation!;
}

test("recordClaim throws AccountNotFoundError for an unknown account", { skip }, async () => {
  await assert.rejects(
    () =>
      recordClaim(db!, {
        accountId: crypto.randomUUID(),
        claimKey: "cx.vendor",
        origin: "research",
        valueType: "string",
        value: "Genesys",
        evidenceRefs: [{ kind: "observation", id: crypto.randomUUID() }],
      }),
    AccountNotFoundError,
  );
});

test("getAccountClaims throws AccountNotFoundError for an unknown account", { skip }, async () => {
  await assert.rejects(() => getAccountClaims(db!, crypto.randomUUID()), AccountNotFoundError);
});

test("getAccountClaims returns an empty array (never a placeholder) when no claims have been recorded", { skip }, async () => {
  const account = await makeAccount();
  const result = await getAccountClaims(db!, account.id);
  assert.deepEqual(result, []);
});

test(
  "recordClaim inserts a machine-origin claim, requires evidence, and becomes current when no prior claim exists",
  { skip },
  async () => {
    const account = await makeAccount();
    const observation = await makeObservation();

    await assert.rejects(
      () =>
        recordClaim(db!, {
          accountId: account.id,
          claimKey: "cx.vendor",
          origin: "research",
          valueType: "string",
          value: "Genesys",
          evidenceRefs: [],
        }),
      (err: unknown) =>
        err instanceof Error &&
        String((err as { cause?: unknown }).cause ?? err).includes(
          "account_claims_machine_origin_requires_evidence",
        ),
    );

    const result = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [{ kind: "observation", id: observation.id }],
    });
    assert.equal(result.outcome, "inserted");
    assert.equal(result.currentPointerUpdated, true);

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.isCurrent, true);
    assert.equal(claims[0]?.value, "Genesys");
    assert.equal(claims[0]?.evidence[0]?.kind, "observation");
  },
);

test(
  "recordClaim is idempotent: an identical (origin, valueType, value) candidate against the current claim inserts no new row",
  { skip },
  async () => {
    const account = await makeAccount();
    const observation = await makeObservation();
    const args = {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research" as const,
      valueType: "string" as const,
      value: "Genesys",
      evidenceRefs: [{ kind: "observation" as const, id: observation.id }],
    };

    const first = await recordClaim(db!, args);
    assert.equal(first.outcome, "inserted");

    const second = await recordClaim(db!, args);
    assert.equal(second.outcome, "duplicate");
    assert.equal(second.claim.id, first.claim.id);

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 1, "the duplicate candidate must not insert a second row");
  },
);

test(
  "recordClaim: a human confirmation of an unchanged value is NOT treated as a duplicate — a fresh confirmation event is itself meaningful",
  { skip },
  async () => {
    const account = await makeAccount();
    const observation = await makeObservation();

    const machineClaim = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [{ kind: "observation", id: observation.id }],
    });
    assert.equal(machineClaim.outcome, "inserted");

    const humanConfirm = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "human_confirmed",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [],
      recordedBy: "operator@example.test",
    });
    assert.equal(humanConfirm.outcome, "inserted");
    assert.notEqual(humanConfirm.claim.id, machineClaim.claim.id);

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 2);
    const current = claims.find((c) => c.isCurrent);
    assert.equal(current?.id, humanConfirm.claim.id);
  },
);

test(
  "recordClaim: two disagreeing machine-origin claims are BOTH preserved, and the current pointer does not move to the newer disagreement",
  { skip },
  async () => {
    const account = await makeAccount();
    const genesysObservation = await makeObservation();
    const niceObservation = await makeObservation();

    const first = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [{ kind: "observation", id: genesysObservation.id }],
    });

    const second = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "NICE CXone",
      evidenceRefs: [{ kind: "observation", id: niceObservation.id }],
    });
    assert.equal(second.outcome, "inserted");
    assert.equal(second.currentPointerUpdated, false, "a disagreeing machine claim must not move the pointer");

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 2, "both disagreeing claims remain visible — no invented winner");
    const genesysRow = claims.find((c) => c.id === first.claim.id);
    const niceRow = claims.find((c) => c.id === second.claim.id);
    assert.equal(genesysRow?.isCurrent, true);
    assert.equal(niceRow?.isCurrent, false);
  },
);

test(
  "recordClaim: a human correction unconditionally overrides the current pointer, even overriding an unresolved machine-origin contradiction",
  { skip },
  async () => {
    const account = await makeAccount();
    const genesysObservation = await makeObservation();
    const niceObservation = await makeObservation();

    const genesysClaim = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [{ kind: "observation", id: genesysObservation.id }],
    });
    await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "NICE CXone",
      evidenceRefs: [{ kind: "observation", id: niceObservation.id }],
    });

    const correction = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "human_corrected",
      valueType: "string",
      value: "NICE CXone",
      evidenceRefs: [],
      supersedesClaimId: genesysClaim.claim.id,
      correctionReason: "Confirmed on customer call",
      recordedBy: "operator@example.test",
    });
    assert.equal(correction.outcome, "inserted");
    assert.equal(correction.currentPointerUpdated, true);

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 3);
    const current = claims.find((c) => c.isCurrent);
    assert.equal(current?.id, correction.claim.id);
    assert.equal(current?.origin, "human_corrected");
  },
);

test(
  "recordClaim: a human rejection with no replacement value reverts the key to Unknown (no current claim)",
  { skip },
  async () => {
    const account = await makeAccount();
    const observation = await makeObservation();

    const original = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "research",
      valueType: "string",
      value: "Genesys",
      evidenceRefs: [{ kind: "observation", id: observation.id }],
    });

    const rejection = await recordClaim(db!, {
      accountId: account.id,
      claimKey: "cx.vendor",
      origin: "human_corrected",
      status: "rejected",
      evidenceRefs: [],
      supersedesClaimId: original.claim.id,
      correctionReason: "Turned out to be unfounded speculation",
      recordedBy: "operator@example.test",
    });
    assert.equal(rejection.outcome, "inserted");
    assert.equal(rejection.claim.status, "rejected");
    assert.equal(rejection.claim.value, null);

    const claims = await getAccountClaims(db!, account.id);
    assert.equal(claims.length, 2);
    assert.equal(
      claims.every((c) => c.isCurrent === false),
      true,
      "no row should be current after a rejection with no replacement value",
    );
  },
);
