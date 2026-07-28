// Unit tests for actionability scoring and its exclusion of legal/
// consent facts.
//
// Run with: tsx --test lib/evaluator/src/rules/actionability.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateActionability } from "./actionability.js";
import { ACTIONABILITY_FIELD_ALLOWLIST } from "../profileConfig.js";
import type { ActionabilityConfig } from "../profileConfig.js";

const CONFIG: ActionabilityConfig = {
  rules: [
    {
      id: "has_email",
      description: "Usable email present",
      points: 10,
      condition: { op: "exists", field: "contact.email" },
    },
    {
      id: "has_owner",
      description: "Known CRM owner",
      points: 5,
      condition: { op: "exists", field: "crm.hubspotOwner" },
    },
  ],
};

test("sums points only for matched rules", () => {
  const result = evaluateActionability(CONFIG, {
    contact: { email: "a@example.com" },
    crm: { hubspotOwner: "Andrei" },
  });
  assert.equal(result.score, 15);
});

test("no evidence => score 0, no missing inputs (exists is total, never unknown)", () => {
  const result = evaluateActionability(CONFIG, { contact: {}, crm: {} });
  assert.equal(result.score, 0);
  assert.deepEqual(result.missingInputs, []);
});

test("actionability field allowlist excludes consent/legal/routing/connector-availability fields", () => {
  const excluded = [
    "consent.email",
    "consent.call",
    "consent.liBasisCleared",
    "consent.dpoVoiceCleared",
    "doNotContact",
    "routingOutput",
    "channelAvailability",
    "integrationAvailability",
  ];
  for (const field of excluded) {
    assert.equal(
      field in ACTIONABILITY_FIELD_ALLOWLIST,
      false,
      `"${field}" must not be an allowed actionability field`,
    );
  }
});

test("actionability field allowlist only contains operational contact/owner evidence", () => {
  assert.deepEqual(Object.keys(ACTIONABILITY_FIELD_ALLOWLIST).sort(), [
    "contact.email",
    "contact.linkedinUrl",
    "contact.phone",
    "crm.hubspotContactId",
    "crm.hubspotOwner",
  ]);
});

test("score components and matched rules carry the actionability dimension label", () => {
  const result = evaluateActionability(CONFIG, {
    contact: { email: "a@example.com" },
    crm: {},
  });
  assert.equal(result.scoreComponents[0]!.dimension, "actionability");
  assert.equal(result.matchedRules[0]!.dimension, "actionability");
});
