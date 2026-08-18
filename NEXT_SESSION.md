# NEXT_SESSION.md — DRUID GTM Mission Control

Concise, operational resume point. For full context, read the files below
first — do not re-derive decisions already made in them.

---

## Resume point

A full read-only repository audit completed 2026-08-18 (`PROJECT_AUDIT.md`),
which also updated `ROADMAP.md` (added a "GTM V2" section and a "Roadmap
Corrections" section) and created `PROJECT_HANDOFF.md`. A follow-up
correction pass, also 2026-08-18, fixed several imprecise claims across all
four documents (see each document's own correction note) and narrowed the
scope of the unit below — most importantly, it removed an internal
contradiction this file originally had between "membership is determined by
canonical open attention items" and "preserve the old MQL/Dismiss
local-state hiding logic." **No application code, schema, or migration was
changed by either pass.** The single next implementation unit is below,
alongside a separate verification step and a separate product decision that
are not part of it.

---

## Files to read first

1. `PROJECT_HANDOFF.md` — durable implementation-state reference
2. `ROADMAP.md` — canonical roadmap (see "Current Verified State — 2026-08-18" near the top, the "GTM V2" section, and "Roadmap Corrections / Reclassified Work" near the end)
3. `PROJECT_AUDIT.md` — full evidence/citations behind every claim in the two files above (see DISC-07 and DISC-08 specifically for this unit's corrected scope)
4. `design-system-extract.md` (supplemental, visual reference only — see "Design reference" below)

---

## Preflight

`4a341126a59cd33337a36af9be8f3d6088fc9333` ("GTM V2: add durable Client
Radar account mapping (#43)") is the **audited application-code baseline** —
the commit every claim in `PROJECT_HANDOFF.md`/`PROJECT_AUDIT.md` was
verified against. It is **not** necessarily the literal HEAD you'll see:
committing the four documentation files this audit produced moves HEAD past
it, and that is expected, not a discrepancy. What actually matters is
whether any *application-code-bearing* change (schema, migrations, backend,
frontend, CI, config, dependencies — anything other than these four
markdown files) has landed since that baseline. Run this and compare against
the two valid states below **before making any change**. If reality matches
neither, **STOP and report the discrepancy before implementing anything.**

```bash
git -C /Users/mihailupu/Projects/druid-gtm-control rev-parse --show-toplevel
git -C /Users/mihailupu/Projects/druid-gtm-control branch --show-current
git -C /Users/mihailupu/Projects/druid-gtm-control log -1 --format="%H %ci %s"
git -C /Users/mihailupu/Projects/druid-gtm-control status --short
git -C /Users/mihailupu/Projects/druid-gtm-control diff --name-only 4a341126a59cd33337a36af9be8f3d6088fc9333..HEAD
```

**Branch must be `main` in both valid states below — anything else is
already a mismatch, stop immediately.**

**Valid state 1 — docs still uncommitted:** HEAD is still exactly
`4a341126a59cd33337a36af9be8f3d6088fc9333`, and `git status --short` shows
only the four documented changes (`ROADMAP.md` modified; `PROJECT_AUDIT.md`,
`PROJECT_HANDOFF.md`, `NEXT_SESSION.md` untracked). The last command above
will show no output (nothing committed since baseline yet) — that's expected
here, not a check to apply in this state.

**Valid state 2 — docs have been committed:** HEAD is a **descendant** of
`4a341126a59cd33337a36af9be8f3d6088fc9333` (confirm with
`git merge-base --is-ancestor 4a341126a59cd33337a36af9be8f3d6088fc9333 HEAD`
— exit code `0` means yes), `git status --short` is fully clean, **and** the
`git diff --name-only` output above lists **only** some subset of
`ROADMAP.md`, `PROJECT_HANDOFF.md`, `PROJECT_AUDIT.md`, `NEXT_SESSION.md`.
If that diff lists *any* other path — a schema file, a migration, anything
under `artifacts/`, `lib/` source, `.github/workflows`, `package.json`/lock
files, `Dockerfile`, `docker-compose.yml`, etc. — the application-code
baseline this audit verified no longer holds as described. **STOP and
report exactly which non-documentation paths changed**, rather than
assuming the audit's findings still apply; those files were not covered by
this audit and may have shifted the ground it stood on.

Neither valid state requires HEAD to literally equal
`4a341126a59cd33337a36af9be8f3d6088fc9333` — only that no application code
changed since it.

Also verify the environment still typechecks and unit-tests clean before
starting:

```bash
pnpm exec tsc --build
cd artifacts/api-server && pnpm exec tsx --test src/services/accounts.test.ts src/routes/accounts.route.test.ts src/services/attentionItems.test.ts src/routes/attentionItems.route.test.ts
```

---

## Three distinct next steps — do not conflate them

This session covers **one** of these three. They are different in kind, not
just in size, and are sequenced accordingly (full reasoning in
`PROJECT_AUDIT.md` §R):

- **A. Implementation (this session's objective, below):** wire the frontend
  "Needs Attention" *membership* view to the already-built GTM V2 attention
  read model. Safe to build now — no schema/backend change, no unresolved
  product question blocks it.
- **B. Verification (should happen in parallel, not before or after A —
  see "Next verification step" below):** confirm whether any real
  operational signal currently reaches GTM V2's ingestion endpoint at all
  (`PROJECT_AUDIT.md` DISC-07). This is **not** an implementation task for
  this or any coding session — it requires inspecting a running system.
- **C. Product decision (should follow B, not precede it — see "Next
  product decision" below):** decide what should feed Intent scoring
  (`PROJECT_AUDIT.md` DISC-02). Do not scope this as an implementation unit
  until a human has made this decision.

---

## Immediate objective (A — implementation)

**Wire the frontend "Needs Attention" view's *membership* to the already-built
GTM V2 attention read model — read-only.**

Replace `artifacts/druid-gtm/src/components/needs-attention-view.tsx`'s
current data source (Sheet-backed rows matched to canonical accounts,
filtered by whether the latest `account_decisions.routing_output` is
`dismissed`/`mql`) with the canonical `attention_items`-derived read model
already implemented in `artifacts/api-server/src/services/accounts.ts`
(`listAccounts` with `needsAttention: true`, returning each account's
`AccountAttentionSummary`).

**The canonical invariant this unit must implement (this is the corrected
core of this unit — read carefully):**

> Frontend code must never independently decide that an account no longer
> needs attention. Membership in "Needs Attention" is determined solely by
> canonical open `attention_items` rows, as returned by
> `GET /internal/accounts?needsAttention=true`. After any operator action
> (MQL, Dismiss, or anything else), refetch/re-evaluate canonical attention
> state rather than removing the row from local state. An account
> disappears from the view only when the backend reports no open attention
> item remains for it — never because the frontend inferred that a decision
> "should" have resolved its attention.

---

## Why this is next, and why its scope is narrower than it first looked

- The read-model backend for this exists, is DB-trigger-enforced, and is
  fully unit-tested — four PRs (`#38`-`#40`) already merged to `main`
  building it. Right now it produces **zero user-visible effect**, because
  nothing in the frontend calls it (`PROJECT_AUDIT.md` DISC-03).
- It is frontend-only for the *membership/read* path: no schema change, no
  migration, no new backend endpoint required for that part.
- It directly continues `ROADMAP.md`'s own "Next Delivery Sequence #1"
  (canonical operational workspace migration) — this is the frontend half of
  work whose backend half is already done.
- **Corrected in this pass (`PROJECT_AUDIT.md` DISC-08):** the original
  version of this document told the implementer to "preserve the old
  MQL/Dismiss local-state removal logic," which directly contradicts the
  canonical invariant above. Verified in code: `accountDecisions.ts` (the
  MQL/Dismiss write path) has zero references to `attention_items` — an
  MQL/Dismiss decision does **not** resolve any attention item. If the old
  local-state rule were kept, an account with an open, unrelated attention
  item (e.g. `evaluation_stale`) that gets MQL'd would incorrectly
  disappear from "Needs Attention" while the backend still considers it
  open. That old rule must be **removed**, not adapted.
- **Also corrected in this pass:** an operator-facing "resolve this
  attention item" UI control is genuinely **out of scope for this unit**,
  not merely deferred by choice — `POST /internal/attention-items/:id/resolve`
  is gated by `requireServiceAuth` (shared-secret header), not `requireAuth`
  (browser session), so the frontend **cannot** call it today. Building that
  control would require a separate, later backend decision (a new
  `requireAuth`-gated resolve route, or some other mechanism) that this unit
  does not include.
- It does **not** depend on step B (verifying the signal bridge) or step C
  (the Intent product decision) — this unit displays whatever attention
  items exist today, however they got created, and is equally correct
  whether or not real signals are currently flowing.

---

## Scope

- Replace `needs-attention-view.tsx`'s data-fetching/filtering logic with a
  call to `GET /internal/accounts?needsAttention=true` (existing endpoint,
  existing auth boundary — `requireAuth`, same as every other route this
  page already calls).
- Surface each account's `AccountAttentionSummary` (open attention-item
  count, oldest open item's `createdAt`, distinct reason codes) somewhere in
  the row/detail UI — the exact visual treatment is an implementation
  choice, not specified by this document (see "Design reference" below).
- **Remove** the old local-state rule that hides a row once its latest
  decision is `mql`/`dismissed` (`needs-attention-view.tsx:210-230`ish) —
  replace it with canonical-membership-only logic per the invariant above.
  After any account-decision action completes, refetch the accounts list
  (or otherwise re-derive from a fresh server response) rather than mutating
  local state to remove the row.
- Preserve Sample Mode gating (a genuinely separate, still-valid guardrail —
  unrelated to the attention-lifecycle contradiction being fixed here).
- Update or remove any test in `artifacts/druid-gtm/src` that currently
  asserts against the old Sheet-backed filtering or the old MQL/Dismiss
  local-state-removal behavior for this view.

## Out of scope

- Any change to `lib/db/src/schema`, `lib/db/drizzle/*.sql`, or any
  `artifacts/api-server/src/services/*` file — the read-model backend for
  this unit is already complete and tested; do not modify it.
- **Any "resolve this attention item" UI control** — not reachable from the
  browser session today (see "Why this is next" above); do not add one, and
  do not add a new backend route to enable one, as part of this unit.
- Step B: runtime-verifying the operational signal bridge (DISC-07) — not an
  implementation task at all, and not blocking this unit either way.
- Step C: wiring signals/identity resolution into ICP evaluation (DISC-02) —
  a separate, larger unit requiring a product decision first.
- Any other operational queue from `ROADMAP.md`'s "Next Delivery Sequence #1"
  list (MQL, Sales Review, Pipeline Assist, etc.) — those remain out of
  scope until this unit is done.
- Any change to the older Sheet-backed data path that other views (e.g.
  "All Accounts") may still depend on — do not remove Sheet-reading code
  that other, unrelated views still use.

## Acceptance criteria

- An account with at least one open `attention_items` row (any `source`,
  any `reason_code`) appears in "Needs Attention" — **including** one whose
  latest `account_decisions` row is `mql` or `dismissed`, as long as an open
  attention item remains (this specific case is the regression test for the
  DISC-08 correction).
- After an operator records an MQL/Dismiss decision (or any other action),
  the view reflects fresh canonical attention state (via refetch) rather
  than locally removing the row — an account with a still-open, unrelated
  attention item remains visible.
- An account with only resolved attention items (or none at all) does not
  appear in "Needs Attention."
- No UI control in this view claims to "resolve" or "dismiss" an attention
  item — only account-level decision actions (MQL/Dismiss) that already
  exist elsewhere in the product are present.
- Pagination, search, filters, loading/empty/error states on this view
  continue to work against the new data source (mirror whatever the existing
  "All Accounts" view — which already calls the same `accounts.ts` service —
  already does correctly).
- `pnpm exec tsc --build` and the relevant frontend test suite
  (`artifacts/druid-gtm`'s `pnpm test`, filtered to files touched) pass.
- No change to any file under `lib/db`, `lib/evaluator`, or
  `artifacts/api-server/src/services`.

## Relevant files/code paths

- `artifacts/druid-gtm/src/components/needs-attention-view.tsx` — primary file to change
- `artifacts/druid-gtm/src/pages/accounts.tsx` — the page that mounts it (view routing: `?view=attention` vs `?view=all`)
- `artifacts/druid-gtm/src/lib/accounts-api.ts` — existing frontend API client for `GET /internal/accounts`; needs a `needsAttention` param added
- `artifacts/api-server/src/services/accounts.ts:332-536` — `listAccounts`, the backend read model (do not modify — read to understand the exact response shape)
- `artifacts/api-server/src/routes/accounts.ts` — the route exposing it
- `artifacts/api-server/src/services/accountDecisions.ts` — read (do not modify) to confirm for yourself that it does not touch `attention_items`, before relying on that fact
- `lib/db/src/schema/attentionItems.ts` — schema reference only, for understanding the `AccountAttentionSummary` shape (do not modify)

## Design reference

`design-system-extract.md` (repo root) documents DRUID's visual system
(colors, typography, spacing, cards, badges, states) inferred from the
`druid-calculator` app — the visual source of truth for DRUID product apps.
Use it for styling the attention-summary UI this unit adds (badge colors for
reason codes, card/row treatment, empty/loading states, etc.) so it stays
visually consistent with the rest of the product. **It is visual/design
guidance only — not an architecture or source-of-truth document.** Do not
redesign unrelated screens, and do not introduce a new visual pattern where
an existing one in `needs-attention-view.tsx` or its siblings already covers
the case; reach for a new element from the design system only when the new
attention-summary UI genuinely needs one that doesn't already exist in the app.

## Tests expected

- New/updated frontend tests asserting the "Needs Attention" view correctly reflects the `needsAttention`/`AccountAttentionSummary` response shape (mock the API response; don't require a live backend).
- A test covering the DISC-08 regression case specifically: an account with an open attention item and a latest `mql`/`dismissed` decision still appears.
- Do not add or modify any `artifacts/api-server` test — the backend is already fully tested for this read model.
- Do not attempt to spin up Postgres or run any `.integration.test.ts` file as part of this unit.

## Guardrails

- No production access, no deploy, no SSH.
- No database migration — this unit requires none; if you find yourself wanting one, stop and re-read the scope above.
- No secret values printed, echoed, or committed anywhere.
- No auto-send / auto-MQL / auto-accept logic introduced anywhere near this change — this unit is read/filter/display only.
- No new "resolve attention item" backend route or UI control — out of scope (see above).
- Do not commit or push without explicit user approval, even after tests pass.
- Do not modify `lib/evaluator`, `lib/evaluator-persistence`, or any Client Radar service file as part of this unit.

---

## Next verification step (B — not an implementation task)

**Runtime-verify whether any real operational signal currently reaches GTM
V2's signal-ingestion API** (`PROJECT_AUDIT.md` DISC-07). This audit found no
caller of `POST /internal/signals` anywhere in this repository and no
provider-specific adapter code (RB2B, Dealfront, etc.) — meaning it is
genuinely unknown whether the resolver, though internally correct, currently
receives any real data. This requires access to a running system this audit
was constrained not to touch (a live n8n instance's workflow definitions, or
the `signals` table in a real database) and explicit approval before any of
that is attempted. Suggested trace, once approved: pick one real signal
source → confirm what it actually sends and where → confirm whether that
payload is normalized into `NormalizedSignalV1` shape anywhere → confirm
whether it is ever POSTed to `/internal/signals` → confirm a resulting
`signals` row and `identity_resolution_events` row exist. Do not build a
bridge before this trace is done — building toward an assumed-but-unverified
integration risks solving the wrong problem.

## Next product decision (C — not an implementation task)

**Decide what should feed Intent scoring** (`PROJECT_AUDIT.md` DISC-02).
Evaluation input currently comes only from bare account identity plus
manually-entered `account_facts`; the evaluator's `NormalizedEngagementV1Schema`
and `intent` rule dimension are fully built but never populated. This is a
product decision (what does "Intent" mean for this product — aggregated
signal/engagement activity? something else?), not an engineering task, and
should be made only after step B above establishes whether real signal data
is even available to decide about.

---

## After this unit

1. Runtime-verify DISC-07 (step B above) — can happen in parallel with, or immediately after, this unit; does not block it.
2. Bring the DISC-02 product decision (step C above) to the user, informed by step B's result.
3. Fix CI to run the Client Radar and ICP-profile test suites on every PR (DISC-05) — small, mechanical, can happen any time.
4. Continue `ROADMAP.md`'s "Next Delivery Sequence #1" with the remaining operational queues (MQL, Sales Review, Pipeline Assist, Owner Alert, Retarget, Nurture, Suppressed).

---

## Bootstrap prompt for Codex

```
You're picking up implementation work on the DRUID GTM Mission Control
repository (/Users/mihailupu/Projects/druid-gtm-control, branch main).

Before writing any code, read these files in full, in this order:
1. PROJECT_HANDOFF.md
2. ROADMAP.md (especially "Current Verified State — 2026-08-18" near the
   top, the "GTM V2" section, and "Roadmap Corrections / Reclassified Work"
   near the end)
3. PROJECT_AUDIT.md (especially DISC-07 and DISC-08)
4. NEXT_SESSION.md (this file's sibling) for the specific unit
5. design-system-extract.md for visual/styling reference only (not
   architecture)

These were produced by a full read-only repository audit plus a follow-up
correction pass, and are the current source of truth — do not assume
anything from outside this repository. That said, treat them as a starting
map, not gospel: inspect the actual current code yourself (schema, services,
routes, frontend) for anything you're about to touch, since code may have
moved since the audit. In particular, verify for yourself (don't just take
the document's word) that accountDecisions.ts does not touch attention_items
before relying on that fact.

Run the preflight commands in NEXT_SESSION.md first. Branch must be main.
HEAD does NOT need to literally equal the commit NEXT_SESSION.md names as
the audited application-code baseline — committing these four documentation
files is expected to move HEAD past it. What matters is whether any
application-code-bearing file (not one of the four docs) has changed since
that baseline commit; NEXT_SESSION.md's "Preflight" section gives the exact
git diff command and the two valid states to check against. If neither
valid state matches — in particular, if that diff shows any changed path
outside the four documentation files — STOP and report exactly which
non-documentation paths changed instead of proceeding, since those weren't
covered by the audit you're relying on.

Your task is ONLY the single implementation unit described in
NEXT_SESSION.md under "Immediate objective (A)" / "Scope" / "Out of scope" /
"Acceptance criteria." Do not attempt the "Next verification step" or "Next
product decision" sections — those are explicitly not implementation tasks
for this session, even if they look related or quick. Do not start on
anything else in the roadmap either.

Pay close attention to the canonical invariant stated under "Immediate
objective": membership in Needs Attention comes solely from canonical open
attention_items, never from frontend-local judgment about whether a decision
"should" have resolved something. Do not preserve the old MQL/Dismiss
local-state hiding logic — remove it, per the acceptance criteria.

Before writing any code: propose a short implementation plan (files you'll
touch, in what order, and how you'll verify each acceptance criterion) and
wait for approval.

Preserve every existing architectural invariant listed in
PROJECT_HANDOFF.md's "Critical invariants / guardrails" section. Do not
touch lib/db, lib/evaluator, lib/evaluator-persistence, or any
artifacts/api-server/src/services file as part of this unit — the backend
for this unit is already complete; this is a frontend-only change. Do not
add any "resolve attention item" UI control or backend route — out of scope.

Run `pnpm exec tsc --build` and the relevant frontend test suite before
declaring the work done. Do not commit, push, deploy, migrate, or SSH
anywhere without explicit approval, even after tests pass.
```

---

## Bootstrap prompt for fresh ChatGPT

```
I'm coordinating implementation work (done by Codex/Claude Code, not you)
on a repository called DRUID GTM Mission Control. Your role here is to help
me coordinate that implementation, review what Codex/Claude Code produces,
suggest concrete next commands, and work one action at a time with me — not
to write large amounts of code yourself.

I have three documents from a recent full repository audit (plus a
follow-up correction pass) that are the current source of truth for this
project's actual state: PROJECT_HANDOFF.md, ROADMAP.md, and
PROJECT_AUDIT.md, plus a short operational NEXT_SESSION.md describing the
single next implementation unit. I'll paste their contents (or relevant
sections) as needed. Please rely on what I paste from these documents rather
than any general assumptions about what a "GTM system" typically looks like,
and don't try to recall or infer project history from anything other than
what I give you in this conversation.

The immediate implementation objective is: wire the frontend "Needs
Attention" view's membership to an already-built backend read model,
read-only (details in NEXT_SESSION.md). Two separate, non-implementation
next steps exist alongside it and should not be conflated with it: a
runtime verification of whether real signals reach the backend at all, and
a product decision about what should feed Intent scoring — help me keep
those three distinct as we go. Help me track progress against the
implementation unit's acceptance criteria and think through any
implementation decisions Codex surfaces.
```
