import type { Operator } from "../lib/operators";

declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth once the signed auth cookie has been verified.
      // Never populated from request body/query — identity is server-derived.
      operator?: Operator;
    }
  }
}

export {};
