// LS8 — pure, DOM-free presentation logic for
// ../components/account-people-panel.tsx. This package has no
// jsdom/testing-library (see ./account-truth-presentation.ts's own module
// comment for the same discipline), so every decision that isn't "how
// does this look on screen" lives here instead, unit-tested without a
// DOM.

import type { AccountPerson } from "@/lib/account-people-api";

/**
 * The primary display label for a person — company_people's own
 * people_has_identity_attribute CHECK guarantees at least one of
 * fullName/workEmail/linkedinUrl/externalId is set, so this fallback
 * chain always finds something real to show, never a fabricated
 * placeholder. Mirrors the same "primary/secondary identity fallback"
 * convention ../pages/accounts.tsx's own accountIdentity() already uses
 * for accounts.
 */
export function personDisplayName(person: AccountPerson): string {
  if (person.fullName) return person.fullName;
  if (person.workEmail) return person.workEmail;
  if (person.linkedinUrl) return person.linkedinUrl;
  return "Unknown contact";
}

/** True only when personDisplayName had to fall back past the person's own name — lets the panel style a missing-name fallback distinctly (e.g. muted) without re-deriving the same fallback logic. */
export function personDisplayNameIsFallback(person: AccountPerson): boolean {
  return person.fullName === null;
}
