import { Router } from "express";
import crypto from "crypto";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body: { password: string }
// Checks against DRUID_ACCESS_CODE env var, sets an httpOnly signed cookie.
// ---------------------------------------------------------------------------
router.post("/login", (req, res) => {
  const accessCode = process.env.APP_PASSWORD;

  if (!accessCode) {
    res.status(503).json({ error: "APP_PASSWORD is not configured on the server." });
    return;
  }

  const supplied = String(req.body?.password ?? "");
  const supBuf = Buffer.from(supplied);
  const codeBuf = Buffer.from(accessCode);

  const match =
    supBuf.length === codeBuf.length &&
    crypto.timingSafeEqual(supBuf, codeBuf);

  if (!match) {
    res.status(401).json({ error: "Incorrect access code." });
    return;
  }

  res.cookie("druid_auth", "1", {
    httpOnly: true,
    sameSite: "strict",
    signed: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Returns { ok: true } if the signed cookie is valid, 401 otherwise.
// ---------------------------------------------------------------------------
router.get("/me", (req, res) => {
  if (req.signedCookies?.druid_auth === "1") {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post("/logout", (_req, res) => {
  res.clearCookie("druid_auth");
  res.json({ ok: true });
});

export default router;
