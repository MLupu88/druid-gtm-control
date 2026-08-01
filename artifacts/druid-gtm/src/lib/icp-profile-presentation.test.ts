// Tests for ./icp-profile-presentation.ts — the pure helpers behind the
// Settings → ICP Profiles list/detail pages. No DOM needed (this package
// has no jsdom/testing-library — see ./accounts-api.limit.test.ts).
//
// Run with: tsx --test src/lib/icp-profile-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveProfileBadges,
  latestProfileActivityAt,
  humanizeVersionStatus,
  selectDefaultVersionId,
  summarizeVersionConfig,
} from "./icp-profile-presentation.js";
import type {
  IcpProfileListItem,
  IcpProfileVersionSummary,
} from "./icp-profiles-api.js";

// ---------------------------------------------------------------------
// deriveProfileBadges
// ---------------------------------------------------------------------

function syntheticVersionSummary(
  overrides: Partial<IcpProfileVersionSummary> = {},
): IcpProfileVersionSummary {
  return {
    id: "version-1",
    versionNumber: 1,
    status: "draft",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    publishedAt: null,
    notes: null,
    ...overrides,
  };
}

function syntheticProfile(
  overrides: Partial<IcpProfileListItem> = {},
): IcpProfileListItem {
  return {
    id: "profile-1",
    name: "Enterprise SaaS",
    description: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    activeVersion: null,
    draftVersion: null,
    latestVersion: null,
    ...overrides,
  };
}

test("deriveProfileBadges returns no badges for a brand-new profile with only an unlisted draft", () => {
  const profile = syntheticProfile();
  assert.deepEqual(deriveProfileBadges(profile), []);
});

test("deriveProfileBadges shows an Active badge with the version number when a version is active", () => {
  const profile = syntheticProfile({
    activeVersion: syntheticVersionSummary({ id: "v-active", versionNumber: 2, status: "published" }),
  });
  const badges = deriveProfileBadges(profile);
  assert.ok(badges.some((b) => b.key === "active" && b.label === "Active · v2"));
});

test("deriveProfileBadges shows a Draft badge when a draft exists, independent of active status", () => {
  const profile = syntheticProfile({
    draftVersion: syntheticVersionSummary({ id: "v-draft", versionNumber: 3, status: "draft" }),
  });
  const badges = deriveProfileBadges(profile);
  assert.ok(badges.some((b) => b.key === "draft" && b.label === "Draft in progress"));
});

test("deriveProfileBadges shows Latest published only when it differs from the active version", () => {
  const active = syntheticVersionSummary({ id: "v-active", versionNumber: 1, status: "published" });
  const latest = syntheticVersionSummary({ id: "v-latest", versionNumber: 2, status: "published" });
  const profile = syntheticProfile({ activeVersion: active, latestVersion: latest });
  const badges = deriveProfileBadges(profile);
  assert.ok(badges.some((b) => b.key === "latest-published" && b.label === "Latest published · v2"));
});

test("deriveProfileBadges omits Latest published when it is the same version as Active (no redundant badge)", () => {
  const same = syntheticVersionSummary({ id: "v-1", versionNumber: 1, status: "published" });
  const profile = syntheticProfile({ activeVersion: same, latestVersion: same });
  const badges = deriveProfileBadges(profile);
  assert.ok(!badges.some((b) => b.key === "latest-published"));
});

test("deriveProfileBadges omits Latest published when the latest version is still a draft (not published)", () => {
  const profile = syntheticProfile({
    latestVersion: syntheticVersionSummary({ id: "v-draft", versionNumber: 2, status: "draft" }),
  });
  const badges = deriveProfileBadges(profile);
  assert.ok(!badges.some((b) => b.key === "latest-published"));
});

test("deriveProfileBadges shows Archived only when archivedAt is present in the returned data", () => {
  const withoutArchive = deriveProfileBadges(syntheticProfile());
  assert.ok(!withoutArchive.some((b) => b.key === "archived"));

  const withArchive = deriveProfileBadges(
    syntheticProfile({ archivedAt: "2026-02-01T00:00:00Z" }),
  );
  assert.ok(withArchive.some((b) => b.key === "archived" && b.label === "Archived"));
});

test("deriveProfileBadges can show Active, Draft, and Archived together for a fully-lived profile", () => {
  const active = syntheticVersionSummary({ id: "v-1", versionNumber: 1, status: "published" });
  const draft = syntheticVersionSummary({ id: "v-2", versionNumber: 2, status: "draft" });
  const profile = syntheticProfile({
    activeVersion: active,
    draftVersion: draft,
    latestVersion: draft,
    archivedAt: "2026-03-01T00:00:00Z",
  });
  const keys = deriveProfileBadges(profile).map((b) => b.key).sort();
  assert.deepEqual(keys, ["active", "archived", "draft"]);
});

// ---------------------------------------------------------------------
// latestProfileActivityAt
// ---------------------------------------------------------------------

test("latestProfileActivityAt returns the profile's own createdAt when there is no latestVersion", () => {
  const profile = syntheticProfile({ createdAt: "2026-01-05T00:00:00Z" });
  assert.equal(latestProfileActivityAt(profile), "2026-01-05T00:00:00Z");
});

test("latestProfileActivityAt returns the more recent of profile.createdAt and latestVersion.createdAt", () => {
  const profile = syntheticProfile({
    createdAt: "2026-01-01T00:00:00Z",
    latestVersion: syntheticVersionSummary({ createdAt: "2026-02-01T00:00:00Z" }),
  });
  assert.equal(latestProfileActivityAt(profile), "2026-02-01T00:00:00Z");
});

test("latestProfileActivityAt never returns a timestamp earlier than the profile's own creation", () => {
  // Defensive case: latestVersion somehow predates the profile row itself.
  const profile = syntheticProfile({
    createdAt: "2026-05-01T00:00:00Z",
    latestVersion: syntheticVersionSummary({ createdAt: "2026-01-01T00:00:00Z" }),
  });
  assert.equal(latestProfileActivityAt(profile), "2026-05-01T00:00:00Z");
});

// ---------------------------------------------------------------------
// humanizeVersionStatus
// ---------------------------------------------------------------------

test("humanizeVersionStatus maps draft and published to plain-language labels", () => {
  assert.equal(humanizeVersionStatus("draft"), "Draft");
  assert.equal(humanizeVersionStatus("published"), "Published version");
});

// ---------------------------------------------------------------------
// selectDefaultVersionId
// ---------------------------------------------------------------------

test("selectDefaultVersionId prefers the active version when it exists among the versions", () => {
  const versions = [
    { id: "v1", status: "published" as const, versionNumber: 1 },
    { id: "v2", status: "draft" as const, versionNumber: 2 },
  ];
  assert.equal(selectDefaultVersionId(versions, "v1"), "v1");
});

test("selectDefaultVersionId falls back to the draft when there is no active version", () => {
  const versions = [
    { id: "v1", status: "published" as const, versionNumber: 1 },
    { id: "v2", status: "draft" as const, versionNumber: 2 },
  ];
  assert.equal(selectDefaultVersionId(versions, null), "v2");
});

test("selectDefaultVersionId falls back to the highest version number when there is no active version and no draft", () => {
  const versions = [
    { id: "v1", status: "published" as const, versionNumber: 1 },
    { id: "v2", status: "published" as const, versionNumber: 2 },
  ];
  assert.equal(selectDefaultVersionId(versions, null), "v2");
});

test("selectDefaultVersionId returns null when there are no versions at all", () => {
  assert.equal(selectDefaultVersionId([], null), null);
});

test("selectDefaultVersionId ignores an activeVersionId that doesn't match any listed version (defensive)", () => {
  const versions = [{ id: "v1", status: "published" as const, versionNumber: 1 }];
  assert.equal(selectDefaultVersionId(versions, "does-not-exist"), "v1");
});

// ---------------------------------------------------------------------
// summarizeVersionConfig
// ---------------------------------------------------------------------

test("summarizeVersionConfig returns null when config isn't a recognizable object", () => {
  assert.equal(summarizeVersionConfig(null), null);
  assert.equal(summarizeVersionConfig("not an object"), null);
  assert.equal(summarizeVersionConfig([1, 2, 3]), null);
});

test("summarizeVersionConfig counts rules/tiers/disqualifiers/restrictions from a well-formed IcpProfileConfigV1-shaped object", () => {
  const config = {
    configSchemaVersion: "v1",
    fit: { rules: [{ id: "a" }, { id: "b" }], tiers: [{ code: "floor", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [{ id: "c" }] },
    eligibility: { hardDisqualifiers: [{ id: "d" }], restrictions: [] },
  };
  const summary = summarizeVersionConfig(config);
  assert.deepEqual(summary, {
    fitRuleCount: 2,
    fitTierCount: 1,
    intentRuleCount: 0,
    intentTierCount: 1,
    actionabilityRuleCount: 1,
    hardDisqualifierCount: 1,
    restrictionCount: 0,
  });
});

test("summarizeVersionConfig reports null (not 0) per-dimension when that dimension is missing or malformed, never a false zero", () => {
  const summary = summarizeVersionConfig({ malformed: true });
  assert.deepEqual(summary, {
    fitRuleCount: null,
    fitTierCount: null,
    intentRuleCount: null,
    intentTierCount: null,
    actionabilityRuleCount: null,
    hardDisqualifierCount: null,
    restrictionCount: null,
  });
});

test("summarizeVersionConfig reports null only for the specific array that's actually missing, not the whole summary", () => {
  const config = {
    fit: { rules: [{ id: "a" }] /* tiers missing */ },
  };
  const summary = summarizeVersionConfig(config);
  assert.equal(summary?.fitRuleCount, 1);
  assert.equal(summary?.fitTierCount, null);
  assert.equal(summary?.intentRuleCount, null);
});
