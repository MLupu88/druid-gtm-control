// GTM V2 Unit 1 — normalized signal contract.
//
// This is the shape every collector/adapter must normalize a raw event
// into before it can be persisted. It intentionally does NOT contain a
// "normalizedPayload" field — this object *is* the normalized payload;
// lib/db's `signals.normalized_payload` column stores this object's
// serialized form, sitting next to a separate `raw_payload` column that
// holds the untouched original source payload. Keeping those two
// concerns apart avoids a self-referential normalizedPayload-inside-
// normalizedPayload structure.
//
// `observedResolutionLevel` (not `resolutionLevel`) is deliberate: this
// describes what the source claimed/identified at ingestion time, on an
// immutable evidence row. It is never the current canonical account/
// person binding — that authority belongs exclusively to
// lib/db's `identity_resolution_events` table.
//
// Pure package: no persistence, no network calls, no dependency on
// lib/db or lib/evaluator (mirrors lib/evaluator's own persistence-free
// stance) — see lib/identity/src/normalize.ts for the pure helpers this
// contract is paired with.

import { z } from "zod/v4";

// Mirrors lib/db's enums.identityResolutionLevel — redeclared here
// (not imported) so this package stays free of any lib/db dependency,
// the same tradeoff lib/evaluator/src/types.ts documents for its own
// IdentityResolutionLevel.
export const SignalResolutionLevelV1 = z.enum([
  "anonymous",
  "company",
  "contact",
  "known_crm_contact",
]);
export type SignalResolutionLevelV1 = z.infer<typeof SignalResolutionLevelV1>;

const NonBlankString = z.string().trim().min(1).max(500);

// Record-key variant of NonBlankString, for externalIds keys (a source
// name, e.g. "hubspot"). Deliberately does NOT trim: a record's key
// schema output replaces the key itself, so a trimming schema here could
// silently collapse two differently-whitespaced keys into one entry,
// dropping data. This only rejects blank/whitespace-only keys.
const NonBlankKey = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "key must not be blank or whitespace-only",
  });

// A source-provided URL can legitimately exceed NonBlankString's 500-char
// cap once tracking query parameters are included (activity.utm/
// clickIds are separate structured fields, but nothing guarantees an
// adapter strips a raw URL down to just its path before setting
// pageUrl). Deliberately not a strict URL-shape validator — source
// systems may emit technically-nonstandard but real URLs.
const NonBlankUrlString = z.string().trim().min(1).max(4096);

// RFC 3339 / ISO 8601, timezone-aware: 'Z' or an explicit numeric offset
// is required, a naive/local timestamp is rejected. `offset: true`
// accepts both 'Z' and '+02:00'-style offsets while still rejecting an
// offset-less string — the signal ledger's ordering depends on this.
export const SignalOccurredAtV1 = z.string().datetime({ offset: true });

export const SignalCompanyV1Schema = z
  .object({
    domain: NonBlankString.nullable(),
    name: NonBlankString.nullable(),
    // Source-specific company identifiers, e.g. { hubspot: "12345" }.
    // Always present as an object (never null) — absence of any
    // external ID is "empty map", not "unknown shape".
    externalIds: z.record(NonBlankKey, NonBlankString),
  })
  .strict();
export type SignalCompanyV1 = z.infer<typeof SignalCompanyV1Schema>;

export const SignalPersonV1Schema = z
  .object({
    fullName: NonBlankString.nullable(),
    workEmail: NonBlankString.nullable(),
    title: NonBlankString.nullable(),
    linkedinUrl: NonBlankString.nullable(),
    externalIds: z.record(NonBlankKey, NonBlankString), // e.g. { hubspot: "67890" }
  })
  .strict();
export type SignalPersonV1 = z.infer<typeof SignalPersonV1Schema>;

export const SignalUtmV1Schema = z
  .object({
    source: NonBlankString.nullable(),
    medium: NonBlankString.nullable(),
    campaign: NonBlankString.nullable(),
    content: NonBlankString.nullable(),
    term: NonBlankString.nullable(),
  })
  .strict();
export type SignalUtmV1 = z.infer<typeof SignalUtmV1Schema>;

export const SignalClickIdsV1Schema = z
  .object({
    gclid: NonBlankString.nullable(),
    fbclid: NonBlankString.nullable(),
    liFatId: NonBlankString.nullable(),
    msclkid: NonBlankString.nullable(),
  })
  .strict();
export type SignalClickIdsV1 = z.infer<typeof SignalClickIdsV1Schema>;

// Activity/campaign/attribution evidence. Present as an object (not
// nullable as a whole, unlike `person` below) because most signals carry
// *some* subset of this — an organic page view has pageUrl but no
// campaign; a paid-click landing has utm/clickIds but no form — an
// all-or-nothing nullable object would be wrong here. `utm`/`clickIds`
// are nullable as a whole sub-objects since their fields are only ever
// meaningful together (an ad platform delivers the whole querystring or
// none of it).
export const SignalActivityV1Schema = z
  .object({
    pageUrl: NonBlankUrlString.nullable(),
    signalDetail: NonBlankString.nullable(), // free-text description of what happened
    formName: NonBlankString.nullable(),
    formStep: NonBlankString.nullable(), // label, e.g. "step-2-contact-info"; not assumed numeric
    campaignId: NonBlankString.nullable(),
    campaignName: NonBlankString.nullable(),
    utm: SignalUtmV1Schema.nullable(),
    clickIds: SignalClickIdsV1Schema.nullable(),
  })
  .strict();
export type SignalActivityV1 = z.infer<typeof SignalActivityV1Schema>;

export const NormalizedSignalV1Schema = z
  .object({
    schemaVersion: z.literal("v1"),
    source: NonBlankString,
    // Caller-supplied idempotency key from the origin system. Adapters
    // whose provider doesn't emit a stable event ID MUST synthesize one
    // deterministically (e.g. a hash of the provider's own natural key)
    // — never random per delivery attempt, or lib/db's
    // signals.UNIQUE(source, source_event_id) stops rejecting retries.
    sourceEventId: NonBlankString,
    occurredAt: SignalOccurredAtV1,
    signalType: NonBlankString,
    observedResolutionLevel: SignalResolutionLevelV1,
    company: SignalCompanyV1Schema,
    person: SignalPersonV1Schema.nullable(), // nullable as a whole: "no contact evidence" is a real, common state
    activity: SignalActivityV1Schema,
    // Escape hatch for source-specific fields that are legitimately
    // normalized/typed but don't have a first-class structured field
    // yet. This is NOT the raw payload (see lib/db's
    // signals.raw_payload) — it holds already-cleaned values an adapter
    // chose not to promote to a named field, not the untouched original
    // object.
    sourceMetadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const contactLevel =
      val.observedResolutionLevel === "contact" ||
      val.observedResolutionLevel === "known_crm_contact";

    // "Company-level intelligence never manufactures a person."
    if (val.person !== null && !contactLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["observedResolutionLevel"],
        message:
          "person requires observedResolutionLevel 'contact' or 'known_crm_contact'",
      });
    }
    if (val.person === null && contactLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["person"],
        message:
          "observedResolutionLevel 'contact'/'known_crm_contact' requires a non-null person",
      });
    }

    // A non-null person must carry at least one real identity attribute
    // — an all-null person object is a ghost contact even though
    // lib/db's people table would also reject it downstream; this
    // catches it at the contract boundary, before anything is
    // persisted.
    if (val.person !== null) {
      const hasPersonIdentity =
        val.person.fullName !== null ||
        val.person.workEmail !== null ||
        val.person.linkedinUrl !== null ||
        Object.keys(val.person.externalIds).length > 0;
      if (!hasPersonIdentity) {
        ctx.addIssue({
          code: "custom",
          path: ["person"],
          message:
            "person must include at least one of fullName, workEmail, linkedinUrl, or an externalIds entry",
        });
      }
    }

    // Company-or-contact-level resolution must carry at least one real
    // company identity attribute — an "anonymous" signal may still have
    // an entirely empty company object (that's the expected shape for
    // "nothing identified yet"), but claiming a company/contact-level
    // resolution while saying nothing about the company is
    // contradictory.
    if (val.observedResolutionLevel !== "anonymous") {
      const hasCompanyIdentity =
        val.company.domain !== null ||
        val.company.name !== null ||
        Object.keys(val.company.externalIds).length > 0;
      if (!hasCompanyIdentity) {
        ctx.addIssue({
          code: "custom",
          path: ["company"],
          message:
            "observedResolutionLevel other than 'anonymous' requires at least one company identity attribute",
        });
      }
    }
  });
export type NormalizedSignalV1 = z.infer<typeof NormalizedSignalV1Schema>;
