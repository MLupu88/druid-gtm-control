// Unit tests for the icp-profiles application service. No database
// needed — every db/tx interaction is a fake queue-based query-chain
// object (see makeQueueTx), same spirit as ./accountEvaluations.test.ts's
// makeFakeSelectDb but extended to also record the arguments each chain
// method was called with, so assertions can check exactly what was
// written (e.g. that `notes` is omitted from an UPDATE .set() call when
// the caller didn't supply it).
//
// Full transactional lifecycle correctness against real triggers/checks
// (immutability, one-draft-per-profile, active_version_id integrity,
// activation event shape) is covered by
// ../routes/icpProfiles.integration.test.ts against a real Postgres
// instance — these tests exercise this module's own branching logic in
// isolation.
//
// Run with: tsx --test src/services/icpProfiles.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProfile,
  listProfiles,
  getProfile,
  updateDraft,
  cloneVersionIntoDraft,
  publishDraft,
  activateVersion,
  validateProfileConfig,
  buildProfileListItem,
  InvalidProfileConfigError,
  ProfileNotFoundError,
  NoDraftVersionError,
  DraftAlreadyExistsError,
  VersionNotFoundError,
  VersionBelongsToAnotherProfileError,
  VersionNotPublishedError,
  NotReadyForPublishError,
} from "./icpProfiles.js";
import type { IcpProfile, IcpProfileVersion } from "@workspace/db/schema";

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

// Uses an explicit `eq` match on company.domain (not a bare `exists`
// check) so this fixture carries meaningful target-company criteria per
// evaluatePublicationReadiness's rules — a plain "domain exists" rule
// alone would make every publishDraft() test below using this fixture
// fail with NotReadyForPublishError. See
// "evaluatePublicationReadiness" tests further down for the
// exists-only/insufficient case specifically.
function syntheticProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "domain_match",
          description: "Domain matches example.com",
          points: 10,
          condition: { op: "eq", field: "company.domain", value: "example.com" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

function syntheticProfile(overrides: Partial<IcpProfile> = {}): IcpProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Enterprise ICP",
    description: null,
    activeVersionId: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

function syntheticVersion(
  overrides: Partial<IcpProfileVersion> = {},
): IcpProfileVersion {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    profileId: "11111111-1111-4111-8111-111111111111",
    versionNumber: 1,
    status: "draft",
    config: syntheticProfileConfig(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    publishedAt: null,
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Fake db/tx: a queue of canned responses, one per root select/insert/
// update call, consumed in call order. Every chain method is recorded
// (with its arguments) onto a shared `calls` array so tests can assert on
// exactly what was queried or written.
// ---------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makeQueueTx(queue: unknown[]) {
  let i = 0;
  const calls: RecordedCall[] = [];

  function chain(): any {
    const obj: any = {};
    for (const method of [
      "from",
      "where",
      "limit",
      "orderBy",
      "set",
      "values",
      "returning",
    ]) {
      obj[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return obj;
      };
    }
    obj.then = (
      resolve: (v: unknown) => void,
      reject?: (e: unknown) => void,
    ) => {
      Promise.resolve(queue[i++]).then(resolve, reject);
    };
    return obj;
  }

  const txLike: any = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain();
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: "insert", args });
      return chain();
    },
    update: (...args: unknown[]) => {
      calls.push({ method: "update", args });
      return chain();
    },
  };

  return { tx: txLike, calls };
}

function makeFakeTransactionalDb(queue: unknown[]) {
  const { tx, calls } = makeQueueTx(queue);
  let transactionCalls = 0;
  const db: any = {
    transaction: async (cb: (tx: unknown) => unknown) => {
      transactionCalls += 1;
      return cb(tx);
    },
  };
  return { db, calls, getTransactionCalls: () => transactionCalls };
}

// ---------------------------------------------------------------------
// validateProfileConfig
// ---------------------------------------------------------------------

test("validateProfileConfig returns the validated config for a canonically valid shape", () => {
  const config = syntheticProfileConfig();
  const result = validateProfileConfig(config);
  assert.deepEqual(result, config);
});

test("validateProfileConfig throws InvalidProfileConfigError for a canonically invalid shape", () => {
  assert.throws(
    () => validateProfileConfig({ configSchemaVersion: "v1" }),
    InvalidProfileConfigError,
  );
});

test("validateProfileConfig throws InvalidProfileConfigError for a non-object value", () => {
  assert.throws(
    () => validateProfileConfig("not an object"),
    InvalidProfileConfigError,
  );
});

// ---------------------------------------------------------------------
// buildProfileListItem
// ---------------------------------------------------------------------

test("buildProfileListItem reports null active/draft/latest when the profile has no versions", () => {
  const profile = syntheticProfile();
  const item = buildProfileListItem(profile, []);
  assert.equal(item.activeVersion, null);
  assert.equal(item.draftVersion, null);
  assert.equal(item.latestVersion, null);
});

test("buildProfileListItem classifies no_active_definition (and empty targetCriteria) when there is no active version, even if a draft exists", () => {
  const profile = syntheticProfile({ activeVersionId: null });
  const draft = syntheticVersion({ id: "v-draft", status: "draft" });
  const item = buildProfileListItem(profile, [draft]);
  assert.equal(item.classification, "no_active_definition");
  assert.deepEqual(item.targetCriteria, []);
});

test("buildProfileListItem classifies fit_only from the active version's config and extracts its target criteria (draft's config is never used)", () => {
  const profile = syntheticProfile({ activeVersionId: "v-active" });
  const activeVersion = syntheticVersion({
    id: "v-active",
    status: "published",
    config: {
      configSchemaVersion: "v1",
      fit: {
        rules: [
          {
            id: "industry_match",
            description: "Industry is Banking",
            points: 20,
            condition: { op: "eq", field: "company.industry", value: "Banking" },
          },
        ],
        tiers: [{ code: "base", minScore: 0 }],
      },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
  });
  const draft = syntheticVersion({
    id: "v-draft",
    status: "draft",
    config: {
      configSchemaVersion: "v1",
      fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
  });

  const item = buildProfileListItem(profile, [activeVersion, draft]);

  assert.equal(item.classification, "fit_only");
  assert.deepEqual(item.targetCriteria, [
    { field: "company.industry", operator: "eq", values: ["Banking"] },
  ]);
});

test("buildProfileListItem classifies legacy_starter when the active version matches the exact legacy signature", () => {
  const profile = syntheticProfile({ activeVersionId: "v-active" });
  const activeVersion = syntheticVersion({
    id: "v-active",
    status: "published",
    config: {
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
    },
  });

  const item = buildProfileListItem(profile, [activeVersion]);
  assert.equal(item.classification, "legacy_starter");
});

test("buildProfileListItem resolves activeVersion via activeVersionId, draftVersion via status, and latestVersion via highest versionNumber", () => {
  const profile = syntheticProfile({ activeVersionId: "v-published-1" });
  const versions = [
    syntheticVersion({
      id: "v-published-1",
      versionNumber: 1,
      status: "published",
      publishedAt: new Date("2026-01-02T00:00:00Z"),
    }),
    syntheticVersion({
      id: "v-published-2",
      versionNumber: 2,
      status: "published",
      publishedAt: new Date("2026-01-03T00:00:00Z"),
    }),
    syntheticVersion({ id: "v-draft-3", versionNumber: 3, status: "draft" }),
  ];

  const item = buildProfileListItem(profile, versions);

  assert.equal(item.activeVersion?.id, "v-published-1");
  assert.equal(item.draftVersion?.id, "v-draft-3");
  assert.equal(item.latestVersion?.id, "v-draft-3");
  // Version summaries never carry the full config.
  assert.equal("config" in (item.activeVersion as object), false);
});

test("buildProfileListItem reports draftVersion/latestVersion null when the profile has only published versions and no active pointer", () => {
  const profile = syntheticProfile({ activeVersionId: null });
  const versions = [
    syntheticVersion({ id: "v1", versionNumber: 1, status: "published" }),
  ];
  const item = buildProfileListItem(profile, versions);
  assert.equal(item.activeVersion, null);
  assert.equal(item.draftVersion, null);
  assert.equal(item.latestVersion?.id, "v1");
});

// ---------------------------------------------------------------------
// createProfile
// ---------------------------------------------------------------------

test("createProfile rejects an invalid config without ever opening a transaction", async () => {
  const { db, getTransactionCalls } = makeFakeTransactionalDb([]);

  await assert.rejects(
    createProfile({
      db,
      name: "Bad ICP",
      config: { configSchemaVersion: "v1" },
      createdBy: null,
    }),
    InvalidProfileConfigError,
  );
  assert.equal(getTransactionCalls(), 0);
});

test("createProfile inserts the profile then its versionNumber=1 draft in one transaction", async () => {
  const profile = syntheticProfile({
    name: "Enterprise ICP",
    createdBy: "jane@example.test",
  });
  const draftVersion = syntheticVersion({
    profileId: profile.id,
    createdBy: "jane@example.test",
  });
  const { db, calls } = makeFakeTransactionalDb([[profile], [draftVersion]]);

  const result = await createProfile({
    db,
    name: "Enterprise ICP",
    config: syntheticProfileConfig(),
    createdBy: "jane@example.test",
  });

  assert.equal(result.profile, profile);
  assert.equal(result.draftVersion, draftVersion);
  const insertCalls = calls.filter((c) => c.method === "insert");
  assert.equal(insertCalls.length, 2);
  const valuesCalls = calls.filter((c) => c.method === "values");
  assert.deepEqual(valuesCalls[0]?.args[0], {
    name: "Enterprise ICP",
    description: null,
    createdBy: "jane@example.test",
  });
  assert.deepEqual(valuesCalls[1]?.args[0], {
    profileId: profile.id,
    versionNumber: 1,
    config: syntheticProfileConfig(),
    createdBy: "jane@example.test",
  });
});

// ---------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------

test("listProfiles returns [] and never queries versions when there are no profiles", async () => {
  const { tx: fakeDb, calls } = makeQueueTx([[]]);
  const result = await listProfiles(fakeDb as never);
  assert.deepEqual(result, []);
  assert.equal(calls.filter((c) => c.method === "select").length, 1);
});

test("listProfiles groups versions by profile and derives active/draft/latest per profile", async () => {
  const profileA = syntheticProfile({ id: "profile-a" });
  const profileB = syntheticProfile({ id: "profile-b", name: "SMB ICP" });
  const versionA1 = syntheticVersion({
    id: "va1",
    profileId: "profile-a",
    versionNumber: 1,
    status: "draft",
  });
  const versionB1 = syntheticVersion({
    id: "vb1",
    profileId: "profile-b",
    versionNumber: 1,
    status: "published",
  });
  const { tx: fakeDb } = makeQueueTx([
    [profileA, profileB],
    [versionA1, versionB1],
  ]);

  const result = await listProfiles(fakeDb as never);

  assert.equal(result.length, 2);
  const itemA = result.find((r) => r.id === "profile-a");
  const itemB = result.find((r) => r.id === "profile-b");
  assert.equal(itemA?.draftVersion?.id, "va1");
  assert.equal(itemB?.draftVersion, null);
  assert.equal(itemB?.latestVersion?.id, "vb1");
});

// ---------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------

test("getProfile returns undefined when the profile does not exist", async () => {
  const { tx: fakeDb } = makeQueueTx([[]]);
  const result = await getProfile(fakeDb as never, "does-not-exist");
  assert.equal(result, undefined);
});

test("getProfile returns the profile with its ordered versions, config untouched", async () => {
  const profile = syntheticProfile();
  const v1 = syntheticVersion({
    id: "v1",
    versionNumber: 1,
    status: "published",
  });
  const v2 = syntheticVersion({ id: "v2", versionNumber: 2, status: "draft" });
  const { tx: fakeDb } = makeQueueTx([[profile], [v1, v2]]);

  const result = await getProfile(fakeDb as never, profile.id);

  assert.equal(result?.profile, profile);
  assert.deepEqual(result?.versions, [v1, v2]);
});

// ---------------------------------------------------------------------
// updateDraft
// ---------------------------------------------------------------------

test("updateDraft rejects an invalid config without ever opening a transaction", async () => {
  const { db, getTransactionCalls } = makeFakeTransactionalDb([]);
  await assert.rejects(
    updateDraft({ db, profileId: "p1", config: { configSchemaVersion: "v1" } }),
    InvalidProfileConfigError,
  );
  assert.equal(getTransactionCalls(), 0);
});

test("updateDraft throws ProfileNotFoundError when the profile does not exist", async () => {
  const { db } = makeFakeTransactionalDb([[]]);
  await assert.rejects(
    updateDraft({ db, profileId: "missing", config: syntheticProfileConfig() }),
    ProfileNotFoundError,
  );
});

test("updateDraft throws NoDraftVersionError when the profile has no draft version", async () => {
  const profile = syntheticProfile();
  const { db } = makeFakeTransactionalDb([[profile], []]);
  await assert.rejects(
    updateDraft({
      db,
      profileId: profile.id,
      config: syntheticProfileConfig(),
    }),
    NoDraftVersionError,
  );
});

test("updateDraft omits notes from the update when the caller didn't supply it", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion({ notes: "existing note" });
  const updated = { ...draft, config: syntheticProfileConfig() };
  const { db, calls } = makeFakeTransactionalDb([
    [profile],
    [draft],
    [updated],
  ]);

  await updateDraft({
    db,
    profileId: profile.id,
    config: syntheticProfileConfig(),
  });

  const setCall = calls.find((c) => c.method === "set");
  assert.ok(setCall);
  assert.equal("notes" in (setCall!.args[0] as object), false);
});

test("updateDraft replaces notes with null when the caller explicitly supplies null", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion({ notes: "existing note" });
  const updated = { ...draft, notes: null };
  const { db, calls } = makeFakeTransactionalDb([
    [profile],
    [draft],
    [updated],
  ]);

  await updateDraft({
    db,
    profileId: profile.id,
    config: syntheticProfileConfig(),
    notes: null,
  });

  const setCall = calls.find((c) => c.method === "set");
  assert.deepEqual((setCall!.args[0] as Record<string, unknown>).notes, null);
});

test("updateDraft throws NoDraftVersionError when the draft was published concurrently (update affects 0 rows)", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion();
  const { db } = makeFakeTransactionalDb([[profile], [draft], []]);
  await assert.rejects(
    updateDraft({
      db,
      profileId: profile.id,
      config: syntheticProfileConfig(),
    }),
    NoDraftVersionError,
  );
});

// ---------------------------------------------------------------------
// cloneVersionIntoDraft
// ---------------------------------------------------------------------

test("cloneVersionIntoDraft throws ProfileNotFoundError when the profile does not exist", async () => {
  const { db } = makeFakeTransactionalDb([[]]);
  await assert.rejects(
    cloneVersionIntoDraft({
      db,
      profileId: "missing",
      sourceVersionId: "v1",
      createdBy: null,
    }),
    ProfileNotFoundError,
  );
});

test("cloneVersionIntoDraft throws DraftAlreadyExistsError when the profile already has a draft", async () => {
  const profile = syntheticProfile();
  const existingDraft = syntheticVersion();
  const { db } = makeFakeTransactionalDb([[profile], [existingDraft]]);
  await assert.rejects(
    cloneVersionIntoDraft({
      db,
      profileId: profile.id,
      sourceVersionId: "v-source",
      createdBy: null,
    }),
    DraftAlreadyExistsError,
  );
});

test("cloneVersionIntoDraft throws VersionNotFoundError when the source version does not exist", async () => {
  const profile = syntheticProfile();
  const { db } = makeFakeTransactionalDb([[profile], [], []]);
  await assert.rejects(
    cloneVersionIntoDraft({
      db,
      profileId: profile.id,
      sourceVersionId: "missing-version",
      createdBy: null,
    }),
    VersionNotFoundError,
  );
});

test("cloneVersionIntoDraft throws VersionBelongsToAnotherProfileError when the source version belongs to a different profile", async () => {
  const profile = syntheticProfile();
  const sourceFromOtherProfile = syntheticVersion({
    profileId: "some-other-profile",
  });
  const { db } = makeFakeTransactionalDb([
    [profile],
    [],
    [sourceFromOtherProfile],
  ]);
  await assert.rejects(
    cloneVersionIntoDraft({
      db,
      profileId: profile.id,
      sourceVersionId: sourceFromOtherProfile.id,
      createdBy: null,
    }),
    VersionBelongsToAnotherProfileError,
  );
});

test("cloneVersionIntoDraft clones the exact source config into a new draft at maxVersionNumber + 1", async () => {
  const profile = syntheticProfile();
  const source = syntheticVersion({
    versionNumber: 2,
    status: "published",
    config: { configSchemaVersion: "v1", marker: "source-config" },
  });
  const cloned = syntheticVersion({
    id: "new-draft",
    versionNumber: 3,
    status: "draft",
    config: source.config,
  });
  const { db, calls } = makeFakeTransactionalDb([
    [profile], // select profile
    [], // select existing draft -> none
    [source], // select source version
    [{ value: 2 }], // select max(versionNumber)
    [cloned], // insert returning
  ]);

  const result = await cloneVersionIntoDraft({
    db,
    profileId: profile.id,
    sourceVersionId: source.id,
    createdBy: "jane@example.test",
  });

  assert.equal(result, cloned);
  const valuesCall = calls.find((c) => c.method === "values");
  assert.deepEqual(valuesCall!.args[0], {
    profileId: profile.id,
    versionNumber: 3,
    config: source.config,
    createdBy: "jane@example.test",
  });
});

// ---------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------

test("publishDraft throws ProfileNotFoundError when the profile does not exist", async () => {
  const { db } = makeFakeTransactionalDb([[]]);
  await assert.rejects(publishDraft(db, "missing"), ProfileNotFoundError);
});

test("publishDraft throws NoDraftVersionError when there is no draft to publish", async () => {
  const profile = syntheticProfile();
  const { db } = makeFakeTransactionalDb([[profile], []]);
  await assert.rejects(publishDraft(db, profile.id), NoDraftVersionError);
});

test("publishDraft sets status=published and a publishedAt timestamp", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion();
  const published = {
    ...draft,
    status: "published" as const,
    publishedAt: new Date(),
  };
  const { db, calls } = makeFakeTransactionalDb([
    [profile],
    [draft],
    [published],
  ]);

  const result = await publishDraft(db, profile.id);

  assert.equal(result, published);
  const setCall = calls.find((c) => c.method === "set");
  const setArgs = setCall!.args[0] as Record<string, unknown>;
  assert.equal(setArgs.status, "published");
  assert.ok(setArgs.publishedAt instanceof Date);
});

test("publishDraft throws NotReadyForPublishError with meaningful_target_required when every fit rule is exists-only", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion({
    config: {
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
    },
  });
  const { db, calls } = makeFakeTransactionalDb([[profile], [draft]]);

  await assert.rejects(publishDraft(db, profile.id), (error: unknown) => {
    assert.ok(error instanceof NotReadyForPublishError);
    assert.equal(error.reasons.length, 1);
    assert.equal(error.reasons[0]!.code, "meaningful_target_required");
    return true;
  });
  // Never reaches the UPDATE — no "set" call should have been recorded.
  assert.equal(calls.some((c) => c.method === "set"), false);
});

test("publishDraft throws NotReadyForPublishError when fit has no rules at all", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion({
    config: {
      configSchemaVersion: "v1",
      fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
  });
  const { db } = makeFakeTransactionalDb([[profile], [draft]]);

  await assert.rejects(publishDraft(db, profile.id), NotReadyForPublishError);
});

test("publishDraft succeeds for a fit-only draft (no intent/actionability/eligibility rules) with a meaningful fit rule", async () => {
  const profile = syntheticProfile();
  const draft = syntheticVersion();
  const published = {
    ...draft,
    status: "published" as const,
    publishedAt: new Date(),
  };
  const { db } = makeFakeTransactionalDb([[profile], [draft], [published]]);

  const result = await publishDraft(db, profile.id);
  assert.equal(result, published);
});

// ---------------------------------------------------------------------
// activateVersion
// ---------------------------------------------------------------------

test("activateVersion throws VersionNotPublishedError when attempting to activate a draft version", async () => {
  const profile = syntheticProfile();
  const draftVersion = syntheticVersion({ status: "draft" });
  const { db } = makeFakeTransactionalDb([[profile], [draftVersion]]);
  await assert.rejects(
    activateVersion({
      db,
      profileId: profile.id,
      versionId: draftVersion.id,
      performedBy: null,
    }),
    VersionNotPublishedError,
  );
});

test("activateVersion throws VersionBelongsToAnotherProfileError when the version belongs to a different profile", async () => {
  const profile = syntheticProfile();
  const otherProfileVersion = syntheticVersion({
    profileId: "other-profile",
    status: "published",
  });
  const { db } = makeFakeTransactionalDb([[profile], [otherProfileVersion]]);
  await assert.rejects(
    activateVersion({
      db,
      profileId: profile.id,
      versionId: otherProfileVersion.id,
      performedBy: null,
    }),
    VersionBelongsToAnotherProfileError,
  );
});

test("activateVersion is a deterministic no-op (no event) when re-activating the already-active version", async () => {
  const version = syntheticVersion({ status: "published" });
  const profile = syntheticProfile({ activeVersionId: version.id });
  const { db, calls } = makeFakeTransactionalDb([[profile], [version]]);

  const result = await activateVersion({
    db,
    profileId: profile.id,
    versionId: version.id,
    performedBy: "jane@example.test",
  });

  assert.equal(result.alreadyActive, true);
  assert.equal(result.event, null);
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
  assert.equal(calls.filter((c) => c.method === "update").length, 0);
});

test("activateVersion updates the pointer and inserts exactly one activation event when activating a different version", async () => {
  const oldVersion = syntheticVersion({
    id: "old-version",
    status: "published",
  });
  const newVersion = syntheticVersion({
    id: "new-version",
    status: "published",
  });
  const profile = syntheticProfile({ activeVersionId: "old-version" });
  const updatedProfile = { ...profile, activeVersionId: "new-version" };
  const event = {
    id: "event-1",
    profileId: profile.id,
    eventType: "activated" as const,
    versionId: "new-version",
    previousActiveVersionId: "old-version",
    performedBy: "jane@example.test",
    performedAt: new Date(),
    reason: null,
  };
  const { db, calls } = makeFakeTransactionalDb([
    [profile],
    [newVersion],
    [updatedProfile],
    [event],
  ]);

  const result = await activateVersion({
    db,
    profileId: profile.id,
    versionId: "new-version",
    performedBy: "jane@example.test",
  });

  assert.equal(result.alreadyActive, false);
  assert.equal(result.event, event);
  assert.equal(result.profile, updatedProfile);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  const valuesCall = calls.find((c) => c.method === "values");
  assert.deepEqual(valuesCall!.args[0], {
    profileId: profile.id,
    eventType: "activated",
    versionId: "new-version",
    previousActiveVersionId: "old-version",
    performedBy: "jane@example.test",
  });
});
