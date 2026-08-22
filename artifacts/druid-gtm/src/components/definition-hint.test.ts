// LS7 — source-inspection tests for ./definition-hint.tsx. Mirrors this
// package's established convention (e.g. ../pages/dashboard.test.ts) —
// no React rendering harness exists here.
//
// Run with: tsx --test src/components/definition-hint.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "definition-hint.tsx"),
  "utf8",
);

test("uses an Info icon, never a warning/exclamation icon — those are reserved for actual warnings", () => {
  assert.ok(SOURCE.includes('from "lucide-react"'));
  assert.ok(/import\s*{\s*Info\s*}/.test(SOURCE));
  for (const forbidden of ["AlertTriangle", "AlertCircle", "AlertOctagon", "TriangleAlert"]) {
    assert.ok(!SOURCE.includes(forbidden), `warning icon used for a definition hint: ${forbidden}`);
  }
});

test("opens on hover (onMouseEnter) and on keyboard focus (onFocus) — never depends solely on hover", () => {
  assert.ok(SOURCE.includes("onMouseEnter={() => setOpen(true)}"));
  assert.ok(SOURCE.includes("onFocus={() => setOpen(true)}"));
});

test("the trigger is a real, keyboard-reachable button with an accessible label naming the term", () => {
  assert.ok(SOURCE.includes('<button'));
  assert.ok(SOURCE.includes('type="button"'));
  assert.ok(SOURCE.includes("aria-label={`What does"));
});

test("reuses the existing Popover primitive rather than a new component library or hand-rolled tooltip", () => {
  assert.ok(SOURCE.includes('from "@/components/ui/popover"'));
});

test("reads every definition from the central registry — never a hardcoded inline string", () => {
  assert.ok(SOURCE.includes('from "@/lib/definitions"'));
  assert.ok(SOURCE.includes("DEFINITIONS[term]"));
});
