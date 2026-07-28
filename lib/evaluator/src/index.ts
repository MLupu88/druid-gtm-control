// Package 2, Phase 2 — canonical evaluator core (pure, no persistence).
// See docs/icp-rule-discovery.md for the Phase 0 discovery this is built
// on and ROADMAP.md Package 2 for the phase plan this belongs to.
//
// This package does NOT implement persistence (lib/db is a separate
// dependency, not imported here) and does NOT produce routing/decision
// output — see registry.ts's evaluateAccount() for the public entrypoint.

export * from "./types.js";
export * from "./conditions.js";
export * from "./profileConfig.js";
export * from "./registry.js";
export { evaluateCanonicalV1 } from "./evaluate.js";
