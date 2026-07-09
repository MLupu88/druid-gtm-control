import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import n8nRouter from "./n8n";
import sheetsRouter from "./sheets";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/n8n", n8nRouter);
router.use("/sheets", sheetsRouter);

export default router;
