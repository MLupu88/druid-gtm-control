import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Guards service-to-service routes (currently: signal ingestion) behind a
// dedicated shared-secret header, distinct from requireAuth's browser
// session cookie — a server-to-server caller has no session to present.
//
// Fails closed when GTM_SIGNAL_INGESTION_SECRET is unset: returns 503
// rather than 401, so an operator can tell "not configured yet" apart from
// "wrong secret" without needing to read a log — and, critically, the
// missing env var is read lazily per-request here, never at module load,
// so an unconfigured deployment still starts the rest of the API server
// normally (mirrors how every other route in this package tolerates an
// absent optional env var, unlike ../lib/operators.ts's OPERATORS, which
// intentionally throws at import time because that one has no safe
// default).
// ---------------------------------------------------------------------------

const INGESTION_SECRET_HEADER = "x-gtm-ingestion-secret";

// node:crypto's timingSafeEqual throws (rather than returning false) on a
// buffer-length mismatch, so length must be checked first. That check
// itself is not constant-time with respect to length, but secret *length*
// is not the property this guards — only secret *content* comparison needs
// to be constant-time, and content is never compared once lengths differ.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function requireServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configuredSecret = process.env.GTM_SIGNAL_INGESTION_SECRET;
  if (!configuredSecret) {
    res.status(503).json({
      error: "Signal ingestion is unavailable.",
      code: "signal_ingestion_unavailable",
    });
    return;
  }

  const provided = req.header(INGESTION_SECRET_HEADER);
  if (typeof provided !== "string" || !safeEqual(provided, configuredSecret)) {
    res.status(401).json({ error: "Unauthorized.", code: "unauthorized" });
    return;
  }

  next();
}
