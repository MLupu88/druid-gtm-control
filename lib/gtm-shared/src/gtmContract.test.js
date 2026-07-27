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
  isConfirmedArtifactReady,
  isIdempotentReplay,
  buildOperatorAuditStamp,
  extractLifecycleProof,
  resolveLifecycleEvidence,
  deriveLifecycleStatus,
  buildLifecycleEnvelope,
  buildRequestContext,
  normalizeIndustryKey,
  industryDisplay,
  resolveOperatorAccessLocal,
  resolveOperatorAccessEntra,
  countUnresolvedRows,
  isRowProcessed,
  QUEUE_QUERY_KEY,
  ACTION_LOG_QUERY_KEY,
  needsReview,
  isLinkedinSelfServeStatus,
  buttonDisabled,
  buttonDisabledPhaseC,
  VOICE_UNAVAILABLE_REASON,
  STATUS_LABELS_V3,
  STATUS_CONFIRMED_LABELS_V3,
  UNAVAILABILITY_CATEGORY,
  PROSPECTING_NOT_APPLICABLE_REASON,
  unavailabilityCategory,
  identityBlocksProspecting,
} from "./gtmContract.js";
import { MOCK_ACCOUNT_QUEUE } from "./mockData.js";

// Deliberately not a real person's address — a fixture, never a production example.
const TEST_OPERATOR = { name: "Test Operator", email: "  Operator@Example.TEST  ", role: "operator" };

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
  assert.match(result.message, /no email-sending tool is connected/i);
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

// ───────────────────────── operator audit stamp ──────────────────────────────────

test("buildOperatorAuditStamp: derives every audit field from the operator fixture, normalizing email", () => {
  const stamp = buildOperatorAuditStamp(TEST_OPERATOR, "2026-01-01T00:00:00.000Z");
  const normalizedEmail = TEST_OPERATOR.email.trim().toLowerCase();
  assert.equal(stamp.requested_by_email, normalizedEmail);
  assert.equal(stamp.requested_by_user_id, normalizedEmail, "no id supplied -> falls back to normalized email");
  assert.equal(stamp.requested_by_name, TEST_OPERATOR.name);
  assert.equal(stamp.requested_by_role, TEST_OPERATOR.role);
  assert.equal(stamp.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(stamp.updated_at, "2026-01-01T00:00:00.000Z");
});

test("buildOperatorAuditStamp: prefers operator.id over the email fallback when present", () => {
  const withId = { ...TEST_OPERATOR, id: "op_test_123" };
  const stamp = buildOperatorAuditStamp(withId);
  assert.equal(stamp.requested_by_user_id, withId.id);
});

// ───────────────────────── strict n8n proof whitelist ────────────────────────────

test("extractLifecycleProof: ignores final_status, provider_status, call_id and any other non-whitelisted field", () => {
  const proof = extractLifecycleProof({
    final_status: "called",
    provider_status: "completed",
    call_id: "abc123",
    execution_confirmed: true,
  });
  assert.equal(proof.execution_confirmed, true, "execution_confirmed IS whitelisted");
  assert.equal(proof.external_id, null, "call_id must never be treated as external_id");
  assert.equal(Object.prototype.hasOwnProperty.call(proof, "final_status"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(proof, "provider_status"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(proof, "call_id"), false);
});

test("extractLifecycleProof: rejects empty-string id fields as non-proof", () => {
  const proof = extractLifecycleProof({ decision_id: "", record_id: "   ", action_id: "d1" });
  assert.equal(proof.decision_id, null);
  assert.equal(proof.record_id, null);
  assert.equal(proof.action_id, "d1");
});

test("extractLifecycleProof: non-object input yields all-absent proof, never throws", () => {
  const proof = extractLifecycleProof(undefined);
  assert.equal(proof.persisted, false);
  assert.equal(proof.decision_id, null);
});

// ───────────────────────── lifecycle status derivation ───────────────────────────

test("deriveLifecycleStatus: error always wins, even over persisted/execution proof", () => {
  const status = deriveLifecycleStatus({
    accepted: true,
    persisted: true,
    decision_id: "d1",
    execution_confirmed: true,
    external_id: "x1",
    error: "boom",
  });
  assert.equal(status, "failed");
});

test("deriveLifecycleStatus: execution_confirmed requires a stable external_id, not just the flag", () => {
  const status = deriveLifecycleStatus({ accepted: true, execution_confirmed: true, external_id: null });
  assert.notEqual(status, "execution_confirmed");
});

test("deriveLifecycleStatus: persisted requires a stable id, not just the flag", () => {
  const status = deriveLifecycleStatus({ accepted: true, persisted: true, decision_id: null, record_id: null, action_id: null });
  assert.equal(status, "accepted");
});

test("deriveLifecycleStatus: a valid, accepted request with no further proof is 'accepted'", () => {
  assert.equal(deriveLifecycleStatus({ accepted: true }), "accepted");
});

test("deriveLifecycleStatus: not accepted and no other proof resolves to 'failed'", () => {
  assert.equal(deriveLifecycleStatus({ accepted: false }), "failed");
});

// ───────────────────────── canonical lifecycle envelope ──────────────────────────

test("buildLifecycleEnvelope: always echoes the server-generated request_id it was given", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_fixed-test-id",
    accepted: true,
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.request_id, "req_fixed-test-id");
});

test("buildLifecycleEnvelope: accepted means API validation, not persistence or execution — a valid request with a downstream failure stays accepted:true", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_1",
    accepted: true,
    error: "Could not reach the automation engine.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.accepted, true);
  assert.equal(envelope.status, "failed");
});

test("buildLifecycleEnvelope: an invalid/rejected request is accepted:false", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_2",
    accepted: false,
    error: "channel and reason are required.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.accepted, false);
  assert.equal(envelope.status, "failed");
});

test("buildLifecycleEnvelope: execution_requested is never inferred merely from calling an activation-style endpoint", () => {
  // Simulates an /activate request where n8n has not (yet) returned any explicit proof
  // field — the envelope must not assume a channel invocation happened just because
  // this was an activation request.
  const envelope = buildLifecycleEnvelope({
    requestId: "req_3",
    accepted: true,
    n8nData: { final_status: "called" },
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.execution_requested, false);
  assert.equal(envelope.execution_confirmed, false);
  assert.equal(envelope.status, "accepted");
});

test("buildLifecycleEnvelope: real persisted-decision proof upgrades status to 'persisted'", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_4",
    accepted: true,
    n8nData: { persisted: true, decision_id: "d_123" },
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.status, "persisted");
  assert.equal(envelope.decision_id, "d_123");
});

test("buildLifecycleEnvelope: real execution-confirmed proof upgrades status to 'execution_confirmed'", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_5",
    accepted: true,
    n8nData: { execution_confirmed: true, external_id: "call_789", provider: "retell" },
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.status, "execution_confirmed");
  assert.equal(envelope.external_id, "call_789");
  assert.equal(envelope.provider, "retell");
});

test("buildLifecycleEnvelope: audit fields always come from the operator argument, never from n8nData — even if n8nData tries to spoof them", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_6",
    accepted: true,
    n8nData: {
      persisted: true,
      decision_id: "d1",
      // Simulated spoofed/attacker-shaped downstream data — must have zero effect.
      requested_by_user_id: "attacker@evil.test",
      requested_by_role: "superadmin",
    },
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.requested_by_email, TEST_OPERATOR.email.trim().toLowerCase());
  assert.equal(envelope.requested_by_role, TEST_OPERATOR.role);
  assert.notEqual(envelope.requested_by_user_id, "attacker@evil.test");
});

// ───────────────────────── unverified request context ────────────────────────────

test("buildRequestContext: is explicitly marked unverified/client-supplied", () => {
  const ctx = buildRequestContext({ account_key: "dom:globex.com", company_domain: "globex.com", industry: "FinServ" });
  assert.equal(ctx.source, "client_payload");
  assert.equal(ctx.verified, false);
  assert.equal(ctx.account_id, "dom:globex.com");
  assert.equal(ctx.company_domain, "globex.com");
  assert.equal(ctx.industry.available, true);
  assert.equal(ctx.industry.key, "finserv");
});

test("buildRequestContext: missing industry is reported as not recorded, never fabricated", () => {
  const ctx = buildRequestContext({ account_key: "dom:example.com" });
  assert.equal(ctx.industry.available, false);
  assert.equal(ctx.industry.display, "Not recorded");
});

// ───────────────────────── industry normalization ────────────────────────────────

test("normalizeIndustryKey: trims, lowercases, and collapses internal whitespace", () => {
  assert.equal(normalizeIndustryKey("  Financial   Services  "), "financial services");
});

test("normalizeIndustryKey: blank/missing input is null, never an empty-string key", () => {
  assert.equal(normalizeIndustryKey(""), null);
  assert.equal(normalizeIndustryKey(undefined), null);
  assert.equal(normalizeIndustryKey(null), null);
});

test("industryDisplay: preserves the original display text alongside the normalized key", () => {
  const result = industryDisplay("  FinServ  ");
  assert.equal(result.available, true);
  assert.equal(result.key, "finserv");
  assert.equal(result.display, "FinServ");
});

// ───────────────────────── future role-aware access resolvers (unenforced) ──────

test("resolveOperatorAccessLocal: today's deployed legacy role 'operator' resolves to superadmin", () => {
  const access = resolveOperatorAccessLocal({ role: "operator" });
  assert.equal(access.effectiveRole, "superadmin");
  assert.equal(access.allowedIndustries, "all");
});

test("resolveOperatorAccessLocal: blank/unknown roles also resolve to superadmin (fail open pre-Entra)", () => {
  assert.equal(resolveOperatorAccessLocal({ role: "" }).effectiveRole, "superadmin");
  assert.equal(resolveOperatorAccessLocal({}).effectiveRole, "superadmin");
  assert.equal(resolveOperatorAccessLocal({ role: "some_future_role" }).effectiveRole, "superadmin");
});

test("resolveOperatorAccessLocal: industry_admin with allowed industries is scoped, not superadmin", () => {
  const access = resolveOperatorAccessLocal({ role: "industry_admin", allowedIndustries: ["insurance", "healthcare"] });
  assert.equal(access.effectiveRole, "industry_admin");
  assert.deepEqual(access.allowedIndustries, ["insurance", "healthcare"]);
});

test("resolveOperatorAccessLocal: industry_admin with no usable industries fails open to superadmin", () => {
  assert.equal(resolveOperatorAccessLocal({ role: "industry_admin", allowedIndustries: [] }).effectiveRole, "superadmin");
  assert.equal(resolveOperatorAccessLocal({ role: "industry_admin" }).effectiveRole, "superadmin");
});

test("resolveOperatorAccessEntra: unknown roles fail CLOSED (opposite of local mode)", () => {
  const access = resolveOperatorAccessEntra({ role: "operator" });
  assert.equal(access.effectiveRole, null);
  assert.deepEqual(access.allowedIndustries, []);
});

test("resolveOperatorAccessEntra: industry_admin with no industries stays scoped to zero access, never superadmin", () => {
  const access = resolveOperatorAccessEntra({ role: "industry_admin", allowedIndustries: [] });
  assert.equal(access.effectiveRole, "industry_admin");
  assert.deepEqual(access.allowedIndustries, []);
});

test("resolveOperatorAccessEntra: superadmin still resolves to full access", () => {
  const access = resolveOperatorAccessEntra({ role: "superadmin" });
  assert.equal(access.effectiveRole, "superadmin");
  assert.equal(access.allowedIndustries, "all");
});

// ───────────────────────── non-2xx n8n response normalization ────────────────────
// Mirrors what routes/n8n.ts's respondFromN8nResult() does for a non-2xx result: pass
// a server-generated error string (never anything extracted from the upstream body)
// alongside whatever n8nData the upstream returned, with accepted:true (our own API
// validated the request fine — the failure is downstream).

test("buildLifecycleEnvelope: a non-2xx n8n response with no explicit n8n error still resolves to 'failed'", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_non2xx_1",
    accepted: true,
    n8nData: { final_status: "queued" }, // no explicit error/persisted/execution field
    error: "Automation engine returned HTTP 500.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.status, "failed");
  assert.equal(envelope.error, "Automation engine returned HTTP 500.");
});

test("buildLifecycleEnvelope: non-2xx normalization keeps accepted:true — our API validated the request; the failure is downstream", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_non2xx_2",
    accepted: true,
    n8nData: {},
    error: "Automation engine returned HTTP 503.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.accepted, true);
});

test("buildLifecycleEnvelope: non-2xx normalization never infers persistence or execution from the upstream body", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_non2xx_3",
    accepted: true,
    n8nData: { final_status: "queued", call_id: "abc123", provider_status: "pending" },
    error: "Automation engine returned HTTP 503.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.persisted, false);
  assert.equal(envelope.execution_requested, false);
  assert.equal(envelope.execution_confirmed, false);
});

test("buildLifecycleEnvelope: an upstream body that LOOKS successful (final_status/call_id/provider_status) can never override a server-detected non-2xx failure", () => {
  const envelope = buildLifecycleEnvelope({
    requestId: "req_non2xx_4",
    accepted: true,
    n8nData: { final_status: "completed", call_id: "call_999", provider_status: "success" },
    error: "Automation engine returned HTTP 500.",
    operator: TEST_OPERATOR,
  });
  assert.equal(envelope.status, "failed");
});

// ───────────────────────── Queue page: unresolved review state ───────────────────

test("countUnresolvedRows (account_queue): a processed nurture row is excluded from the count", () => {
  const rows = [
    { account_key: "a1", operator_decision: "", final_status: "" }, // unresolved
    { account_key: "a2", operator_decision: "nurture", final_status: "nurture" }, // processed
    { account_key: "a3", operator_decision: "", final_status: "" }, // unresolved
  ];
  assert.equal(countUnresolvedRows(rows, "account_queue"), 2);
});

test("countUnresolvedRows (signal_queue): only pending_review rows with no decision yet are counted", () => {
  const rows = [
    { engine_status: "pending_review", operator_decision: "" }, // unresolved
    { engine_status: "pending_review", operator_decision: "reject" }, // processed
    { engine_status: "auto_processed", operator_decision: "" }, // not pending_review at all
  ];
  assert.equal(countUnresolvedRows(rows, "signal_queue"), 1);
});

test("countUnresolvedRows: empty/non-array input is 0, never throws", () => {
  assert.equal(countUnresolvedRows(undefined, "account_queue"), 0);
  assert.equal(countUnresolvedRows([], "account_queue"), 0);
});

test("isRowProcessed: a persisted decision (operator_decision + final_status) marks the row processed", () => {
  const row = { operator_decision: "nurture", final_status: "nurture" };
  assert.equal(isRowProcessed(row), true);
});

test("isRowProcessed: a row with nothing persisted yet remains unresolved (visible in the default view)", () => {
  const row = { operator_decision: "", final_status: "" };
  assert.equal(isRowProcessed(row), false);
});

test("isRowProcessed: a decided MQL-type row is processed even though its output type still has approve buttons available — must not be decided twice", () => {
  const decidedMqlRow = {
    recommended_output: "MQL",
    operator_decision: "reject",
    final_status: "rejected",
  };
  assert.equal(isRowProcessed(decidedMqlRow), true);
});

test("isRowProcessed: signal_queue engine_status alone (auto_processed, no persisted decision) is NOT treated as a recorded decision", () => {
  // This is the truthfulness fix: needsReview(row) is already false here (engine_status
  // isn't pending_review), but that is not proof any human decision was ever recorded —
  // isRowProcessed must not invent one.
  const row = { engine_status: "auto_processed", operator_decision: "", final_status: "" };
  assert.equal(needsReview(row), false);
  assert.equal(isRowProcessed(row), false);
});

test("isRowProcessed: a persisted operator_decision alone (no final_status) marks the row processed", () => {
  const row = { engine_status: "pending_review", operator_decision: "reject", final_status: "" };
  assert.equal(isRowProcessed(row), true);
});

test("isRowProcessed: a persisted final_status alone (no operator_decision) marks the row processed", () => {
  const row = { engine_status: "pending_review", operator_decision: "", final_status: "called" };
  assert.equal(isRowProcessed(row), true);
});

test("isRowProcessed: an unresolved pending_review row (no decision persisted) can still show actions", () => {
  const row = { engine_status: "pending_review", operator_decision: "", final_status: "" };
  assert.equal(needsReview(row), true);
  assert.equal(isRowProcessed(row), false);
});

test("QUEUE_QUERY_KEY: matches the query key the Queue page fetches with, so invalidation targets the right cache entry", () => {
  assert.deepEqual(QUEUE_QUERY_KEY, ["sheets", "queue"]);
});

test("ACTION_LOG_QUERY_KEY: matches the query key the action-log view fetches with, so invalidation targets the right cache entry", () => {
  assert.deepEqual(ACTION_LOG_QUERY_KEY, ["sheets", "action-log"]);
});

// ───────────────────────── extended lifecycle whitelist (artifact fields) ───────────────

test("extractLifecycleProof: whitelists tool_status/artifact_type/artifact_filename/artifact_content/export_filename/export_text/idempotent_replay/ledger_persisted", () => {
  const proof = extractLifecycleProof({
    tool_status: "linkedin_export_ready",
    artifact_type: "linkedin_self_serve_text",
    artifact_filename: "acme-linkedin.txt",
    artifact_content: "Hi Jordan, ...",
    export_filename: "acme-linkedin-export.txt",
    export_text: "Hi Jordan, ...",
    idempotent_replay: true,
    ledger_persisted: true,
  });
  assert.equal(proof.tool_status, "linkedin_export_ready");
  assert.equal(proof.artifact_type, "linkedin_self_serve_text");
  assert.equal(proof.artifact_filename, "acme-linkedin.txt");
  assert.equal(proof.artifact_content, "Hi Jordan, ...");
  assert.equal(proof.export_filename, "acme-linkedin-export.txt");
  assert.equal(proof.export_text, "Hi Jordan, ...");
  assert.equal(proof.idempotent_replay, true);
  assert.equal(proof.ledger_persisted, true);
});

test("extractLifecycleProof: idempotent_replay/ledger_persisted require the literal boolean true, not a truthy string", () => {
  const proof = extractLifecycleProof({ idempotent_replay: "true", ledger_persisted: "yes" });
  assert.equal(proof.idempotent_replay, false);
  assert.equal(proof.ledger_persisted, false);
});

test("extractLifecycleProof: empty-string artifact fields are rejected as non-proof, same as other id fields", () => {
  const proof = extractLifecycleProof({ artifact_content: "   ", export_text: "" });
  assert.equal(proof.artifact_content, null);
  assert.equal(proof.export_text, null);
});

// ───────────────────────── isConfirmedArtifactReady ──────────────────────────────────

test("isConfirmedArtifactReady: true with persisted + action_id + artifact_content (LinkedIn shape)", () => {
  assert.equal(
    isConfirmedArtifactReady({ persisted: true, action_id: "a1", artifact_content: "Hi there..." }),
    true,
  );
});

test("isConfirmedArtifactReady: true with persisted + action_id + export_text (alternate field name)", () => {
  assert.equal(isConfirmedArtifactReady({ persisted: true, action_id: "a1", export_text: "Hi there..." }), true);
});

test("isConfirmedArtifactReady: false without persisted:true, even with action_id and content", () => {
  assert.equal(isConfirmedArtifactReady({ persisted: false, action_id: "a1", artifact_content: "x" }), false);
});

test("isConfirmedArtifactReady: false without a stable action_id, even with persisted:true and content", () => {
  assert.equal(isConfirmedArtifactReady({ persisted: true, action_id: "", artifact_content: "x" }), false);
});

test("isConfirmedArtifactReady: false with persisted + action_id but no artifact/export text at all", () => {
  assert.equal(isConfirmedArtifactReady({ persisted: true, action_id: "a1" }), false);
});

test("isConfirmedArtifactReady: is never satisfied by decision_id/record_id alone — a distinct proof from isConfirmedPersistedDecision", () => {
  assert.equal(isConfirmedArtifactReady({ persisted: true, decision_id: "d1" }), false);
  assert.equal(isConfirmedPersistedDecision({ persisted: true, decision_id: "d1" }), true);
});

// ───────────────────────── deriveLifecycleStatus: artifact_ready ────────────────────

test("deriveLifecycleStatus: resolves to 'artifact_ready' when persisted + action_id + artifact content are all present", () => {
  const status = deriveLifecycleStatus({
    accepted: true,
    persisted: true,
    action_id: "a1",
    artifact_content: "Hi there...",
  });
  assert.equal(status, "artifact_ready");
});

test("deriveLifecycleStatus: execution_confirmed still outranks artifact_ready", () => {
  const status = deriveLifecycleStatus({
    accepted: true,
    execution_confirmed: true,
    external_id: "ext1",
    persisted: true,
    action_id: "a1",
    artifact_content: "Hi there...",
  });
  assert.equal(status, "execution_confirmed");
});

test("deriveLifecycleStatus: error always wins, even over a complete artifact-ready shape", () => {
  const status = deriveLifecycleStatus({
    accepted: true,
    error: "Automation engine returned HTTP 502.",
    persisted: true,
    action_id: "a1",
    artifact_content: "Hi there...",
  });
  assert.equal(status, "failed");
});

// ───────────────────────── getTruthfulStatusPresentation: artifact_ready ─────────────

test("getTruthfulStatusPresentation: LinkedIn artifact-ready evidence renders phase 'artifact_ready' with whitelisted artifact fields", () => {
  const result = getTruthfulStatusPresentation("approved_linkedin_export_ready", {
    persisted: true,
    action_id: "a1",
    artifact_type: "linkedin_self_serve_text",
    artifact_filename: "acme-linkedin.txt",
    artifact_content: "Hi Jordan, DRUID could help with claims automation...",
  });
  assert.equal(result.phase, "artifact_ready");
  assert.equal(result.artifact.type, "linkedin_self_serve_text");
  assert.equal(result.artifact.filename, "acme-linkedin.txt");
  assert.equal(result.artifact.content, "Hi Jordan, DRUID could help with claims automation...");
  assert.match(result.message, /ready to copy or download/i);
});

test("getTruthfulStatusPresentation: email persisted-draft artifact-ready evidence also renders phase 'artifact_ready'", () => {
  const result = getTruthfulStatusPresentation("approved_email_pending_tool", {
    persisted: true,
    action_id: "a2",
    artifact_type: "email_draft",
    artifact_filename: "acme-email-draft.txt",
    artifact_content: "Subject: Claims Automation at Acme\n\nHi Jordan, ...",
  });
  assert.equal(result.phase, "artifact_ready");
  assert.equal(result.artifact.type, "email_draft");
  assert.equal(result.artifact.content, "Subject: Claims Automation at Acme\n\nHi Jordan, ...");
});

test("getTruthfulStatusPresentation: artifact-ready prefers export_filename/export_text when artifact_filename/artifact_content are absent", () => {
  const result = getTruthfulStatusPresentation("approved_linkedin_export_ready", {
    persisted: true,
    action_id: "a1",
    export_filename: "acme-linkedin-export.txt",
    export_text: "Hi Jordan, ...",
  });
  assert.equal(result.artifact.filename, "acme-linkedin-export.txt");
  assert.equal(result.artifact.content, "Hi Jordan, ...");
});

test("getTruthfulStatusPresentation: artifact-ready never claims execution — must not reuse the external-execution fallback wording", () => {
  const result = getTruthfulStatusPresentation("approved_linkedin_export_ready", {
    persisted: true,
    action_id: "a1",
    artifact_content: "Hi Jordan, ...",
  });
  assert.doesNotMatch(result.message, /executed/i);
  assert.doesNotMatch(result.message, /\bsent\b/i);
  assert.doesNotMatch(result.message, /\bcalled\b/i);
});

test("getTruthfulStatusPresentation: an action_id with no artifact/export content is NOT artifact-ready — falls through to pending", () => {
  const result = getTruthfulStatusPresentation("approved_linkedin_export_ready", {
    persisted: true,
    action_id: "a1",
  });
  assert.equal(result.phase, "pending");
  assert.equal("artifact" in result, false);
});

// ───────────────────────── idempotent replay ─────────────────────────────────────────

test("isIdempotentReplay: true only when idempotent_replay === true", () => {
  assert.equal(isIdempotentReplay({ idempotent_replay: true }), true);
  assert.equal(isIdempotentReplay({ idempotent_replay: "true" }), false);
  assert.equal(isIdempotentReplay({}), false);
  assert.equal(isIdempotentReplay(undefined), false);
});

test("getTruthfulStatusPresentation: idempotent replay of an artifact-ready response says it was already recorded", () => {
  const result = getTruthfulStatusPresentation("approved_linkedin_export_ready", {
    persisted: true,
    action_id: "a1",
    artifact_content: "Hi Jordan, ...",
    idempotent_replay: true,
  });
  assert.match(result.message, /already recorded/i);
  // The artifact itself is still the real, previously-generated artifact — still exposed.
  assert.equal(result.artifact.content, "Hi Jordan, ...");
});

test("getTruthfulStatusPresentation: idempotent replay of a persisted-decision response says it was already recorded", () => {
  const result = getTruthfulStatusPresentation("rejected", {
    persisted: true,
    decision_id: "d1",
    idempotent_replay: true,
  });
  assert.match(result.message, /already recorded/i);
});

// ───────────────────────── blocked voice ──────────────────────────────────────────────

test("getTruthfulStatusPresentation: blocked voice status reads as blocked, never as 'pending'/'not yet confirmed'", () => {
  const result = getTruthfulStatusPresentation("blocked:voice_dispatch_not_validated", undefined);
  assert.match(result.message, /blocked/i);
  assert.match(result.message, /no call/i);
  assert.doesNotMatch(result.message, /not yet confirmed/i);
});

test("STATUS_LABELS_V3: has a dedicated entry for blocked:voice_dispatch_not_validated (never falls back to the generic fallback label)", () => {
  assert.ok(STATUS_LABELS_V3["blocked:voice_dispatch_not_validated"]);
});

test("buttonDisabled: approve_call is unconditionally disabled regardless of row/engine state (defense-in-depth)", () => {
  const liveRow = { engine_mode: "live", gate_status: "passed", block_reason: "" };
  const result = buttonDisabled("approve_call", liveRow);
  assert.equal(result.disabled, true);
  assert.equal(result.reason, VOICE_UNAVAILABLE_REASON);
});

test("buttonDisabled: approve_email/approve_linkedin remain gated by engine_mode/gate_status as before (given an identified contact)", () => {
  // resolution_level:"person" satisfies the identified-contact requirement added
  // 2026-07-24 (see hasIdentifiedContact) so this test keeps exercising the pre-existing
  // engine_mode gate independently of that new, separate requirement.
  const pausedRow = { resolution_level: "person", engine_mode: "paused" };
  assert.equal(buttonDisabled("approve_email", pausedRow).disabled, true);
  const liveRow = { resolution_level: "person", engine_mode: "live", gate_status: "passed" };
  assert.equal(buttonDisabled("approve_linkedin", liveRow).disabled, false);
});

// ───────────────────────── identified-contact requirement (product decision, 2026-07-24) ─

test("buttonDisabled: approve_email/approve_linkedin are blocked for a company-level signal-queue row, even with a fully live engine/passed gate", () => {
  const row = { resolution_level: "company", engine_mode: "live", gate_status: "passed" };
  assert.equal(buttonDisabled("approve_email", row).disabled, true);
  assert.equal(buttonDisabled("approve_linkedin", row).disabled, true);
});

test("buttonDisabled: approve_email/approve_linkedin are blocked for an anonymous/missing-resolution signal-queue row", () => {
  const row = { engine_mode: "live", gate_status: "passed" };
  assert.equal(buttonDisabled("approve_email", row).disabled, true);
  assert.equal(buttonDisabled("approve_linkedin", row).disabled, true);
});

test("buttonDisabledPhaseC: reconstructed_contact fails closed for approve_email/approve_linkedin, even with a fully live/passing config and row", () => {
  const row = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "reconstructed_contact" };
  const liveCfg = { engine_mode: "live" };
  assert.equal(buttonDisabledPhaseC("approve_email", row, liveCfg), true);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", row, liveCfg), true);
});

test("buttonDisabledPhaseC: company_level/anonymous identity fails closed the same way", () => {
  const companyRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "company_level" };
  const anonymousRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "anonymous" };
  const missingRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "" };
  const liveCfg = { engine_mode: "live" };
  for (const row of [companyRow, anonymousRow, missingRow]) {
    assert.equal(buttonDisabledPhaseC("approve_email", row, liveCfg), true);
    assert.equal(buttonDisabledPhaseC("approve_linkedin", row, liveCfg), true);
  }
});

test("buttonDisabledPhaseC: previewOnly does NOT bypass the identified-contact requirement — an insufficiently identified row stays blocked in Sample/preview mode", () => {
  // Regression test for the exact ordering bug this PR fixes: the identity check must run
  // BEFORE the previewOnly early return, so Sample mode can never reveal a prospect-facing
  // draft-preparation button for reconstructed_contact/company_level/anonymous/missing rows.
  const reconstructedRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "reconstructed_contact" };
  const companyRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "company_level" };
  const anonymousRow = { ...GLOBEX_ACCOUNT_ROW, identity_resolution: "anonymous" };
  for (const row of [reconstructedRow, companyRow, anonymousRow]) {
    assert.equal(buttonDisabledPhaseC("approve_email", row, {}, true), true);
    assert.equal(buttonDisabledPhaseC("approve_linkedin", row, {}, true), true);
  }
});

test("buttonDisabledPhaseC: previewOnly still unlocks email/linkedin for a properly identified row (unaffected by the new identity check)", () => {
  // GLOBEX_ACCOUNT_ROW is identified_contact — confirms the identity check doesn't
  // regress the existing previewOnly bypass for rows that ARE sufficiently identified.
  assert.equal(buttonDisabledPhaseC("approve_email", GLOBEX_ACCOUNT_ROW, {}, true), false);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", GLOBEX_ACCOUNT_ROW, {}, true), false);
});

// ───────────────────────── backward-compatible status labels ────────────────────────

test("STATUS_LABELS_V3: both approved_linkedin_pending_tool (old) and approved_linkedin_export_ready (new) resolve to real labels, never the generic fallback", () => {
  assert.ok(STATUS_LABELS_V3.approved_linkedin_pending_tool);
  assert.ok(STATUS_LABELS_V3.approved_linkedin_export_ready);
  assert.notEqual(STATUS_LABELS_V3.approved_linkedin_pending_tool, STATUS_LABELS_V3.approved_linkedin_export_ready);
});

test("STATUS_CONFIRMED_LABELS_V3: both old and new LinkedIn self-serve statuses have confirmed-artifact wording", () => {
  assert.ok(STATUS_CONFIRMED_LABELS_V3.approved_linkedin_pending_tool);
  assert.ok(STATUS_CONFIRMED_LABELS_V3.approved_linkedin_export_ready);
});

test("isLinkedinSelfServeStatus: recognizes both the old and new persisted final_status values", () => {
  assert.equal(isLinkedinSelfServeStatus("approved_linkedin_pending_tool"), true);
  assert.equal(isLinkedinSelfServeStatus("approved_linkedin_export_ready"), true);
  assert.equal(isLinkedinSelfServeStatus("approved_email_pending_tool"), false);
  assert.equal(isLinkedinSelfServeStatus(""), false);
  assert.equal(isLinkedinSelfServeStatus(undefined), false);
});

test("getTruthfulStatusPresentation: an OLDER persisted row (approved_linkedin_pending_tool, no artifact fields) still gets truthful, non-crashing pending wording", () => {
  // Simulates a row persisted before this feature shipped: final_status is the old
  // value and no lifecycle evidence is available at all (e.g. reading from historical
  // action-log data, not a fresh POST response).
  const result = getTruthfulStatusPresentation("approved_linkedin_pending_tool", undefined);
  assert.equal(result.phase, "pending");
  assert.equal(result.message, STATUS_LABELS_V3.approved_linkedin_pending_tool);
});

// ───────────────────────── resolveLifecycleEvidence (UI trust boundary) ─────────────
// This is the exact function ActionModal calls to pick evidence for
// getTruthfulStatusPresentation — it must never let a raw, unwhitelisted response body
// pass as trusted proof.

test("resolveLifecycleEvidence: prefers the server-built lifecycle envelope when present, unmodified", () => {
  const lifecycle = { persisted: true, action_id: "a1", artifact_content: "Hi there..." };
  const rawData = { final_status: "approved_linkedin_export_ready", something_else: "noise" };
  const evidence = resolveLifecycleEvidence(lifecycle, rawData);
  assert.equal(evidence, lifecycle, "must be the same lifecycle object, not a re-derived one");
});

test("resolveLifecycleEvidence: a real artifact-ready lifecycle envelope resolves to artifact_ready via getTruthfulStatusPresentation", () => {
  const lifecycle = {
    persisted: true,
    action_id: "a1",
    artifact_type: "linkedin_self_serve_text",
    artifact_filename: "acme.txt",
    artifact_content: "Hi Jordan, ...",
  };
  const evidence = resolveLifecycleEvidence(lifecycle, { anything: "ignored when lifecycle is present" });
  const presentation = getTruthfulStatusPresentation("approved_linkedin_export_ready", evidence);
  assert.equal(presentation.phase, "artifact_ready");
  assert.equal(presentation.artifact.content, "Hi Jordan, ...");
});

test("resolveLifecycleEvidence: when lifecycle is missing, runs rawData through extractLifecycleProof rather than trusting it raw", () => {
  const rawData = { persisted: true, action_id: "a1", artifact_content: "Hi there..." };
  const evidence = resolveLifecycleEvidence(undefined, rawData);
  assert.deepEqual(evidence, extractLifecycleProof(rawData));
  assert.notEqual(evidence, rawData, "must never be the same (unvetted) object reference as rawData");
});

test("resolveLifecycleEvidence: a raw response with success-looking-but-unwhitelisted fields (final_status/provider_status) never becomes confirmed proof", () => {
  // This is the exact failure mode being guarded against: an unwhitelisted response body
  // that LOOKS successful in plain text, but carries none of the real proof fields.
  const rawData = {
    final_status: "approved_linkedin_export_ready",
    provider_status: "sent",
    call_id: "c1",
    tool_status: "linkedin_export_ready",
    // Deliberately no persisted/action_id/artifact_content/export_text.
  };
  const evidence = resolveLifecycleEvidence(undefined, rawData);
  const presentation = getTruthfulStatusPresentation("approved_linkedin_export_ready", evidence);
  assert.equal(presentation.phase, "pending");
  assert.equal("artifact" in presentation, false);
});

test("resolveLifecycleEvidence: when lifecycle is missing, a rawData shape that genuinely carries the whitelisted proof fields still resolves to artifact_ready", () => {
  // Supports a genuinely older response shape (no wrapping lifecycle envelope) that
  // nonetheless carries real proof fields directly — extractLifecycleProof still
  // recognizes them; the whitelist, not the wrapper shape, is what matters.
  const rawData = { persisted: true, action_id: "a1", export_text: "Hi Jordan, ..." };
  const evidence = resolveLifecycleEvidence(undefined, rawData);
  const presentation = getTruthfulStatusPresentation("approved_linkedin_export_ready", evidence);
  assert.equal(presentation.phase, "artifact_ready");
  assert.equal(presentation.artifact.content, "Hi Jordan, ...");
});

test("resolveLifecycleEvidence: null/array lifecycle values are rejected, falling through to extractLifecycleProof(rawData)", () => {
  const rawData = { persisted: true, action_id: "a1", artifact_content: "x" };
  assert.deepEqual(resolveLifecycleEvidence(null, rawData), extractLifecycleProof(rawData));
  assert.deepEqual(resolveLifecycleEvidence([1, 2, 3], rawData), extractLifecycleProof(rawData));
});

test("resolveLifecycleEvidence: undefined rawData with no lifecycle never throws and resolves to pending", () => {
  const evidence = resolveLifecycleEvidence(undefined, undefined);
  const presentation = getTruthfulStatusPresentation("approved_linkedin_export_ready", evidence);
  assert.equal(presentation.phase, "pending");
});

// ───────────────────────── buttonDisabledPhaseC: voice lock + preview-mode wiring ────
// Covers the account-detail-sheet wiring fix: sample/preview rows can open the composer
// without a live ICP_Config fetch, voice stays locked in every mode, and the live/real
// account-queue gate (fail-closed on missing config) is unchanged for non-preview rows.

const GLOBEX_ACCOUNT_ROW = MOCK_ACCOUNT_QUEUE.find((r) => r.company_name === "Globex");

test("buttonDisabledPhaseC: approve_call is always disabled, even with a fully-cleared live config/row", () => {
  const permissiveCfg = { engine_mode: "live", us_voice_cleared: "true" };
  const permissiveRow = { ...GLOBEX_ACCOUNT_ROW, consent_call: "true", dpo_voice_cleared: "true" };
  assert.equal(buttonDisabledPhaseC("approve_call", permissiveRow, permissiveCfg), true);
  assert.equal(
    buttonDisabledPhaseC("approve_call", permissiveRow, permissiveCfg, true),
    true,
    "previewOnly must not unlock voice either",
  );
});

test("buttonDisabledPhaseC: sample Globex can open email composition in preview mode with no live config", () => {
  assert.equal(buttonDisabledPhaseC("approve_email", GLOBEX_ACCOUNT_ROW, {}, true), false);
});

test("buttonDisabledPhaseC: sample Globex can open LinkedIn composition in preview mode with no live config", () => {
  assert.equal(buttonDisabledPhaseC("approve_linkedin", GLOBEX_ACCOUNT_ROW, {}, true), false);
});

test("buttonDisabledPhaseC: previewOnly bypass ignores region/consent gates too — enabled unconditionally for email/linkedin", () => {
  const noConsentEuRow = { ...GLOBEX_ACCOUNT_ROW, region: "de", consent_email: "", li_basis_cleared: "" };
  assert.equal(buttonDisabledPhaseC("approve_email", noConsentEuRow, {}, true), false);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", noConsentEuRow, {}, true), false);
});

test("buttonDisabledPhaseC: previewOnly never touches 'Send for a closer look' or 'Not a fit' — unaffected in both modes", () => {
  assert.equal(buttonDisabledPhaseC("to_sales_review", GLOBEX_ACCOUNT_ROW, {}, false), false);
  assert.equal(buttonDisabledPhaseC("to_sales_review", GLOBEX_ACCOUNT_ROW, {}, true), false);
  assert.equal(buttonDisabledPhaseC("reject", GLOBEX_ACCOUNT_ROW, {}, false), false);
  assert.equal(buttonDisabledPhaseC("reject", GLOBEX_ACCOUNT_ROW, {}, true), false);
});

test("buttonDisabledPhaseC: live mode (non-preview) still obeys cfg.engine_mode — a paused/review-only engine blocks activation", () => {
  const notLiveCfg = { engine_mode: "recommend_only" };
  assert.equal(buttonDisabledPhaseC("approve_email", GLOBEX_ACCOUNT_ROW, notLiveCfg), true);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", GLOBEX_ACCOUNT_ROW, notLiveCfg), true);
});

test("buttonDisabledPhaseC: live mode (non-preview) with a genuinely live config enables email/linkedin for an eligible row", () => {
  const liveCfg = { engine_mode: "live" };
  assert.equal(buttonDisabledPhaseC("approve_email", GLOBEX_ACCOUNT_ROW, liveCfg), false);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", GLOBEX_ACCOUNT_ROW, liveCfg), false);
});

test("buttonDisabledPhaseC: missing/empty config remains fail-closed outside preview mode (the original production bug)", () => {
  assert.equal(buttonDisabledPhaseC("approve_email", GLOBEX_ACCOUNT_ROW, {}), true);
  assert.equal(buttonDisabledPhaseC("approve_linkedin", GLOBEX_ACCOUNT_ROW, {}), true);
  assert.equal(buttonDisabledPhaseC("approve_call", GLOBEX_ACCOUNT_ROW, {}), true);
});

// ───────────────────────── unavailabilityCategory / UNAVAILABILITY_CATEGORY (PR 2) ──────

test("UNAVAILABILITY_CATEGORY: exact values are stable (used as keys elsewhere, e.g. the UI)", () => {
  assert.equal(UNAVAILABILITY_CATEGORY.VOICE_NOT_ENABLED, "voice_not_enabled");
  assert.equal(UNAVAILABILITY_CATEGORY.NOT_APPLICABLE, "not_applicable");
  assert.equal(UNAVAILABILITY_CATEGORY.TEMPORARY, "temporary");
});

test("VOICE_UNAVAILABLE_REASON: describes voice as not-yet-enabled, never as permanent", () => {
  assert.match(VOICE_UNAVAILABLE_REASON, /compliance/i);
  assert.match(VOICE_UNAVAILABLE_REASON, /provider/i);
  assert.doesNotMatch(VOICE_UNAVAILABLE_REASON, /\bpermanent(ly)?\b/i);
  assert.doesNotMatch(VOICE_UNAVAILABLE_REASON, /non-resolving/i);
});

test("PROSPECTING_NOT_APPLICABLE_REASON: exact copy", () => {
  assert.equal(PROSPECTING_NOT_APPLICABLE_REASON, "Not applicable for this recommendation.");
});

test("unavailabilityCategory: approve_call is always voice_not_enabled, regardless of output type", () => {
  for (const outputType of ["MQL", "Sales Review", "Pipeline Assist", "Owner Alert", "Nurture", "Retarget", "Suppressed"]) {
    assert.equal(unavailabilityCategory("approve_call", outputType), UNAVAILABILITY_CATEGORY.VOICE_NOT_ENABLED);
  }
});

test("unavailabilityCategory: approve_email/approve_linkedin are not_applicable under every NO_PROSPECT output", () => {
  for (const outputType of ["Pipeline Assist", "Owner Alert", "Retarget", "Suppressed"]) {
    assert.equal(unavailabilityCategory("approve_email", outputType), UNAVAILABILITY_CATEGORY.NOT_APPLICABLE);
    assert.equal(unavailabilityCategory("approve_linkedin", outputType), UNAVAILABILITY_CATEGORY.NOT_APPLICABLE);
  }
});

test("unavailabilityCategory: approve_email/approve_linkedin are temporary under non-NO_PROSPECT outputs", () => {
  for (const outputType of ["MQL", "Sales Review", "Nurture"]) {
    assert.equal(unavailabilityCategory("approve_email", outputType), UNAVAILABILITY_CATEGORY.TEMPORARY);
    assert.equal(unavailabilityCategory("approve_linkedin", outputType), UNAVAILABILITY_CATEGORY.TEMPORARY);
  }
});

test("unavailabilityCategory: any other button key falls through to temporary (no special-casing beyond voice/email/linkedin)", () => {
  assert.equal(unavailabilityCategory("dismiss", "Suppressed"), UNAVAILABILITY_CATEGORY.TEMPORARY);
  assert.equal(unavailabilityCategory("notify_owner", "Pipeline Assist"), UNAVAILABILITY_CATEGORY.TEMPORARY);
  assert.equal(unavailabilityCategory("nurture", "Nurture"), UNAVAILABILITY_CATEGORY.TEMPORARY);
});

// ───────────────────────── identityBlocksProspecting (PR 2) ─────────────────────────────

test("identityBlocksProspecting: false when the contact is identified, even for MQL (email/linkedin are offered and available)", () => {
  assert.equal(identityBlocksProspecting({ identity_resolution: "identified_contact" }, "MQL"), false);
  assert.equal(identityBlocksProspecting({ identity_resolution: "known_crm_contact" }, "MQL"), false);
});

test("identityBlocksProspecting: true when identity is insufficient AND the output type would otherwise offer email/linkedin", () => {
  for (const identity of ["reconstructed_contact", "company_level", "anonymous", "", undefined]) {
    const row = identity === undefined ? {} : { identity_resolution: identity };
    assert.equal(identityBlocksProspecting(row, "MQL"), true, `identity=${identity}`);
  }
});

test("identityBlocksProspecting: false when identity is insufficient BUT the output type never offers email/linkedin anyway (NO_PROSPECT)", () => {
  for (const outputType of ["Pipeline Assist", "Owner Alert", "Retarget", "Suppressed"]) {
    assert.equal(identityBlocksProspecting({ identity_resolution: "anonymous" }, outputType), false, outputType);
  }
});

test("identityBlocksProspecting: false when identity is insufficient BUT the output type is Sales Review (also never offers email/linkedin)", () => {
  assert.equal(identityBlocksProspecting({ identity_resolution: "company_level" }, "Sales Review"), false);
});

test("identityBlocksProspecting: works for signal-queue shaped rows (resolution_level) as well as account-queue rows (identity_resolution)", () => {
  assert.equal(identityBlocksProspecting({ resolution_level: "company" }, "MQL"), true);
  assert.equal(identityBlocksProspecting({ resolution_level: "person" }, "MQL"), false);
});
