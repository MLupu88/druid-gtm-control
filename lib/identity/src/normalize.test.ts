// Unit tests for lib/identity's pure deterministic normalization
// helpers.
//
// Run with: tsx --test lib/identity/src/normalize.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalDedupeKey,
  normalizeAliasValue,
  normalizeCompanyDomain,
  normalizeWorkEmail,
} from "./normalize.js";

test("normalizeCompanyDomain strips protocol, www., path/query/fragment, and trailing dot", () => {
  assert.equal(
    normalizeCompanyDomain("HTTPS://WWW.Example.com/path?a=1#frag"),
    "example.com",
  );
  assert.equal(normalizeCompanyDomain("  Example.com.  "), "example.com");
  assert.equal(normalizeCompanyDomain("http://example.com"), "example.com");
});

test("normalizeCompanyDomain returns null for blank/whitespace/undefined input", () => {
  assert.equal(normalizeCompanyDomain(""), null);
  assert.equal(normalizeCompanyDomain("   "), null);
  assert.equal(normalizeCompanyDomain(null), null);
  assert.equal(normalizeCompanyDomain(undefined), null);
});

test("normalizeCompanyDomain is idempotent", () => {
  const once = normalizeCompanyDomain("HTTPS://WWW.Example.com/path");
  const twice = normalizeCompanyDomain(once);
  assert.equal(once, twice);
});

test("normalizeWorkEmail lowercases and trims a valid address", () => {
  assert.equal(normalizeWorkEmail("  Jordan@Example.COM "), "jordan@example.com");
});

test("normalizeWorkEmail returns null for missing/multiple '@' or blank parts", () => {
  assert.equal(normalizeWorkEmail("not-an-email"), null);
  assert.equal(normalizeWorkEmail("a@b@example.com"), null);
  assert.equal(normalizeWorkEmail("@example.com"), null);
  assert.equal(normalizeWorkEmail("jordan@"), null);
  assert.equal(normalizeWorkEmail(""), null);
  assert.equal(normalizeWorkEmail(null), null);
});

test("buildSignalDedupeKey is deterministic", () => {
  const first = buildSignalDedupeKey("hubspot", "evt-123");
  const second = buildSignalDedupeKey("hubspot", "evt-123");
  assert.equal(first, second);
});

test("buildSignalDedupeKey differs when either input changes", () => {
  const base = buildSignalDedupeKey("hubspot", "evt-123");
  assert.notEqual(base, buildSignalDedupeKey("hubspot", "evt-124"));
  assert.notEqual(base, buildSignalDedupeKey("salesforce", "evt-123"));
});

test("buildSignalDedupeKey source is case/whitespace-insensitive, sourceEventId is case-preserving", () => {
  assert.equal(
    buildSignalDedupeKey("HubSpot", "evt-123"),
    buildSignalDedupeKey(" hubspot ", "evt-123"),
  );
  assert.notEqual(
    buildSignalDedupeKey("hubspot", "EVT-123"),
    buildSignalDedupeKey("hubspot", "evt-123"),
  );
});

test("buildSignalDedupeKey throws on blank source or sourceEventId", () => {
  assert.throws(() => buildSignalDedupeKey("", "evt-123"));
  assert.throws(() => buildSignalDedupeKey("hubspot", ""));
  assert.throws(() => buildSignalDedupeKey("   ", "evt-123"));
});

test("buildSignalDedupeKey does not collide across a delimiter boundary (::)", () => {
  const a = buildSignalDedupeKey("a::b", "c");
  const b = buildSignalDedupeKey("a", "b::c");
  assert.notEqual(a, b);
});

test("buildSignalDedupeKey does not collide across a delimiter boundary (|)", () => {
  const a = buildSignalDedupeKey("a|b", "c");
  const b = buildSignalDedupeKey("a", "b|c");
  assert.notEqual(a, b);
});

test('normalizeAliasValue("domain") behaves like normalizeCompanyDomain', () => {
  assert.equal(
    normalizeAliasValue("HTTPS://WWW.Example.com/path", "domain"),
    "example.com",
  );
});

test('normalizeAliasValue("domain") throws when the value has no normalizable domain', () => {
  assert.throws(() => normalizeAliasValue("   ", "domain"));
});

test('normalizeAliasValue("case_insensitive") trims and lowercases', () => {
  assert.equal(
    normalizeAliasValue("  Acme Inc  ", "case_insensitive"),
    "acme inc",
  );
});

test('normalizeAliasValue("exact") trims but preserves case', () => {
  assert.equal(normalizeAliasValue("  AbC123XyZ  ", "exact"), "AbC123XyZ");
});

test('normalizeAliasValue("exact") does not merge two distinct case-sensitive IDs', () => {
  const first = normalizeAliasValue("AbC123XyZ", "exact");
  const second = normalizeAliasValue("abc123xyz", "exact");
  assert.notEqual(first, second);
});

test("normalizeAliasValue throws on a value that normalizes to blank", () => {
  assert.throws(() => normalizeAliasValue("   ", "case_insensitive"));
  assert.throws(() => normalizeAliasValue("   ", "exact"));
});
