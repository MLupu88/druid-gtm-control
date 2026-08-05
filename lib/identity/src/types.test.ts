// Unit tests for NormalizedSignalV1's strictness, nullability, and
// cross-field invariants.
//
// Run with: tsx --test lib/identity/src/types.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  NormalizedSignalV1Schema,
  type NormalizedSignalV1,
} from "./types.js";

function minimalSignal(): NormalizedSignalV1 {
  return {
    schemaVersion: "v1",
    source: "test-source",
    sourceEventId: "evt-1",
    occurredAt: "2026-01-01T10:00:00Z",
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
  };
}

test("a minimal anonymous signal (empty company, null person) parses successfully", () => {
  const parsed = NormalizedSignalV1Schema.parse(minimalSignal());
  assert.equal(parsed.person, null);
  assert.equal(parsed.company.domain, null);
});

test('schemaVersion must be exactly the literal "v1"', () => {
  const input = { ...minimalSignal(), schemaVersion: "v2" };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("unrestricted arbitrary top-level fields are rejected", () => {
  const input = { ...minimalSignal(), extraField: "not allowed" };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("unrestricted arbitrary nested fields are rejected", () => {
  const input = minimalSignal();
  const withExtra = {
    ...input,
    company: { ...input.company, unexpected: true },
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(withExtra));
});

test("blank strings are rejected in favor of null (never an empty-string placeholder)", () => {
  const input = minimalSignal();
  input.company.domain = "";
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("observedResolutionLevel must be one of the closed enum values", () => {
  const input = { ...minimalSignal(), observedResolutionLevel: "made_up" };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("a populated, identified person at contact level parses successfully", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "contact";
  input.company = { domain: "example.com", name: "Example Inc", externalIds: {} };
  input.person = {
    fullName: "Jordan Rivera",
    workEmail: "j.rivera@example.com",
    title: "Director of CX",
    linkedinUrl: null,
    externalIds: {},
  };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.person?.fullName, "Jordan Rivera");
});

test("person present with an anonymous/company resolution level is rejected", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "company";
  input.company = { domain: "example.com", name: null, externalIds: {} };
  input.person = {
    fullName: "Jordan Rivera",
    workEmail: null,
    title: null,
    linkedinUrl: null,
    externalIds: {},
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("contact-level resolution with a null person is rejected", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "known_crm_contact";
  input.company = { domain: "example.com", name: null, externalIds: {} };
  input.person = null;
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("a non-null person with no identity attribute at all is rejected (no ghost contacts)", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "contact";
  input.company = { domain: "example.com", name: null, externalIds: {} };
  input.person = {
    fullName: null,
    workEmail: null,
    title: null,
    linkedinUrl: null,
    externalIds: {},
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("a non-null person identified only via externalIds (no name/email/linkedin) is accepted", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "contact";
  input.company = { domain: "example.com", name: null, externalIds: {} };
  input.person = {
    fullName: null,
    workEmail: null,
    title: null,
    linkedinUrl: null,
    externalIds: { hubspot: "67890" },
  };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.person?.externalIds.hubspot, "67890");
});

test("non-anonymous resolution level with an entirely empty company is rejected", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "company";
  input.company = { domain: null, name: null, externalIds: {} };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("non-anonymous resolution level with company identified only via externalIds is accepted", () => {
  const input = minimalSignal();
  input.observedResolutionLevel = "company";
  input.company = { domain: null, name: null, externalIds: { clearbit: "abc123" } };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.company.externalIds.clearbit, "abc123");
});

test("company.externalIds rejects a blank or whitespace-only key", () => {
  const blankKey = minimalSignal();
  blankKey.observedResolutionLevel = "company";
  blankKey.company = { domain: null, name: null, externalIds: { "": "abc123" } };
  assert.throws(() => NormalizedSignalV1Schema.parse(blankKey));

  const whitespaceKey = minimalSignal();
  whitespaceKey.observedResolutionLevel = "company";
  whitespaceKey.company = {
    domain: null,
    name: null,
    externalIds: { "   ": "abc123" },
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(whitespaceKey));
});

test("person.externalIds rejects a blank or whitespace-only key", () => {
  const blankKey = minimalSignal();
  blankKey.observedResolutionLevel = "contact";
  blankKey.company = { domain: "example.com", name: null, externalIds: {} };
  blankKey.person = {
    fullName: null,
    workEmail: null,
    title: null,
    linkedinUrl: null,
    externalIds: { "": "67890" },
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(blankKey));

  const whitespaceKey = minimalSignal();
  whitespaceKey.observedResolutionLevel = "contact";
  whitespaceKey.company = { domain: "example.com", name: null, externalIds: {} };
  whitespaceKey.person = {
    fullName: null,
    workEmail: null,
    title: null,
    linkedinUrl: null,
    externalIds: { "  ": "67890" },
  };
  assert.throws(() => NormalizedSignalV1Schema.parse(whitespaceKey));
});

test("anonymous resolution level with an entirely empty company is accepted", () => {
  const parsed = NormalizedSignalV1Schema.parse(minimalSignal());
  assert.equal(parsed.observedResolutionLevel, "anonymous");
});

test("occurredAt rejects a timezone-less timestamp", () => {
  const input = { ...minimalSignal(), occurredAt: "2026-01-01T10:00:00" };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("occurredAt rejects a malformed date string", () => {
  const input = { ...minimalSignal(), occurredAt: "not-a-date" };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("occurredAt accepts a 'Z'-suffixed timestamp", () => {
  const input = { ...minimalSignal(), occurredAt: "2026-01-01T10:00:00Z" };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.occurredAt, "2026-01-01T10:00:00Z");
});

test("occurredAt accepts an explicit numeric-offset timestamp", () => {
  const input = { ...minimalSignal(), occurredAt: "2026-01-01T10:00:00+02:00" };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.occurredAt, "2026-01-01T10:00:00+02:00");
});

test("activity fields may be partially populated (page view with no campaign)", () => {
  const input = minimalSignal();
  input.activity = {
    ...input.activity,
    pageUrl: "https://example.com/pricing",
    signalDetail: "viewed pricing page",
  };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.activity.pageUrl, "https://example.com/pricing");
  assert.equal(parsed.activity.campaignId, null);
});

test("activity.pageUrl accepts a URL longer than the generic 500-char field cap", () => {
  const longUrl =
    "https://example.com/landing?" + "utm_content=" + "x".repeat(600);
  assert.ok(longUrl.length > 500);
  const input = minimalSignal();
  input.activity = { ...input.activity, pageUrl: longUrl };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.activity.pageUrl, longUrl);
});

test("activity.pageUrl rejects a URL longer than 4096 characters", () => {
  const tooLongUrl = "https://example.com/?q=" + "x".repeat(4090);
  assert.ok(tooLongUrl.length > 4096);
  const input = minimalSignal();
  input.activity = { ...input.activity, pageUrl: tooLongUrl };
  assert.throws(() => NormalizedSignalV1Schema.parse(input));
});

test("utm and clickIds are nullable as a whole sub-object", () => {
  const input = minimalSignal();
  input.activity = {
    ...input.activity,
    utm: {
      source: "google",
      medium: "cpc",
      campaign: "brand",
      content: null,
      term: null,
    },
    clickIds: { gclid: "abc", fbclid: null, liFatId: null, msclkid: null },
  };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.equal(parsed.activity.utm?.source, "google");
  assert.equal(parsed.activity.clickIds?.gclid, "abc");
});

test("sourceMetadata accepts null and an arbitrary object", () => {
  const withNull = NormalizedSignalV1Schema.parse(minimalSignal());
  assert.equal(withNull.sourceMetadata, null);

  const input = { ...minimalSignal(), sourceMetadata: { adapterFlavor: "beta" } };
  const parsed = NormalizedSignalV1Schema.parse(input);
  assert.deepEqual(parsed.sourceMetadata, { adapterFlavor: "beta" });
});
