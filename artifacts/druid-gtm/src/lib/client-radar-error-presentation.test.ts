// Tests for ./client-radar-error-presentation.ts — see that file's
// header for the production bug this guards against: a raw env-var
// config error ("CLIENT_RADAR_BASE_URL is not configured.") reaching the
// Client Radar research panel verbatim.
//
// Run with: tsx --test src/lib/client-radar-error-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeClientRadarFailure } from "./client-radar-error-presentation.js";

test("a raw CLIENT_RADAR_BASE_URL config error is replaced with a truthful, actionable message", () => {
  const result = describeClientRadarFailure(
    "CLIENT_RADAR_BASE_URL is not configured.",
    "failed",
  );
  assert.equal(result.primary, "Client Radar is not configured for this environment.");
  assert.notEqual(result.primary, "CLIENT_RADAR_BASE_URL is not configured.");
});

test("a raw CLIENT_RADAR_API_TOKEN config error is also replaced", () => {
  const result = describeClientRadarFailure(
    "CLIENT_RADAR_API_TOKEN is not configured.",
    "failed",
  );
  assert.equal(result.primary, "Client Radar is not configured for this environment.");
});

test("the original raw config error is preserved for a technical-details view, not discarded", () => {
  const result = describeClientRadarFailure(
    "CLIENT_RADAR_BASE_URL is not configured.",
    "failed",
  );
  assert.equal(result.technical, "CLIENT_RADAR_BASE_URL is not configured.");
});

test("a genuine non-config error message passes through unchanged", () => {
  const result = describeClientRadarFailure(
    "Client Radar returned a 502 from its research endpoint.",
    "failed",
  );
  assert.equal(result.primary, "Client Radar returned a 502 from its research endpoint.");
  assert.equal(result.technical, null);
});

test("a null lastError still produces a truthful fallback per status", () => {
  assert.equal(
    describeClientRadarFailure(null, "failed").primary,
    "Client Radar could not complete this research run, and no error message was recorded.",
  );
  assert.equal(
    describeClientRadarFailure(null, "cancelled").primary,
    "This research run was cancelled.",
  );
});
