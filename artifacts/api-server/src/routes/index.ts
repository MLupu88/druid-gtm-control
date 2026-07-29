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
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Public routes. Must stay mounted above the requireAuth guard below.
router.use(healthRouter);
router.use("/auth", authRouter);

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

export default router;
