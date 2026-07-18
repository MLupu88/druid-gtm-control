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
  buildOperatorAuditStamp,
  extractLifecycleProof,
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
  needsReview,
} from "./gtmContract.js";

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
