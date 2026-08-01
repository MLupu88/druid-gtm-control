// Source-level contract guard for ./account-icp-evaluations-api.ts,
// mirroring ./icp-profiles-api.test.ts's approach — this package has no
// jsdom/testing-library and no established fetch-mocking convention for
// API client wrapper files, so this checks the literal source against
// the backend contract read directly from
// artifacts/api-server/src/routes/accountIcpEvaluations.ts, rather than
// exercising a live/mocked request.
//
// Run with: tsx --test src/lib/account-icp-evaluations-api.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "account-icp-evaluations-api.ts",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `function ${name} must exist`);
  const nextExport = source.indexOf("\nexport async function", start + 1);
  return nextExport > -1 ? source.slice(start, nextExport) : source.slice(start);
}

test("runAccountIcpOfficialEvaluation POSTs to /accounts/:accountId/icp-evaluations/official", () => {
  const block = functionBlock(readSource(), "runAccountIcpOfficialEvaluation");
  assert.ok(block.includes("/icp-evaluations/official`"));
  assert.ok(block.includes('method: "POST"'));
});

test("runAccountIcpOfficialEvaluation sends exactly { profileId } — no snapshotId/profileVersionId/evaluatorVersionId, no evaluationMode, no preview result", () => {
  const block = functionBlock(readSource(), "runAccountIcpOfficialEvaluation");
  assert.ok(block.includes("body: JSON.stringify({ profileId })"));
  for (const forbidden of [
    "snapshotId",
    "profileVersionId",
    "evaluatorVersionId",
    "evaluationMode",
    "preview",
  ]) {
    assert.ok(!block.includes(forbidden), `must not send "${forbidden}"`);
  }
});

test("runAccountIcpOfficialEvaluation and runAccountIcpPreview hit distinct paths and are two separate functions, never sharing a generic mode parameter", () => {
  const source = readSource();
  assert.ok(source.includes("`/api/internal/accounts/${encodeURIComponent(accountId)}/icp-evaluations`"));
  assert.ok(
    source.includes(
      "`/api/internal/accounts/${encodeURIComponent(accountId)}/icp-evaluations/official`",
    ),
  );
  // "evaluationMode" is only ever discussed in doc comments explaining
  // its ABSENCE from both request bodies (see the module/function
  // comments) — neither function body itself ever reads or sends it.
  const previewBlock = functionBlock(source, "runAccountIcpPreview");
  const officialBlock = functionBlock(source, "runAccountIcpOfficialEvaluation");
  assert.ok(!previewBlock.includes("evaluationMode"));
  assert.ok(!officialBlock.includes("evaluationMode"));
});
