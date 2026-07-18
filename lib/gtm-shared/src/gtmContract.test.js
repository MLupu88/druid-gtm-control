// gtmContract.test.js — unit tests for the Cockpit Truth & Clarity presentation helpers.
// Run with: node --test lib/gtm-shared/src/gtmContract.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreComponentDisplay,
  riskScoreDisplay,
  mqlDisplay,
  matchedByDisplay,
  scoreTierLabel,
  humanizeToken,
  firstValidNumber,
  DECISION_LABELS,
  ACTION_TYPE_LABELS,
  getTruthfulStatusPresentation,
  isConfirmedPersistedDecision,
  isConfirmedExternalExecution,
} from "./gtmContract.js";

// ───────────────────────── score components ─────────────────────────────────────

test("scoreComponentDisplay: normal numeric value renders as-is", () => {
  const result = scoreComponentDisplay({ fit_score: 30 }, "fit_score");
  assert.equal(result.available, true);
  assert.equal(result.value, 30);
  assert.equal(result.label, "Fit");
});

test("scoreComponentDisplay: a real zero is preserved, not treated as missing", () => {
  const result = scoreComponentDisplay({ interest_score: 0 }, "interest_score");
  assert.equal(result.available, true);
  assert.equal(result.value, 0);
});

test("scoreComponentDisplay: missing component score is 'Not available', never zero", () => {
  const result = scoreComponentDisplay({}, "fit_score");
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.equal(result.display, "Not available");
});

test("scoreComponentDisplay: non-numeric junk is treated as missing, not zero", () => {
  const result = scoreComponentDisplay({ fit_score: "n/a" }, "fit_score");
  assert.equal(result.available, false);
  assert.equal(result.value, null);
});

// ───────────────────────── firstValidNumber (total/account score) ───────────────

test("firstValidNumber: real zero on the first candidate is preserved", () => {
  assert.equal(firstValidNumber("0", "42"), 0);
  assert.equal(firstValidNumber(0, 42), 0);
});

test("firstValidNumber: blank first candidate falls through to the next valid one", () => {
  assert.equal(firstValidNumber("", 42), 42);
});

test("firstValidNumber: invalid first candidate falls through to the next valid one", () => {
  assert.equal(firstValidNumber("invalid", 42), 42);
});

test("firstValidNumber: all candidates missing/invalid resolves to null", () => {
  assert.equal(firstValidNumber(undefined, "invalid", ""), null);
});

// ───────────────────────── risk score sentinels ──────────────────────────────────

test("riskScoreDisplay: sentinel 999 is never shown as a real score", () => {
  const result = riskScoreDisplay({ risk_score: 999 });
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.equal(result.label, "Risk data unavailable");
  assert.equal(result.rawValue, 999, "raw value preserved for internal/debug use only");
});

test("riskScoreDisplay: sentinel 1998 is never shown as a real score", () => {
  const result = riskScoreDisplay({ risk_score: 1998 });
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.equal(result.label, "Risk data unavailable");
});

test("riskScoreDisplay: a real, non-sentinel risk score renders normally", () => {
  const result = riskScoreDisplay({ risk_score: 12 });
  assert.equal(result.available, true);
  assert.equal(result.value, 12);
});

test("riskScoreDisplay: missing risk_score is 'not calculated', never zero", () => {
  const result = riskScoreDisplay({});
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.equal(result.label, "Risk not calculated");
});

// ───────────────────────── MQL qualification (strict parsing) ───────────────────

test("mqlDisplay: a high total score never implies MQL — explicit mql_flag=false wins", () => {
  const row = { total_score: 180, mql_flag: "false", sales_review_reason: "below_mql_threshold" };
  const result = mqlDisplay(row);
  assert.equal(result.known, true);
  assert.equal(result.isMql, false);
  assert.equal(result.label, "Not MQL-qualified");
  assert.match(result.reason, /strong enough/i);
});

test("mqlDisplay: real boolean true is accepted", () => {
  const result = mqlDisplay({ mql_flag: true, mql_reason: "strong fit" });
  assert.equal(result.known, true);
  assert.equal(result.isMql, true);
  assert.equal(result.reason, "strong fit");
});

test("mqlDisplay: real boolean false is accepted", () => {
  const result = mqlDisplay({ mql_flag: false });
  assert.equal(result.known, true);
  assert.equal(result.isMql, false);
});

test("mqlDisplay: the exact string 'true'/'false' is accepted (case-insensitive)", () => {
  assert.equal(mqlDisplay({ mql_flag: "TRUE" }).isMql, true);
  assert.equal(mqlDisplay({ mql_flag: "False" }).isMql, false);
});

test("mqlDisplay: an unrecognized value never silently becomes 'not qualified'", () => {
  const result = mqlDisplay({ mql_flag: "yes" });
  assert.equal(result.known, false);
  assert.equal(result.isMql, null);
  assert.equal(result.label, "MQL qualification not recorded");
});

test("mqlDisplay: missing mql_flag is 'not recorded', never a default of false", () => {
  const result = mqlDisplay({});
  assert.equal(result.known, false);
  assert.equal(result.isMql, null);
});

// ───────────────────────── enum -> business language mappings ───────────────────

test("scoreTierLabel: known tiers map to plain business language", () => {
  assert.equal(scoreTierLabel("outbound_now"), "Ready to act now");
  assert.equal(scoreTierLabel("sales_review"), "Needs a closer look");
  assert.equal(scoreTierLabel("nurture"), "Not ready yet");
  assert.equal(scoreTierLabel("low"), "Low current priority");
});

test("scoreTierLabel: unknown tier is humanized, never raw snake_case", () => {
  assert.equal(scoreTierLabel("future_tier"), "Future Tier");
});

test("scoreTierLabel: missing tier is 'Not available'", () => {
  assert.equal(scoreTierLabel(""), "Not available");
});

test("humanizeToken: strips underscores/colons and title-cases", () => {
  assert.equal(humanizeToken("excluded:internal"), "Excluded Internal");
  assert.equal(humanizeToken("no_lawful_channel"), "No Lawful Channel");
});

test("matchedByDisplay: known source + confidence map to plain language", () => {
  const result = matchedByDisplay({ contact_origin: "rb2b", match_confidence: "high" });
  assert.equal(result.available, true);
  assert.match(result.label, /RB2B/);
  assert.match(result.label, /High confidence/);
});

test("matchedByDisplay: nothing recorded is 'Not available', never invented", () => {
  const result = matchedByDisplay({});
  assert.equal(result.available, false);
  assert.equal(result.label, "Not available");
});

test("DECISION_LABELS: technical decision enum maps to business language", () => {
  assert.equal(DECISION_LABELS.suppress, "Do not contact");
  assert.equal(DECISION_LABELS.mark_retarget, "Add to retargeting audience");
  assert.equal(DECISION_LABELS.manual_review, "Needs sales review");
});

test("ACTION_TYPE_LABELS: technical action_type enum maps to a requested-operation phrase", () => {
  assert.equal(ACTION_TYPE_LABELS.owner_alert, "Notify account owner");
  assert.equal(ACTION_TYPE_LABELS.retarget, "Add to retargeting audience");
});

// ───────────────────────── truthful status / connector rendering ────────────────

test("getTruthfulStatusPresentation: a pending connector action stays neutral", () => {
  const result = getTruthfulStatusPresentation("approved_email_pending_tool", undefined);
  assert.equal(result.phase, "pending");
  assert.match(result.message, /don't have an email-sending tool connected/i);
});

test("getTruthfulStatusPresentation: 'called' is never treated as confirmed by itself", () => {
  const result = getTruthfulStatusPresentation("called", undefined);
  assert.equal(result.phase, "pending");
  assert.match(result.message, /not yet confirmed/i);
});

test("getTruthfulStatusPresentation: empty final_status uses the neutral fallback", () => {
  const result = getTruthfulStatusPresentation("", undefined);
  assert.equal(result.phase, "pending");
  assert.equal(result.message, "Request recorded — execution not yet confirmed.");
});

test("getTruthfulStatusPresentation: an unrecognized final_status uses the neutral fallback, never the raw value", () => {
  const result = getTruthfulStatusPresentation("some_future_status", undefined);
  assert.equal(result.phase, "pending");
  assert.equal(result.message, "Request recorded — execution not yet confirmed.");
});

test("getTruthfulStatusPresentation: explicit persisted-decision proof upgrades to success", () => {
  const result = getTruthfulStatusPresentation("rejected", { persisted: true, decision_id: "d1" });
  assert.equal(result.phase, "success");
  assert.equal(result.message, "Marked as not a fit.");
});

test("getTruthfulStatusPresentation: persisted=true alone (no stable id) is NOT enough proof", () => {
  const result = getTruthfulStatusPresentation("rejected", { persisted: true });
  assert.equal(result.phase, "pending");
});

test("getTruthfulStatusPresentation: a stable id alone (persisted not true) is NOT enough proof", () => {
  const result = getTruthfulStatusPresentation("rejected", { decision_id: "d1" });
  assert.equal(result.phase, "pending");
});

test("getTruthfulStatusPresentation: explicit external-execution proof upgrades to success", () => {
  const result = getTruthfulStatusPresentation("called", {
    execution_confirmed: true,
    external_id: "call_123",
  });
  assert.equal(result.phase, "success");
  assert.doesNotMatch(result.message, /not yet confirmed/i);
});

test("getTruthfulStatusPresentation: provider_status alone (no execution_confirmed) is NOT enough proof", () => {
  const result = getTruthfulStatusPresentation("called", {
    provider_status: "completed",
    external_id: "call_123",
  });
  assert.equal(result.phase, "pending");
});

test("isConfirmedPersistedDecision / isConfirmedExternalExecution: false when no evidence exists", () => {
  assert.equal(isConfirmedPersistedDecision(undefined), false);
  assert.equal(isConfirmedExternalExecution(undefined), false);
  assert.equal(isConfirmedPersistedDecision({}), false);
  assert.equal(isConfirmedExternalExecution({}), false);
});
