// GTM V2 Unit 1 — Operational Identity and Signal Contracts.
//
// Pure package: the normalized signal contract plus the deterministic
// helpers identity matching is built from. No persistence (lib/db is a
// separate dependency, not imported here) and no runtime resolution
// logic — see ROADMAP.md for the unit this package is scoped to.

export * from "./types.js";
export * from "./normalize.js";
