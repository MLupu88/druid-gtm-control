import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import n8nRouter from "./n8n";
import sheetsRouter from "./sheets";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Public routes. Must stay mounted above the requireAuth guard below.
router.use(healthRouter);
router.use("/auth", authRouter);

// Everything below this line requires a valid session.
router.use("/n8n", requireAuth, n8nRouter);
router.use("/sheets", requireAuth, sheetsRouter);

export default router;
