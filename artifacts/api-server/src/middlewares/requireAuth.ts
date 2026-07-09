import type { NextFunction, Request, Response } from "express";
import { DEFAULT_OPERATOR, operatorsConfigured, findOperatorByCookieKey } from "../lib/operators";

// ---------------------------------------------------------------------------
// Guards routes behind the signed `druid_auth` cookie set by POST /api/auth/login.
// Mount after /api/auth so login/logout/me stay public.
//
// Also resolves the verified operator identity onto req.operator so
// downstream handlers never have to (and never should) trust an
// approved_by / approved_by_email value from the request body.
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieValue = req.signedCookies?.druid_auth;
  if (typeof cookieValue !== "string") {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  if (operatorsConfigured) {
    const operator = findOperatorByCookieKey(cookieValue);
    if (!operator) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    req.operator = operator;
    next();
    return;
  }

  if (cookieValue === "1") {
    req.operator = DEFAULT_OPERATOR;
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required." });
}
