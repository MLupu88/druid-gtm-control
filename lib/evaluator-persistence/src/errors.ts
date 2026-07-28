// Typed errors thrown by evaluateAndPersist() for the cases where NO row
// may ever be inserted: missing referenced records, and a production
// evaluation requested against a non-published profile version.
//
// `UnsupportedEvaluatorVersionError` (the third "no row inserted" case)
// is NOT redeclared here — it's reused directly from
// @workspace/evaluator's registry.ts, since that package already owns
// evaluator-version validation and this adapter should not duplicate it.

export type MissingRecordType =
  | "accountSnapshot"
  | "icpProfileVersion"
  | "evaluatorVersion";

export class MissingRecordError extends Error {
  constructor(
    public readonly recordType: MissingRecordType,
    public readonly id: string,
  ) {
    super(`${recordType} with id "${id}" does not exist.`);
    this.name = "MissingRecordError";
  }
}

export class ProductionRequiresPublishedProfileError extends Error {
  constructor(
    public readonly profileVersionId: string,
    public readonly status: string,
  ) {
    super(
      `Production evaluation requires a published profile version; profileVersionId "${profileVersionId}" has status "${status}".`,
    );
    this.name = "ProductionRequiresPublishedProfileError";
  }
}
