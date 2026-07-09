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
  approve_email:    { kind:"server", endpoint:"activate", body:{ channel:"email" },    label:"Approve an email",                     honest:"Logs the approval — no email tool is connected yet, so nothing is sent." },
  approve_linkedin: { kind:"server", endpoint:"activate", body:{ channel:"linkedin" }, label:"Approve a LinkedIn message",           honest:"Logs the approval — no LinkedIn tool is connected yet, so nothing is sent." },
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

// Whether a given button must be DISABLED for a row. The cockpit enforces UX; n8n enforces truth.
export function buttonDisabled(buttonKey, row) {
  const live = String(row.engine_mode || "paused").toLowerCase() === "live"; // fail-closed: missing mode = paused
  const isActivation = ["approve_call","approve_email","approve_linkedin"].includes(buttonKey);
  // Global kill-switch: no activation unless engine is live.
  if (isActivation && !live) return { disabled: true, reason: `Engine is ${row.engine_mode} — activation paused.` };
  // US-voice TCPA lock.
  if (buttonKey === "approve_call" &&
      String(row.block_reason).toLowerCase() === "us_voice_not_cleared")
    return { disabled: true, reason: "US voice is LOCKED pending TCPA clearance (us_voice_cleared=false)." };
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
export function buttonDisabledPhaseC(btn,row,cfg){
  if(_lc(cfg.engine_mode)!=="live" && ["approve_email","approve_linkedin","approve_call"].includes(btn)) return true;
  if(btn==="approve_call"){ if(_lc(row.region)==="us" && _lc(cfg.us_voice_cleared)!=="true") return true; if(_lc(row.region)!=="us" && !(_lc(row.dpo_voice_cleared)==="true"||_lc(row.consent_call)==="true")) return true; }
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
export const PENDING_TOOL_STATUSES = ["approved_email_pending_tool","approved_linkedin_pending_tool","owner_alert_logged","marked_retarget"];
export const STATUSES_V2 = [...STATUSES, ...PENDING_TOOL_STATUSES, "retried"];
// Human labels so operators understand "approved but no tool connected yet":
export const STATUS_LABELS = {
  approved_email_pending_tool: "Approved — email logged (no email tool connected)",
  approved_linkedin_pending_tool: "Approved — LinkedIn logged (no tool connected)",
  owner_alert_logged: "Owner alert logged (no HubSpot write)",
  marked_retarget: "Marked for retargeting (no ad sync)",
  retried: "Re-sent to intake",
};
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

// receiver final_status -> honest, non-alarming plain sentence (never say "sent" when it wasn't)
export const STATUS_LABELS_V3 = {
  called: "Call placed.",
  approved_email_pending_tool: "Approved. We don't have an email-sending tool connected yet, so no email went out — this is logged and ready for when one is connected.",
  approved_linkedin_pending_tool: "Approved. We don't have a LinkedIn tool connected yet, so no message went out — this is logged and ready for when one is connected.",
  owner_alert_logged: "Logged for the account owner. (No CRM is connected yet, so this wasn't written to HubSpot.)",
  marked_retarget: "Added to the retargeting list. (No ad platform is connected yet — this is a marker for later.)",
  retried: "Sent back for another pass.",
  rejected: "Marked as not a fit.",
  nurture: "Moved to nurture — will keep collecting signal.",
  manual_review: "Sent for a closer human look.",
  suppressed: "Added to the do-not-contact list.",
};

// cost / credit line — plain business framing, never "consumes_credits" as a word
export function costLabel(row){
  if(String(row.consumes_credits).toLowerCase()==="true") return { label:"Uses paid AI minutes", detail: row.cost_explanation||"This action uses a paid AI phone call." };
  return { label:"No cost to log this", detail: row.cost_explanation||"Logging or sending this doesn't use paid credits." };
}
