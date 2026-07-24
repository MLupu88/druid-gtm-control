// messageComposer.test.js — unit tests for the deterministic activation composer.
// Run with: node --test lib/gtm-shared/src/messageComposer.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { composeLinkedinDraft, composeEmailDraft } from "./messageComposer.js";
import { MOCK_ACCOUNT_QUEUE } from "./mockData.js";

function accountRow(companyName) {
  const row = MOCK_ACCOUNT_QUEUE.find((r) => r.company_name === companyName);
  assert.ok(row, `fixture row for ${companyName} must exist in MOCK_ACCOUNT_QUEUE`);
  return row;
}

// ───────────────────────── LinkedIn tailored composition ────────────────────────────

test("composeLinkedinDraft: tailored when company + recommended_solution are present", () => {
  const row = {
    contact_name: "Jordan Rivera",
    company_name: "Acme Insurance",
    industry: "Insurance",
    country: "US",
    recommended_solution: "Customer Self-Service & Claims Automation",
    why_now: "US person-level visitor match (RB2B) on /solutions/claims",
  };
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Jordan Rivera/);
  assert.match(draft.text, /Customer Self-Service & Claims Automation/);
  assert.match(draft.text, /Acme Insurance/);
  // industry/region are intentionally never rendered (see module header) — usedFields
  // must only list what's actually incorporated into the visible text.
  assert.deepEqual(draft.usedFields.slice().sort(), ["company_name", "contact_name", "recommended_solution"].sort());
});

test("composeLinkedinDraft: is concise (single paragraph), conversational, no subject field", () => {
  const draft = composeLinkedinDraft({
    company_name: "Globex",
    recommended_solution: "Order Management Automation",
  });
  assert.equal(draft.text.includes("\n"), false, "LinkedIn draft should be a single conversational paragraph");
  assert.equal("subject" in draft, false, "LinkedIn draft must never include a subject field");
});

test("composeLinkedinDraft: never claims a message was sent", () => {
  const draft = composeLinkedinDraft({ company_name: "Acme", recommended_solution: "Claims Automation" });
  assert.doesNotMatch(draft.text, /\bsent\b/i);
  assert.doesNotMatch(draft.text, /\bdelivered\b/i);
});

// ───────────────────────── Email tailored composition ────────────────────────────────

test("composeEmailDraft: tailored subject + body, more contextual than LinkedIn", () => {
  const row = {
    contact_name: "Sophie Linden",
    contact_title: "Head of Operations",
    company_name: "EuroCare Health",
    industry: "Healthcare",
    country: "NL",
    recommended_solution: "Patient Scheduling & Intake Automation",
  };
  const draft = composeEmailDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.subject, /Patient Scheduling & Intake Automation/);
  assert.match(draft.subject, /EuroCare Health/);
  assert.match(draft.body, /Sophie Linden/);
  assert.match(draft.body, /Head of Operations/);
  // industry/region are intentionally never rendered — see the "raw region tokens" and
  // "unsupported claim" tests below.
  assert.doesNotMatch(draft.body, /Healthcare/);
  assert.doesNotMatch(draft.body, /\bNL\b/);
});

test("composeEmailDraft: never claims an email was sent", () => {
  const draft = composeEmailDraft({ company_name: "Acme", recommended_solution: "Claims Automation" });
  assert.doesNotMatch(draft.body, /\bsent\b/i);
  assert.doesNotMatch(draft.subject, /\bsent\b/i);
});

test("composeEmailDraft: body has multiple short paragraphs (subject separate from body)", () => {
  const draft = composeEmailDraft({ company_name: "Acme", recommended_solution: "Claims Automation" });
  assert.ok(draft.body.includes("\n\n"), "email body should have paragraph breaks");
  assert.equal(typeof draft.subject, "string");
  assert.ok(draft.subject.length > 0);
});

// ───────────────────────── Generic fallback ──────────────────────────────────────────

test("composeLinkedinDraft: falls back to a generic safe message with no company/solution", () => {
  const draft = composeLinkedinDraft({});
  assert.equal(draft.fallback, true);
  assert.deepEqual(draft.usedFields, []);
  assert.match(draft.text, /DRUID's conversational AI agents/);
});

test("composeEmailDraft: falls back to a generic safe message with no company/solution", () => {
  const draft = composeEmailDraft({});
  assert.equal(draft.fallback, true);
  assert.deepEqual(draft.usedFields, []);
  assert.match(draft.body, /DRUID's conversational AI agents/);
});

test("composeLinkedinDraft: falls back when company is present but there is no recommended_solution", () => {
  // recommended_action alone (internal instruction text, e.g. "Notify opportunity owner")
  // must never be enough to trigger tailored composition on its own.
  const draft = composeLinkedinDraft({
    company_name: "Allianz X",
    recommended_action: "Notify opportunity owner",
  });
  assert.equal(draft.fallback, true);
});

// ───────────────────────── No invented values ────────────────────────────────────────

test("composeLinkedinDraft: never renders undefined/null/placeholder tokens", () => {
  const draft = composeLinkedinDraft({ company_name: "Acme", recommended_solution: "" });
  assert.doesNotMatch(draft.text, /undefined/);
  assert.doesNotMatch(draft.text, /null/);
  assert.doesNotMatch(draft.text, /\{\{/);
  assert.doesNotMatch(draft.text, /N\/A/);
});

test("composeEmailDraft: never renders undefined/null/placeholder tokens", () => {
  const draft = composeEmailDraft({});
  assert.doesNotMatch(draft.body, /undefined/);
  assert.doesNotMatch(draft.subject, /undefined/);
  assert.doesNotMatch(draft.body, /null/);
  assert.doesNotMatch(draft.body, /\{\{/);
});

test("composeLinkedinDraft: never quotes recommended_action verbatim in the drafted text", () => {
  // recommended_action in the real schema is an internal operator instruction
  // ("Approve LinkedIn outreach (Dripify)", "Suppressed - no action") — never
  // customer-facing copy, so it must never appear in the message body.
  const row = {
    company_name: "DRUID AI",
    recommended_solution: "Order Management Automation",
    recommended_action: "Suppressed - no action",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.text, /Suppressed - no action/i);
});

test("composeEmailDraft: never quotes recommended_action verbatim in the drafted text", () => {
  const row = {
    company_name: "StadtKlinik Group",
    recommended_solution: "Patient Scheduling & Intake Automation",
    recommended_action: "Approve LinkedIn outreach (Dripify)",
  };
  const draft = composeEmailDraft(row);
  assert.doesNotMatch(draft.body, /Dripify/i);
  assert.doesNotMatch(draft.subject, /Dripify/i);
});

test("composeLinkedinDraft: never quotes raw why_now vendor/jargon language in the drafted text", () => {
  const row = {
    company_name: "Acme Insurance",
    recommended_solution: "Claims Automation",
    why_now: "US person-level visitor match (RB2B) on /solutions/claims; active search intent",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.text, /RB2B/);
  assert.doesNotMatch(draft.text, /visitor match/i);
  // why_now is still surfaced separately, for the operator's own reference only.
  assert.match(draft.signalContext, /RB2B/);
});

// ───────────────────────── Visitor-safe wording ──────────────────────────────────────

test("composeLinkedinDraft: signalContext runs why_now through visitorSafeCopy (visitor_claim_allowed=false)", () => {
  const row = {
    company_name: "Acme",
    recommended_solution: "Claims Automation",
    why_now: "You visited our pricing page yesterday",
    visitor_claim_allowed: "false",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.signalContext, /\byou visited\b/i);
});

test("composeEmailDraft: signalContext is empty (not fabricated) when why_now is blank", () => {
  const draft = composeEmailDraft({ company_name: "Acme", recommended_solution: "Claims Automation" });
  assert.equal(draft.signalContext, "");
});

// ───────────────────────── Field-source integrity ────────────────────────────────────

test("composeLinkedinDraft: prefers contact_name/company_name over best_contact_name/company_domain fallbacks", () => {
  const draft = composeLinkedinDraft({
    contact_name: "Morgan Chen",
    best_contact_name: "Should Not Appear",
    company_name: "Globex",
    company_domain: "globex.com",
    recommended_solution: "Automation",
  });
  assert.match(draft.text, /Morgan Chen/);
  assert.doesNotMatch(draft.text, /Should Not Appear/);
});

test("composeLinkedinDraft: falls through to best_contact_name/company_domain when preferred fields are blank", () => {
  const draft = composeLinkedinDraft({
    best_contact_name: "Alex Torrez",
    company_domain: "claimsfirst.com",
    recommended_solution: "Claims Automation",
  });
  assert.match(draft.text, /Alex Torrez/);
  assert.match(draft.text, /claimsfirst\.com/);
});

// ───────────────────────── account_queue: derived-topic fallback tier ───────────────
// account_queue rows have NO recommended_solution field at all (confirmed against
// MOCK_ACCOUNT_QUEUE) — without a further signal source, every account_queue row would
// hit the generic fallback. These tests use the REAL mock rows, not synthetic fixtures,
// so they fail if the real schema ever changes underneath this logic.

test("composeLinkedinDraft: Globex (real MOCK_ACCOUNT_QUEUE row, /pricing) never renders 'Pricing' as the DRUID value angle — pricing is commercial-intent, not a use case", () => {
  const row = accountRow("Globex");
  assert.equal(row.recommended_solution, undefined, "sanity: account_queue rows genuinely have no recommended_solution field");
  assert.match(row.why_now, /\/pricing/);
  const draft = composeLinkedinDraft(row);
  // Pricing is a commercial/generic page — it must remain the safe generic fallback,
  // never a specific (and wrong) "DRUID could help with Pricing" claim.
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /DRUID could help with Pricing/i);
  assert.doesNotMatch(draft.text, /\bPricing\b/);
});

test("composeLinkedinDraft: Globex still gets a restrained, relevant timing signal (visitor_claim_allowed=true) instead of the bare generic opener", () => {
  const row = accountRow("Globex");
  assert.equal(row.visitor_claim_allowed, "true");
  const draft = composeLinkedinDraft(row);
  assert.match(draft.text, /evaluating automation options/i);
  assert.ok(draft.usedFields.includes("why_now"));
  // Still the conservative generic value angle underneath — no fabricated specific claim.
  assert.match(draft.text, /DRUID's conversational AI agents help teams automate/);
});

test("composeLinkedinDraft: a commercial-page topic (e.g. /pricing) gets NO timing signal at all when visitor_claim_allowed is false", () => {
  const draft = composeLinkedinDraft({
    company_name: "Acme",
    why_now: "Acme engaged with /pricing (2 sources); no CRM record.",
    visitor_claim_allowed: "false",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /evaluating automation options/i);
  assert.doesNotMatch(draft.text, /\bPricing\b/);
});

test("composeLinkedinDraft: Acme Insurance (real MOCK_ACCOUNT_QUEUE row, Sales Review, visitor_claim_allowed=false) gets a tailored draft from /insurance-claims-automation, with NO observation claim", () => {
  const row = accountRow("Acme Insurance");
  assert.equal(row.visitor_claim_allowed, "false");
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Insurance Claims Automation/);
  assert.doesNotMatch(draft.text, /Since your team has been looking into/i);
  assert.doesNotMatch(draft.text, /\byou visited\b/i);
});

test("composeLinkedinDraft: Acme Insurance's derived topic never leaks the surrounding internal CRM-state prose", () => {
  const row = accountRow("Acme Insurance");
  assert.match(row.why_now, /no CRM record/);
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.text, /CRM record/i);
  assert.doesNotMatch(draft.text, /\(4 sources\)/);
});

test("composeLinkedinDraft: Some Company Ltd (real row) correctly falls back — a bare '/solutions' path is too generic to be a specific topic", () => {
  const row = accountRow("Some Company Ltd");
  assert.match(row.why_now, /\/solutions/);
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /\bSolutions\b/);
});

test("composeLinkedinDraft: BigBank (real row) correctly falls back — why_now has no URL path, only internal ownership routing text", () => {
  const row = accountRow("BigBank");
  assert.match(row.why_now, /owned by Andrei/);
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /Andrei/);
});

test("composeLinkedinDraft: Allianz X (real row) correctly falls back — why_now describes internal CRM state (open opportunity), not a topic", () => {
  const row = accountRow("Allianz X");
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /opportunity/i);
});

test("composeEmailDraft: Acme Insurance (real row) gets a tailored subject from the derived topic, not the generic subject", () => {
  const row = accountRow("Acme Insurance");
  const draft = composeEmailDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.subject, /Insurance Claims Automation/);
});

test("composeLinkedinDraft: an incidental slash inside ordinary prose (not a URL) is never misread as a path", () => {
  // Regression case: "Internal/test activity" previously produced a nonsensical
  // "DRUID could help with Test" draft — the slash here is NOT a URL, just two words
  // separated by a slash with no preceding whitespace.
  const draft = composeLinkedinDraft({
    company_name: "DRUID AI",
    why_now: "Internal/test activity",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /\bTest\b/);
});

test("composeLinkedinDraft: an incidental slash like 'CRM/contact' is never misread as a path either", () => {
  const draft = composeLinkedinDraft({
    company_name: "Globex",
    why_now: "Known CRM/contact activity (HubSpot): pricing page revisit",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /\bContact\b/);
});

test("composeLinkedinDraft: a genuine multi-segment path derives its LAST segment as the topic", () => {
  const draft = composeLinkedinDraft({
    company_name: "Acme",
    why_now: "US person-level visitor match (RB2B) on /solutions/claims; active search intent",
  });
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Claims/);
});

test("composeLinkedinDraft: recommended_solution always wins over a derived topic when both are present", () => {
  const draft = composeLinkedinDraft({
    company_name: "Acme",
    recommended_solution: "Claims Automation Suite",
    why_now: "Acme appears to be exploring /pricing (2 sources); no CRM record.",
  });
  assert.match(draft.text, /Claims Automation Suite/);
  assert.doesNotMatch(draft.text, /\bPricing\b/);
});

// ───────────────────────── commercial vs. use-case path classification ──────────────
// Every path in this list must NEVER become "DRUID could help with {page}." — confirmed
// per-item, not just for /pricing, since the whole point is a classification rule.

for (const commercialPath of ["/pricing", "/demo", "/contact", "/about", "/product", "/solutions", "/resources"]) {
  test(`composeLinkedinDraft: '${commercialPath}' is commercial/generic — never becomes the value angle`, () => {
    const draft = composeLinkedinDraft({
      company_name: "Acme",
      why_now: `Acme engaged with ${commercialPath} (2 sources); no CRM record.`,
    });
    assert.equal(draft.fallback, true);
    const bareTopic = commercialPath.replace(/^\//, "");
    assert.doesNotMatch(draft.text, new RegExp(`DRUID could help with ${bareTopic}`, "i"));
  });
}

for (const useCasePath of ["/insurance-claims-automation", "/patient-scheduling", "/solutions/claims"]) {
  test(`composeLinkedinDraft: '${useCasePath}' is a specific use case — still tailors the value angle`, () => {
    const draft = composeLinkedinDraft({
      company_name: "Acme",
      why_now: `Acme appears to be exploring ${useCasePath} (3 sources); no CRM record.`,
    });
    assert.equal(draft.fallback, false);
    assert.match(draft.text, /DRUID could help with/);
  });
}

// ───────────────────────── raw region tokens are never rendered ─────────────────────

test("composeLinkedinDraft: a raw lowercase region value ('us') is never rendered anywhere in the output", () => {
  const draft = composeLinkedinDraft({
    company_name: "Globex",
    region: "us",
    recommended_solution: "Claims Automation",
  });
  // This is the exact reported bug: "DRUID could help with Pricing — we work with teams
  // in us on this." Region is no longer rendered at all (see module header), so this
  // exact pattern — and the raw token generally — must never reappear.
  assert.doesNotMatch(draft.text, /\bin us\b/i);
  assert.doesNotMatch(draft.text, /\bworks? with (other )?teams?\b/i);
});

test("composeEmailDraft: a raw lowercase region value ('emea') is never rendered anywhere in the output", () => {
  const draft = composeEmailDraft({
    company_name: "Acme Insurance",
    country: "emea",
    recommended_solution: "Claims Automation",
  });
  assert.doesNotMatch(draft.body, /\bemea\b/i);
  assert.doesNotMatch(draft.subject, /\bemea\b/i);
});

test("composeLinkedinDraft: the real Globex/Acme Insurance MOCK_ACCOUNT_QUEUE rows (region: 'us'/'emea') never leak the raw region token", () => {
  const globex = composeLinkedinDraft(accountRow("Globex"));
  const acme = composeLinkedinDraft(accountRow("Acme Insurance"));
  assert.doesNotMatch(globex.text, /\bin us\b/i);
  assert.doesNotMatch(acme.text, /\bin emea\b/i);
  assert.doesNotMatch(acme.text, /\bemea\b/i);
});

test("composeLinkedinDraft: never emits the old unsupported 'we work with other teams' claim", () => {
  const row = {
    company_name: "Acme Insurance",
    industry: "Insurance",
    country: "US",
    recommended_solution: "Claims Automation",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.text, /we work with/i);
});

test("composeEmailDraft: never emits the old unsupported 'we work with other teams' claim", () => {
  const row = {
    company_name: "EuroCare Health",
    industry: "Healthcare",
    country: "NL",
    recommended_solution: "Patient Scheduling Automation",
  };
  const draft = composeEmailDraft(row);
  assert.doesNotMatch(draft.body, /we work with/i);
});

// ───────────────────────── internal CRM/routing language stays excluded ─────────────
// (Confirmed above for specific real rows too — Acme Insurance/BigBank/Allianz X.)

test("composeLinkedinDraft: internal CRM/routing phrases never leak even when they sit right next to a real use-case path", () => {
  const draft = composeLinkedinDraft({
    company_name: "Acme",
    why_now: "Acme appears to be exploring /insurance-claims-automation (4 sources); owned by Andrei; no CRM record; open opportunity exists.",
  });
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Insurance Claims Automation/);
  assert.doesNotMatch(draft.text, /Andrei/);
  assert.doesNotMatch(draft.text, /CRM record/i);
  assert.doesNotMatch(draft.text, /open opportunity/i);
});
