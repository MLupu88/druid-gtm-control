// Pure presentation helper for a failed/cancelled Client Radar research
// run's `lastError` (see ../lib/client-radar-research-api.ts's
// ClientRadarResearchRun). Split out from
// ../components/client-radar-research-panel.tsx so it's unit-testable
// without a DOM, same as ./icp-preview-presentation.ts.
//
// `lastError` is server-persisted verbatim from whatever threw during
// the research run (see artifacts/api-server/src/services/
// clientRadarResearchRuns.ts's submitAndPersist/refresh catch blocks) —
// including, for a misconfigured environment, the literal message a
// plain `Error` carries out of clientRadarClient.ts's getConfig(), e.g.
// "CLIENT_RADAR_BASE_URL is not configured." That message is truthful
// but not something a GTM user can act on or should see verbatim — this
// swaps it for an equally truthful, actionable sentence while preserving
// the original for a collapsed technical-details view.

const CONFIG_ERROR_PATTERN = /^CLIENT_RADAR_[A-Z0-9_]+ IS NOT CONFIGURED\.?$/;

export interface ClientRadarFailureMessage {
  primary: string;
  /** The original, unscrubbed lastError — only when it was actually replaced. */
  technical: string | null;
}

export function describeClientRadarFailure(
  lastError: string | null,
  status: "failed" | "cancelled",
): ClientRadarFailureMessage {
  if (lastError === null || lastError.trim() === "") {
    return {
      primary:
        status === "failed"
          ? "Client Radar could not complete this research run, and no error message was recorded."
          : "This research run was cancelled.",
      technical: null,
    };
  }

  if (CONFIG_ERROR_PATTERN.test(lastError.trim().toUpperCase())) {
    return {
      primary: "Client Radar is not configured for this environment.",
      technical: lastError,
    };
  }

  return { primary: lastError, technical: null };
}
