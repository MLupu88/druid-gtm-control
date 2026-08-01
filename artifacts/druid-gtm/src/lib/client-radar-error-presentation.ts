// Pure presentation helper for a Client Radar research run's terminal
// state (see ../lib/client-radar-research-api.ts's ClientRadarResearchRun).
// Split out from ../components/client-radar-research-panel.tsx so it's
// unit-testable without a DOM, same as ./icp-preview-presentation.ts.
//
// The distinction this module exists for: "Client Radar isn't configured
// in this environment" is not the same fact as "we called Client Radar
// and the request genuinely failed" — showing a red "Failed" badge, a
// failure timestamp, and a "Retry research" button for a deployment that
// was never going to succeed is actively misleading. That distinction is
// now computed server-side (see artifacts/api-server/src/lib/
// clientRadarClient.ts's classifyClientRadarFailureReason) into the
// typed `failureReason` field on ClientRadarResearchRun — this module
// switches on that field directly, never by pattern-matching lastError's
// raw text itself.

import type { ClientRadarFailureReason } from "./client-radar-research-api";

export interface ClientRadarFailureMessage {
  primary: string;
  /** The original, unscrubbed lastError, kept for a collapsed technical-details view — never discarded, even when not_configured. */
  technical: string | null;
}

export const CLIENT_RADAR_NOT_CONFIGURED_MESSAGE =
  "Client Radar research is unavailable in this environment.";

export function describeClientRadarFailure(
  lastError: string | null,
  status: "failed" | "cancelled",
  failureReason: ClientRadarFailureReason | null,
): ClientRadarFailureMessage {
  if (failureReason === "not_configured") {
    return { primary: CLIENT_RADAR_NOT_CONFIGURED_MESSAGE, technical: lastError };
  }

  if (lastError === null || lastError.trim() === "") {
    return {
      primary:
        status === "failed"
          ? "Client Radar could not complete this research run, and no error message was recorded."
          : "This research run was cancelled.",
      technical: null,
    };
  }

  return { primary: lastError, technical: null };
}
