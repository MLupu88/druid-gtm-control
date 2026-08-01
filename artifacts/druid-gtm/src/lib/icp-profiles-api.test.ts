// Source-level contract guard for ./icp-profiles-api.ts's Slice 3
// mutations (publish/activate/clone) — this package has no
// jsdom/testing-library and no established fetch-mocking convention for
// API client wrapper files (see ./accounts-api.limit.test.ts, which
// checks static usage patterns rather than mocking fetch), so this
// checks the literal source against the backend contracts read directly
// from artifacts/api-server/src/routes/icpProfiles.ts, rather than
// exercising a live/mocked request.
//
// Run with: tsx --test src/lib/icp-profiles-api.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profiles-api.ts",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `function ${name} must exist`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport > -1 ? source.slice(start, nextExport) : source.slice(start);
}

// ---------------------------------------------------------------------
// publishIcpProfileDraft — POST /:profileId/publish, EmptyRequestSchema
// (no body fields accepted per the route's own comment: "no body fields
// are accepted").
// ---------------------------------------------------------------------

test("publishIcpProfileDraft POSTs to /:profileId/publish with an empty body", () => {
  const block = functionBlock(readSource(), "publishIcpProfileDraft");
  assert.ok(block.includes("/publish`"));
  assert.ok(block.includes('method: "POST"'));
  assert.ok(block.includes("body: JSON.stringify({})"));
});

// ---------------------------------------------------------------------
// activateIcpProfileVersion — POST /:profileId/activate,
// VersionIdRequestSchema = { versionId } only.
// ---------------------------------------------------------------------

test("activateIcpProfileVersion POSTs to /:profileId/activate with exactly { versionId }", () => {
  const block = functionBlock(readSource(), "activateIcpProfileVersion");
  assert.ok(block.includes("/activate`"));
  assert.ok(block.includes('method: "POST"'));
  assert.ok(block.includes("body: JSON.stringify({ versionId })"));
});

test("ActivateIcpProfileVersionResult mirrors the service's exact { profile, event, alreadyActive } shape", () => {
  const source = readSource();
  const typeBlock = source.slice(
    source.indexOf("export interface ActivateIcpProfileVersionResult"),
    source.indexOf("export async function activateIcpProfileVersion"),
  );
  assert.ok(typeBlock.includes("profile: IcpProfile"));
  assert.ok(typeBlock.includes("event: IcpProfileActivationEvent | null"));
  assert.ok(typeBlock.includes("alreadyActive: boolean"));
});

// ---------------------------------------------------------------------
// cloneIcpProfileVersionIntoDraft — POST /:profileId/clone,
// VersionIdRequestSchema = { versionId } (the SOURCE version).
// ---------------------------------------------------------------------

test("cloneIcpProfileVersionIntoDraft POSTs to /:profileId/clone with { versionId: sourceVersionId }", () => {
  const block = functionBlock(readSource(), "cloneIcpProfileVersionIntoDraft");
  assert.ok(block.includes("/clone`"));
  assert.ok(block.includes('method: "POST"'));
  assert.ok(block.includes("body: JSON.stringify({ versionId: sourceVersionId })"));
});

// ---------------------------------------------------------------------
// None of the three new mutations touch name/description or introduce a
// second config-writing path — updateIcpProfileDraft (Slice 2) remains
// the only function that ever sends a `config` field.
// ---------------------------------------------------------------------

test("publish/activate/clone never send name, description, or config on the wire", () => {
  const source = readSource();
  for (const name of [
    "publishIcpProfileDraft",
    "activateIcpProfileVersion",
    "cloneIcpProfileVersionIntoDraft",
  ]) {
    const block = functionBlock(source, name);
    assert.ok(!block.includes("name:"), `${name} must not send a name field`);
    assert.ok(!block.includes("description:"), `${name} must not send a description field`);
    assert.ok(!block.includes("config:"), `${name} must not send a config field`);
  }
});

test("no archive/deactivate/activation-history endpoint is called anywhere in this file", () => {
  const source = readSource();
  for (const term of ["/archive", "/deactivate", "activation-events", "activationEvents"]) {
    assert.ok(!source.includes(term), `must not reference "${term}"`);
  }
});
