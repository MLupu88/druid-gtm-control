import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { checkDatabaseConnection } from "@workspace/db";

const router: IRouter = Router();

// Lightweight liveness — must not depend on any downstream system (Sheets,
// n8n, Postgres). If this responds, the process is up.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness — confirms the operational-ledger database is reachable.
// Never exposes the connection string, a raw driver error, or a stack trace.
router.get("/readyz", async (_req, res) => {
  const result = await checkDatabaseConnection();

  if (!result.ok) {
    res.status(503).json({ status: "unavailable" });
    return;
  }

  res.status(200).json({ status: "ok" });
});

router.get("/health", async (_req, res) => {
  const dbCheck = await checkDatabaseConnection();
  res.json({
    status: dbCheck.ok ? "ok" : "degraded",
    ts: new Date().toISOString(),
    database: dbCheck.ok ? "ok" : "unavailable",
  });
});

export default router;
