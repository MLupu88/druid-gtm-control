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
import { createSignalResolutionRouter } from "./signalResolution";
import { createAttentionItemsRouter } from "./attentionItems";
import { createAttentionItemResolutionRouter } from "./attentionItemResolution";
import { createHubSpotCompanySyncRouter } from "./hubSpotCompanySync";
import { createRb2bSignalBridgeRouter } from "./rb2bSignalBridge";
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
// GTM V2 Unit 3 — POST /internal/signals/:signalId/resolve. Mounted at
// the same "/internal/signals" prefix and behind the same
// requireServiceAuth boundary as signal ingestion above (not a separate
// mount point, since both are the same service-to-service signal API).
router.use(
  "/internal/signals",
  requireServiceAuth,
  createSignalResolutionRouter({ db }),
);
// GTM V2 Stage 3, Unit 2 — POST /internal/accounts/:accountId/attention-items.
// Mounted at the full, specific prefix INCLUDING :accountId (not the
// shared "/internal/accounts" prefix the requireAuth-gated accounts
// router below uses) and registered before that mount — same rationale
// as signal ingestion above: requireServiceAuth must never run in front
// of the browser-session-gated /internal/accounts routes, and this
// mount's pattern only ever matches a request carrying an
// ".../attention-items" path segment, so it never intercepts a plain
// GET /internal/accounts or GET /internal/accounts/:accountId request.
router.use(
  "/internal/accounts/:accountId/attention-items",
  requireServiceAuth,
  createAttentionItemsRouter({ db }),
);
// POST /internal/attention-items/:attentionItemId/resolve. Same
// requireServiceAuth boundary, a prefix no other router in this package
// uses, so no ordering hazard with any other mount.
router.use(
  "/internal/attention-items",
  requireServiceAuth,
  createAttentionItemResolutionRouter({ db }),
);
// Milestone 3E.2a — POST /internal/rb2b/signals. Same requireServiceAuth
// boundary, a prefix no other router in this package uses, so no
// ordering hazard with any other mount. The n8n-side fan-out that would
// actually call this (3E.2b) is not implemented yet — this endpoint
// exists so the repository-side contract can be built and tested ahead
// of that wiring, per NEXT_SESSION.md's 3E.2 checkpoint.
router.use(
  "/internal/rb2b/signals",
  requireServiceAuth,
  createRb2bSignalBridgeRouter({ db }),
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
  "/internal/hubspot/company-sync",
  requireAuth,
  createHubSpotCompanySyncRouter({ db }),
);
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
