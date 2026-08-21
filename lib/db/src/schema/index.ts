// Package 2, Phase 1 — ICP profile and evaluation persistence foundation.
// See docs/icp-rule-discovery.md for the Phase 0 discovery this schema is
// built on, and ROADMAP.md Package 2 for the phase plan this belongs to.

// M3.5 real-data defect fix — must load before any query result is
// decoded; see ../pgJsonTypeParsers.ts for why this schema barrel (the
// one module every DB-touching file, production and test, already
// imports) is pg.types' correct home.
import "../pgJsonTypeParsers";

export * from "./enums";
export * from "./icpProfiles";
export * from "./icpProfileVersions";
export * from "./icpProfileActivationEvents";
export * from "./evaluatorVersions";
export * from "./decisionPolicyVersions";
export * from "./accounts";
export * from "./accountSnapshots";
export * from "./accountEvaluations";
export * from "./accountDecisions";
export * from "./clientRadarResearchRuns";
export * from "./accountFacts";
export * from "./accountFactCurrent";

// GTM V2 Unit 1 — Operational Identity and Signal Contracts.
export * from "./accountAliases";
export * from "./people";
export * from "./accountPeople";
export * from "./signals";
export * from "./identityResolutionEvents";

// GTM V2 Stage 3, Unit 1 — Attention Model foundation.
export * from "./attentionItems";

// Milestone 3D — provider-neutral candidate observation persistence.
export * from "./observations";

// Milestone 3F — provider-neutral fact reconciliation.
export * from "./resolvedFacts";
