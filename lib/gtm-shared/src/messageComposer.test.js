// messageComposer.test.js — unit tests for the deterministic activation composer.
// Run with: node --test lib/gtm-shared/src/messageComposer.test.js
//
// NOTE (product decision, 2026-07-24): composeLinkedinDraft/composeEmailDraft now require
// an identified contact (known_crm_contact/identified_contact) before producing ANY draft
// text — see hasIdentifiedContact() in gtmContract.js. Most ad-hoc rows below set
// identity_resolution: "identified_contact" explicitly so they keep exercising the
// composer's text-generation logic (tailoring, fallback, redaction, path classification)
// rather than incidentally hitting the new identity block. Tests that specifically cover
// the identity requirement itself are grouped near the end of this file. Every ad-hoc row
// constructed in this file is synthetic demo/test data (provenance:"synthetic_demo_fixture")
// — never real evidence, customers, scoring, or Client Radar findings.
import test from "node:test";
import assert from "node:assert/strict";
import {
  composeLinkedinDraft,
  composeEmailDraft,
  ANGLES,
  ANGLE_LABELS,
  ANGLE_ORDER,
  defaultAngleForRow,
} from "./messageComposer.js";
import { MOCK_ACCOUNT_QUEUE } from "./mockData.js";

function accountRow(companyName) {
  const row = MOCK_ACCOUNT_QUEUE.find((r) => r.company_name === companyName);
  assert.ok(row, `fixture row for ${companyName} must exist in MOCK_ACCOUNT_QUEUE`);
  return row;
}

// ───────────────────────── LinkedIn tailored composition ────────────────────────────

test("composeLinkedinDraft: tailored when company + recommended_solution are present", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Globex",
    recommended_solution: "Order Management Automation",
  });
  assert.equal(draft.text.includes("\n"), false, "LinkedIn draft should be a single conversational paragraph");
  assert.equal("subject" in draft, false, "LinkedIn draft must never include a subject field");
});

test("composeLinkedinDraft: never claims a message was sent", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.doesNotMatch(draft.text, /\bsent\b/i);
  assert.doesNotMatch(draft.text, /\bdelivered\b/i);
});

// ───────────────────────── Email tailored composition ────────────────────────────────

test("composeEmailDraft: tailored subject + body, more contextual than LinkedIn", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
  const draft = composeEmailDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.doesNotMatch(draft.body, /\bsent\b/i);
  assert.doesNotMatch(draft.subject, /\bsent\b/i);
});

test("composeEmailDraft: body has multiple short paragraphs (subject separate from body)", () => {
  const draft = composeEmailDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.ok(draft.body.includes("\n\n"), "email body should have paragraph breaks");
  assert.equal(typeof draft.subject, "string");
  assert.ok(draft.subject.length > 0);
});

// ───────────────────────── Generic fallback ──────────────────────────────────────────

test("composeLinkedinDraft: falls back to a generic safe message with no company/solution (contact is identified)", () => {
  const draft = composeLinkedinDraft({ provenance: "synthetic_demo_fixture", identity_resolution: "identified_contact" });
  assert.equal(draft.fallback, true);
  assert.deepEqual(draft.usedFields, []);
  assert.match(draft.text, /DRUID's conversational AI agents/);
});

test("composeEmailDraft: falls back to a generic safe message with no company/solution (contact is identified)", () => {
  const draft = composeEmailDraft({ provenance: "synthetic_demo_fixture", identity_resolution: "identified_contact" });
  assert.equal(draft.fallback, true);
  assert.deepEqual(draft.usedFields, []);
  assert.match(draft.body, /DRUID's conversational AI agents/);
});

test("composeLinkedinDraft: falls back when company is present but there is no recommended_solution", () => {
  // recommended_action alone (internal instruction text, e.g. "Notify opportunity owner")
  // must never be enough to trigger tailored composition on its own.
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Allianz X",
    recommended_action: "Notify opportunity owner",
  });
  assert.equal(draft.fallback, true);
});

// ───────────────────────── No invented values ────────────────────────────────────────

test("composeLinkedinDraft: never renders undefined/null/placeholder tokens", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "",
  });
  assert.doesNotMatch(draft.text, /undefined/);
  assert.doesNotMatch(draft.text, /null/);
  assert.doesNotMatch(draft.text, /\{\{/);
  assert.doesNotMatch(draft.text, /N\/A/);
});

test("composeEmailDraft: never renders undefined/null/placeholder tokens", () => {
  const draft = composeEmailDraft({ provenance: "synthetic_demo_fixture", identity_resolution: "identified_contact" });
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "DRUID AI",
    recommended_solution: "Order Management Automation",
    recommended_action: "Suppressed - no action",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.text, /Suppressed - no action/i);
});

test("composeEmailDraft: never quotes recommended_action verbatim in the drafted text", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
    why_now: "You visited our pricing page yesterday",
    visitor_claim_allowed: "false",
  };
  const draft = composeLinkedinDraft(row);
  assert.doesNotMatch(draft.signalContext, /\byou visited\b/i);
});

test("composeEmailDraft: signalContext is empty (not fabricated) when why_now is blank", () => {
  const draft = composeEmailDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.signalContext, "");
});

// ───────────────────────── Field-source integrity ────────────────────────────────────

test("composeLinkedinDraft: prefers contact_name/company_name over best_contact_name/company_domain fallbacks", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    best_contact_name: "Alex Torrez",
    company_domain: "claimsfirst.com",
    recommended_solution: "Claims Automation",
  });
  assert.match(draft.text, /Alex Torrez/);
  assert.match(draft.text, /claimsfirst\.com/);
});

// ───────────────────────── account_queue: derived-topic fallback tier ───────────────
// Most account_queue rows have NO recommended_solution field at all (confirmed against
// MOCK_ACCOUNT_QUEUE) — without a further signal source, every such row would hit the
// generic fallback. Globex is a deliberate, corrected exception (product decision,
// 2026-07-24): it now carries a configured synthetic recommended_solution so its MQL
// recommendation is never demonstrated as resting on a bare /pricing-page visit alone.
// These tests use the current UI-visible synthetic MOCK_ACCOUNT_QUEUE fixtures (not ad-hoc
// rows constructed inline), so they fail if that fixture data ever changes underneath this
// logic.

test("composeLinkedinDraft: Globex (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) is tailored from its configured recommended_solution — MQL is no longer demonstrated via a bare /pricing signal", () => {
  const row = accountRow("Globex");
  assert.equal(row.recommended_output, "MQL");
  assert.equal(row.recommended_solution, "Customer Self-Service Automation");
  assert.doesNotMatch(row.why_now, /\/pricing/);
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Customer Self-Service Automation/);
  assert.doesNotMatch(draft.text, /\bPricing\b/i);
});

test("composeLinkedinDraft: a commercial-page topic (e.g. /pricing) with visitor_claim_allowed=true still gets a restrained, relevant timing signal instead of the bare generic opener", () => {
  // Synthetic identified-contact fixture (not a MOCK_ACCOUNT_QUEUE row) — keeps this
  // composer-logic assertion independent of whichever fixtures happen to reference /pricing.
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Fixture Co",
    why_now: "Fixture Co engaged with /pricing (2 sources); no CRM record.",
    visitor_claim_allowed: "true",
  };
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.match(draft.text, /evaluating automation options/i);
  assert.ok(draft.usedFields.includes("why_now"));
  // Still the conservative generic value angle underneath — no fabricated specific claim.
  assert.match(draft.text, /DRUID's conversational AI agents help teams automate/);
});

test("composeLinkedinDraft: a commercial-page topic (e.g. /pricing) gets NO timing signal at all when visitor_claim_allowed is false", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    why_now: "Acme engaged with /pricing (2 sources); no CRM record.",
    visitor_claim_allowed: "false",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /evaluating automation options/i);
  assert.doesNotMatch(draft.text, /\bPricing\b/);
});

test("composeLinkedinDraft: Acme Insurance (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) is blocked — reconstructed_contact is not a sufficiently identified contact", () => {
  // Regression coverage for the identified-contact requirement (product decision,
  // 2026-07-24): Acme Insurance's configured fixture is reconstructed_contact, which must
  // fail closed exactly like company_level/anonymous/missing — no draft may be prepared.
  const row = accountRow("Acme Insurance");
  assert.equal(row.identity_resolution, "reconstructed_contact");
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.blocked, true);
  assert.equal(draft.text, "");
});

test("composeLinkedinDraft: the same /insurance-claims-automation signal DOES tailor the value angle once the contact is identified", () => {
  // Synthetic identified-contact row carrying the same why_now/path as the configured
  // Acme Insurance MOCK_ACCOUNT_QUEUE fixture, keeping coverage of the path-derivation and
  // CRM-prose-stripping logic independent of that fixture's (correctly blocking)
  // reconstructed_contact status.
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme Insurance",
    visitor_claim_allowed: "false",
    why_now: "Acme Insurance appears to be exploring /insurance-claims-automation (4 sources); no CRM record.",
  };
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Insurance Claims Automation/);
  assert.doesNotMatch(draft.text, /Since your team has been looking into/i);
  assert.doesNotMatch(draft.text, /\byou visited\b/i);
  assert.doesNotMatch(draft.text, /CRM record/i);
  assert.doesNotMatch(draft.text, /\(4 sources\)/);
});

test("composeLinkedinDraft: Some Company Ltd (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) is blocked — company_level identity is not sufficient, independent of the generic '/solutions' path also falling back", () => {
  const row = accountRow("Some Company Ltd");
  assert.equal(row.identity_resolution, "company_level");
  assert.match(row.why_now, /\/solutions/);
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.blocked, true);
  assert.equal(draft.text, "");
});

test("composeLinkedinDraft: BigBank (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) correctly falls back — why_now has no URL path, only internal ownership routing text", () => {
  const row = accountRow("BigBank");
  assert.equal(row.identity_resolution, "known_crm_contact");
  assert.match(row.why_now, /owned by Andrei/);
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /Andrei/);
});

test("composeLinkedinDraft: Allianz X (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) correctly falls back — why_now describes internal CRM state (open opportunity), not a topic", () => {
  const row = accountRow("Allianz X");
  assert.equal(row.identity_resolution, "known_crm_contact");
  const draft = composeLinkedinDraft(row);
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /opportunity/i);
});

test("composeEmailDraft: Acme Insurance (current UI-visible synthetic MOCK_ACCOUNT_QUEUE row) is blocked — reconstructed_contact is not a sufficiently identified contact", () => {
  const row = accountRow("Acme Insurance");
  const draft = composeEmailDraft(row);
  assert.equal(draft.blocked, true);
  assert.equal(draft.subject, "");
  assert.equal(draft.body, "");
});

test("composeEmailDraft: the same derived-topic signal DOES get a tailored subject once the contact is identified", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme Insurance",
    why_now: "Acme Insurance appears to be exploring /insurance-claims-automation (4 sources); no CRM record.",
  };
  const draft = composeEmailDraft(row);
  assert.equal(draft.fallback, false);
  assert.match(draft.subject, /Insurance Claims Automation/);
});

test("composeLinkedinDraft: an incidental slash inside ordinary prose (not a URL) is never misread as a path", () => {
  // Regression case: "Internal/test activity" previously produced a nonsensical
  // "DRUID could help with Test" draft — the slash here is NOT a URL, just two words
  // separated by a slash with no preceding whitespace.
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "DRUID AI",
    why_now: "Internal/test activity",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /\bTest\b/);
});

test("composeLinkedinDraft: an incidental slash like 'CRM/contact' is never misread as a path either", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Globex",
    why_now: "Known CRM/contact activity (HubSpot): pricing page revisit",
  });
  assert.equal(draft.fallback, true);
  assert.doesNotMatch(draft.text, /\bContact\b/);
});

test("composeLinkedinDraft: a genuine multi-segment path derives its LAST segment as the topic", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    why_now: "US person-level visitor match (RB2B) on /solutions/claims; active search intent",
  });
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Claims/);
});

test("composeLinkedinDraft: recommended_solution always wins over a derived topic when both are present", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
      provenance: "synthetic_demo_fixture",
      identity_resolution: "identified_contact",
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
      provenance: "synthetic_demo_fixture",
      identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme Insurance",
    country: "emea",
    recommended_solution: "Claims Automation",
  });
  assert.doesNotMatch(draft.body, /\bemea\b/i);
  assert.doesNotMatch(draft.subject, /\bemea\b/i);
});

test("composeLinkedinDraft: the current UI-visible synthetic Globex MOCK_ACCOUNT_QUEUE row (region: 'us') never leaks the raw region token", () => {
  const globex = composeLinkedinDraft(accountRow("Globex"));
  assert.doesNotMatch(globex.text, /\bin us\b/i);
});

test("composeLinkedinDraft: an identified-contact fixture with region 'emea' never leaks the raw region token either", () => {
  // Acme Insurance's configured MOCK_ACCOUNT_QUEUE fixture is reconstructed_contact and
  // therefore correctly blocked (see the dedicated test above) — this uses a synthetic
  // identified row with the same region to keep region-redaction coverage independent of
  // that.
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme Insurance",
    region: "emea",
    recommended_solution: "Claims Automation",
  };
  const acme = composeLinkedinDraft(row);
  assert.doesNotMatch(acme.text, /\bin emea\b/i);
  assert.doesNotMatch(acme.text, /\bemea\b/i);
});

test("composeLinkedinDraft: never emits the old unsupported 'we work with other teams' claim", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
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
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "EuroCare Health",
    industry: "Healthcare",
    country: "NL",
    recommended_solution: "Patient Scheduling Automation",
  };
  const draft = composeEmailDraft(row);
  assert.doesNotMatch(draft.body, /we work with/i);
});

// ───────────────────────── internal CRM/routing language stays excluded ─────────────
// (Confirmed above for specific current fixtures too — Acme Insurance/BigBank/Allianz X.)

test("composeLinkedinDraft: internal CRM/routing phrases never leak even when they sit right next to a real use-case path", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    why_now: "Acme appears to be exploring /insurance-claims-automation (4 sources); owned by Andrei; no CRM record; open opportunity exists.",
  });
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Insurance Claims Automation/);
  assert.doesNotMatch(draft.text, /Andrei/);
  assert.doesNotMatch(draft.text, /CRM record/i);
  assert.doesNotMatch(draft.text, /open opportunity/i);
});

// ───────────────────────── identified-contact requirement (product decision, 2026-07-24) ─
// Prospect-facing drafts require known_crm_contact/identified_contact. Every other value —
// reconstructed_contact, company_level, anonymous, or a missing/unrecognized value — must
// fail closed: no greeting, subject, body, or signal context of any kind. See also the
// dedicated Acme Insurance (reconstructed_contact) and Some Company Ltd (company_level)
// fixture tests above.

test("composeLinkedinDraft: company_level identity is blocked", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "company_level",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.blocked, true);
  assert.equal(draft.text, "");
  assert.equal(draft.signalContext, "");
});

test("composeEmailDraft: company_level identity is blocked", () => {
  const draft = composeEmailDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "company_level",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.blocked, true);
  assert.equal(draft.subject, "");
  assert.equal(draft.body, "");
});

test("composeLinkedinDraft: anonymous identity is blocked", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "anonymous",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.blocked, true);
  assert.equal(draft.text, "");
});

test("composeLinkedinDraft: a missing/unrecognized identity_resolution value fails closed (not silently treated as identified)", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.blocked, true);
});

test("composeLinkedinDraft: signal-queue shaped rows (resolution_level='company') are blocked the same way", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    resolution_level: "company",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.blocked, true);
});

test("composeLinkedinDraft: signal-queue shaped rows (resolution_level='person') ARE sufficiently identified", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    resolution_level: "person",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(Boolean(draft.blocked), false);
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Claims Automation/);
});

test("composeLinkedinDraft: known_crm_contact is sufficiently identified", () => {
  const draft = composeLinkedinDraft({
    provenance: "synthetic_demo_fixture",
    identity_resolution: "known_crm_contact",
    company_name: "Acme",
    recommended_solution: "Claims Automation",
  });
  assert.equal(draft.fallback, false);
  assert.match(draft.text, /Claims Automation/);
});

test("composeLinkedinDraft: a row with no identity field at all is blocked, not the generic fallback", () => {
  const draft = composeLinkedinDraft({ provenance: "synthetic_demo_fixture" });
  assert.equal(draft.blocked, true);
  assert.equal(draft.text, "");
});

test("composeEmailDraft: a row with no identity field at all is blocked, not the generic fallback", () => {
  const draft = composeEmailDraft({ provenance: "synthetic_demo_fixture" });
  assert.equal(draft.blocked, true);
  assert.equal(draft.subject, "");
  assert.equal(draft.body, "");
});

// ───────────────────────── PR 3: deterministic angles ────────────────────────────────
// Three angles (use_case, business_value, general) — genuinely different, equally
// deterministic renderings of the same safe signal set. No randomness, no LLM, never
// described as AI-generated. See module header in messageComposer.js.

const GROUNDED_ROW = {
  provenance: "synthetic_demo_fixture",
  identity_resolution: "identified_contact",
  contact_name: "Jordan Rivera",
  contact_title: "VP Operations",
  company_name: "Acme Insurance",
  recommended_solution: "Customer Self-Service & Claims Automation",
};

const UNGROUNDED_ROW = {
  provenance: "synthetic_demo_fixture",
  identity_resolution: "identified_contact",
  company_name: "BigBank",
  why_now: "BigBank — owned by Andrei, no open opp.",
};

const NOT_IDENTIFIED_ROW = {
  provenance: "synthetic_demo_fixture",
  identity_resolution: "reconstructed_contact",
  company_name: "Acme Insurance",
  recommended_solution: "Customer Self-Service & Claims Automation",
};

test("angle metadata: ANGLES/ANGLE_LABELS/ANGLE_ORDER are stable and consistent with each other", () => {
  assert.deepEqual(ANGLES, { USE_CASE: "use_case", BUSINESS_VALUE: "business_value", GENERAL: "general" });
  assert.deepEqual(ANGLE_LABELS, {
    use_case: "Use-case led",
    business_value: "Business-value led",
    general: "General outreach",
  });
  assert.deepEqual(ANGLE_ORDER, [ANGLES.USE_CASE, ANGLES.BUSINESS_VALUE, ANGLES.GENERAL]);
  for (const angle of ANGLE_ORDER) {
    assert.ok(ANGLE_LABELS[angle], `ANGLE_LABELS must have an entry for ${angle}`);
  }
});

test("defaultAngleForRow: use_case when a safe recommended_solution/use-case signal exists", () => {
  assert.equal(defaultAngleForRow(GROUNDED_ROW), ANGLES.USE_CASE);
});

test("defaultAngleForRow: general when no safe grounding signal exists", () => {
  assert.equal(defaultAngleForRow(UNGROUNDED_ROW), ANGLES.GENERAL);
});

test("defaultAngleForRow: general for a row without a sufficiently identified contact (never crashes, never fabricates)", () => {
  assert.equal(defaultAngleForRow(NOT_IDENTIFIED_ROW), ANGLES.GENERAL);
});

test("composeLinkedinDraft: each angle produces materially different text for a grounded row", () => {
  const useCase = composeLinkedinDraft(GROUNDED_ROW, ANGLES.USE_CASE);
  const businessValue = composeLinkedinDraft(GROUNDED_ROW, ANGLES.BUSINESS_VALUE);
  const general = composeLinkedinDraft(GROUNDED_ROW, ANGLES.GENERAL);

  assert.notEqual(useCase.text, businessValue.text);
  assert.notEqual(useCase.text, general.text);
  assert.notEqual(businessValue.text, general.text);

  assert.equal(useCase.angle, ANGLES.USE_CASE);
  assert.equal(businessValue.angle, ANGLES.BUSINESS_VALUE);
  assert.equal(general.angle, ANGLES.GENERAL);

  assert.match(useCase.text, /Customer Self-Service & Claims Automation/);
  assert.match(businessValue.text, /Customer Self-Service & Claims Automation/);
  // General deliberately never names the specific offer.
  assert.doesNotMatch(general.text, /Customer Self-Service & Claims Automation/);
});

test("composeEmailDraft: each angle produces materially different subject and body for a grounded row", () => {
  const useCase = composeEmailDraft(GROUNDED_ROW, ANGLES.USE_CASE);
  const businessValue = composeEmailDraft(GROUNDED_ROW, ANGLES.BUSINESS_VALUE);
  const general = composeEmailDraft(GROUNDED_ROW, ANGLES.GENERAL);

  assert.notEqual(useCase.subject, businessValue.subject);
  assert.notEqual(useCase.subject, general.subject);
  assert.notEqual(businessValue.subject, general.subject);
  assert.notEqual(useCase.body, businessValue.body);
  assert.notEqual(useCase.body, general.body);
  assert.notEqual(businessValue.body, general.body);
});

test("composeLinkedinDraft/composeEmailDraft: same row + same angle is byte-identical across repeated calls (no randomness)", () => {
  for (const angle of ANGLE_ORDER) {
    const li1 = composeLinkedinDraft(GROUNDED_ROW, angle);
    const li2 = composeLinkedinDraft(GROUNDED_ROW, angle);
    assert.equal(li1.text, li2.text);
    assert.deepEqual(li1.usedFields, li2.usedFields);

    const em1 = composeEmailDraft(GROUNDED_ROW, angle);
    const em2 = composeEmailDraft(GROUNDED_ROW, angle);
    assert.equal(em1.subject, em2.subject);
    assert.equal(em1.body, em2.body);
    assert.deepEqual(em1.usedFields, em2.usedFields);
  }
});

test("composeLinkedinDraft/composeEmailDraft: without a grounding signal, every angle converges on the identical honest generic rendering", () => {
  for (const angle of ANGLE_ORDER) {
    const li = composeLinkedinDraft(UNGROUNDED_ROW, angle);
    assert.equal(li.angle, ANGLES.GENERAL, `angle=${angle} must render as general when there's no safe signal to differentiate on`);
    assert.equal(li.fallback, true);

    const em = composeEmailDraft(UNGROUNDED_ROW, angle);
    assert.equal(em.angle, ANGLES.GENERAL);
    assert.equal(em.fallback, true);
  }
});

test("composeLinkedinDraft: an unknown/invalid angle string fails closed to general", () => {
  const draft = composeLinkedinDraft(GROUNDED_ROW, "not_a_real_angle");
  assert.equal(draft.angle, ANGLES.GENERAL);
});

test("composeLinkedinDraft/composeEmailDraft: identity gating blocks every angle, not just the default", () => {
  for (const angle of ANGLE_ORDER) {
    const li = composeLinkedinDraft(NOT_IDENTIFIED_ROW, angle);
    assert.equal(li.blocked, true);
    assert.equal(li.text, "");

    const em = composeEmailDraft(NOT_IDENTIFIED_ROW, angle);
    assert.equal(em.blocked, true);
    assert.equal(em.subject, "");
    assert.equal(em.body, "");
  }
});

test("composeLinkedinDraft: business_value angle never fabricates pain, urgency, metrics, ROI, or a company-specific problem", () => {
  const draft = composeLinkedinDraft(GROUNDED_ROW, ANGLES.BUSINESS_VALUE);
  assert.doesNotMatch(draft.text, /\d+%/);
  assert.doesNotMatch(draft.text, /\$\d/);
  assert.doesNotMatch(draft.text, /\bhours?\b/i);
  assert.doesNotMatch(draft.text, /\bROI\b/i);
  assert.doesNotMatch(draft.text, /\burgent(ly)?\b/i);
  assert.doesNotMatch(draft.text, /\bstruggl(e|ing|es)\b/i);
  assert.doesNotMatch(draft.text, /\bproblem\b/i);
  assert.doesNotMatch(draft.text, /\bpain\b/i);
  // Must not reference other customers/teams (the previously-removed unsupported claim).
  assert.doesNotMatch(draft.text, /other (customers|teams)/i);
  assert.doesNotMatch(draft.text, /we work with/i);
});

test("composeEmailDraft: business_value angle subject/body never imply the prospect currently has a problem or quantify a benefit", () => {
  const draft = composeEmailDraft(GROUNDED_ROW, ANGLES.BUSINESS_VALUE);
  const full = `${draft.subject}\n${draft.body}`;
  assert.doesNotMatch(full, /\d+%/);
  assert.doesNotMatch(full, /\$\d/);
  assert.doesNotMatch(full, /\byou (currently|are) (struggling|facing)\b/i);
  assert.doesNotMatch(full, /other (customers|teams)/i);
});

test("no angle leaks internal CRM/routing/score/gate/opportunity/owner/MQL language or raw region tokens", () => {
  const row = {
    provenance: "synthetic_demo_fixture",
    identity_resolution: "identified_contact",
    company_name: "Acme",
    region: "us",
    industry: "Insurance",
    recommended_solution: "Claims Automation",
    recommended_action: "Approve LinkedIn outreach (Dripify)",
    why_now: "US person-level visitor match; owned by Andrei; open opportunity exists; MQL gate passed.",
  };
  for (const angle of ANGLE_ORDER) {
    for (const draft of [composeLinkedinDraft(row, angle), composeEmailDraft(row, angle)]) {
      const full = `${draft.text ?? ""}${draft.subject ?? ""}${draft.body ?? ""}`;
      assert.doesNotMatch(full, /\bAndrei\b/);
      assert.doesNotMatch(full, /open opportunity/i);
      assert.doesNotMatch(full, /\bMQL\b/);
      assert.doesNotMatch(full, /\bgate\b/i);
      assert.doesNotMatch(full, /\bDripify\b/);
      assert.doesNotMatch(full, /\bin us\b/i);
      assert.doesNotMatch(full, /\bInsurance\b/);
    }
  }
});

test("usedFields (evidence) for the general angle excludes recommended_solution/why_now even when the row has them", () => {
  const draft = composeLinkedinDraft(GROUNDED_ROW, ANGLES.GENERAL);
  assert.equal(draft.usedFields.includes("recommended_solution"), false);
  assert.equal(draft.usedFields.includes("why_now"), false);
  assert.ok(draft.usedFields.includes("company_name"));
});

test("usedFields (evidence) for use_case/business_value angles includes recommended_solution when it grounded the claim", () => {
  const useCase = composeLinkedinDraft(GROUNDED_ROW, ANGLES.USE_CASE);
  const businessValue = composeLinkedinDraft(GROUNDED_ROW, ANGLES.BUSINESS_VALUE);
  assert.ok(useCase.usedFields.includes("recommended_solution"));
  assert.ok(businessValue.usedFields.includes("recommended_solution"));
});

test("usedFields (evidence) never includes fields the row doesn't actually have populated", () => {
  const row = { provenance: "synthetic_demo_fixture", identity_resolution: "identified_contact", company_name: "Acme" };
  for (const angle of ANGLE_ORDER) {
    const draft = composeLinkedinDraft(row, angle);
    assert.equal(draft.usedFields.includes("contact_name"), false);
    assert.equal(draft.usedFields.includes("contact_title"), false);
    assert.equal(draft.usedFields.includes("recommended_solution"), false);
  }
});
