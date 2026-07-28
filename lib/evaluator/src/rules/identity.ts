// Identity resolution is canonical evaluator-version mechanics, NOT
// profile-authored scoring — this function takes no IcpProfileConfigV1
// input at all, by construction, so no profile config (hostile or
// otherwise) can ever influence identity resolution or raise
// enrichment-derived confidence. See conditions.ts/profileConfig.ts for
// what IS profile-configurable; identity deliberately isn't part of it.
//
// This directly implements the ROADMAP.md cross-cutting invariant:
// "Company intelligence must never manufacture a contact or make an
// unidentified account eligible for person-addressed outreach."

import type {
  IdentityConfidence,
  IdentityResolutionLevel,
  MatchedRule,
  NormalizedAccountInputV1,
} from "../types.js";

export interface IdentityResult {
  resolutionLevel: IdentityResolutionLevel;
  confidence: IdentityConfidence;
  matchedRules: MatchedRule[];
}

// A stable person identifier is either a verified CRM contact linkage
// (crm.hubspotContactId) or a genuinely reachable channel (email, phone,
// LinkedIn profile URL) on the contact record itself. Name/title alone
// never counts, regardless of which of these is present.
function hasStablePersonIdentifier(
  contact: NormalizedAccountInputV1["contact"],
  crm: NormalizedAccountInputV1["crm"],
): boolean {
  if (crm.hubspotContactId !== null) return true;
  if (!contact) return false;
  return (
    contact.email !== null ||
    contact.phone !== null ||
    contact.linkedinUrl !== null
  );
}

// Company-level evidence is a domain/name on the company record OR a
// linked HubSpot company ID — any one of the three is sufficient on its
// own.
function hasCompanyEvidence(
  company: NormalizedAccountInputV1["company"],
  crm: NormalizedAccountInputV1["crm"],
): boolean {
  return (
    company.domain !== null ||
    company.name !== null ||
    crm.hubspotCompanyId !== null
  );
}

export function evaluateIdentity(
  input: NormalizedAccountInputV1,
): IdentityResult {
  const { contact, company, crm } = input;
  const stableId = hasStablePersonIdentifier(contact, crm);

  if (contact && stableId) {
    // Verified CRM contact: hubspot-known origin plus an actual linked
    // HubSpot contact ID. This alone is sufficient — email/phone/
    // LinkedIn are not additionally required, since the CRM linkage
    // itself is the stable identifier here.
    if (contact.origin === "hubspot_known" && crm.hubspotContactId !== null) {
      return {
        resolutionLevel: "known_crm_contact",
        confidence: "high",
        matchedRules: [
          {
            ruleId: "identity.known_crm_contact",
            dimension: "identity",
            description:
              'Verified CRM contact: origin "hubspot_known" with a linked HubSpot contact ID.',
          },
        ],
      };
    }

    if (
      contact.origin === "form_submit" ||
      contact.origin === "self_identified" ||
      contact.origin === "rb2b"
    ) {
      return {
        resolutionLevel: "contact",
        confidence: "high",
        matchedRules: [
          {
            ruleId: "identity.direct_person_evidence",
            dimension: "identity",
            description: `Direct person evidence via origin "${contact.origin}" with a stable person identifier.`,
          },
        ],
      };
    }

    if (contact.origin === "cognism_reconstructed") {
      return {
        resolutionLevel: "contact",
        confidence: "medium",
        // Capped at medium unconditionally — there is no branch of this
        // function, and no profile config input, that can raise this to
        // high. Reconstruction is never deanonymization.
        matchedRules: [
          {
            ruleId: "identity.reconstructed_contact",
            dimension: "identity",
            description:
              "Enrichment-derived (reconstructed) contact — never treated as directly identified, regardless of configuration.",
          },
        ],
      };
    }

    // Any other stable-identifier case: origin "unknown", or an
    // unverified "hubspot_known" without a matching hubspotContactId.
    // Weak/unverified provenance, but a real stable identifier exists.
    return {
      resolutionLevel: "contact",
      confidence: "low",
      matchedRules: [
        {
          ruleId: "identity.weak_provenance_contact",
          dimension: "identity",
          description: `Stable person identifier present but provenance ("${contact.origin}") is weak or unverified.`,
        },
      ],
    };
  }

  if (hasCompanyEvidence(company, crm)) {
    return {
      resolutionLevel: "company",
      confidence: "medium",
      matchedRules: [
        {
          ruleId: "identity.company_only",
          dimension: "identity",
          description:
            "Company-level evidence present with no valid contact evidence — never treated as a contact, regardless of any name/title present.",
        },
      ],
    };
  }

  return {
    resolutionLevel: "anonymous",
    confidence: "low",
    matchedRules: [
      {
        ruleId: "identity.anonymous",
        dimension: "identity",
        description: "No company or contact evidence present.",
      },
    ],
  };
}
