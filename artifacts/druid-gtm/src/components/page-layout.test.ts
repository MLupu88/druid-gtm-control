import assert from "node:assert/strict";
import { test } from "node:test";
import { pageLayoutVariants } from "./page-layout";

test("page layouts expose the approved content-width variants", () => {
  assert.match(pageLayoutVariants({ width: "narrow" }), /content-width-narrow/);
  assert.match(pageLayoutVariants({ width: "standard" }), /content-width-standard/);
  assert.match(pageLayoutVariants({ width: "wide" }), /content-width-wide/);
  assert.match(pageLayoutVariants({ width: "full" }), /max-w-none/);
});

test("page layouts use shared responsive gutter and block-spacing tokens", () => {
  const classes = pageLayoutVariants();
  assert.match(classes, /page-gutter/);
  assert.match(classes, /page-block-padding/);
});
