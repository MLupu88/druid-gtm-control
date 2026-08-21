// M3.5 real-data defect fix — unit tests for
// ./observationCurrentOccurrence.ts. Pure: no DB, no network.
//
// Run with: tsx --test src/services/observationCurrentOccurrence.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { selectCurrentOccurrencePerStream, type OccurrenceRow } from "./observationCurrentOccurrence.js";

let idCounter = 0;
function row(overrides: Partial<OccurrenceRow> = {}): OccurrenceRow {
  idCounter += 1;
  return {
    id: `occ-${idCounter}`,
    provider: "hubspot",
    observationClass: "crm_state",
    sourceRecordId: "company-1",
    semanticKey: "crm.owner",
    observedAt: null,
    importedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

test("a single occurrence passes through unchanged", () => {
  const only = row();
  assert.deepEqual(selectCurrentOccurrencePerStream([only]), [only]);
});

test("repeated occurrences of the same provider claim collapse to exactly one current occurrence", () => {
  const oldest = row({ importedAt: new Date("2026-08-01T00:00:00Z") });
  const middle = row({ importedAt: new Date("2026-08-10T00:00:00Z") });
  const newest = row({ importedAt: new Date("2026-08-20T00:00:00Z") });

  const current = selectCurrentOccurrencePerStream([oldest, middle, newest]);

  assert.equal(current.length, 1);
  assert.equal(current[0]!.id, newest.id);
});

test("a changed value from the same provider claim: only the newest occurrence is current, the old one is not returned at all", () => {
  const oldValue = row({ importedAt: new Date("2026-08-01T00:00:00Z") });
  const newValue = row({ importedAt: new Date("2026-08-20T00:00:00Z") });

  const current = selectCurrentOccurrencePerStream([oldValue, newValue]);

  assert.equal(current.length, 1);
  assert.equal(current[0]!.id, newValue.id);
  assert.ok(!current.some((r) => r.id === oldValue.id));
});

test("when every occurrence in a stream has observedAt, the latest observedAt wins, even against a disagreeing importedAt order", () => {
  // A defensible backfill case: the occurrence imported LAST actually
  // observed an EARLIER moment than the one imported first.
  const importedFirstObservedLater = row({
    observedAt: new Date("2026-08-20T00:00:00Z"),
    importedAt: new Date("2026-08-01T00:00:00Z"),
  });
  const importedSecondObservedEarlier = row({
    observedAt: new Date("2026-08-05T00:00:00Z"),
    importedAt: new Date("2026-08-15T00:00:00Z"),
  });

  const current = selectCurrentOccurrencePerStream([
    importedFirstObservedLater,
    importedSecondObservedEarlier,
  ]);

  assert.equal(current.length, 1);
  assert.equal(current[0]!.id, importedFirstObservedLater.id);
});

test("when only SOME occurrences in a stream carry observedAt, the whole stream falls back to importedAt ordering", () => {
  const dated = row({
    observedAt: new Date("2026-08-20T00:00:00Z"),
    importedAt: new Date("2026-08-01T00:00:00Z"),
  });
  const undated = row({
    observedAt: null,
    importedAt: new Date("2026-08-15T00:00:00Z"),
  });

  const current = selectCurrentOccurrencePerStream([dated, undated]);

  assert.equal(current.length, 1);
  // undated has the later importedAt and wins the fallback ordering —
  // proves observedAt was NOT selectively trusted for just one row.
  assert.equal(current[0]!.id, undated.id);
});

test("different providers for the same sourceRecordId/semanticKey are never collapsed together", () => {
  const hubspot = row({ provider: "hubspot" });
  const dealfront = row({ provider: "dealfront" });

  const current = selectCurrentOccurrencePerStream([hubspot, dealfront]);

  assert.equal(current.length, 2);
  assert.deepEqual(
    new Set(current.map((r) => r.id)),
    new Set([hubspot.id, dealfront.id]),
  );
});

test("different sourceRecordIds for the same provider/semanticKey are never collapsed together", () => {
  const companyA = row({ sourceRecordId: "company-a" });
  const companyB = row({ sourceRecordId: "company-b" });

  const current = selectCurrentOccurrencePerStream([companyA, companyB]);

  assert.equal(current.length, 2);
});

test("different semanticKeys for the same provider/sourceRecordId are never collapsed together", () => {
  const owner = row({ semanticKey: "crm.owner" });
  const lifecycle = row({ semanticKey: "crm.lifecycleStage" });

  const current = selectCurrentOccurrencePerStream([owner, lifecycle]);

  assert.equal(current.length, 2);
});

test("different observationClasses are never collapsed together, even sharing every other field", () => {
  const crmState = row({ observationClass: "crm_state", semanticKey: "shared-key" });
  const firmographic = row({ observationClass: "firmographic_fact", semanticKey: "shared-key" });

  const current = selectCurrentOccurrencePerStream([crmState, firmographic]);

  assert.equal(current.length, 2);
});

test("an exact observedAt/importedAt tie is broken deterministically by id", () => {
  const sameInstant = new Date("2026-08-20T00:00:00Z");
  const a = row({ id: "a", observedAt: sameInstant, importedAt: sameInstant });
  const b = row({ id: "b", observedAt: sameInstant, importedAt: sameInstant });

  const first = selectCurrentOccurrencePerStream([a, b]);
  const second = selectCurrentOccurrencePerStream([b, a]);

  assert.equal(first.length, 1);
  assert.equal(first[0]!.id, second[0]!.id);
});

test("result is independent of input order", () => {
  const oldest = row({ importedAt: new Date("2026-08-01T00:00:00Z") });
  const newest = row({ importedAt: new Date("2026-08-20T00:00:00Z") });
  const otherProvider = row({ provider: "dealfront" });

  const forward = selectCurrentOccurrencePerStream([oldest, newest, otherProvider]);
  const reversed = selectCurrentOccurrencePerStream([otherProvider, newest, oldest]);

  const idsOf = (rows: OccurrenceRow[]) => new Set(rows.map((r) => r.id));
  assert.deepEqual(idsOf(forward), idsOf(reversed));
});
