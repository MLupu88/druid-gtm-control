import type { NextFunction, Request, Response } from "express";

// ---------------------------------------------------------------------------
// Guards routes behind the signed `druid_auth` cookie set by POST /api/auth/login.
// Mount after /api/auth so login/logout/me stay public.
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.signedCookies?.druid_auth === "1") {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required." });
}
