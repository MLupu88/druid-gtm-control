// Pure unit tests for ./signals.ts's canonicalization and structural
// equality helpers. No database, no HTTP — see ./signals.integration.test.ts
// (via ../routes/signals.integration.test.ts) for the real-Postgres write
// path this canonicalization feeds.
//
// Run with: tsx --test src/services/signals.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedSignalV1 } from "@workspace/identity";
import {
  canonicalizeNormalizedSignal,
  structurallyEqual,
  InvalidSignalDomainError,
  InvalidSignalWorkEmailError,
} from "./signals.js";

function baseSignal(overrides: Partial<NormalizedSignalV1> = {}): NormalizedSignalV1 {
  return {
    schemaVersion: "v1",
    source: "hubspot",
    sourceEventId: "evt_123",
    occurredAt: "2026-01-01T00:00:00Z",
    signalType: "page_view",
    observedResolutionLevel: "anonymous",
    company: { domain: null, name: null, externalIds: {} },
    person: null,
    activity: {
      pageUrl: null,
      signalDetail: null,
      formName: null,
      formStep: null,
      campaignId: null,
      campaignName: null,
      utm: null,
      clickIds: null,
    },
    sourceMetadata: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// source / sourceEventId canonicalization
// ---------------------------------------------------------------------

test("canonicalizeNormalizedSignal: lowercases and trims source", () => {
  const result = canonicalizeNormalizedSignal(baseSignal({ source: "  HubSpot  " }));
  assert.equal(result.source, "hubspot");
});

test("canonicalizeNormalizedSignal: trims sourceEventId but preserves case", () => {
  const result = canonicalizeNormalizedSignal(
    baseSignal({ sourceEventId: "  EVT_MixedCase123  " }),
  );
  assert.equal(result.sourceEventId, "EVT_MixedCase123");
});

// ---------------------------------------------------------------------
// company.domain canonicalization
// ---------------------------------------------------------------------

test("canonicalizeNormalizedSignal: normalizes a scheme/www/path-bearing domain", () => {
  const result = canonicalizeNormalizedSignal(
    baseSignal({
      observedResolutionLevel: "company",
      company: { domain: "https://Www.Example.com/pricing?utm=1", name: null, externalIds: {} },
    }),
  );
  assert.equal(result.company.domain, "example.com");
});

test("canonicalizeNormalizedSignal: leaves a null domain as null", () => {
  const result = canonicalizeNormalizedSignal(baseSignal());
  assert.equal(result.company.domain, null);
});

test("canonicalizeNormalizedSignal: throws InvalidSignalDomainError for a domain that cannot normalize (blank after scheme strip)", () => {
  assert.throws(
    () =>
      canonicalizeNormalizedSignal(
        baseSignal({
          observedResolutionLevel: "company",
          company: { domain: "https://", name: "Acme", externalIds: {} },
        }),
      ),
    InvalidSignalDomainError,
  );
});

test("canonicalizeNormalizedSignal: throws InvalidSignalDomainError when normalization still fails the www.-shape rule (www.www.example.com)", () => {
  assert.throws(
    () =>
      canonicalizeNormalizedSignal(
        baseSignal({
          observedResolutionLevel: "company",
          company: { domain: "www.www.example.com", name: null, externalIds: {} },
        }),
      ),
    InvalidSignalDomainError,
  );
});

// ---------------------------------------------------------------------
// person.workEmail canonicalization
// ---------------------------------------------------------------------

test("canonicalizeNormalizedSignal: trims and lowercases a valid work email", () => {
  const result = canonicalizeNormalizedSignal(
    baseSignal({
      observedResolutionLevel: "contact",
      person: {
        fullName: "Jane Doe",
        workEmail: "  Jane.Doe@Example.COM  ",
        title: null,
        linkedinUrl: null,
        externalIds: {},
      },
    }),
  );
  assert.equal(result.person?.workEmail, "jane.doe@example.com");
});

test("canonicalizeNormalizedSignal: leaves a null person as null", () => {
  const result = canonicalizeNormalizedSignal(baseSignal());
  assert.equal(result.person, null);
});

test("canonicalizeNormalizedSignal: throws InvalidSignalWorkEmailError for a malformed email", () => {
  assert.throws(
    () =>
      canonicalizeNormalizedSignal(
        baseSignal({
          observedResolutionLevel: "contact",
          person: {
            fullName: "Jane Doe",
            workEmail: "not-an-email",
            title: null,
            linkedinUrl: null,
            externalIds: {},
          },
        }),
      ),
    InvalidSignalWorkEmailError,
  );
});

test("canonicalizeNormalizedSignal: preserves every other field unchanged", () => {
  const input = baseSignal({
    signalType: "form_submission",
    activity: {
      pageUrl: "https://example.com/contact",
      signalDetail: "filled contact form",
      formName: "contact-us",
      formStep: null,
      campaignId: "camp_1",
      campaignName: "Spring Launch",
      utm: null,
      clickIds: null,
    },
    sourceMetadata: { foo: "bar" },
  });
  const result = canonicalizeNormalizedSignal(input);
  assert.equal(result.signalType, "form_submission");
  assert.deepEqual(result.activity, input.activity);
  assert.deepEqual(result.sourceMetadata, { foo: "bar" });
});

// ---------------------------------------------------------------------
// structurallyEqual
// ---------------------------------------------------------------------

test("structurallyEqual: identical primitives are equal", () => {
  assert.equal(structurallyEqual("a", "a"), true);
  assert.equal(structurallyEqual(1, 1), true);
  assert.equal(structurallyEqual(null, null), true);
  assert.equal(structurallyEqual(true, true), true);
});

test("structurallyEqual: differing primitives/types are not equal", () => {
  assert.equal(structurallyEqual("a", "b"), false);
  assert.equal(structurallyEqual(1, "1"), false);
  assert.equal(structurallyEqual(null, undefined), false);
  assert.equal(structurallyEqual(0, false), false);
});

test("structurallyEqual: object key order does not affect equality", () => {
  const a = { source: "hubspot", sourceEventId: "evt_1", company: { domain: "example.com" } };
  const b = { company: { domain: "example.com" }, sourceEventId: "evt_1", source: "hubspot" };
  assert.equal(structurallyEqual(a, b), true);
});

test("structurallyEqual: nested object key order does not affect equality", () => {
  const a = { activity: { utm: { source: "google", medium: "cpc" }, pageUrl: null } };
  const b = { activity: { pageUrl: null, utm: { medium: "cpc", source: "google" } } };
  assert.equal(structurallyEqual(a, b), true);
});

test("structurallyEqual: a missing key vs. an explicit null key are not equal", () => {
  assert.equal(structurallyEqual({ a: null }, {}), false);
  assert.equal(structurallyEqual({ a: null }, { a: null }), true);
});

test("structurallyEqual: arrays remain order-sensitive", () => {
  assert.equal(structurallyEqual([1, 2, 3], [3, 2, 1]), false);
  assert.equal(structurallyEqual([1, 2, 3], [1, 2, 3]), true);
});

test("structurallyEqual: arrays of objects compare each element structurally (key order ignored within elements, position still matters)", () => {
  const a = [{ x: 1, y: 2 }, { z: 3 }];
  const b = [{ y: 2, x: 1 }, { z: 3 }];
  const c = [{ z: 3 }, { y: 2, x: 1 }];
  assert.equal(structurallyEqual(a, b), true);
  assert.equal(structurallyEqual(a, c), false);
});

test("structurallyEqual: an array is never equal to a plain object", () => {
  assert.equal(structurallyEqual([1, 2], { "0": 1, "1": 2 }), false);
});

test("structurallyEqual: different array lengths are not equal", () => {
  assert.equal(structurallyEqual([1, 2], [1, 2, 3]), false);
});

test("structurallyEqual: deeply nested mixed object/array structures", () => {
  const a = {
    signalType: "form_submission",
    sourceMetadata: { tags: ["a", "b"], nested: { z: 1, a: 2 } },
  };
  const b = {
    sourceMetadata: { nested: { a: 2, z: 1 }, tags: ["a", "b"] },
    signalType: "form_submission",
  };
  const c = {
    sourceMetadata: { nested: { a: 2, z: 1 }, tags: ["b", "a"] },
    signalType: "form_submission",
  };
  assert.equal(structurallyEqual(a, b), true);
  assert.equal(structurallyEqual(a, c), false);
});
