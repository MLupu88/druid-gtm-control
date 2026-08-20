// Package 2, Phase 1 — ICP profile and evaluation persistence foundation.
// See docs/icp-rule-discovery.md for the Phase 0 discovery this schema is
// built on, and ROADMAP.md Package 2 for the phase plan this belongs to.

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
