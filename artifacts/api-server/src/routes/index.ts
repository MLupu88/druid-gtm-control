import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import healthRouter from "./health";
import authRouter from "./auth";
import n8nRouter from "./n8n";
import sheetsRouter from "./sheets";
import { createAccountEvaluationsRouter } from "./accountEvaluations";
import { createIcpProfilesRouter } from "./icpProfiles";
import { createAccountsRouter } from "./accounts";
import { createAccountDecisionsRouter } from "./accountDecisions";
import { createClientRadarResearchRunsRouter } from "./clientRadarResearchRuns";
import { createAccountIcpEvaluationsRouter } from "./accountIcpEvaluations";
import { createAccountFactsRouter } from "./accountFacts";
import { createSignalsRouter } from "./signals";
import { requireAuth } from "../middlewares/requireAuth";
import { requireServiceAuth } from "../middlewares/requireServiceAuth";

const router: IRouter = Router();

// Public routes. Must stay mounted above the requireAuth guard below.
router.use(healthRouter);
router.use("/auth", authRouter);

// Service-to-service, not browser-session: guarded by requireServiceAuth
// (a shared-secret header), never requireAuth. Mounted at the full,
// specific "/internal/signals" prefix and registered before the bare
// "/internal" + requireAuth mounts below — Express matches router.use
// prefixes in registration order, and "/internal/signals" would also
// match those routers' shared "/internal" prefix, so registering this
// first is what keeps signal-ingestion requests from ever reaching the
// browser-session auth boundary (and, just as importantly, keeps
// requireServiceAuth from ever running in front of the unrelated
// requireAuth-gated /internal routes mounted below).
router.use(
  "/internal/signals",
  requireServiceAuth,
  createSignalsRouter({ db }),
);

// Everything below this line requires a valid session.
router.use("/n8n", requireAuth, n8nRouter);
router.use("/sheets", requireAuth, sheetsRouter);
router.use(
  "/internal/account-evaluations",
  requireAuth,
  createAccountEvaluationsRouter({ db }),
);
router.use(
  "/internal/icp-profiles",
  requireAuth,
  createIcpProfilesRouter({ db }),
);
router.use("/internal/accounts", requireAuth, createAccountsRouter({ db }));
router.use(
  "/internal/account-decisions",
  requireAuth,
  createAccountDecisionsRouter({ db }),
);
router.use(
  "/internal",
  requireAuth,
  createClientRadarResearchRunsRouter({ db }),
);
router.use(
  "/internal",
  requireAuth,
  createAccountIcpEvaluationsRouter({ db }),
);
router.use("/internal", requireAuth, createAccountFactsRouter({ db }));

export default router;
