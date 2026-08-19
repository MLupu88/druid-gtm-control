import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  activeAppNavigationLabel,
  isAppNavigationItemActive,
} from "./app-navigation";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "app-shell.tsx",
);

const items = [
  { path: "/dashboard", label: "Overview" },
  { path: "/accounts", label: "Accounts" },
  { path: "/reports", label: "Reports" },
  { path: "/settings", label: "Settings" },
] as const;

test("navigation keeps parent sections active on nested routes", () => {
  assert.equal(isAppNavigationItemActive("/accounts/acc-123", "/accounts"), true);
  assert.equal(
    isAppNavigationItemActive("/settings/icp-profiles/profile-1", "/settings"),
    true,
  );
  assert.equal(isAppNavigationItemActive("/reports", "/accounts"), false);
  assert.equal(isAppNavigationItemActive("/accounts-old", "/accounts"), false);
});

test("dashboard handles both the root redirect location and canonical route", () => {
  assert.equal(isAppNavigationItemActive("/", "/dashboard"), true);
  assert.equal(isAppNavigationItemActive("/dashboard", "/dashboard"), true);
  assert.equal(isAppNavigationItemActive("/dashboard/other", "/dashboard"), false);
});

test("the top bar derives a stable section label", () => {
  assert.equal(activeAppNavigationLabel("/accounts/acc-123", items), "Accounts");
  assert.equal(activeAppNavigationLabel("/unknown", items), "Mission Control");
});

test("the shell uses client navigation and exposes the responsive sidebar trigger", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.match(source, /<Link[\s\S]*?href=\{item\.path\}/);
  assert.ok(source.includes("<SidebarTrigger"));
  assert.ok(source.includes("setOpenMobile(false)"));
  assert.ok(!source.includes('<a href={item.path}>'));
});

test("operator and shell utilities remain available", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(source.includes("Marketplace Analytics"));
  assert.ok(source.includes("Acting as {operator.name}"));
  assert.ok(source.includes("logout.mutate()"));
  assert.ok(source.includes('setTheme(option)'));
});
