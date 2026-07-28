// Explicit evaluator-version registry. An evaluator_versions.version
// string from the database is untrusted input as far as this package is
// concerned — it must never be used to dispatch to arbitrary code. Only
// versions listed in SUPPORTED_EVALUATOR_VERSIONS have a real
// implementation; anything else fails clearly via
// UnsupportedEvaluatorVersionError rather than silently falling back to
// some default behavior.
//
// "canonical-v1" is the first (and currently only) supported
// implementation. It is what rules/identity.ts's canonical mechanics and
// conditions.ts's condition semantics belong to — a future canonical-v2
// could define different mechanics entirely, dispatched the same way.

import { evaluateCanonicalV1 } from "./evaluate.js";
import type { EvaluationResult, NormalizedAccountInputV1 } from "./types.js";
import type { IcpProfileConfigV1 } from "./profileConfig.js";

export const SUPPORTED_EVALUATOR_VERSIONS = ["canonical-v1"] as const;
export type SupportedEvaluatorVersion =
  (typeof SUPPORTED_EVALUATOR_VERSIONS)[number];

export class UnsupportedEvaluatorVersionError extends Error {
  constructor(public readonly version: string) {
    super(
      `Evaluator version "${version}" is not supported by this running code. Supported versions: ${SUPPORTED_EVALUATOR_VERSIONS.join(", ")}.`,
    );
    this.name = "UnsupportedEvaluatorVersionError";
  }
}

export function isSupportedEvaluatorVersion(
  version: string,
): version is SupportedEvaluatorVersion {
  return (SUPPORTED_EVALUATOR_VERSIONS as readonly string[]).includes(version);
}

export type EvaluatorImplementation = (
  normalizedInput: NormalizedAccountInputV1,
  profileConfig: IcpProfileConfigV1,
) => EvaluationResult;

const EVALUATOR_REGISTRY: Record<
  SupportedEvaluatorVersion,
  EvaluatorImplementation
> = {
  "canonical-v1": evaluateCanonicalV1,
};

export function getEvaluatorImplementation(
  version: string,
): EvaluatorImplementation {
  if (!isSupportedEvaluatorVersion(version)) {
    throw new UnsupportedEvaluatorVersionError(version);
  }
  return EVALUATOR_REGISTRY[version];
}

/**
 * The public pure evaluation entrypoint. Takes already-validated typed
 * input (parsing raw JSON is the future persist.ts adapter's job, not
 * this function's — see the package report for that boundary decision)
 * and dispatches to the registered implementation for evaluatorVersion,
 * throwing UnsupportedEvaluatorVersionError clearly if it isn't one this
 * running code knows how to execute.
 */
export function evaluateAccount(args: {
  normalizedInput: NormalizedAccountInputV1;
  profileConfig: IcpProfileConfigV1;
  evaluatorVersion: string;
}): EvaluationResult {
  const implementation = getEvaluatorImplementation(args.evaluatorVersion);
  return implementation(args.normalizedInput, args.profileConfig);
}
