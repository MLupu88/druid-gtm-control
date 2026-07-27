// researchEligibility.js — Client Radar research eligibility is a SEPARATE decision from
// outbound-prospecting eligibility (NO_PROSPECT / buttonDisabledPhaseC in gtmContract.js).
// Suppression, existing-customer state, and open opportunities may block prospect-facing
// outreach, but must NEVER automatically block research — see product decision, 2026-07-24.
//
// This module establishes only the canonical, tested business rule. No Client Radar button
// or API is added in this PR — later PRs wire real UI/API to getResearchEligibility().

function _isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function _isTrue(v) {
  return String(v ?? "").trim().toLowerCase() === "true";
}

export const RESEARCH_PURPOSES = [
  "pipeline_assist",
  "owner_support",
  "existing_customer_intelligence",
  "account_expansion",
  "new_prospecting",
];

// Client Radar needs at least one usable identifier to look anything up.
function _hasUsableIdentifier(row) {
  return !_isBlank(row?.account_key) || !_isBlank(row?.company_domain) || !_isBlank(row?.company_name);
}

// Purposes are derived from actual row state and are NOT mutually exclusive — a row can
// match more than one condition (e.g. a suppressed existing customer with a known owner).
function _derivePurposes(row) {
  const purposes = new Set();
  if (_isTrue(row?.open_opportunity)) {
    purposes.add("pipeline_assist");
    purposes.add("owner_support");
  }
  if (_isTrue(row?.existing_customer) || row?.recommended_output === "Suppressed") {
    purposes.add("existing_customer_intelligence");
    purposes.add("account_expansion");
  }
  if (!_isBlank(row?.hubspot_owner)) {
    purposes.add("owner_support");
    purposes.add("account_expansion");
  }
  if (purposes.size === 0) purposes.add("new_prospecting");
  return Array.from(purposes);
}

/**
 * getResearchEligibility(row) -> { eligible, purposes, reason }
 *
 * Deliberately NOT a decorative function that always returns true: eligibility requires a
 * usable account identifier, and the only false path is "no_usable_account_identifier".
 * Eligibility is independent of NO_PROSPECT/suppression/open-opportunity/identity state —
 * those restrict prospect-facing outreach, never research.
 */
export function getResearchEligibility(row) {
  if (!_hasUsableIdentifier(row)) {
    return { eligible: false, purposes: [], reason: "no_usable_account_identifier" };
  }
  return { eligible: true, purposes: _derivePurposes(row), reason: "" };
}
