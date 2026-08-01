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
