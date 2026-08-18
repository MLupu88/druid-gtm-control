import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountListItem } from "./accounts-api.js";
import { filterCanonicalNeedsAttentionItems } from "./needs-attention-view-model.js";

function attentionItem(
  id: string,
  routingOutput: "mql" | "dismissed",
): AccountListItem {
  return {
    account: {
      id,
      accountKey: `dom:${id}.example`,
      companyDomain: `${id}.example`,
      companyName: id === "mql" ? "MQL Account" : "Dismissed Account",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
    latestEvaluation: null,
    latestProductionEvaluation: null,
    latestDecision: {
      id: `decision-${id}`,
      routingOutput,
      createdAt: "2026-08-18T01:00:00.000Z",
    },
    attention: {
      openCount: 1,
      oldestOpenAttentionAt: "2026-08-17T00:00:00.000Z",
      reasonCodes: ["evaluation_stale"],
    },
  };
}

test("DISC-08: open-attention accounts remain present after MQL or Dismissed decisions", () => {
  const responseItems = [attentionItem("mql", "mql"), attentionItem("dismissed", "dismissed")];

  const visible = filterCanonicalNeedsAttentionItems(responseItems, "");

  assert.deepEqual(
    visible.map((item) => item.account.id),
    ["mql", "dismissed"],
  );
});

test("page-local search matches canonical identity without changing the source membership", () => {
  const responseItems = [attentionItem("mql", "mql"), attentionItem("dismissed", "dismissed")];

  const visible = filterCanonicalNeedsAttentionItems(responseItems, "MQL Account");

  assert.deepEqual(visible.map((item) => item.account.id), ["mql"]);
  assert.equal(responseItems.length, 2);
});
