// Tests for ./client-radar-error-presentation.ts — see that file's header
// for the production bug this guards against: a raw env-var config error
// ("CLIENT_RADAR_BASE_URL is not configured.") reaching the Client Radar
// research panel verbatim, styled identically to a genuine failure (red
// badge, Retry button, failure timestamp). The fix uses a backend-computed
// typed `failureReason`, not frontend string matching — these tests
// exercise that typed contract directly.
//
// Run with: tsx --test src/lib/client-radar-error-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeClientRadarFailure,
  CLIENT_RADAR_NOT_CONFIGURED_MESSAGE,
} from "./client-radar-error-presentation.js";

test("a failureReason of 'not_configured' always produces the neutral unavailable message, regardless of the raw lastError text", () => {
  const result = describeClientRadarFailure(
    "CLIENT_RADAR_BASE_URL is not configured.",
    "failed",
    "not_configured",
  );
  assert.equal(result.primary, CLIENT_RADAR_NOT_CONFIGURED_MESSAGE);
  assert.notEqual(result.primary, "CLIENT_RADAR_BASE_URL is not configured.");
});

test("the original raw config error is preserved for a technical-details view when not_configured, never discarded", () => {
  const result = describeClientRadarFailure(
    "CLIENT_RADAR_BASE_URL is not configured.",
    "failed",
    "not_configured",
  );
  assert.equal(result.technical, "CLIENT_RADAR_BASE_URL is not configured.");
});

test("a null failureReason (genuine runtime failure) passes a real lastError message through unchanged", () => {
  const result = describeClientRadarFailure(
    "Client Radar returned a 502 from its research endpoint.",
    "failed",
    "runtime_failure",
  );
  assert.equal(result.primary, "Client Radar returned a 502 from its research endpoint.");
  assert.equal(result.technical, null);
});

test("failureReason 'runtime_failure' never produces the not-configured message, even if lastError text superficially resembles it", () => {
  const result = describeClientRadarFailure(
    "Something mentions CLIENT_RADAR_BASE_URL but is not the config error",
    "failed",
    "runtime_failure",
  );
  assert.notEqual(result.primary, CLIENT_RADAR_NOT_CONFIGURED_MESSAGE);
});

test("a null lastError with a null failureReason (cancelled run) still produces a truthful fallback", () => {
  assert.equal(
    describeClientRadarFailure(null, "failed", null).primary,
    "Client Radar could not complete this research run, and no error message was recorded.",
  );
  assert.equal(
    describeClientRadarFailure(null, "cancelled", null).primary,
    "This research run was cancelled.",
  );
});

test("failureReason is only ever honored for the not_configured case — a cancelled run's null failureReason never fabricates the config-error message", () => {
  const result = describeClientRadarFailure("Some cancellation detail", "cancelled", null);
  assert.notEqual(result.primary, CLIENT_RADAR_NOT_CONFIGURED_MESSAGE);
  assert.equal(result.primary, "Some cancellation detail");
});
