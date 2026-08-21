// LS6 — source-inspection tests for ./overview-summary-card.tsx.
// Mirrors ../pages/dashboard.test.ts's convention — no React rendering
// harness exists in this package.
//
// Run with: tsx --test src/components/overview-summary-card.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "overview-summary-card.tsx"),
  "utf8",
);

test("section title is exactly 'AI Summary'", () => {
  assert.ok(SOURCE.includes(">AI Summary<"));
});

test("has honest loading and unavailable states — no sample/fake fallback content", () => {
  assert.ok(SOURCE.includes("isLoading"));
  assert.ok(SOURCE.includes("isError"));
  assert.ok(SOURCE.includes("AI Summary is currently unavailable."));
  assert.ok(!SOURCE.includes("MOCK_"));
  assert.ok(!SOURCE.includes("SAMPLE_"));
  // Never a hand-written fallback sentence masquerading as generated
  // content — the only rendered summary text comes from the summary prop.
  assert.ok(!/summary:\s*["'`][A-Z]/.test(SOURCE));
});

test("renders only summary.summary — no raw facts/ids exposed to the user", () => {
  assert.ok(SOURCE.includes("summary.summary"));
  assert.ok(!SOURCE.includes("factsUsed"));
});

test("is not a chatbot — no prompt input, no chat history, no Account Brain controls", () => {
  for (const forbidden of ["<input", "<textarea", "chatHistory", "sendMessage", "AccountBrain", "onSubmit"]) {
    assert.ok(!SOURCE.includes(forbidden), `chat-like/Account Brain control present: ${forbidden}`);
  }
});

test("has a Retry action wired to the onRetry prop, consistent with the rest of Overview's error states", () => {
  assert.ok(SOURCE.includes("onClick={onRetry}"));
  assert.ok(SOURCE.includes("Retry"));
});
