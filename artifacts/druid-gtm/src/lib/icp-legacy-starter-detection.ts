// Re-exports the legacy "Starter ICP" bootstrap-config detector from
// @workspace/evaluator, which is now the single implementation shared
// with the API server's profile-library classification (see
// artifacts/api-server/src/services/icpProfiles.ts's buildProfileListItem
// and @workspace/evaluator's profileClassification.ts). The detection
// algorithm itself is unchanged — see lib/evaluator/src/
// legacyStarterDetection.ts for the full module comment and
// lib/evaluator/src/legacyStarterDetection.test.ts for its tests.
//
// Kept as a thin local module (rather than switching every call site to
// import directly from @workspace/evaluator) so
// ../components/account-icp-preview-panel.tsx,
// ../components/evaluation-runs-list.tsx, and ../pages/icp-profile-detail.tsx
// need no import changes, and so this file's own existing test
// (./icp-legacy-starter-detection.test.ts) keeps exercising the exact
// same public entrypoint.

export { isLegacyStarterIcpConfig } from "@workspace/evaluator";
