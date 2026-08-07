// Tests for the not-configured/failure classification added to
// ./clientRadarClient.ts — see the module comment on
// ClientRadarNotConfiguredError for why this exists: distinguishing
// "Client Radar isn't set up in this environment" from a genuine
// runtime/request failure via a stable typed reason, not brittle
// frontend substring matching.
//
// Run with: tsx --test src/lib/clientRadarClient.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE,
  CLIENT_RADAR_API_TOKEN_NOT_CONFIGURED_MESSAGE,
  isClientRadarNotConfiguredMessage,
  classifyClientRadarFailureReason,
  parseResultResponse,
  ClientRadarApiError,
} from "./clientRadarClient.js";

test("isClientRadarNotConfiguredMessage is true only for the two exact known messages", () => {
  assert.equal(isClientRadarNotConfiguredMessage(CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE), true);
  assert.equal(isClientRadarNotConfiguredMessage(CLIENT_RADAR_API_TOKEN_NOT_CONFIGURED_MESSAGE), true);
});

test("isClientRadarNotConfiguredMessage is false for a genuine runtime failure message, even one that superficially resembles it", () => {
  assert.equal(isClientRadarNotConfiguredMessage("Client Radar returned HTTP 500."), false);
  assert.equal(
    isClientRadarNotConfiguredMessage("Client Radar returned an unexpected response shape."),
    false,
  );
});

test("isClientRadarNotConfiguredMessage is false for null/undefined, never a guess", () => {
  assert.equal(isClientRadarNotConfiguredMessage(null), false);
  assert.equal(isClientRadarNotConfiguredMessage(undefined), false);
});

test("classifyClientRadarFailureReason returns null for any non-failed status", () => {
  assert.equal(classifyClientRadarFailureReason("completed", null), null);
  assert.equal(classifyClientRadarFailureReason("cancelled", CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE), null);
  assert.equal(classifyClientRadarFailureReason("queued", null), null);
  assert.equal(classifyClientRadarFailureReason("running", null), null);
  assert.equal(classifyClientRadarFailureReason("submitting", null), null);
});

test("classifyClientRadarFailureReason returns 'not_configured' for a failed run with a known config-error lastError", () => {
  assert.equal(
    classifyClientRadarFailureReason("failed", CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE),
    "not_configured",
  );
  assert.equal(
    classifyClientRadarFailureReason("failed", CLIENT_RADAR_API_TOKEN_NOT_CONFIGURED_MESSAGE),
    "not_configured",
  );
});

test("classifyClientRadarFailureReason returns 'runtime_failure' for a failed run with any other lastError, including null", () => {
  assert.equal(classifyClientRadarFailureReason("failed", "Client Radar returned HTTP 500."), "runtime_failure");
  assert.equal(classifyClientRadarFailureReason("failed", null), "runtime_failure");
});

// ---------------------------------------------------------------------
// GTM V2 Stage 5, Unit 1 — parseResultResponse's strict account.id
// validation (the only production source of
// ../services/clientRadarAccountAlias.ts's durable identity anchor).
// Exercised directly against synthetic JSON — no network, no
// CLIENT_RADAR_BASE_URL/CLIENT_RADAR_API_TOKEN needed.
// ---------------------------------------------------------------------

const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function completedEnvelope(account: Record<string, unknown> | null) {
  return {
    run_id: "run_123",
    status: "completed",
    accounts: [
      {
        company: "Acme Corp",
        domain: "acme.example",
        country: "US",
        industry: "Manufacturing",
        account,
        evidence: { items: [], total: 0 },
      },
    ],
  };
}

test("parseResultResponse: a valid account.id uuid is parsed and exposed as clientRadarAccountId", () => {
  const parsed = parseResultResponse(completedEnvelope({ id: VALID_UUID, account_key: "acme-corp" }));
  assert.equal(parsed.status, "completed");
  if (parsed.status !== "completed") return;
  assert.equal(parsed.accounts[0]?.clientRadarAccountId, VALID_UUID);
  // account_key remains available on the raw passthrough blob for
  // display/debugging, but is never itself treated as the durable id.
  assert.equal(parsed.accounts[0]?.account?.account_key, "acme-corp");
});

test("parseResultResponse: account.id is uppercase-normalized-safe (case is preserved, still valid)", () => {
  const upper = VALID_UUID.toUpperCase();
  const parsed = parseResultResponse(completedEnvelope({ id: upper }));
  if (parsed.status !== "completed") throw new Error("expected completed");
  assert.equal(parsed.accounts[0]?.clientRadarAccountId, upper);
});

test("parseResultResponse: a completed account result with account present but no id field fails parsing", () => {
  assert.throws(
    () => parseResultResponse(completedEnvelope({ account_key: "acme-corp" })),
    ClientRadarApiError,
  );
});

test("parseResultResponse: a completed account result with a malformed (non-uuid) account.id fails parsing", () => {
  assert.throws(
    () => parseResultResponse(completedEnvelope({ id: "not-a-uuid", account_key: "acme-corp" })),
    ClientRadarApiError,
  );
});

test("parseResultResponse: a malformed account.id fails even when it is otherwise a non-empty string (no loosened generic check)", () => {
  assert.throws(
    () => parseResultResponse(completedEnvelope({ id: "acme-corp-internal-id-42" })),
    ClientRadarApiError,
  );
});

test("parseResultResponse: account: null is not an error — clientRadarAccountId is simply null", () => {
  const parsed = parseResultResponse(completedEnvelope(null));
  if (parsed.status !== "completed") throw new Error("expected completed");
  assert.equal(parsed.accounts[0]?.account, null);
  assert.equal(parsed.accounts[0]?.clientRadarAccountId, null);
});
