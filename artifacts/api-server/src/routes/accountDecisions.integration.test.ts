// Integration tests for ../services/accountDecisions.ts, exercised
// end-to-end against a real, migrated Postgres instance: real db, real
// triggers/constraints (lib/db/drizzle/0001_integrity_triggers.sql), real
// service — no fakes anywhere in this file.
//
// Deliberately service-level, not HTTP-level: every requirement this file
// covers (idempotent replay, conflict detection, eligibility checks, gate
// derivation, policy-version reuse, list/detail shaping) is described in
// terms of what the service itself returns or throws, and is entirely
// independent of the HTTP status-code mapping already covered by
// ./accountDecisions.route.test.ts's fake-service unit tests. The route
// (./accountDecisions.ts) is not imported or exercised here, and is not
// yet wired into ./index.ts.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Deliberately builds its own pg.Pool/drizzle instance rather than
// importing @workspace/db's exported singleton — that singleton throws at
// import time if DATABASE_URL is unset, which would break this file's
// ability to skip itself. Mirrors ./accounts.integration.test.ts and
// ./accountEvaluations.integration.test.ts.
//
// Every list/filter/ordering fixture is scoped to a freshly created,
// unique account (via an accountId filter or by construction), so unlike
// ./accounts.integration.test.ts's own account-listing tests, no
// far-future/rerun-safe timestamp scheme is needed here — a decision can
// only ever be found by querying through the one evaluation (and thus the
// one account) this test itself just created.
//
// Run with: tsx --test src/routes/accountDecisions.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import {
  createAccountDecision,
  listAccountDecisions,
  getAccountDecisionById,
  resolveManualDecisionPolicyVersion,
  MANUAL_DECISION_POLICY_VERSION,
  AccountEvaluationNotFoundError,
  AccountEvaluationNotEligibleError,
  IdempotencyKeyConflictError,
} from "../services/accountDecisions.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// Embedded in accountKey/profile name strings below, purely for human
// traceability in a shared, never-cleaned-up disposable database. No
// assertion depends on it.
const RUN_ID = crypto.randomUUID();

// ---------------------------------------------------------------------
// Runtime narrowing (no `as` casts) for the `unknown`-typed jsonb columns
// (operationalContextSnapshot/channelAvailability/blockers) before
// asserting on their exact shape.
// ---------------------------------------------------------------------

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be a plain object`,
  );
}

function assertIsArray(
  value: unknown,
  context: string,
): asserts value is unknown[] {
  assert.ok(Array.isArray(value), `${context} must be an array`);
}

// ---------------------------------------------------------------------
// Ordering helper — same leading-hex-digit-swap technique as
// ./accounts.integration.test.ts's makeOrderedIdPair: derives two
// distinct, format-valid, byte-comparison-ordered UUIDs from one fresh
// random UUID, so tie-break fixtures never collide across tests or
// reruns.
// ---------------------------------------------------------------------

function makeOrderedIdPair(): { lowerId: string; higherId: string } {
  const base = crypto.randomUUID();
  return {
    lowerId: `0${base.slice(1)}`,
    higherId: `f${base.slice(1)}`,
  };
}

// ---------------------------------------------------------------------
// Fixtures — same shapes as ./accounts.integration.test.ts /
// ./accountEvaluations.integration.test.ts.
// ---------------------------------------------------------------------

async function makeAccount(
  overrides: Partial<typeof schema.accounts.$inferInsert> = {},
) {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:account-decisions-test-${RUN_ID}-${crypto.randomUUID()}.example`,
      ...overrides,
    })
    .returning();
  return account!;
}

async function makeSnapshot(accountId: string) {
  const [snapshot] = await db!
    .insert(schema.accountSnapshots)
    .values({
      accountId,
      source: "account-decisions-integration-test",
      rawInput: { raw: true },
      normalizedInput: {
        schemaVersion: "v1",
        company: {
          domain: "account-decisions-test.example",
          name: "Account Decisions Test Co",
          industry: null,
          employeeRange: null,
          revenueRange: null,
          region: "unknown",
          country: null,
        },
        engagement: {
          sources: [],
          pagesVisited: [],
          distinctSourceCount: 0,
          repeatVisit: false,
          lastSeenAt: null,
        },
        contact: {
          name: null,
          email: "account-decisions-test@example.test",
          phone: null,
          title: null,
          linkedinUrl: null,
          origin: "form_submit",
        },
        crm: {
          hubspotCompanyId: null,
          hubspotContactId: null,
          hubspotOwner: null,
          openOpportunity: false,
          existingCustomer: false,
          competitorFlag: false,
          partnerFlag: false,
        },
        doNotContact: false,
        consent: {
          email: "unknown",
          call: "unknown",
          liBasisCleared: "unknown",
          dpoVoiceCleared: "unknown",
        },
        source: "account-decisions-integration-test",
      },
      schemaVersion: "v1",
    })
    .returning();
  return snapshot!;
}

async function makeAccountWithSnapshot(
  overrides: Partial<typeof schema.accounts.$inferInsert> = {},
) {
  const account = await makeAccount(overrides);
  const snapshot = await makeSnapshot(account.id);
  return { account, snapshot };
}

function syntheticProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: "Has a domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

async function makeProfile() {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `account-decisions-test-profile-${RUN_ID}` })
    .returning();
  return profile!;
}

// Publishing is insert-then-update: insert as a draft, then UPDATE
// status -> 'published' with published_at set in the same statement —
// the one mutation icp_profile_versions ever permits.
async function makePublishedVersion(profileId: string) {
  const [draft] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId, versionNumber: 1, config: syntheticProfileConfig() })
    .returning();
  const [published] = await db!
    .update(schema.icpProfileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(schema.icpProfileVersions.id, draft!.id))
    .returning();
  return published!;
}

// evaluator_versions.version is UNIQUE — get-or-create so repeated test
// runs against the same database don't collide.
async function getOrCreateCanonicalEvaluatorVersion() {
  const [inserted] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version: "canonical-v1" })
    .onConflictDoNothing({ target: schema.evaluatorVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db!
    .select()
    .from(schema.evaluatorVersions)
    .where(eq(schema.evaluatorVersions.version, "canonical-v1"))
    .limit(1);
  if (!existing) {
    throw new Error(
      "getOrCreateCanonicalEvaluatorVersion: insert conflicted but no existing row was found",
    );
  }
  return existing;
}

interface SharedEvaluationContext {
  evaluatorVersionId: string;
  profileVersionId: string;
}
let sharedContextPromise: Promise<SharedEvaluationContext> | undefined;
function getSharedEvaluationContext(): Promise<SharedEvaluationContext> {
  if (!sharedContextPromise) {
    sharedContextPromise = (async () => {
      const evaluatorVersion = await getOrCreateCanonicalEvaluatorVersion();
      const profile = await makeProfile();
      const publishedVersion = await makePublishedVersion(profile.id);
      return {
        evaluatorVersionId: evaluatorVersion.id,
        profileVersionId: publishedVersion.id,
      };
    })();
  }
  return sharedContextPromise;
}

// A full "completed" row by default, satisfying the
// completed-requires-core-outputs CHECK. evaluationMode/status/eligibility
// fields are overridable per test (preview evaluations, failed
// evaluations, and each eligibility combination for gate derivation).
async function makeEvaluation(
  args: {
    accountId: string;
    snapshotId: string;
    evaluationMode: "preview" | "production";
  },
  overrides: Partial<typeof schema.accountEvaluations.$inferInsert> = {},
) {
  const { evaluatorVersionId, profileVersionId } =
    await getSharedEvaluationContext();
  const [evaluation] = await db!
    .insert(schema.accountEvaluations)
    .values({
      accountId: args.accountId,
      snapshotId: args.snapshotId,
      profileVersionId,
      evaluatorVersionId,
      evaluationMode: args.evaluationMode,
      status: "completed",
      fitScore: "10",
      fitTier: "high",
      intentScore: "5",
      intentTier: "warm",
      identityResolutionLevel: "contact",
      identityConfidence: "high",
      actionabilityScore: "3",
      eligibilityOutcome: "eligible",
      eligibilityRestrictions: [],
      hardDisqualifiers: [],
      scoreComponents: [],
      matchedRules: [],
      missingInputs: [],
      profileConfigSnapshot: { configSchemaVersion: "v1" },
      ...overrides,
    })
    .returning();
  return evaluation!;
}

// The manual policy version is a singleton row, resolved lazily via the
// real service helper and memoized for the rest of this run — mirrors how
// production code would only ever need to resolve it once per process.
let manualPolicyVersionIdPromise: Promise<string> | undefined;
function getManualPolicyVersionId(): Promise<string> {
  if (!manualPolicyVersionIdPromise) {
    manualPolicyVersionIdPromise = resolveManualDecisionPolicyVersion(db!).then(
      (row) => row.id,
    );
  }
  return manualPolicyVersionIdPromise;
}

// Direct insert, bypassing createAccountDecision — used only for
// list/order/filter fixture data, where precise createdAt/id control is
// needed and no eligibility/idempotency logic is under test. Tests that
// exercise createAccountDecision's own behavior always call it directly.
async function makeDecisionRow(
  args: { accountEvaluationId: string },
  overrides: Partial<typeof schema.accountDecisions.$inferInsert> = {},
) {
  const decisionPolicyVersionId = await getManualPolicyVersionId();
  const [decision] = await db!
    .insert(schema.accountDecisions)
    .values({
      accountEvaluationId: args.accountEvaluationId,
      decisionPolicyVersionId,
      operationalContextSnapshot: { source: "manual_operator_decision" },
      channelAvailability: {},
      blockers: [],
      routingOutput: "mql",
      routingReason: null,
      overallDecisionGate: "actionable",
      createdBy: "operator@example.test",
      ...overrides,
    })
    .returning();
  return decision!;
}

// ---------------------------------------------------------------------
// createAccountDecision — creation, exact persisted values
// ---------------------------------------------------------------------

test(
  "createAccountDecision creates an mql decision for a completed production evaluation, with every field persisted exactly",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });
    const idempotencyKey = crypto.randomUUID();
    const manualPolicyVersionId = await getManualPolicyVersionId();

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey,
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      routingReason: "Strong signal, promote to sales",
      createdBy: "operator@example.test",
    });

    assert.equal(result.created, true);
    assert.equal(result.accountId, account.id);
    assert.equal(result.decision.id, idempotencyKey);
    assert.equal(result.decision.accountEvaluationId, evaluation.id);
    assert.equal(
      result.decision.decisionPolicyVersionId,
      manualPolicyVersionId,
    );
    assert.equal(result.decision.routingOutput, "mql");
    assert.equal(
      result.decision.routingReason,
      "Strong signal, promote to sales",
    );
    assert.equal(result.decision.overallDecisionGate, "actionable");
    assert.equal(result.decision.createdBy, "operator@example.test");

    assertIsRecord(
      result.decision.operationalContextSnapshot,
      "decision.operationalContextSnapshot",
    );
    assert.deepEqual(result.decision.operationalContextSnapshot, {
      source: "manual_operator_decision",
    });
    assertIsRecord(
      result.decision.channelAvailability,
      "decision.channelAvailability",
    );
    assert.deepEqual(result.decision.channelAvailability, {});
    assertIsArray(result.decision.blockers, "decision.blockers");
    assert.deepEqual(result.decision.blockers, []);
  },
);

test(
  "createAccountDecision creates a sales_review decision, normalizing an omitted routingReason to null",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "sales_review",
      createdBy: "operator@example.test",
    });

    assert.equal(result.created, true);
    assert.equal(result.decision.routingOutput, "sales_review");
    assert.equal(result.decision.routingReason, null);
  },
);

test(
  "createAccountDecision preserves an explicit null routingReason",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      routingReason: null,
      createdBy: "operator@example.test",
    });

    assert.equal(result.decision.routingReason, null);
  },
);

// ---------------------------------------------------------------------
// createAccountDecision — gate derivation from real evaluation rows
// ---------------------------------------------------------------------

test(
  "createAccountDecision derives overallDecisionGate=actionable from a real eligible evaluation with no restrictions or disqualifiers",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      {
        eligibilityOutcome: "eligible",
        eligibilityRestrictions: [],
        hardDisqualifiers: [],
      },
    );

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    });

    assert.equal(result.decision.overallDecisionGate, "actionable");
  },
);

test(
  "createAccountDecision derives overallDecisionGate=restricted from a real evaluation carrying eligibilityRestrictions",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      {
        eligibilityOutcome: "restricted",
        eligibilityRestrictions: ["needs_review"],
        hardDisqualifiers: [],
      },
    );

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "sales_review",
      createdBy: "operator@example.test",
    });

    assert.equal(result.decision.overallDecisionGate, "restricted");
  },
);

test(
  "createAccountDecision derives overallDecisionGate=blocked from a real evaluation carrying hardDisqualifiers",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      {
        eligibilityOutcome: "ineligible",
        eligibilityRestrictions: [],
        hardDisqualifiers: ["internal_domain"],
      },
    );

    const result = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    });

    assert.equal(result.decision.overallDecisionGate, "blocked");
  },
);

// ---------------------------------------------------------------------
// createAccountDecision — idempotency
// ---------------------------------------------------------------------

test(
  "createAccountDecision: exact idempotent replay returns created:false and does not create a duplicate row",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });
    const idempotencyKey = crypto.randomUUID();
    const args = {
      db: db!,
      idempotencyKey,
      accountEvaluationId: evaluation.id,
      routingOutput: "mql" as const,
      routingReason: "First pass",
      createdBy: "operator@example.test",
    };

    const first = await createAccountDecision(args);
    assert.equal(first.created, true);

    const second = await createAccountDecision(args);
    assert.equal(second.created, false);
    assert.deepEqual(second.decision, first.decision);
    assert.equal(second.accountId, first.accountId);

    const rows = await db!
      .select()
      .from(schema.accountDecisions)
      .where(eq(schema.accountDecisions.id, idempotencyKey));
    assert.equal(rows.length, 1);
  },
);

test(
  "createAccountDecision: reusing the same key with a different effective input throws IdempotencyKeyConflictError and leaves the original row untouched",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });
    const idempotencyKey = crypto.randomUUID();

    const first = await createAccountDecision({
      db: db!,
      idempotencyKey,
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    });
    assert.equal(first.created, true);

    await assert.rejects(
      createAccountDecision({
        db: db!,
        idempotencyKey,
        accountEvaluationId: evaluation.id,
        routingOutput: "sales_review",
        createdBy: "operator@example.test",
      }),
      IdempotencyKeyConflictError,
    );

    const [unchanged] = await db!
      .select()
      .from(schema.accountDecisions)
      .where(eq(schema.accountDecisions.id, idempotencyKey))
      .limit(1);
    assert.deepEqual(unchanged, first.decision);
  },
);

// ---------------------------------------------------------------------
// createAccountDecision — evaluation eligibility
// ---------------------------------------------------------------------

test(
  "createAccountDecision throws AccountEvaluationNotFoundError for a nonexistent accountEvaluationId",
  { skip },
  async () => {
    await assert.rejects(
      createAccountDecision({
        db: db!,
        idempotencyKey: crypto.randomUUID(),
        accountEvaluationId: crypto.randomUUID(),
        routingOutput: "mql",
        createdBy: "operator@example.test",
      }),
      AccountEvaluationNotFoundError,
    );
  },
);

test(
  "createAccountDecision throws AccountEvaluationNotEligibleError for a preview evaluation",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "preview",
    });

    await assert.rejects(
      createAccountDecision({
        db: db!,
        idempotencyKey: crypto.randomUUID(),
        accountEvaluationId: evaluation.id,
        routingOutput: "mql",
        createdBy: "operator@example.test",
      }),
      AccountEvaluationNotEligibleError,
    );
  },
);

test(
  "createAccountDecision throws AccountEvaluationNotEligibleError for a failed (non-completed) evaluation",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      {
        status: "failed",
        errorDetail: "account snapshot failed validation",
        fitScore: null,
        fitTier: null,
        intentScore: null,
        intentTier: null,
        identityResolutionLevel: null,
        identityConfidence: null,
        actionabilityScore: null,
        eligibilityOutcome: null,
      },
    );

    await assert.rejects(
      createAccountDecision({
        db: db!,
        idempotencyKey: crypto.randomUUID(),
        accountEvaluationId: evaluation.id,
        routingOutput: "mql",
        createdBy: "operator@example.test",
      }),
      AccountEvaluationNotEligibleError,
    );
  },
);

// ---------------------------------------------------------------------
// listAccountDecisions
// ---------------------------------------------------------------------

test(
  "listAccountDecisions orders by createdAt desc, breaking ties by id desc",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    const older = await makeDecisionRow(
      { accountEvaluationId: evaluation.id },
      { createdAt: new Date("2031-01-01T00:00:00Z") },
    );
    const { lowerId, higherId } = makeOrderedIdPair();
    const tieLow = await makeDecisionRow(
      { accountEvaluationId: evaluation.id },
      { id: lowerId, createdAt: new Date("2031-02-01T00:00:00Z") },
    );
    const tieHigh = await makeDecisionRow(
      { accountEvaluationId: evaluation.id },
      { id: higherId, createdAt: new Date("2031-02-01T00:00:00Z") },
    );

    const result = await listAccountDecisions({
      db: db!,
      limit: 100,
      offset: 0,
      accountId: account.id,
    });

    assert.deepEqual(
      result.items.map((item) => item.decision.id),
      [tieHigh.id, tieLow.id, older.id],
    );
    assert.equal(result.total, 3);
  },
);

test(
  "listAccountDecisions returns total independently of page size, and offset advances correctly through createdAt DESC, id DESC order",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    const fixtureCount = 5;
    const decisions: schema.AccountDecision[] = [];
    for (let i = 0; i < fixtureCount; i++) {
      const decision = await makeDecisionRow(
        { accountEvaluationId: evaluation.id },
        { createdAt: new Date(Date.UTC(2031, 0, i + 1)) },
      );
      decisions.push(decision);
    }
    // Inserted oldest (index 0, 2031-01-01) to newest (index 4, 2031-01-05)
    // — createdAt values are all distinct, so id tie-break never applies
    // here; createdAt desc alone fully determines order.
    const expectedDescOrder = [...decisions].reverse();

    const page1 = await listAccountDecisions({
      db: db!,
      limit: 2,
      offset: 0,
      accountId: account.id,
    });
    const page2 = await listAccountDecisions({
      db: db!,
      limit: 2,
      offset: 2,
      accountId: account.id,
    });

    assert.deepEqual(
      page1.items.map((item) => item.decision.id),
      expectedDescOrder.slice(0, 2).map((decision) => decision.id),
    );
    assert.deepEqual(
      page2.items.map((item) => item.decision.id),
      expectedDescOrder.slice(2, 4).map((decision) => decision.id),
    );

    // Proves offset actually advanced the window rather than page 2
    // silently repeating page 1's rows.
    const page1Ids = new Set(page1.items.map((item) => item.decision.id));
    for (const item of page2.items) {
      assert.ok(
        !page1Ids.has(item.decision.id),
        `page 2 must not repeat decision ${item.decision.id} already returned on page 1`,
      );
    }

    assert.equal(page1.total, fixtureCount);
    assert.equal(page2.total, fixtureCount);
  },
);

test(
  "listAccountDecisions filters by accountId in SQL, excluding decisions belonging to other accounts",
  { skip },
  async () => {
    const { account: accountA, snapshot: snapshotA } =
      await makeAccountWithSnapshot();
    const { account: accountB, snapshot: snapshotB } =
      await makeAccountWithSnapshot();
    const evaluationA = await makeEvaluation({
      accountId: accountA.id,
      snapshotId: snapshotA.id,
      evaluationMode: "production",
    });
    const evaluationB = await makeEvaluation({
      accountId: accountB.id,
      snapshotId: snapshotB.id,
      evaluationMode: "production",
    });

    const decisionA = await makeDecisionRow({
      accountEvaluationId: evaluationA.id,
    });
    const decisionB = await makeDecisionRow({
      accountEvaluationId: evaluationB.id,
    });

    const resultA = await listAccountDecisions({
      db: db!,
      limit: 100,
      offset: 0,
      accountId: accountA.id,
    });
    const idsA = resultA.items.map((item) => item.decision.id);

    assert.equal(resultA.total, 1);
    assert.ok(idsA.includes(decisionA.id));
    assert.ok(!idsA.includes(decisionB.id));
    assert.ok(resultA.items.every((item) => item.accountId === accountA.id));
  },
);

// ---------------------------------------------------------------------
// getAccountDecisionById
// ---------------------------------------------------------------------

test(
  "getAccountDecisionById returns the exact persisted decision and accountId",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });
    const created = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      routingReason: "detail test",
      createdBy: "operator@example.test",
    });

    const result = await getAccountDecisionById(db!, created.decision.id);

    assert.ok(result, "expected a decision row");
    assert.deepEqual(result.decision, created.decision);
    assert.equal(result.accountId, account.id);
  },
);

test(
  "getAccountDecisionById returns undefined for a nonexistent decision id",
  { skip },
  async () => {
    const result = await getAccountDecisionById(db!, crypto.randomUUID());
    assert.equal(result, undefined);
  },
);

// ---------------------------------------------------------------------
// Manual policy version reuse
// ---------------------------------------------------------------------

test(
  "resolveManualDecisionPolicyVersion is idempotent against a real database",
  { skip },
  async () => {
    const first = await resolveManualDecisionPolicyVersion(db!);
    const second = await resolveManualDecisionPolicyVersion(db!);

    assert.equal(first.id, second.id);
    assert.equal(first.version, MANUAL_DECISION_POLICY_VERSION.version);
  },
);

test(
  "repeated decision creation reuses the same manual-operator-v1 policy-version row rather than creating duplicates",
  { skip },
  async () => {
    const { account: accountA, snapshot: snapshotA } =
      await makeAccountWithSnapshot();
    const { account: accountB, snapshot: snapshotB } =
      await makeAccountWithSnapshot();
    const evaluationA = await makeEvaluation({
      accountId: accountA.id,
      snapshotId: snapshotA.id,
      evaluationMode: "production",
    });
    const evaluationB = await makeEvaluation({
      accountId: accountB.id,
      snapshotId: snapshotB.id,
      evaluationMode: "production",
    });

    const resultA = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluationA.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    });
    const resultB = await createAccountDecision({
      db: db!,
      idempotencyKey: crypto.randomUUID(),
      accountEvaluationId: evaluationB.id,
      routingOutput: "sales_review",
      createdBy: "operator@example.test",
    });

    assert.equal(
      resultA.decision.decisionPolicyVersionId,
      resultB.decision.decisionPolicyVersionId,
    );

    const policyRows = await db!
      .select()
      .from(schema.decisionPolicyVersions)
      .where(
        eq(
          schema.decisionPolicyVersions.version,
          MANUAL_DECISION_POLICY_VERSION.version,
        ),
      );
    assert.equal(policyRows.length, 1);
  },
);

test.after(async () => {
  await pool?.end();
});
