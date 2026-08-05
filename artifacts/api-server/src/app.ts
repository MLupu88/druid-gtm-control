import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const REQUIRED_ENV_VARS = ["SESSION_SECRET", "APP_PASSWORD", "APP_ORIGIN"] as const;

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`${name} environment variable is required but was not provided.`);
  }
}

const app: Express = express();

app.set("trust proxy", 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, "../../druid-gtm/dist/public");

app.use(cookieParser(process.env.SESSION_SECRET));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: process.env.APP_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(express.static(frontendDist));

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }

  res.sendFile(path.join(frontendDist, "index.html"));
});

// Maps body-parser's oversized-body rejection (thrown by express.json()
// above, before any route handler runs) to the JSON error shape every API
// consumer expects, rather than Express 5's default HTML error page. The
// rejected body itself is never available here (body-parser aborts the
// read before producing one) and is not logged. Scoped to exactly this
// error type — any other error is passed through unchanged to Express's
// default handler.
app.use(
  (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { type?: unknown }).type === "entity.too.large"
    ) {
      res.status(413).json({
        error: "The request body is too large.",
        code: "payload_too_large",
      });
      return;
    }
    next(err);
  },
);

export default app;
