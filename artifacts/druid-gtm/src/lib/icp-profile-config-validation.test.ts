// Tests for ./icp-profile-config-validation.ts. No DOM needed.
//
// Run with: tsx --test src/lib/icp-profile-config-validation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fieldAllowlistFor,
  humanizeFieldLabel,
  leafOperatorsForFieldType,
  describeConfigErrorLocation,
  validateProfileConfigDraft,
  issuesForPath,
} from "./icp-profile-config-validation.js";
import { buildStarterProfileConfig } from "./icp-profile-config-editing.js";

// ---------------------------------------------------------------------
// fieldAllowlistFor
// ---------------------------------------------------------------------

test("no dimension's allowlist exposes a job-title/role field — the evaluator does not support role/title scoring yet", () => {
  for (const dimension of ["fit", "intent", "actionability", "eligibility"] as const) {
    const fields = Object.keys(fieldAllowlistFor(dimension));
    assert.ok(
      !fields.some((f) => /title|role|seniority/i.test(f)),
      `dimension "${dimension}" must not expose a title/role/seniority field`,
    );
  }
});

test("fieldAllowlistFor returns a non-empty, distinct allowlist per dimension", () => {
  const fit = fieldAllowlistFor("fit");
  const intent = fieldAllowlistFor("intent");
  const actionability = fieldAllowlistFor("actionability");
  const eligibility = fieldAllowlistFor("eligibility");
  assert.ok(Object.keys(fit).length > 0);
  assert.ok(Object.keys(intent).length > 0);
  assert.ok(Object.keys(actionability).length > 0);
  assert.ok(Object.keys(eligibility).length > 0);
  assert.ok("company.domain" in fit);
  assert.ok(!("company.domain" in intent));
});

// ---------------------------------------------------------------------
// humanizeFieldLabel
// ---------------------------------------------------------------------

test("humanizeFieldLabel returns a plain-language label for a known field", () => {
  assert.equal(humanizeFieldLabel("company.employeeRange"), "Employee range");
  assert.equal(humanizeFieldLabel("company.domain"), "Company domain");
});

test("humanizeFieldLabel falls back to the raw field path for an unmapped field, never a guess", () => {
  assert.equal(humanizeFieldLabel("company.someNewField"), "company.someNewField");
});

// ---------------------------------------------------------------------
// leafOperatorsForFieldType — mirrors conditions.ts's own compatibility rules
// ---------------------------------------------------------------------

test("leafOperatorsForFieldType offers exists/eq/in for string fields, never gte or includesAny", () => {
  const ops = leafOperatorsForFieldType("string").map((o) => o.op);
  assert.deepEqual(ops.sort(), ["eq", "exists", "in"]);
});

test("leafOperatorsForFieldType offers gte in addition for number fields", () => {
  const ops = leafOperatorsForFieldType("number").map((o) => o.op);
  assert.deepEqual(ops.sort(), ["eq", "exists", "gte", "in"]);
});

test("leafOperatorsForFieldType offers only exists/includesAny for stringArray fields", () => {
  const ops = leafOperatorsForFieldType("stringArray").map((o) => o.op);
  assert.deepEqual(ops.sort(), ["exists", "includesAny"]);
});

test("leafOperatorsForFieldType offers exists/eq/in for boolean fields, never gte or includesAny", () => {
  const ops = leafOperatorsForFieldType("boolean").map((o) => o.op);
  assert.deepEqual(ops.sort(), ["eq", "exists", "in"]);
});

// ---------------------------------------------------------------------
// describeConfigErrorLocation
// ---------------------------------------------------------------------

test("describeConfigErrorLocation humanizes a dimension + section + 1-based index", () => {
  assert.equal(describeConfigErrorLocation(["fit", "tiers", 1, "minScore"]), "Company fit — tier #2");
  assert.equal(
    describeConfigErrorLocation(["intent", "rules", 0, "condition"]),
    "Buying intent — rule #1",
  );
});

test("describeConfigErrorLocation humanizes a dimension + section with no index (whole-section issue)", () => {
  assert.equal(describeConfigErrorLocation(["fit", "tiers"]), "Company fit — tiers");
});

test("describeConfigErrorLocation falls back to a neutral label for an unrecognized path", () => {
  assert.equal(describeConfigErrorLocation([]), "Profile configuration");
  assert.equal(describeConfigErrorLocation(["configSchemaVersion"]), "Profile configuration");
});

// ---------------------------------------------------------------------
// validateProfileConfigDraft — exercises the REAL canonical schema
// ---------------------------------------------------------------------

test("validateProfileConfigDraft accepts the starter config", () => {
  const result = validateProfileConfigDraft(buildStarterProfileConfig());
  assert.equal(result.valid, true);
});

test("validateProfileConfigDraft rejects a config missing the required floor tier, with a humanized location", () => {
  const config = buildStarterProfileConfig();
  config.fit.tiers = [{ code: "high", minScore: 10 }];
  const result = validateProfileConfigDraft(config);
  assert.equal(result.valid, false);
  if (!result.valid) {
    const tierIssue = result.issues.find((i) => i.message.includes("floor tier"));
    assert.ok(tierIssue, "expected a floor-tier issue");
    assert.equal(tierIssue!.location, "Company fit — tiers");
  }
});

test("validateProfileConfigDraft rejects a duplicate rule id within one dimension", () => {
  const config = buildStarterProfileConfig();
  config.fit.rules = [
    {
      id: "has_domain",
      description: "Has a domain",
      points: 10,
      condition: { op: "exists", field: "company.domain" },
    },
    {
      id: "has_domain",
      description: "Duplicate id",
      points: 5,
      condition: { op: "exists", field: "company.name" },
    },
  ];
  const result = validateProfileConfigDraft(config);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.message.includes("duplicate rule id")));
  }
});

test("validateProfileConfigDraft rejects a condition referencing a field outside the dimension's allowlist", () => {
  const config = buildStarterProfileConfig();
  config.fit.rules = [
    {
      id: "bad_field",
      description: "Uses an intent-only field on a fit rule",
      points: 5,
      condition: { op: "exists", field: "engagement.repeatVisit" },
    },
  ];
  const result = validateProfileConfigDraft(config);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.message.includes("is not allowed for dimension")));
  }
});

test("validateProfileConfigDraft returns a location humanizing 'rules' as 'rule #N' with a 1-based index", () => {
  const config = buildStarterProfileConfig();
  config.fit.rules = [
    {
      id: "r1",
      description: "",
      points: 1,
      condition: { op: "exists", field: "engagement.repeatVisit" },
    },
  ];
  const result = validateProfileConfigDraft(config);
  assert.equal(result.valid, false);
  if (!result.valid) {
    const issue = result.issues.find((i) => i.location.includes("rule #1"));
    assert.ok(issue, "expected an issue located at fit rule #1");
  }
});

// ---------------------------------------------------------------------
// issuesForPath
// ---------------------------------------------------------------------

test("issuesForPath filters to only the issues whose path starts with the given prefix", () => {
  const config = buildStarterProfileConfig();
  config.fit.tiers = [{ code: "high", minScore: 10 }]; // missing floor
  config.intent.rules = [
    {
      id: "bad",
      description: "",
      points: 1,
      condition: { op: "exists", field: "company.domain" }, // wrong allowlist
    },
  ];
  const result = validateProfileConfigDraft(config);
  assert.equal(result.valid, false);
  if (!result.valid) {
    const fitIssues = issuesForPath(result.issues, ["fit"]);
    const intentIssues = issuesForPath(result.issues, ["intent"]);
    assert.ok(fitIssues.length > 0);
    assert.ok(intentIssues.length > 0);
    assert.ok(fitIssues.every((i) => i.path[0] === "fit"));
    assert.ok(intentIssues.every((i) => i.path[0] === "intent"));
  }
});
