// messageComposer.js — deterministic, side-effect-free draft generation for the
// activation composer (LinkedIn self-serve export / email draft).
//
// Rules this module exists to enforce:
//   - Pure string templating only. No network calls, no LLM/provider, no client-side AI,
//     and no randomness anywhere. Every angle (see ANGLES below) is a genuinely different,
//     equally deterministic rendering of the SAME safe signal set — never an illusion of
//     variety, and never described anywhere as "AI-generated."
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
//         "/insurance-claims-automation", "/solutions/claims") — may power a tailored
//         angle (use_case/business_value below), the same way recommended_solution does.
//       - "commercial": a commercial-intent or structurally generic page (pricing, demo,
//         contact, about, product, solutions, resources, home) — this must NEVER become
//         "DRUID could help with {page}." It may, at most, support a restrained
//         timing/interest signal (e.g. "Since your team appears to be evaluating
//         automation options..."), and only when visitor_claim_allowed is true. The
//         underlying rendering in that case is still the conservative generic one —
//         never a fabricated specific claim about what the page means.
//       - "none": no path found at all (e.g. "BigBank — owned by Andrei, no open opp."),
//         or the path is present but empty after parsing.
//   - recommended_action is likewise internal operator-instruction text as written today
//     ("Approve LinkedIn outreach (Dripify)", "Suppressed - no action", "Notify opportunity
//     owner") — confirmed against the real queue rows, not customer-facing copy. Quoting
//     it verbatim in a drafted message would read as broken/nonsensical to a prospect, so
//     it is deliberately excluded from the templated text.
//   - Region/industry/score components are deliberately NOT rendered anywhere in the
//     drafted text. The previous "— we work with other {industry} teams in {region} on
//     this" clause was an unsupported claim (an unverifiable assertion about DRUID's
//     customer history) and also emitted raw, un-normalized region tokens (e.g. "in us").
//     Omitting it entirely is safer than inventing new phrasing to replace it. The same
//     discipline applies to the business_value angle below: it may describe DRUID's own
//     general capability, grounded in the specific offer, but must never reference other
//     customers/teams, must never imply the prospect currently HAS a specific problem, and
//     must never quantify a benefit (no percentages, hours, dollar figures).
//   - Tailored composition (use_case/business_value angles) requires a company to address
//     AND either recommended_solution or a "use_case"-classified derived topic to hang a
//     claim on — anything less falls back to the same conservative generic message every
//     angle uses in that situation (`fallback: true`), which must be the genuine last
//     resort, not the default outcome for an ordinary actionable row.
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

// Commercial-intent or structurally generic pages — never a valid claim on their own (a
// pricing/demo/contact-page visit doesn't tell us anything specific to pitch). At most
// they support a restrained timing/interest signal in the generic rendering.
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

// Extracts ONLY a URL path segment from why_now, never any surrounding internal/CRM-state
// prose, and classifies it as "use_case" or "commercial" (see module header).
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

// Real fields on the row every angle may draw from. why_now is collected for
// `signalContext` (operator-facing, never templated directly) AND, narrowly, for topic
// classification — see module header. recommended_action is collected only for operator
// reference and is never templated into any angle's output.
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

  return {
    contactName,
    contactTitle,
    companyName,
    recommendedSolution,
    derivedTopic,
    derivedTopicKind,
    visitorClaimAllowed,
    // Operator-facing only — never templated into text/subject/body by any angle.
    signalContext: whyNowSafe,
    recommendedAction,
  };
}

// Whether there's a safe, non-fabricated signal to hang a specific claim on — required by
// BOTH tailored angles (use_case, business_value). Without this, no angle may claim a
// specific offer; every angle converges on the same generic rendering.
function _hasTailoredSignal(signals) {
  return Boolean(signals.companyName) && Boolean(signals.recommendedSolution || (signals.derivedTopicKind === "use_case" && signals.derivedTopic));
}

// Fields common to every angle's greeting/role clause.
function _baseUsedFields(signals) {
  const used = [];
  if (signals.contactName) used.push("contact_name");
  if (signals.contactTitle) used.push("contact_title");
  if (signals.companyName) used.push("company_name");
  return used;
}

// Fields specifically used to ground a tailored claim (use_case/business_value angles) —
// only ever added when that grounding signal genuinely exists and was rendered.
function _offerUsedFields(signals) {
  const used = [];
  if (signals.recommendedSolution) used.push("recommended_solution");
  if (signals.derivedTopicKind === "use_case" && signals.derivedTopic) used.push("why_now");
  return used;
}

const GENERIC_VALUE_ANGLE =
  "DRUID's conversational AI agents help teams automate customer-facing and internal workflows end to end.";

function _greeting(signals) {
  return signals.contactName ? `Hi ${signals.contactName},` : "Hi there,";
}

function _companyRef(signals) {
  return signals.companyName || "your team";
}

// The real recommended_solution when present, otherwise the "use_case"-classified derived
// topic. Only ever called when a tailored angle is actually rendering, so guaranteed
// non-blank at that point.
function _offer(signals) {
  return signals.recommendedSolution || signals.derivedTopic;
}

function _roleClause(signals) {
  return signals.contactTitle ? ` Given your role as ${signals.contactTitle}, thought it might be worth a look.` : "";
}

// Restrained timing/interest lead-in used ONLY in the generic rendering, and ONLY when
// why_now derived a "commercial"-classified page AND visitor_claim_allowed is true.
// Deliberately generic wording — never names the specific page, as that would itself be
// the kind of overclaim being guarded against.
function _timingSignalClause(signals) {
  if (signals.derivedTopicKind !== "commercial") return "";
  if (!signals.visitorClaimAllowed) return "";
  const sentence = "Since your team appears to be evaluating automation options, ";
  return visitorSafeCopy(sentence, "true").text;
}

// ===================== ANGLES (product decision, PR 3) ==================================
// Three genuinely different, equally deterministic renderings of the same safe signal
// set — never randomness, never described as AI-generated anywhere in the UI.
export const ANGLES = {
  USE_CASE: "use_case",
  BUSINESS_VALUE: "business_value",
  GENERAL: "general",
};

export const ANGLE_LABELS = {
  [ANGLES.USE_CASE]: "Use-case led",
  [ANGLES.BUSINESS_VALUE]: "Business-value led",
  [ANGLES.GENERAL]: "General outreach",
};

export const ANGLE_ORDER = [ANGLES.USE_CASE, ANGLES.BUSINESS_VALUE, ANGLES.GENERAL];

// Unknown/invalid angle values fail closed to the safest, always-available rendering —
// matching this codebase's existing conservative-default pattern elsewhere (engine_mode,
// visitor_claim_allowed, identity resolution).
function _normalizeAngle(angle) {
  return ANGLE_ORDER.includes(angle) ? angle : ANGLES.GENERAL;
}

// The truthful default: use_case only when a safe, non-fabricated signal exists to hang it
// on; general otherwise. Never business_value by default — see product decision, PR 3.
export function defaultAngleForRow(row) {
  if (!hasIdentifiedContact(row)) return ANGLES.GENERAL;
  const signals = _collectSignals(row);
  return _hasTailoredSignal(signals) ? ANGLES.USE_CASE : ANGLES.GENERAL;
}

// ─── generic rendering — the shared fallback for every angle when no safe signal exists,
// and the deliberate, always-available rendering for the "general" angle itself. ─────────
function _genericLinkedin(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const timing = _timingSignalClause(signals);
  const text = `${greeting} ${timing || "I wanted to reach out — "}${GENERIC_VALUE_ANGLE} Open to a short conversation to see if it's relevant for ${company}?`;
  const used = _baseUsedFields(signals);
  if (timing) used.push("why_now");
  return { text, used };
}

function _genericEmail(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const timing = _timingSignalClause(signals);
  const subject = `Quick question for ${company}`;
  const body = [
    greeting,
    "",
    `${timing || "I wanted to reach out — "}${GENERIC_VALUE_ANGLE}`,
    "",
    `Would you be open to a short conversation to see if it's relevant for ${company}?`,
  ].join("\n");
  const used = _baseUsedFields(signals);
  if (timing) used.push("why_now");
  return { subject, body, used };
}

// ─── use_case angle — direct and specific: "DRUID could help with {offer}." (identical
// to this module's original, pre-PR-3 tailored rendering). ───────────────────────────────
function _useCaseLinkedin(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const text = `${greeting} DRUID could help with ${_offer(signals)}.${_roleClause(signals)} Worth a quick chat to see if it's a fit for ${company}?`;
  return { text, used: [..._baseUsedFields(signals), ..._offerUsedFields(signals)] };
}

function _useCaseEmail(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const subject = `${_offer(signals)} at ${company}`;
  const body = [
    `${greeting}${_roleClause(signals)}`,
    "",
    `DRUID could help with ${_offer(signals)}.`,
    "",
    `Happy to share more about ${_offer(signals)} — would a short call work?`,
  ].join("\n");
  return { subject, body, used: [..._baseUsedFields(signals), ..._offerUsedFields(signals)] };
}

// ─── business_value angle — describes DRUID's general operational value, grounded in the
// same offer as use_case, WITHOUT implying the prospect currently has a specific problem
// and WITHOUT quantifying any benefit (no percentages, hours, dollar figures — see module
// header). Never references other customers/teams. ──────────────────────────────────────
function _businessValueSentence(signals) {
  return `DRUID is built to automate work like ${_offer(signals)}, with the goal of cutting manual effort and freeing up time for higher-value work.`;
}

function _businessValueLinkedin(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const text = `${greeting} ${_businessValueSentence(signals)}${_roleClause(signals)} Would it be worth a short conversation about the potential value for ${company}?`;
  return { text, used: [..._baseUsedFields(signals), ..._offerUsedFields(signals)] };
}

function _businessValueEmail(signals) {
  const greeting = _greeting(signals);
  const company = _companyRef(signals);
  const subject = `Potential value from ${_offer(signals)} at ${company}`;
  const body = [
    `${greeting}${_roleClause(signals)}`,
    "",
    _businessValueSentence(signals),
    "",
    `Would it be worth a short conversation about the potential value for ${company}?`,
  ].join("\n");
  return { subject, body, used: [..._baseUsedFields(signals), ..._offerUsedFields(signals)] };
}

// A blocked composer result carries no greeting, subject, body, or signal context —
// nothing that could be copied, downloaded, approved, or confirmed. Every caller (the
// MessageComposer UI, ActionModal) must check `.blocked` and refuse to render/enable any
// of those, never falling back to `.fallback`-only handling for this case.
function _blockedDraft() {
  return {
    blocked: true,
    blockedReason: IDENTIFIED_CONTACT_REQUIRED_REASON,
    fallback: true,
    usedFields: [],
    signalContext: "",
    angle: ANGLES.GENERAL,
  };
}

// ─── LinkedIn: concise, conversational, no subject, modest next step ──────────────────
export function composeLinkedinDraft(row, angle) {
  if (!hasIdentifiedContact(row)) {
    return { text: "", ..._blockedDraft() };
  }
  const signals = _collectSignals(row);
  const hasTailored = _hasTailoredSignal(signals);
  const requestedAngle = _normalizeAngle(angle ?? defaultAngleForRow(row));

  let rendered;
  let effectiveAngle;
  if (!hasTailored || requestedAngle === ANGLES.GENERAL) {
    rendered = _genericLinkedin(signals);
    effectiveAngle = ANGLES.GENERAL;
  } else if (requestedAngle === ANGLES.BUSINESS_VALUE) {
    rendered = _businessValueLinkedin(signals);
    effectiveAngle = ANGLES.BUSINESS_VALUE;
  } else {
    rendered = _useCaseLinkedin(signals);
    effectiveAngle = ANGLES.USE_CASE;
  }

  return {
    text: rendered.text,
    usedFields: rendered.used,
    fallback: !hasTailored,
    blocked: false,
    blockedReason: "",
    signalContext: signals.signalContext,
    angle: effectiveAngle,
  };
}

// ─── Email: subject + short body, slightly more contextual than LinkedIn ──────────────
export function composeEmailDraft(row, angle) {
  if (!hasIdentifiedContact(row)) {
    return { subject: "", body: "", ..._blockedDraft() };
  }
  const signals = _collectSignals(row);
  const hasTailored = _hasTailoredSignal(signals);
  const requestedAngle = _normalizeAngle(angle ?? defaultAngleForRow(row));

  let rendered;
  let effectiveAngle;
  if (!hasTailored || requestedAngle === ANGLES.GENERAL) {
    rendered = _genericEmail(signals);
    effectiveAngle = ANGLES.GENERAL;
  } else if (requestedAngle === ANGLES.BUSINESS_VALUE) {
    rendered = _businessValueEmail(signals);
    effectiveAngle = ANGLES.BUSINESS_VALUE;
  } else {
    rendered = _useCaseEmail(signals);
    effectiveAngle = ANGLES.USE_CASE;
  }

  return {
    subject: rendered.subject,
    body: rendered.body,
    usedFields: rendered.used,
    fallback: !hasTailored,
    blocked: false,
    blockedReason: "",
    signalContext: signals.signalContext,
    angle: effectiveAngle,
  };
}
