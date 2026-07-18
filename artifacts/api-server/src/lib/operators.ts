import crypto from "crypto";

export interface Operator {
  name: string;
  email: string;
  role: string;
  // Additive, optional, forward-compatible fields for the future role-aware model.
  // Not used for any authorization or filtering yet — see gtmContract.js's
  // resolveOperatorAccessLocal/resolveOperatorAccessEntra, which are prepared and
  // tested but never called by any route in this package.
  id?: string;
  allowedIndustries?: string[];
}

export const DEFAULT_OPERATOR: Operator = {
  name: "Authenticated operator",
  email: "",
  role: "operator",
};

function isValidOperator(value: unknown): value is Operator {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const idOk = v.id === undefined || typeof v.id === "string";
  const industriesOk =
    v.allowedIndustries === undefined ||
    (Array.isArray(v.allowedIndustries) &&
      v.allowedIndustries.every((entry) => typeof entry === "string"));
  return (
    typeof v.name === "string" &&
    v.name.length > 0 &&
    typeof v.email === "string" &&
    typeof v.role === "string" &&
    v.role.length > 0 &&
    idOk &&
    industriesOk
  );
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// ---------------------------------------------------------------------------
// Parses and validates OPERATORS at module load so misconfiguration fails
// fast at startup rather than surfacing as a confusing runtime auth bug.
//
// codeToOperator: raw login code -> operator (used only during /login lookup)
// cookieKeyToOperator: sha256(code) -> operator (what the signed cookie
// stores, so the raw login code never round-trips through the cookie)
// ---------------------------------------------------------------------------
const rawOperators = process.env.OPERATORS;

export const operatorsConfigured = Boolean(rawOperators);

export const codeToOperator = new Map<string, Operator>();
export const cookieKeyToOperator = new Map<string, Operator>();

if (rawOperators) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOperators);
  } catch (err) {
    throw new Error(
      `OPERATORS environment variable is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OPERATORS environment variable must be a JSON object mapping login codes to operator records.");
  }

  for (const [code, operator] of Object.entries(parsed as Record<string, unknown>)) {
    if (!code) {
      throw new Error("OPERATORS contains an empty login code.");
    }
    if (!isValidOperator(operator)) {
      throw new Error(
        `OPERATORS entry for code '${code}' must be an object with string 'name', 'email', and non-empty 'role'.`,
      );
    }
    codeToOperator.set(code, operator);
    cookieKeyToOperator.set(hashCode(code), operator);
  }

  if (codeToOperator.size === 0) {
    throw new Error("OPERATORS environment variable must contain at least one operator entry.");
  }
}

export function findOperatorByCode(code: string): Operator | undefined {
  return codeToOperator.get(code);
}

export function cookieKeyForCode(code: string): string {
  return hashCode(code);
}

export function findOperatorByCookieKey(key: string): Operator | undefined {
  return cookieKeyToOperator.get(key);
}
