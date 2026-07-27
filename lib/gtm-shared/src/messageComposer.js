// messageComposer.js — deterministic, side-effect-free draft generation for the
// activation composer (LinkedIn self-serve export / email draft).
//
// Rules this module exists to enforce:
//   - Pure string templating only. No network calls, no LLM/provider, no client-side AI.
//   - Never invent a fact: every clause in the output is built ONLY from a real,
//     non-blank field on the row. A field that's blank is simply omitted, never
//     replaced with a placeholder ("undefined", "N/A", "{{company}}", etc).
//   - why_now is internal signal-source language (vendor names like RB2B/Dealfront/
//     Cognism, resolution levels, "no CRM record", "open opportunity", "owned by <name>"
//     phrasing) meant for the OPERATOR's own understanding — never the prospect's. The
//     full text is therefore never spliced into the drafted message body, and is exposed
//     separately as `signalContext` (already run through visitorSafeCopy) purely so the
//     composer UI can show the operator why this draft looks the way it does.
//
//     The ONE narrow exception: most account_queue rows have no recommended_solution field
//     (confirmed against MOCK_ACCOUNT_QUEUE; Globex is a deliberate, corrected exception —
//     see mockData.js and product decision, 2026-07-24, fixing the prior /pricing+MQL
//     contradiction), so relying on recommended_solution alone would push nearly every
//     account_queue draft into the generic fallback even when real, safe signal exists.
//     Several why_now values on that schema DO contain a URL path the
//     account engaged with — but NOT every such path is a valid product/use-case claim.
//     _classifyPathTopic extracts ONLY the path segment (never the surrounding internal
//     CRM-state prose) and classifies it:
//       - "use_case": a specific, customer-facing product/solution area (e.g.
//         "/insurance-claims-automation", "/solutions/claims") — may power the value angle
//         directly, the same way recommended_solution does.
//       - "commercial": a commercial-intent or structurally generic page (pricing, demo,
//         contact, about, product, solutions, resources, home) — this must NEVER become
//         "DRUID could help with {page}." It may, at most, support a restrained
//         timing/interest signal (e.g. "Since your team appears to be evaluating
//         automation options..."), and only when visitor_claim_allowed is true. The
//         underlying value angle in that case is still the conservative generic one —
//         never a fabricated specific claim about what the page means.
//       - "none": no path found at all (e.g. "BigBank — owned by Andrei, no open opp."),
//         or the path is present but empty after parsing.
//   - recommended_action is likewise internal operator-instruction text as written today
//     ("Approve LinkedIn outreach (Dripify)", "Suppressed - no action", "Notify opportunity
//     owner") — confirmed against the real queue rows, not customer-facing copy. Quoting
//     it verbatim in a drafted message would read as broken/nonsensical to a prospect, so
//     it is deliberately excluded from the templated text.
//   - Region/industry are deliberately NOT rendered anywhere in the drafted text. The
//     previous "— we work with other {industry} teams in {region} on this" clause was an
//     unsupported claim (an unverifiable assertion about DRUID's customer history) and
//     also emitted raw, un-normalized region tokens (e.g. "in us"). Omitting it entirely
//     is safer than inventing new phrasing to replace it.
//   - Tailored composition requires a company to address AND either recommended_solution
//     or a "use_case"-classified derived topic to hang a value angle on — anything less
//     falls back to a clearly-labeled generic message (`fallback: true`), which must be
//     the genuine last resort, not the default outcome for an ordinary actionable row.
import { visitorSafeCopy, hasIdentifiedContact, IDENTIFIED_CONTACT_REQUIRED_REASON } from "./gtmContract.js";

function _isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function _clean(v) {
  return _isBlank(v) ? "" : String(v).trim();
}

function _lc(v) {
  return String(v ?? "").trim().toLowerCase();
}

function _pick(row, ...keys) {
  for (const key of keys) {
    const value = _clean(row?.[key]);
    if (value) return value;
  }
  return "";
}

function _titleCase(phrase) {
  return phrase
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Commercial-intent or structurally generic pages — never a valid value-angle claim on
// their own (a pricing/demo/contact-page visit doesn't tell us anything specific about
// what to pitch). At most they support a restrained timing/interest signal.
const COMMERCIAL_OR_GENERIC_PATH_TOPICS = new Set([
  "pricing",
  "demo",
  "contact",
  "about",
  "product",
  "products",
  "solutions",
  "solution",
  "resources",
  "home",
  "index",
]);

// Extracts ONLY a URL path segment from why_now (e.g. "/insurance-claims-automation" out
// of "Acme Insurance appears to be exploring /insurance-claims-automation (4 sources); no
// CRM record."), never any of the surrounding internal/CRM-state prose, and classifies it
// as "use_case" or "commercial" (see module header). Returns kind "none" when no path is
// present (e.g. "BigBank — owned by Andrei, no open opp.").
//
// The slash must be preceded by whitespace or the start of the string — this is what
// distinguishes a genuine URL path (always a standalone token after a preposition/verb in
// these strings, e.g. "exploring /pricing") from an incidental slash inside ordinary
// prose (e.g. "Internal/test activity", "Known CRM/contact activity"), which is NOT a URL
// and must never be misread as one.
function _classifyPathTopic(whyNowSafe) {
  if (!whyNowSafe) return { topic: "", kind: "none" };
  const match = whyNowSafe.match(/(?:^|\s)\/([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*)/i);
  if (!match) return { topic: "", kind: "none" };
  const segments = match[1].split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? "";
  const words = lastSegment.split("-").filter(Boolean);
  if (words.length === 0) return { topic: "", kind: "none" };
  const rawTopic = words.join(" ").toLowerCase();
  const kind = COMMERCIAL_OR_GENERIC_PATH_TOPICS.has(rawTopic) ? "commercial" : "use_case";
  return { topic: _titleCase(rawTopic), kind };
}

// Real fields on the row this module reads. why_now is collected for `signalContext`
// (operator-facing, never templated directly) AND, narrowly, for topic classification —
// see module header. recommended_action is collected only for operator reference.
function _collectSignals(row) {
  const contactName = _pick(row, "contact_name", "best_contact_name");
  const contactTitle = _pick(row, "contact_title", "best_contact_title");
  const companyName = _pick(row, "company_name", "company_domain");
  const recommendedSolution = _pick(row, "recommended_solution");
  const recommendedAction = _pick(row, "recommended_action");
  const visitorClaimAllowed = _lc(_pick(row, "visitor_claim_allowed")) === "true";

  const whyNowRaw = _pick(row, "why_now");
  const whyNowSafe = whyNowRaw ? visitorSafeCopy(whyNowRaw, row?.visitor_claim_allowed ?? "false").text : "";
  const { topic: derivedTopic, kind: derivedTopicKind } = recommendedSolution
    ? { topic: "", kind: "none" }
    : _classifyPathTopic(whyNowSafe);

  // A commercial-topic timing clause only actually renders under these two conditions —
  // mirrors _timingSignalClause exactly, so `used` stays honest about whether why_now
  // really appears in the visible text.
  const rendersTimingClause = derivedTopicKind === "commercial" && visitorClaimAllowed;

  // used: fields actually incorporated into the visible drafted text. why_now is only
  // included when it actually renders somewhere (a use_case topic powering the value
  // angle, or a commercial-topic timing clause) — never when the raw text itself is
  // quoted, since it never is. industry/region are intentionally not collected — see
  // module header for why they're never rendered.
  const used = [];
  if (contactName) used.push("contact_name");
  if (contactTitle) used.push("contact_title");
  if (companyName) used.push("company_name");
  if (recommendedSolution) used.push("recommended_solution");
  if ((derivedTopicKind === "use_case" && derivedTopic) || rendersTimingClause) used.push("why_now");

  return {
    contactName,
    contactTitle,
    companyName,
    recommendedSolution,
    derivedTopic,
    derivedTopicKind,
    visitorClaimAllowed,
    // Operator-facing only — never templated into text/subject/body below.
    signalContext: whyNowSafe,
    recommendedAction,
    used,
  };
}

// A tailored draft needs someone to address (company) AND either a real product
// recommendation OR a "use_case"-classified derived topic to hang the value angle on.
// A "commercial"-classified topic (pricing, demo, etc.) never counts here — see
// _timingSignalClause for the only way it's allowed to color the (still generic) draft.
function _hasTailoredSignal(signals) {
  return Boolean(signals.companyName) && Boolean(signals.recommendedSolution || (signals.derivedTopicKind === "use_case" && signals.derivedTopic));
}

const GENERIC_VALUE_ANGLE =
  "DRUID's conversational AI agents help teams automate customer-facing and internal workflows end to end.";

function _greeting(signals) {
  return signals.contactName ? `Hi ${signals.contactName},` : "Hi there,";
}

function _companyRef(signals) {
  return signals.companyName || "your team";
}

// The "offer" this draft is built around: the real recommended_solution when present,
// otherwise the "use_case"-classified derived topic. Only ever called when
// _hasTailoredSignal is true, so this is guaranteed non-blank.
function _offer(signals) {
  return signals.recommendedSolution || signals.derivedTopic;
}

// Builds the tailored value-angle sentence. Only ever called when _hasTailoredSignal is
// true, i.e. `_offer` is a real recommended_solution or a specific use-case topic — never
// a commercial/generic page. No industry/region clause — see module header.
function _valueAngle(signals) {
  return `DRUID could help with ${_offer(signals)}.`;
}

function _roleClause(signals) {
  return signals.contactTitle ? ` Given your role as ${signals.contactTitle}, thought it might be worth a look.` : "";
}

function _tailoredNextStep(signals) {
  return `Happy to share more about ${_offer(signals)} — would a short call work?`;
}

const GENERIC_NEXT_STEP = "Would a short call this week work to see if it's relevant?";

// Restrained timing/interest lead-in used ONLY for the generic (fallback) message, and
// ONLY when why_now derived a "commercial"-classified page AND visitor_claim_allowed is
// true. Deliberately generic wording — never names the specific page ("pricing", "demo",
// etc.) as that would itself be the same kind of overclaim being guarded against; this
// only signals that the account is somewhere in an active evaluation, not what page it
// was. Returns "" (no lead-in at all) otherwise, so the plain generic opener is used —
// never presented as an observation when visitor_claim_allowed isn't true.
function _timingSignalClause(signals) {
  if (signals.derivedTopicKind !== "commercial") return "";
  if (!signals.visitorClaimAllowed) return "";
  const sentence = "Since your team appears to be evaluating automation options, ";
  return visitorSafeCopy(sentence, "true").text;
}

// A blocked composer result carries no greeting, subject, body, or signal context —
// nothing that could be copied, downloaded, approved, or confirmed. Every caller (the
// MessageComposer UI, ActionModal) must check `.blocked` and refuse to render/enable any
// of those, never falling back to `.fallback`-only handling for this case (product
// decision, 2026-07-24).
function _blockedDraft() {
  return { blocked: true, blockedReason: IDENTIFIED_CONTACT_REQUIRED_REASON, fallback: true, usedFields: [], signalContext: "" };
}

// ─── LinkedIn: concise, conversational, no subject, modest next step ──────────────────
export function composeLinkedinDraft(row) {
  if (!hasIdentifiedContact(row)) {
    return { text: "", ..._blockedDraft() };
  }
  const signals = _collectSignals(row);
  const fallback = !_hasTailoredSignal(signals);
  const greeting = _greeting(signals);
  const company = _companyRef(signals);

  const text = fallback
    ? `${greeting} ${_timingSignalClause(signals) || "I wanted to reach out — "}${GENERIC_VALUE_ANGLE} Open to a short conversation to see if it's relevant for ${company}?`
    : `${greeting} ${_valueAngle(signals)}${_roleClause(signals)} Worth a quick chat to see if it's a fit for ${company}?`;

  return {
    text,
    usedFields: signals.used,
    fallback,
    // Explicit false/"" (not omitted) so this return shape stays uniform with the blocked
    // path above — omitting these here made TypeScript infer two incompatible object
    // shapes for JS consumers, which broke `.blocked`/`.blockedReason` access in TSX.
    blocked: false,
    blockedReason: "",
    signalContext: signals.signalContext,
  };
}

// ─── Email: subject + short body, slightly more contextual than LinkedIn ──────────────
export function composeEmailDraft(row) {
  if (!hasIdentifiedContact(row)) {
    return { subject: "", body: "", ..._blockedDraft() };
  }
  const signals = _collectSignals(row);
  const fallback = !_hasTailoredSignal(signals);
  const greeting = _greeting(signals);
  const company = _companyRef(signals);

  const subject = fallback ? `Quick question for ${company}` : `${_offer(signals)} at ${company}`;
  const nextStep = fallback ? GENERIC_NEXT_STEP : _tailoredNextStep(signals);

  const body = fallback
    ? [
        greeting,
        "",
        `${_timingSignalClause(signals) || "I wanted to reach out — "}${GENERIC_VALUE_ANGLE}`,
        "",
        `Would you be open to a short conversation to see if it's relevant for ${company}?`,
      ].join("\n")
    : [`${greeting}${_roleClause(signals)}`, "", _valueAngle(signals), "", nextStep].join("\n");

  return {
    subject,
    body,
    usedFields: signals.used,
    fallback,
    blocked: false,
    blockedReason: "",
    signalContext: signals.signalContext,
  };
}
