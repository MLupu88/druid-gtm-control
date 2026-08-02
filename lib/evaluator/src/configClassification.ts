// Small, pure classification helpers over an already-validated
// IcpProfileConfigV1 — shared by the API server (evaluation-summary
// mapping) and the frontend (evaluation-result truthfulness display,
// profile-list classification, draft-editor readiness hints) so every
// caller answers "is buying intent actually configured on this profile?"
// the exact same way. Never touches scoring, tiering, or eligibility —
// this only reads what's configured, it doesn't evaluate anything.

import type { IcpProfileConfigV1 } from "./profileConfig.js";

/** True when the profile config has at least one configured intent rule. False means every account's intentTier necessarily resolves to the profile's fallback band — not a real evaluated buying-intent signal. */
export function isIntentConfigured(config: IcpProfileConfigV1): boolean {
  return config.intent.rules.length > 0;
}
