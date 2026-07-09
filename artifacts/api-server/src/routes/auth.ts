import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import {
  DEFAULT_OPERATOR,
  operatorsConfigured,
  findOperatorByCode,
  findOperatorByCookieKey,
  cookieKeyForCode,
} from "../lib/operators";

const router = Router();

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const AUTH_COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: "strict" as const,
  signed: true as const,
  maxAge: 1000 * 60 * 60 * 24 * 7,
};

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body: { password: string }
//
// If OPERATORS is configured, the supplied code is looked up against it and
// the signed cookie stores a hash of the code (never the raw code) so the
// operator identity can be resolved server-side on every later request.
//
// If OPERATORS is not configured, falls back to the single APP_PASSWORD
// code for local/dev, with a generic default operator identity.
// ---------------------------------------------------------------------------
router.post("/login", loginRateLimiter, (req, res) => {
  const supplied = String(req.body?.password ?? "");

  if (operatorsConfigured) {
    const operator = findOperatorByCode(supplied);
    if (!operator) {
      res.status(401).json({ error: "Incorrect access code." });
      return;
    }

    res.cookie("druid_auth", cookieKeyForCode(supplied), AUTH_COOKIE_OPTS);
    res.json({ ok: true, authenticated: true, operator });
    return;
  }

  const accessCode = process.env.APP_PASSWORD;
  if (!accessCode) {
    res.status(503).json({ error: "APP_PASSWORD is not configured on the server." });
    return;
  }

  const supBuf = Buffer.from(supplied);
  const codeBuf = Buffer.from(accessCode);

  const match =
    supBuf.length === codeBuf.length &&
    crypto.timingSafeEqual(supBuf, codeBuf);

  if (!match) {
    res.status(401).json({ error: "Incorrect access code." });
    return;
  }

  res.cookie("druid_auth", "1", AUTH_COOKIE_OPTS);
  res.json({ ok: true, authenticated: true, operator: DEFAULT_OPERATOR });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Returns { authenticated: true, operator } if the signed cookie is valid,
// { authenticated: false } (401) otherwise.
// ---------------------------------------------------------------------------
router.get("/me", (req, res) => {
  const cookieValue = req.signedCookies?.druid_auth;
  if (typeof cookieValue !== "string") {
    res.status(401).json({ ok: false, authenticated: false });
    return;
  }

  if (operatorsConfigured) {
    const operator = findOperatorByCookieKey(cookieValue);
    if (!operator) {
      res.status(401).json({ ok: false, authenticated: false });
      return;
    }
    res.json({ ok: true, authenticated: true, operator });
    return;
  }

  if (cookieValue === "1") {
    res.json({ ok: true, authenticated: true, operator: DEFAULT_OPERATOR });
    return;
  }

  res.status(401).json({ ok: false, authenticated: false });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post("/logout", (_req, res) => {
  res.clearCookie("druid_auth");
  res.json({ ok: true });
});

export default router;
