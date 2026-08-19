import assert from "node:assert/strict";
import { test } from "node:test";
import { statusBadgeVariants } from "./status-badge";
import { inlineNoticeVariants } from "./inline-notice";

const tones = ["neutral", "info", "success", "warning", "danger"] as const;

test("status badges expose every semantic state without workflow-specific names", () => {
  for (const tone of tones) {
    const classes = statusBadgeVariants({ tone });
    assert.match(classes, new RegExp(`status-${tone}`));
  }
});

test("inline notices share the same semantic state vocabulary", () => {
  for (const tone of tones) {
    const classes = inlineNoticeVariants({ tone });
    assert.match(classes, new RegExp(`status-${tone}`));
  }
});
