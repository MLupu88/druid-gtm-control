// LS7 — unit tests for the centralized definition registry.
// Run with: tsx --test src/lib/definitions.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { DEFINITIONS } from "./definitions.js";

test("every definition has a non-blank term, meaning, and basis", () => {
  for (const [key, entry] of Object.entries(DEFINITIONS)) {
    assert.ok(entry.term.trim().length > 0, `${key}.term is blank`);
    assert.ok(entry.meaning.trim().length > 0, `${key}.meaning is blank`);
    assert.ok(entry.basis.trim().length > 0, `${key}.basis is blank`);
  }
});

test("no definition uses forbidden interpretive/scoring-adjacent language it doesn't own", () => {
  // Definitions may explain that a value is calculated, but must never
  // themselves assert business interpretation LS7 is not authorized to
  // add (buying intent conclusions, health, propensity, recommendations).
  const forbidden = ["you should", "recommend", "hot account", "propensity", "likely to"];
  for (const [key, entry] of Object.entries(DEFINITIONS)) {
    const text = `${entry.meaning} ${entry.basis}`.toLowerCase();
    for (const phrase of forbidden) {
      assert.ok(!text.includes(phrase), `${key} contains forbidden phrase "${phrase}"`);
    }
  }
});

test("observations_captured explicitly disclaims being a count of external events — LS5/LS6 terminology correction", () => {
  const text = DEFINITIONS.observations_captured.basis.toLowerCase();
  assert.ok(text.includes("not a count of distinct external events"));
});

test("decision_readiness accurately describes it as calculated, never manually set", () => {
  assert.ok(DEFINITIONS.decision_readiness.basis.toLowerCase().includes("never manually set"));
});
