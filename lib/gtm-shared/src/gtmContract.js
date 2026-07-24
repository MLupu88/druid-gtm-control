// gtmContract.js — the single source of truth shared between the cockpit and the n8n engine.
// The engine WRITES these columns to the ICP_Review_Queue tab; the cockpit READS them and
// DISPLAYS them. The cockpit must never recompute gates or cost — n8n is the authority.

// Exact column names in the ICP_Review_Queue sheet tab (order matches the sheet).
export const QUEUE_COLUMNS = [
  "queue_key","queue_id","signal_at","company_domain","company_name","country","stream",
  "resolution_level","industry","vertical","account_score","score_tier","contact_name",
  "contact_email","contact_phone","recommended_solution","why_now","recommended_action","tool",
  "consumes_credits","cost_impact","cost_explanation","gate_status","block_reason","gate_detail",
  "engine_status","last_signal_source","engine_mode","test_mode",
  // operator-owned (written ONLY by the cockpit via the approval endpoints — engine never touches these):
  "operator_decision","approved_by","approved_at","reason","final_status","processed_at"
];

// A row "needs review" when the engine queued it and no operator decision exists yet.
export const needsReview = (row) =>
  String(row.engine_status).toLowerCase() === "pending_review" &&
  !String(row.operator_decision || "").trim();

// gate_detail is a JSON string of individual gates. Values: passed | failed | warning | na.
export const parseGates = (row) => {
  try { return JSON.parse(row.gate_detail || "{}"); } catch { return {}; }
};

// ---- The THREE n8n approval endpoints (consolidated). All POST, all server-side, all carry
// the x-gtm-secret header. The action rides in the body. ----
export const ENDPOINTS = {
  activate: "/webhook/gtm-activate",   // body.channel = voice | email | linkedin
  decision: "/webhook/gtm-decision",   // body.decision = reject | nurture | manual_review | suppress
  action:   "/webhook/gtm-action",     // body.action  = owner_alert | retry
  testSignal:"/webhook/icp-account-shadow", // "Try a Sample Lead" — SHADOW engine only (side-effect-free). NEVER post test signals to /icp-signal-intake: the live intake lineage drops test_mode and can trigger real enrichment.
  config:"/webhook/gtm-config", // Settings writes — allowlisted keys: engine_mode, us_voice_cleared, queue_source, account_queue_write
  preview:"/webhook/icp-personalize-execute" // On-demand personalization PREVIEW (returns copy; never dispatches)
};

// The ONLY config keys/values the cockpit may write (mirrors the n8n allowlist exactly).
export const CONFIG_WRITES = {
  engine_mode:        ["live","recommend_only","paused"],
  us_voice_cleared:   ["true","false"],
  queue_source:       ["signal_queue","account_queue"],
  account_queue_write:["on","off"]
};
// Flipping us_voice_cleared to "true" unlocks US TCPA voice — require an explicit typed confirmation.
export const CONFIG_DANGER = { key:"us_voice_cleared", value:"true",
  confirmText:"UNLOCK US VOICE",
  warning:"This enables AI voice calls to US numbers under TCPA. Only do this after written legal sign-off." };

// Maps each cockpit button to its endpoint + the action token to send.
export const BUTTONS = {
  // kind:"server" posts to a receiver; kind:"ui" is a local UI transition (no receiver call).
  // Labels are operator-facing plain language — never name a tool that isn't actually connected.
  approve_call:     { kind:"server", endpoint:"activate", body:{ channel:"voice" },    label:"Approve a call",                       honest:"Places a real AI phone call (if calling is turned on)." },
  approve_email:    { kind:"server", endpoint:"activate", body:{ channel:"email" },    label:"Approve an email",                     honest:"Saves your drafted email as a persisted record — no email tool is connected yet, so nothing is sent." },
  approve_linkedin: { kind:"server", endpoint:"activate", body:{ channel:"linkedin" }, label:"Approve a LinkedIn message",           honest:"Generates a self-serve LinkedIn message you copy or download and send yourself — no LinkedIn tool is connected, so nothing is sent automatically." },
  to_sales_review:  { kind:"server", endpoint:"decision", body:{ decision:"manual_review" }, label:"Send for a closer look",          honest:"Records that this needs human review — no outreach happens." },
  manual_review:    { kind:"server", endpoint:"decision", body:{ decision:"manual_review" }, label:"Send for a closer look",          honest:"Records that this needs human review — no outreach happens." },
  nurture:          { kind:"server", endpoint:"decision", body:{ decision:"nurture" },       label:"Keep nurturing",                  honest:"Keeps collecting signal — no outreach happens." },
  mark_nurture:     { kind:"server", endpoint:"decision", body:{ decision:"nurture" },       label:"Keep nurturing",                  honest:"Keeps collecting signal — no outreach happens." },
  reject:           { kind:"server", endpoint:"decision", body:{ decision:"reject" },        label:"Not a fit",                       honest:"Records your decision — no outreach happens." },
  suppress:         { kind:"server", endpoint:"decision", body:{ decision:"suppress" },      label:"Block — do not contact",          honest:"Adds to the do-not-contact list." },
  mark_retarget:    { kind:"server", endpoint:"decision", body:{ decision:"mark_retarget" }, label:"Add to ads audience",             honest:"Marks the account for retargeting — no ad platform is connected yet, this is a marker for later." },
  notify_owner:     { kind:"server", endpoint:"action",   body:{ action:"owner_alert" },     label:"Notify the account owner",        honest:"Logs a note for the account owner — no CRM is connected yet, nothing is written to HubSpot." },
  owner_alert:      { kind:"server", endpoint:"action",   body:{ action:"owner_alert" },     label:"Notify the account owner",        honest:"Logs a note for the account owner — no CRM is connected yet, nothing is written to HubSpot." },
  retry:            { kind:"server", endpoint:"action",   body:{ action:"retry" },           label:"Run this one through again",      honest:"Sends the record back through scoring." },
  promote_mql:      { kind:"ui", label:"Treat as Ready for Sales", honest:"Switches this account's view to Ready for Sales so you can approve outreach — the same safety checks still apply on approval." },
  promote_mql_owner:{ kind:"ui", label:"Owner: promote to Ready for Sales", honest:"For the account owner — same as above." },
  dismiss:          { kind:"ui", label:"Dismiss", honest:"Hides this from your attention list for now. The account stays in the queue until a real decision is recorded." },
  view_reason:      { kind:"ui", label:"See why this is blocked", honest:"Shows the reason — no action available on blocked accounts." }
};

// Static cost model — the engine already writes consumes_credits/cost_impact/cost_explanation per row,
// so prefer the ROW values. This is fallback copy for the confirmation modal only.
export const COST_MODEL = {
  voice:    { consumes_credits: "yes",   cost_impact: "medium", note: "Consumes Retell call minutes + telephony if launched." },
  email:    { consumes_credits: "maybe", cost_impact: "low",    note: "May consume sequence/send capacity; affects domain reputation." },
  linkedin: { consumes_credits: "maybe", cost_impact: "low",    note: "May consume seat/action limits; affects LinkedIn account safety." },
  owner_alert: { consumes_credits: "no", cost_impact: "none",   note: "Internal log only — no CRM is connected yet." },
  suppress: { consumes_credits: "no",    cost_impact: "none",   note: "Blocks future activation." },
  nurture:  { consumes_credits: "no",    cost_impact: "none",   note: "No external activation." },
  reject:   { consumes_credits: "no",    cost_impact: "none",   note: "No external activation." },
  manual_review: { consumes_credits: "no", cost_impact: "none", note: "No external activation." },
  retry:    { consumes_credits: "maybe", cost_impact: "low",    note: "Re-runs the pipeline; may re-consume enrichment credits unless test_mode." }
};

// Voice dispatch has not been validated for production — n8n enforces this authoritatively
// (final_status: blocked:voice_dispatch_not_validated), but the cockpit also disables the
// control itself as defense-in-depth so no activation request is ever sent for voice.
export const VOICE_UNAVAILABLE_REASON = "Voice activation is not available yet. No call can be placed.";

// Whether a given button must be DISABLED for a row. The cockpit enforces UX; n8n enforces truth.
export function buttonDisabled(buttonKey, row) {
  // Voice remains unconditionally unavailable regardless of row/engine state — this is a
  // hard UI-level lock, not derived from row data, so it can never be relaxed by gate_status
  // or engine_mode alone.
  if (buttonKey === "approve_call") return { disabled: true, reason: VOICE_UNAVAILABLE_REASON };
  const live = String(row.engine_mode || "paused").toLowerCase() === "live"; // fail-closed: missing mode = paused
  const isActivation = ["approve_call","approve_email","approve_linkedin"].includes(buttonKey);
  // Global kill-switch: no activation unless engine is live.
  if (isActivation && !live) return { disabled: true, reason: `Engine is ${row.engine_mode} — activation paused.` };
  // Hard engine block on this row.
  if (isActivation && String(row.gate_status).toLowerCase() === "blocked")
    return { disabled: true, reason: row.block_reason || "Blocked by an engine gate." };
  return { disabled: false, reason: "" };
}

export const STATUSES = ["pending_review","approved","rejected","suppressed","auto_processed",
  "blocked_by_gate","sent_to_owner","called","sequenced","qualified","mql_created","nurture",
  "manual_review","error"];

// ===================== PHASE C (account queue) — ships behind queue_source toggle =====================
export const OUTPUT_TYPES = ["MQL","Sales Review","Pipeline Assist","Owner Alert","Nurture","Retarget","Suppressed"];
export const SALES_REVIEW_REASONS = ["no_lawful_channel","low_confidence_match","region_unknown","below_mql_threshold","strong_account_needs_review","low_fit_high_activity","manual_review_required"];
export const NO_PROSPECT = new Set(["Pipeline Assist","Owner Alert","Retarget","Suppressed"]);
const _lc = (s) => String(s == null ? "" : s).trim().toLowerCase();

// Which tab + key the cockpit reads, driven by ICP_Config.queue_source.
export function resolveQueueTab(cfg){ return _lc(cfg.queue_source) === "account_queue" ? "ICP_Account_Queue" : "ICP_Review_Queue"; }
export function resolveMatchKey(cfg){ return _lc(cfg.queue_source) === "account_queue" ? "account_key" : "queue_key"; }

// Buttons available for an output type (output type is the decision; no prospecting on assist/alert/retarget).
export function buttonsForOutput(out){
  switch(out){
    case "MQL": return ["approve_email","approve_linkedin","approve_call","to_sales_review","reject"];
    case "Sales Review": return ["promote_mql","nurture","reject","suppress"];
    case "Pipeline Assist": return ["notify_owner","dismiss"];
    case "Owner Alert": return ["notify_owner","promote_mql_owner","dismiss"];
    case "Nurture": return ["nurture","dismiss"];
    case "Retarget": return ["mark_retarget","dismiss"];
    case "Suppressed": return ["view_reason"];
    default: return ["view_reason"];
  }
}
// Per-button disabled check (kill-switch + US-voice/TCPA lock + EMEA lawful basis + no-prospecting).
// approve_call is permanently locked — the same unconditional defense-in-depth as
// buttonDisabled() applies on the signal-queue path; no cfg/row state can ever re-enable voice.
// previewOnly (sample/demo rows, never able to reach a real POST — ActionModal's previewOnly
// guard is authoritative) bypasses ONLY the live engine_mode gate for approve_email/
// approve_linkedin, so exploring the composer never depends on a real ICP_Config fetch. It does
// not affect approve_call, and it never touches to_sales_review/reject, which this function
// never gates in the first place.
export function buttonDisabledPhaseC(btn,row,cfg,previewOnly=false){
  if(btn==="approve_call") return true;
  if(previewOnly && (btn==="approve_email"||btn==="approve_linkedin")) return false;
  if(_lc(cfg.engine_mode)!=="live" && ["approve_email","approve_linkedin","approve_call"].includes(btn)) return true;
  if(btn==="approve_email" && _lc(row.region)!=="us" && !(_lc(row.consent_email)==="true"||_lc(row.li_basis_cleared)==="true")) return true;
  if(NO_PROSPECT.has(row.recommended_output) && ["approve_email","approve_linkedin","approve_call"].includes(btn)) return true;
  return false;
}
// Visitor-claim language enforcement — MUST run on any generated copy when visitor_claim_allowed=false.
const _FORBIDDEN=[/this person visited/i,/\bviewed the page\b/i,/we saw you on the site/i,/\byou visited\b/i,/\bthey visited\b/i];
export function visitorSafeCopy(text, visitor_claim_allowed){
  if(_lc(visitor_claim_allowed)==="true") return { text, safe:true, violations:[] };
  const violations=_FORBIDDEN.filter(rx=>rx.test(text)).map(rx=>rx.source);
  let safe=String(text)
    .replace(/this person visited/ig,"this account showed activity on")
    .replace(/([A-Z][a-z]+) viewed the page/g,"the account showed activity")
    .replace(/we saw you on the site/ig,"the company appears to be exploring the site")
    .replace(/\byou visited\b/ig,"the account showed activity on")
    .replace(/\bthey visited\b/ig,"the account showed activity on");
  return { text:safe, safe:violations.length===0, violations };
}
export function committeeSummary(committee_json){
  let arr=[]; try{ arr=JSON.parse(committee_json||"[]"); }catch(e){ arr=[]; }
  if(!Array.isArray(arr)) arr=[];
  const count=arr.length;
  const summary = count ? arr.slice(0,3).map(p=>`${p.title||p.name||"contact"}${p.identity_resolution?(" ["+p.identity_resolution+"]"):""}`).join("; ")+(count>3?` +${count-3} more`:"") : "";
  return { committee_count:count, committee_summary:summary };
}

// ===================== PHASE C additions v2 (receiver-aligned statuses + account-queue review rule) =====================
// Final statuses the receivers actually write now (external-call policy: only Retell is real; everything else logs):
export const PENDING_TOOL_STATUSES = ["approved_email_pending_tool","approved_linkedin_pending_tool","approved_linkedin_export_ready","owner_alert_logged","marked_retarget"];
export const STATUSES_V2 = [...STATUSES, ...PENDING_TOOL_STATUSES, "retried", "blocked:voice_dispatch_not_validated"];
// Human labels so operators understand "approved but no tool connected yet":
export const STATUS_LABELS = {
  approved_email_pending_tool: "Approved — email draft logged (no email tool connected)",
  approved_linkedin_pending_tool: "Approved — LinkedIn logged (no tool connected)",
  approved_linkedin_export_ready: "Approved — self-serve LinkedIn message ready to copy or download",
  owner_alert_logged: "Owner alert logged (no HubSpot write)",
  marked_retarget: "Marked for retargeting (no ad sync)",
  retried: "Re-sent to intake",
  "blocked:voice_dispatch_not_validated": "Blocked — voice dispatch has not been validated for production",
};

// Older receiver responses wrote approved_linkedin_pending_tool; the current receiver
// writes approved_linkedin_export_ready for the same self-serve-export outcome. Any
// consumer that needs to recognize "this row's LinkedIn approval produced self-serve
// export content" must use this helper instead of comparing final_status to a single
// literal, so already-persisted older rows are never treated as unrecognized/broken.
export const LINKEDIN_SELF_SERVE_STATUSES = ["approved_linkedin_pending_tool", "approved_linkedin_export_ready"];
export function isLinkedinSelfServeStatus(status) {
  return LINKEDIN_SELF_SERVE_STATUSES.includes(String(status ?? "").trim());
}
// The account queue has NO engine_status column — review state is derived from operator fields only:
export const needsReviewAccount = (row) =>
  !String(row.operator_decision || "").trim() && !String(row.final_status || "").trim();
// Render any status not in STATUSES_V2 with a neutral badge and the raw value — never crash on unknown status.

// ===================== PLAIN-LANGUAGE LABELS (v3) =====================
// Every user-facing string in the cockpit must come from these maps, never be invented inline.
// Audience: non-technical operators (partnerships, sales, marketing) with zero engineering background.
// Rule: no field names, no acronyms without explanation, no dev jargon (webhook/JSON/payload/endpoint/
// gate/engine_mode/queue_source as literal words) anywhere in rendered UI text.

// engine_mode -> what an operator actually experiences right now
export const ENGINE_MODE_LABELS = {
  live: { label: "Fully Live", detail: "Approved actions are actually sent." , color:"green"},
  recommend_only: { label: "Review Mode", detail: "You can review and approve accounts, but nothing is sent yet — every approval is logged for when sending is turned on.", color:"amber" },
  paused: { label: "Paused", detail: "Sending is off and actions are blocked. You can still record review decisions and change settings.", color:"red" },
};

// which scoring model is active — admin-only concept, plain business framing
export const QUEUE_SOURCE_LABELS = {
  account_queue: { label: "Whole-Company Scoring", detail: "We score all activity from a company together, as one account." },
  signal_queue: { label: "Per-Visit Scoring (Classic)", detail: "We score each website visit or signal on its own." },
};

// output type -> what a non-technical person should see, with a plain one-line explanation
export const OUTPUT_TYPE_LABELS = {
  "MQL": { label: "Ready for Sales", sub: "MQL", detail: "Meets our bar for fit and interest, and we have a real way to reach them." },
  "Sales Review": { label: "Worth a Look", sub: "Needs your judgment", detail: "Promising, but something needs a human decision before we act." },
  "Pipeline Assist": { label: "Already Being Worked", sub: "Existing deal", detail: "This company already has an open deal — we'll notify the deal owner, not reach out ourselves." },
  "Owner Alert": { label: "Notify Account Owner", sub: "Known account", detail: "This account already belongs to someone on the team — we alert them instead of contacting the company ourselves." },
  "Nurture": { label: "Not Ready Yet", sub: "Keep an eye on them", detail: "Too early to act — we'll keep collecting signal." },
  "Retarget": { label: "Add to Ads Audience", sub: "No direct outreach", detail: "Not enough to reach out directly, but worth showing ads to." },
  "Suppressed": { label: "Blocked — Do Not Contact", sub: "", detail: "We must not contact this company or person." },
};

// why a "Worth a Look" (Sales Review) account isn't further along yet
export const SALES_REVIEW_REASON_LABELS = {
  no_lawful_channel: "We don't have a permitted way to contact them yet (no confirmed email or call permission).",
  low_confidence_match: "We're not fully sure we've matched this to the right company.",
  region_unknown: "We don't know what country they're in, so we can't confirm we're allowed to contact them.",
  below_mql_threshold: "Interest looks real, but not quite strong enough yet to hand to sales.",
  strong_account_needs_review: "Strong signal here — worth a closer look even though we can't reach out directly yet.",
  low_fit_high_activity: "Lots of activity, but this may not be a great fit for what we sell.",
  manual_review_required: "This one needs a human decision before we go further.",
};

// how confident we are this is a real, named person — the single most important label in the app.
// This directly drives visitorSafeCopy(); never invent alternate wording for these states.
export const IDENTITY_LABELS = {
  known_crm_contact: { label: "Confirmed contact", detail: "Already a known contact in our system." },
  identified_contact: { label: "Named person, verified", detail: "We know exactly who this is." },
  reconstructed_contact: { label: "Likely contact (unconfirmed)", detail: "We found a person who's probably right for this account, but we have not confirmed they personally did anything — we're inferring from company-level activity." },
  company_level: { label: "Company only", detail: "We only know the company was active — no specific person identified." },
  anonymous: { label: "Unknown visitor", detail: "We don't know who this is at all." },
};

// why an activation button is greyed out — plain reasons, no field names
export const BLOCK_REASON_LABELS = {
  engine_not_live: "Sending is turned off right now (Review Mode) — this will be logged, not sent.",
  engine_paused: "The system is paused — nothing can be processed right now.",
  us_voice_not_cleared: "Calling US contacts isn't turned on yet — see Settings.",
  emea_voice_no_basis: "We don't have permission to call this EU contact yet.",
  emea_email_no_basis: "We don't have permission to email this EU contact yet.",
  suppressed_or_dnc: "This contact asked not to be contacted, or is on our do-not-contact list.",
  internal_domain: "This is one of our own company's addresses.",
  no_safe_channel: "We don't have a permitted way to reach this account yet.",
  region_unknown: "We don't know what country they're in yet.",
  invalid_activation_for_output_type: "This type of account isn't meant to be contacted directly — see the recommended action instead.",
  bad_secret: "Something went wrong confirming this request — try again or tell Mihai.",
};

// receiver final_status -> honest, non-alarming sentence describing the REQUEST that was
// recorded — never a completed-fact claim, because final_status alone does not prove
// persistence or external execution. getTruthfulStatusPresentation() below is the only
// place allowed to upgrade this to confirmed-outcome wording.
export const STATUS_LABELS_V3 = {
  called: "Call request recorded — provider execution not yet confirmed.",
  approved_email_pending_tool: "Approved. Your email draft was saved — no email-sending tool is connected yet, so no email went out.",
  // Older persisted rows may still carry this exact status — kept for backward compatibility.
  approved_linkedin_pending_tool: "Approved. We don't have a LinkedIn tool connected yet, so no message went out — this is logged and ready for when one is connected.",
  approved_linkedin_export_ready: "Approved. A self-serve LinkedIn message was generated for you to copy or download and send yourself — no LinkedIn tool is connected, so nothing was sent automatically.",
  owner_alert_logged: "Owner notification request recorded. No CRM execution confirmed.",
  marked_retarget: "Retargeting request recorded. No ad platform execution confirmed.",
  retried: "Retry request recorded.",
  rejected: "Decision request recorded: mark as not a fit.",
  nurture: "Decision request recorded: keep nurturing.",
  manual_review: "Decision request recorded: send for sales review.",
  suppressed: "Do-not-contact request recorded — persistence not yet confirmed.",
  // Voice remains unavailable — this must always read as blocked, never as "pending"
  // or "not yet confirmed," since no call is possible and none was attempted.
  "blocked:voice_dispatch_not_validated": "Blocked — voice calling has not been validated for production yet. No call occurred.",
};

// Stronger wording used ONLY once isConfirmedPersistedDecision()/isConfirmedArtifactReady()
// proves the record was actually persisted — never selected from final_status alone.
export const STATUS_CONFIRMED_LABELS_V3 = {
  rejected: "Marked as not a fit.",
  nurture: "Moved to nurture.",
  manual_review: "Sent for sales review.",
  suppressed: "Added to the do-not-contact list.",
  approved_email_pending_tool: "Email draft saved — no email tool connected, nothing was sent.",
  approved_linkedin_pending_tool: "LinkedIn message ready to copy or download.",
  approved_linkedin_export_ready: "LinkedIn message ready to copy or download.",
};

// Generic confirmed-execution message used when isConfirmedExternalExecution() is true
// but the backend didn't supply its own confirmation_message — must never reuse
// STATUS_LABELS_V3 here, since that map is worded "not yet confirmed" throughout.
export const EXTERNAL_EXECUTION_CONFIRMED_FALLBACK = "Confirmed: action executed.";

// Generic fallback shown when an artifact-ready response has no confirmation_message
// and no dedicated STATUS_CONFIRMED_LABELS_V3 entry for its final_status.
export const ARTIFACT_READY_CONFIRMED_FALLBACK = "Your message is ready to copy or download.";

// ── Truthful outcome proof ────────────────────────────────────────────────────────
// Confirmed persisted decision requires the backend to explicitly say so.
export function isConfirmedPersistedDecision(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  const persistedId = evidence.decision_id || evidence.record_id;
  return evidence.persisted === true && Boolean(persistedId);
}

// Confirmed external execution requires the backend to explicitly say so — never
// inferred from provider_status alone or from final_status="called".
export function isConfirmedExternalExecution(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  const externalId = evidence.external_id;
  return evidence.execution_confirmed === true && Boolean(externalId);
}

// Confirmed self-serve artifact (LinkedIn export text or a persisted email draft)
// requires a stable action_id AND actual generated content — persisted:true alone is
// not enough, and neither is an action_id with no artifact/export text attached. This
// is deliberately a THIRD, distinct kind of proof from isConfirmedPersistedDecision:
// generating an artifact is not the same claim as "a decision was persisted," and it
// must never be described as external execution (isConfirmedExternalExecution) — no
// LinkedIn message or email was actually sent.
export function isConfirmedArtifactReady(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  if (evidence.persisted !== true) return false;
  if (!Boolean(evidence.action_id)) return false;
  return Boolean(evidence.artifact_content) || Boolean(evidence.export_text);
}

// True when the receiver reports this exact request as an idempotent replay — i.e. it
// was already recorded on a previous call, and nothing NEW happened this time. This must
// never be silently absorbed into ordinary success/artifact-ready wording, since "your
// message is ready" reads very differently from "this was already approved earlier."
export function isIdempotentReplay(evidence) {
  return Boolean(evidence && typeof evidence === "object" && evidence.idempotent_replay === true);
}

const IDEMPOTENT_REPLAY_NOTE = "This request was already recorded earlier — no new action was taken. ";

// Prefixes the idempotent-replay note onto an otherwise-truthful message, without
// changing the phase/artifact truth already derived — a replay of a real persisted
// artifact is still that same real artifact, just not newly created by this call.
function _withReplayNote(message, evidence) {
  return isIdempotentReplay(evidence) ? `${IDEMPOTENT_REPLAY_NOTE}${message}` : message;
}

// The ONLY function components should call after a POST response. Centralizes the
// truthfulness rule so request-time and confirmed-time wording can never drift apart.
// "success" requires explicit proof fields; otherwise "pending" — regardless of
// final_status. (STATUS_FALLBACK_LABEL is defined further below in this file.)
//
// Return shape is additive: `artifact` is only ever present (and only ever populated
// from the whitelisted evidence fields — never raw/unwhitelisted response data) when
// isConfirmedArtifactReady(evidence) is true, so callers can render Copy/Download
// controls without re-deriving the truthfulness check themselves.
export function getTruthfulStatusPresentation(finalStatus, evidence) {
  if (isConfirmedExternalExecution(evidence)) {
    const confirmedMessage =
      evidence && typeof evidence.confirmation_message === "string"
        ? evidence.confirmation_message
        : "";
    // Never fall back to STATUS_LABELS_V3 here — that map is deliberately worded as
    // "not yet confirmed" for every entry, which would contradict the "success" phase
    // being returned alongside it.
    return {
      phase: "success",
      message: _withReplayNote(confirmedMessage || EXTERNAL_EXECUTION_CONFIRMED_FALLBACK, evidence),
    };
  }
  if (isConfirmedArtifactReady(evidence)) {
    const confirmedMessage =
      evidence && typeof evidence.confirmation_message === "string" ? evidence.confirmation_message : "";
    return {
      phase: "artifact_ready",
      message: _withReplayNote(
        confirmedMessage || (STATUS_CONFIRMED_LABELS_V3[finalStatus] ?? ARTIFACT_READY_CONFIRMED_FALLBACK),
        evidence,
      ),
      artifact: {
        type: evidence.artifact_type ?? null,
        filename: evidence.artifact_filename ?? evidence.export_filename ?? null,
        content: evidence.artifact_content ?? evidence.export_text ?? null,
      },
    };
  }
  if (isConfirmedPersistedDecision(evidence)) {
    return {
      phase: "success",
      message: _withReplayNote(
        STATUS_CONFIRMED_LABELS_V3[finalStatus] ?? STATUS_LABELS_V3[finalStatus] ?? STATUS_FALLBACK_LABEL,
        evidence,
      ),
    };
  }
  return { phase: "pending", message: STATUS_LABELS_V3[finalStatus] ?? STATUS_FALLBACK_LABEL };
}

// cost / credit line — plain business framing, never "consumes_credits" as a word
export function costLabel(row){
  if(String(row.consumes_credits).toLowerCase()==="true") return { label:"Uses paid AI minutes", detail: row.cost_explanation||"This action uses a paid AI phone call." };
  return { label:"No cost to log this", detail: row.cost_explanation||"Logging or sending this doesn't use paid credits." };
}

// ===================== SCORE EXPLAINABILITY (Cockpit Truth & Clarity) =====================
// Central helpers so score/risk/MQL/status rendering never invents evidence, never
// zero-fills missing data, never displays a technical sentinel as a real number, and
// never confuses a requested decision with a confirmed external action.
// Components must call these instead of reading row[key] directly.

function _isBlank(v){ return v===undefined || v===null || String(v).trim()===""; }
function _humanize(v){ return String(v).replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase()); }

// Public last-resort fallback for any raw snake_case/colon-joined enum token that has
// no dedicated label map entry (e.g. an unmapped block_reason) — the cockpit must never
// show raw internal vocabulary like "excluded:internal" verbatim.
export function humanizeToken(v){
  if(_isBlank(v)) return "";
  return String(v).replace(/[_:]/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

// decision enum (posted to ENDPOINTS.decision) -> plain business language.
// These are all REQUESTED/RECORDED decisions, not claims of external execution.
export const DECISION_LABELS = {
  reject: "Not a fit",
  nurture: "Keep nurturing",
  manual_review: "Needs sales review",
  suppress: "Do not contact",
  mark_retarget: "Add to retargeting audience",
};

// action_type enum (from the action log) -> plain business language describing the
// REQUESTED operation — never phrased as a completed external action.
export const ACTION_TYPE_LABELS = {
  call: "Request phone call",
  voice: "Request phone call",
  email: "Request email outreach",
  linkedin: "Request LinkedIn outreach",
  owner_alert: "Notify account owner",
  retry: "Retry processing",
  retarget: "Add to retargeting audience",
  mark_retarget: "Add to retargeting audience",
};

// score_tier -> plain business language. outbound_now/sales_review/nurture are the
// values the engine writes today (verified against mockData.js); "low" is included
// because the account-level scoring contract can produce a low-priority tier even
// though no current mock row carries it. Any other value falls back to a humanized
// (not raw snake_case) rendering rather than inventing a business meaning we haven't seen.
export const SCORE_TIER_LABELS = {
  outbound_now: "Ready to act now",
  sales_review: "Needs a closer look",
  nurture: "Not ready yet",
  low: "Low current priority",
};

// Human-readable score tier — never leaks the raw snake_case enum.
export function scoreTierLabel(tier){
  if(_isBlank(tier)) return "Not available";
  return SCORE_TIER_LABELS[String(tier).toLowerCase()] ?? _humanize(tier);
}

// A generic, non-overclaiming fallback for any request that succeeded server-side
// but whose final_status is empty or not yet mapped in STATUS_LABELS_V3. Never fall
// back to a button's pre-action "honest" description here — that describes intent,
// not confirmed outcome, and would read as an execution that may not have happened.
export const STATUS_FALLBACK_LABEL = "Request recorded — execution not yet confirmed.";

// First VALID numeric candidate across fields, in priority order — a real "0" counts
// as valid, and an empty/invalid earlier candidate correctly falls through to the next
// one instead of masking it. Used for total/account score resolution (never zero-fill).
export function firstValidNumber(...candidates){
  const found = candidates.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== "" &&
      Number.isFinite(Number(value)),
  );
  return found === undefined ? null : Number(found);
}

// Component score fields the account queue may provide, with plain-language framing.
export const SCORE_COMPONENT_FIELDS = [
  { key:"fit_score",           label:"Fit",                 question:"How well do they match who we sell to?" },
  { key:"interest_score",      label:"Interest",            question:"How interested do they seem?" },
  { key:"identity_score",      label:"Identity",            question:"How confident are we who this is?" },
  { key:"actionability_score", label:"Can we act safely?",  question:"Do we have a safe, permitted way to reach them?" },
  { key:"timing_score",        label:"Timing",              question:"How fresh is this signal?" },
];

// Display state for a single score component. Distinguishes a real, evidenced "0"
// from "not provided at all" — never substitutes zero for missing data.
export function scoreComponentDisplay(row, key){
  const field = SCORE_COMPONENT_FIELDS.find(f => f.key === key);
  const label = field?.label ?? key;
  const question = field?.question ?? "";
  const raw = row ? row[key] : undefined;
  if(_isBlank(raw)) return { key, label, question, available:false, value:null, display:"Not available" };
  const num = Number(raw);
  if(!Number.isFinite(num)) return { key, label, question, available:false, value:null, display:"Not available" };
  return { key, label, question, available:true, value:num, display:String(num) };
}

// Risk score technical sentinels: the engine writes these exact values when risk has
// not actually been calculated for a row. Only these two proven values are treated as
// sentinels — we do not guess at a threshold the backend contract hasn't confirmed.
// The raw value is preserved on the returned object for internal/debug use only —
// normal UI must read `.label`, never `.rawValue`.
export const RISK_SCORE_SENTINELS = new Set([999, 1998]);

export function riskScoreDisplay(row){
  const raw = row ? row.risk_score : undefined;
  if(_isBlank(raw)) return { available:false, value:null, rawValue:null, label:"Risk not calculated" };
  const num = Number(raw);
  if(!Number.isFinite(num)) return { available:false, value:null, rawValue:raw, label:"Risk not calculated" };
  if(RISK_SCORE_SENTINELS.has(num))
    return { available:false, value:null, rawValue:num, label:"Risk data unavailable" };
  return { available:true, value:num, rawValue:num, label:"What could prevent action?" };
}

// MQL qualification is a separate fact from the total score — a high total score never
// implies mql_flag=true by itself. Only a real boolean or the exact string "true"/"false"
// is trusted; any other value (missing, "1", "yes", garbage) is reported as NOT KNOWN
// rather than silently treated as a negative qualification.
export function mqlDisplay(row){
  const raw = row ? row.mql_flag : undefined;
  const reasonText = row?.sales_review_reason
    ? (SALES_REVIEW_REASON_LABELS[row.sales_review_reason] ?? row.sales_review_reason)
    : (row?.mql_reason || "");
  let parsed = null;
  if(raw === true || raw === false){
    parsed = raw;
  } else if(!_isBlank(raw)){
    const s = String(raw).trim().toLowerCase();
    if(s === "true") parsed = true;
    else if(s === "false") parsed = false;
  }
  if(parsed === null) return { known:false, isMql:null, label:"MQL qualification not recorded", reason:reasonText };
  return {
    known:true,
    isMql:parsed,
    label: parsed ? "Qualified as MQL" : "Not MQL-qualified",
    reason: parsed ? (row?.mql_reason || "") : reasonText,
  };
}

// Known sources for "how this account/contact was identified" — covers every
// contact_origin/last_signal_source value found in mockData.js and the shared contract.
// Unknown values fall back to a humanized (not raw snake_case) rendering.
export const MATCH_SOURCE_LABELS = {
  rb2b: "Identified via person-level visitor matching (RB2B)",
  cognism_reconstructed: "Likely contact reconstructed from company data (Cognism)",
  dealfront: "Company-level visit detected (Dealfront)",
  hubspot: "Known contact from HubSpot",
  posthog: "Detected via product analytics (PostHog)",
  test: "Synthetic test signal",
};

// match_confidence -> plain language; never expose the raw snake_case/lowercase token.
export const MATCH_CONFIDENCE_LABELS = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

// How this account was identified/matched. "matched_by" is the forward-looking field
// name; existing rows carry the same fact under "contact_origin" — prefer matched_by
// when both are present, but never invent a value when neither exists.
export function matchedByDisplay(row){
  const matchedByRaw = row?.matched_by || row?.contact_origin || "";
  const confidenceRaw = row?.match_confidence || "";
  if(!matchedByRaw && !confidenceRaw) return { available:false, label:"Not available" };
  const parts = [];
  if(matchedByRaw) parts.push(MATCH_SOURCE_LABELS[matchedByRaw] ?? _humanize(matchedByRaw));
  if(confidenceRaw){
    const key = String(confidenceRaw).toLowerCase();
    parts.push(MATCH_CONFIDENCE_LABELS[key] ?? `${_humanize(confidenceRaw)} confidence`);
  }
  return { available:true, label:parts.join(" · ") };
}

// Freshness — "as of" for the score/recommendation. Never invents a time when none exists.
export function rowFreshnessDisplay(row){
  const ts = row?.updated_at || row?.signal_at || row?.last_signal_at || "";
  if(!ts) return { available:false, label:"Not available" };
  const d = new Date(ts);
  if(isNaN(d.getTime())) return { available:false, label:"Not available" };
  return { available:true, label:d.toISOString(), timestamp:ts };
}

// ===================== ACTION LIFECYCLE + ROLE-AWARE MODEL (prep only) =====================
// Canonical Decision/Action/Activation response contract for the truthful-action-lifecycle
// package. Nothing here enforces industry access or activates Entra — the role/industry
// helpers below are prepared, tested, and NEVER called by any route yet.

function _normalizeEmail(email){ return String(email ?? "").trim().toLowerCase(); }
function _nonEmptyString(v){ return (typeof v === "string" && v.trim() !== "") ? v : null; }

// Server-verified operator identity -> the audit fields every persisted decision/action
// should carry. Callers must pass the req.operator object resolved by requireAuth —
// never anything client-supplied (req.body). requested_by_user_id has no real stable id
// yet (pre-Entra): operator.id is used when present (forward-compatible with a future
// real id), otherwise the normalized email is the interim identifier.
//
// Future ledger mapping (feat/postgres-operational-ledger — NOT merged/modified here;
// reconcile physically only when that branch is reviewed and integrated):
//   requested_by_user_id -> operatorId
//   requested_by_name    -> operatorName
//   requested_by_email   -> operatorEmail
export function buildOperatorAuditStamp(operator, timestamp){
  const email = _normalizeEmail(operator?.email);
  const at = timestamp || new Date().toISOString();
  return {
    requested_by_user_id: operator?.id || email,
    requested_by_email: email,
    requested_by_name: operator?.name ?? "",
    requested_by_role: operator?.role ?? "",
    created_at: at,
    updated_at: at,
  };
}

// Strict whitelist of n8n proof fields — the raw n8n response is NEVER spread or trusted
// directly. final_status, provider_status, call_id, HTTP status, or any other text/shape
// n8n happens to return is deliberately excluded: none of it is proof of persistence or
// external execution.
//
// tool_status/artifact_type/artifact_filename/artifact_content/export_filename/export_text
// are the self-serve LinkedIn export / persisted email draft artifact fields — added
// explicitly, by name, exactly like every other whitelisted field. idempotent_replay and
// ledger_persisted are booleans describing the request/ledger, not proof of a NEW action
// having occurred this call.
export function extractLifecycleProof(n8nData){
  const d = (n8nData && typeof n8nData === "object") ? n8nData : {};
  return {
    persisted: d.persisted === true,
    execution_requested: d.execution_requested === true,
    execution_confirmed: d.execution_confirmed === true,
    decision_id: _nonEmptyString(d.decision_id),
    record_id: _nonEmptyString(d.record_id),
    action_id: _nonEmptyString(d.action_id),
    external_id: _nonEmptyString(d.external_id),
    provider: _nonEmptyString(d.provider),
    confirmation_message: _nonEmptyString(d.confirmation_message),
    error: _nonEmptyString(d.error),
    tool_status: _nonEmptyString(d.tool_status),
    artifact_type: _nonEmptyString(d.artifact_type),
    artifact_filename: _nonEmptyString(d.artifact_filename),
    artifact_content: _nonEmptyString(d.artifact_content),
    export_filename: _nonEmptyString(d.export_filename),
    export_text: _nonEmptyString(d.export_text),
    idempotent_replay: d.idempotent_replay === true,
    ledger_persisted: d.ledger_persisted === true,
  };
}

// The ONLY function UI code should call to pick the evidence object passed into
// getTruthfulStatusPresentation. Prefers the server-built lifecycle envelope (already
// fully whitelisted by extractLifecycleProof/buildLifecycleEnvelope) when present.
//
// When a response genuinely lacks a lifecycle envelope (e.g. an older API response
// shape, or a future regression that drops it), the raw response body must NEVER be
// trusted directly as proof — it is run through the same strict extractLifecycleProof
// whitelist used everywhere else, so an older/unwhitelisted shape can, at best, resolve
// to the exact same evidence a whitelisted call would produce, and never bypass the
// whitelist by carrying stray fields (final_status, provider_status, an arbitrary
// "success"-looking string, etc.) that were never proof of anything.
//
// A bare object is never treated as already-whitelisted just because typeof === "object"
// — arrays and null are explicitly rejected, falling through to extractLifecycleProof
// (which safely treats any non-plain-object input as "nothing").
export function resolveLifecycleEvidence(lifecycle, rawData) {
  if (lifecycle && typeof lifecycle === "object" && !Array.isArray(lifecycle)) return lifecycle;
  return extractLifecycleProof(rawData);
}

// status is derived from explicit fields only, in strict priority order — never copied
// from final_status or arbitrary n8n text. "artifact_ready" (self-serve LinkedIn export /
// persisted email draft with real content) is ranked above the generic "persisted" status
// it would otherwise also qualify for, since it carries a stronger, more specific proof
// (an actual artifact/export body), and callers should be able to key off it directly.
export function deriveLifecycleStatus(fields){
  if(fields.error) return "failed";
  if(fields.execution_confirmed === true && fields.external_id) return "execution_confirmed";
  if(fields.execution_requested === true) return "execution_requested";
  if(isConfirmedArtifactReady(fields)) return "artifact_ready";
  if(fields.persisted === true && (fields.decision_id || fields.record_id || fields.action_id)) return "persisted";
  if(fields.accepted === true) return "accepted";
  return "failed";
}

// request_context is UNVERIFIED — it originates from the browser-supplied row, not a
// server-resolved canonical account record. Never use it for authorization, industry
// filtering, or as proof of anything. Future Entra/ledger work must replace this with a
// server-resolved account context looked up by a trusted account id.
export function buildRequestContext(row){
  const r = (row && typeof row === "object") ? row : {};
  return {
    source: "client_payload",
    verified: false,
    account_id: r.account_key || r.queue_key || null,
    company_domain: r.company_domain || null,
    industry: industryDisplay(r.industry),
  };
}

// The ONLY function that should construct a lifecycle envelope. `accepted` must be
// supplied by the caller — it means "the authenticated API accepted and validated the
// request for processing," a fact about OUR validation, never about what n8n did with it
// downstream. A valid, accepted request whose downstream network/persistence/execution
// step fails still has accepted:true and status:"failed" — accepted is not persistence
// or execution proof.
/**
 * @param {{
 *   requestId: string,
 *   accepted: boolean,
 *   n8nData?: unknown,
 *   error?: string | null,
 *   operator?: { id?: string, name?: string, email?: string, role?: string, allowedIndustries?: string[] } | null,
 *   requestContext?: Record<string, unknown> | null,
 *   timestamp?: string,
 * }} params
 */
export function buildLifecycleEnvelope({ requestId, accepted, n8nData, error, operator, requestContext, timestamp }){
  const proof = extractLifecycleProof(n8nData);
  const fields = {
    accepted: Boolean(accepted),
    persisted: proof.persisted,
    decision_id: proof.decision_id,
    record_id: proof.record_id,
    action_id: proof.action_id,
    execution_requested: proof.execution_requested,
    execution_confirmed: proof.execution_confirmed,
    external_id: proof.external_id,
    provider: proof.provider,
    error: error ?? proof.error,
    confirmation_message: proof.confirmation_message,
    tool_status: proof.tool_status,
    artifact_type: proof.artifact_type,
    artifact_filename: proof.artifact_filename,
    artifact_content: proof.artifact_content,
    export_filename: proof.export_filename,
    export_text: proof.export_text,
    idempotent_replay: proof.idempotent_replay,
    ledger_persisted: proof.ledger_persisted,
  };
  return {
    request_id: requestId,
    ...fields,
    status: deriveLifecycleStatus(fields),
    ...buildOperatorAuditStamp(operator, timestamp),
    request_context: requestContext ?? null,
  };
}

// industry is currently free text ("Insurance", "Healthcare", ...) with no fixed enum.
// normalizeIndustryKey() gives a stable matching key (trim, lowercase, collapse spaces)
// for future access matching, while the original display text is preserved separately.
// Never fabricates a value: missing/blank industry is reported as unavailable, not "".
export function normalizeIndustryKey(raw){
  if(raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim().replace(/\s+/g," ");
  if(!trimmed) return null;
  return trimmed.toLowerCase();
}

export function industryDisplay(raw){
  const key = normalizeIndustryKey(raw);
  if(!key) return { available:false, key:null, display:"Not recorded" };
  return { available:true, key, display:String(raw).trim().replace(/\s+/g," ") };
}

// Pre-Entra (current/local) mode: there is no untrusted multi-tenant boundary yet — the
// whole deployment today IS the trusted internal team, so this fails OPEN to superadmin
// for any role it doesn't specifically recognize as industry_admin. This is never called
// by any route in this package; it exists only to prepare the future contract.
export function resolveOperatorAccessLocal(operator){
  const role = String(operator?.role ?? "").trim().toLowerCase();
  if(role === "industry_admin"){
    const allowed = Array.isArray(operator?.allowedIndustries)
      ? operator.allowedIndustries.filter((v) => typeof v === "string" && v.trim() !== "")
      : [];
    if(allowed.length > 0) return { effectiveRole:"industry_admin", allowedIndustries:allowed };
    // industry_admin configured with no usable industries isn't a real restriction —
    // fail open to superadmin rather than silently locking the operator out entirely.
    return { effectiveRole:"superadmin", allowedIndustries:"all" };
  }
  // "operator" (today's deployed/legacy value), "superadmin", blank, or anything else
  // unrecognized all resolve to superadmin pre-Entra.
  return { effectiveRole:"superadmin", allowedIndustries:"all" };
}

// Future Entra-enforced mode: fails CLOSED for any role it doesn't recognize. Not called
// anywhere in this package — prepared so a later Entra package can switch the resolver
// used without redesigning the contract.
export function resolveOperatorAccessEntra(operator){
  const role = String(operator?.role ?? "").trim().toLowerCase();
  if(role === "superadmin") return { effectiveRole:"superadmin", allowedIndustries:"all" };
  if(role === "industry_admin"){
    const allowed = Array.isArray(operator?.allowedIndustries)
      ? operator.allowedIndustries.filter((v) => typeof v === "string" && v.trim() !== "")
      : [];
    return { effectiveRole:"industry_admin", allowedIndustries:allowed };
  }
  return { effectiveRole:null, allowedIndustries:[] };
}

// ===================== QUEUE PAGE: unresolved review state =====================
// The review queue is never "resolved" implicitly — a row only stops needing
// attention once an operator decision or final status has actually been persisted
// (see needsReview / needsReviewAccount above, which already implement this rule).
// These helpers exist so any surface counting/gating on "still needs a decision" uses
// the exact same rule, rather than re-deriving it (or falling back to rows.length,
// which counts already-processed rows too).

function _needsReviewCheck(source){
  return String(source).toLowerCase() === "account_queue" ? needsReviewAccount : needsReview;
}

export function countUnresolvedRows(rows, source){
  const check = _needsReviewCheck(source);
  return (Array.isArray(rows) ? rows : []).filter((row) => check(row)).length;
}

// A row is "processed" ONLY when actual decision evidence has been persisted for it —
// operator_decision or final_status is non-empty. This is deliberately NOT the inverse
// of needsReview/needsReviewAccount: for signal_queue rows, needsReview also turns false
// when engine_status simply isn't "pending_review" (e.g. the engine auto-suppressed or
// auto-processed it), which is not proof any human decision was ever recorded. Treating
// that as "processed" would invent evidence and could hide the "Decision recorded"
// section's absence behind a false claim. source is intentionally NOT consulted here —
// operator_decision/final_status are the same two persisted-evidence fields regardless
// of which queue a row came from.
export function isRowProcessed(row){
  return Boolean(String(row?.operator_decision ?? "").trim()) ||
    Boolean(String(row?.final_status ?? "").trim());
}

// The shared React Query key for the queue view — kept here so the query call site and
// any invalidation call site (e.g. after a successful decision/action) always agree on
// the exact key shape without duplicating the literal array in multiple files.
export const QUEUE_QUERY_KEY = ["sheets", "queue"];

// Same rationale as QUEUE_QUERY_KEY, for the action-log view (Recent activity). A
// persisted activation/decision writes a new ICP_Action_Log row, so any surface that
// invalidates the queue after an action must invalidate this key too, or "Recent
// activity" silently goes stale until an unrelated reload.
export const ACTION_LOG_QUERY_KEY = ["sheets", "action-log"];
