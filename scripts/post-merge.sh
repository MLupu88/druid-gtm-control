#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Dev-only convenience sync (drizzle-kit push) — never use this for production
# migrations, which must go through the generated SQL migrations instead
# (pnpm db:generate / pnpm db:migrate).
pnpm --filter db run push:dev-only
