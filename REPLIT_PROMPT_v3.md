# Build: DRUID GTM Mission Control (cockpit for an existing n8n GTM engine) — v3
**This version supersedes REPLIT_PROMPT_v2.md and REPLIT_CORRECTIVE_PROMPT.md. Use this one only.**

Build an internal web app — a review-and-approve cockpit for an existing n8n GTM signal engine.
**Do not rebuild the engine. Do not call any vendor API from the browser.** The app reads engine
state from one Google Sheet and sends approvals to n8n via server-side webhooks. n8n is the
automation brain; this app is where a human looks at what the engine found and decides what to do.

## Who uses this app (read this before writing any copy)
The people using this are **not engineers**. Think product marketing, partnerships, and sales —
someone who knows what "a lead" and "a deal" and "an MQL" are, but has never heard of a webhook, a
gate, a queue key, or TCPA. Every word in the UI must read like a well-written CRM (think HubSpot's
own interface, or Notion) — plain, calm, business-normal — never like a systems dashboard. If a
label needs an acronym or a technical word to be accurate, put the plain meaning first and the
technical term second in parentheses, small and secondary — never the reverse.

**Words that must never appear anywhere in rendered UI text, tooltips, or button labels** (fine in
code/comments, never on screen): webhook, endpoint, payload, JSON, gate (as in "gate_status"),
engine_mode / queue_source / account_key / queue_key as literal words, TCPA without an explanation
next to it, sandbox, simulator, synthetic, mock (unless literally telling the operator "no real data
connected yet" in a single small, honest badge — never as the app's identity).

## Golden rules (do not violate)
1. **Read, don't recompute.** The engine has already computed every gate, score, recommendation, and
   cost. The cockpit DISPLAYS those, translated into plain language via the label maps in
   `gtmContract.js`. It never re-runs gate/cost logic and never invents its own wording for a status,
   reason, or output type — always pull from `OUTPUT_TYPE_LABELS`, `SALES_REVIEW_REASON_LABELS`,
   `IDENTITY_LABELS`, `BLOCK_REASON_LABELS`, `STATUS_LABELS_V3`, `ENGINE_MODE_LABELS`, `costLabel()`.
2. **No secrets client-side.** All webhook calls go through the Express backend (the browser never
   sees `N8N_WEBHOOK_SECRET` — and never say the word "webhook" or "secret" anywhere a user can see).
3. **Four write actions, described in plain language, not by internal endpoint name.** Internally
   these map to `/gtm-activate`, `/gtm-decision`, `/gtm-action`, `/gtm-config` — the operator never
   sees those names, only the plain button they clicked.
4. **The app never triggers Retell/Cognism/HubSpot/Salesforge/Dripify directly.** It sends an
   approval to the engine; the engine does the final safety checks and decides whether to act.
5. **Honesty about what's actually connected right now.** Only voice calls (via our AI calling tool)
   are a real, live send today. Email, LinkedIn, and account-owner alerts are **logged, not sent** —
   there's no email tool, LinkedIn tool, or CRM connected yet. The UI must say this plainly every
   single time (see Status Labels below) — never say "sent" when nothing left the building.
6. **Never claim a specific person did something unless we're sure.** Before showing ANY sentence
   about an account's activity, run it through `visitorSafeCopy(text, row.visitor_claim_allowed)`.
   Use `IDENTITY_LABELS` for how confident we are. When we're not sure it's a specific person, say
   "the company showed activity" or "looks like they're exploring" — never "this person visited",
   never a made-up name doing something, never "we saw you on the site."

## Stack
React (Vite) frontend, Node/Express backend, single password login, Google Sheets read connector
with a sample-data fallback, server-side write routes. Dark mode, calm and legible, business-normal
tone — this should feel like a well-made internal tool, not a "mission control" console.

Drop-in files (the contract — do not redefine any of this by hand, import and use it):
- `shared/gtmContract.js` — data columns, the label/glossary maps (`ENGINE_MODE_LABELS`,
  `QUEUE_SOURCE_LABELS`, `OUTPUT_TYPE_LABELS`, `SALES_REVIEW_REASON_LABELS`, `IDENTITY_LABELS`,
  `BLOCK_REASON_LABELS`, `STATUS_LABELS_V3`, `costLabel()`), `needsReview()` / `needsReviewAccount()`,
  `parseGates()`, `buttonDisabled()` / `buttonDisabledPhaseC()`, `buttonsForOutput()`,
  `visitorSafeCopy()`, `committeeSummary()`, `resolveQueueTab()` / `resolveMatchKey()`.
- `shared/mockData.js` — sample rows in both queue shapes, ALREADY written in compliant plain
  language (do not rewrite the sample copy — if you add more sample rows, run every string through
  the same rules).
- `server/n8n.js` — `postToN8n()`, `buildApprovalPayload()`, `buildAccountApprovalPayload()`.
- `server/sheets.js` — `readTabCached()`, `readActiveQueue()` (picks the live data source; falls back
  to sample data quietly if the real sheet isn't reachable — see the one honest badge rule above).
- `.env.example`.

## Environment variables
`APP_PASSWORD`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`.

## Data model (internal — never shown to the user this way)
Two possible data sources, chosen by an admin setting. Non-technical operators never see the words
"signal queue" or "account queue" — they just see accounts in a list. **The active source is
whatever `ICP_Config.queue_source` says — read it, never assume.** For the CURRENT deployment expect
`signal_queue` first; the app must fully support `account_queue` but must not assume it's active, and
must render an empty account queue gracefully ("No accounts yet — whole-company scoring hasn't
started writing here") rather than looking broken. When the account view IS active, one row per
account:
identity (`identity_resolution`, `match_confidence`) → render via `IDENTITY_LABELS`; the decision
(`recommended_output`) → render via `OUTPUT_TYPE_LABELS`, and for "Worth a Look" accounts also render
`sales_review_reason` via `SALES_REVIEW_REASON_LABELS`; five plain-language score dimensions (see
Account Detail below); contact info; cost/credit info via `costLabel()`; and the six operator fields
(who approved what, when, why, and what happened).
**Known gap to design around:** the classic per-visit data source currently has no engine writing to
it. If an admin ever switches to it and it's empty, show: "No activity yet in this view — the system
that fills it isn't running right now." Never show a blank table with no explanation.

## The four actions (server-side; the operator only ever sees a button, never the mechanism)
- **Approve a call, email, or LinkedIn message** — sends the approval to the engine. Voice really
  dials (if it's allowed — see Settings). Email/LinkedIn are logged, not sent (see rule #5).
- **Reject / Not a fit, Keep nurturing, Send for a closer look, Block this contact** — records your
  decision, no outreach happens.
- **Notify the account owner** (used for "Already Being Worked" and "Notify Account Owner" types) —
  logs an internal note; does not write to any CRM yet.
- **Add to ads audience** (used for "Add to Ads Audience" type only) — marks the account; does not
  push to an ad platform yet.
- **Settings changes** (turn sending on/off, turn US calling on/off, switch data source) — described
  in the Settings view below.
Every write always includes who did it, when, and why (required reason field).

## Status labels — use `STATUS_LABELS_V3` verbatim, never invent your own phrasing
| Internal result | What the operator sees |
|---|---|
| call placed | "Call placed." |
| email approved | "Approved. We don't have an email-sending tool connected yet, so no email went out — this is logged and ready for when one is connected." |
| LinkedIn approved | "Approved. We don't have a LinkedIn tool connected yet, so no message went out — logged for later." |
| owner alert | "Logged for the account owner. (No CRM is connected yet.)" |
| marked for ads | "Added to the retargeting list. (No ad platform connected yet — this is a marker for later.)" |
| blocked | Use `BLOCK_REASON_LABELS` — always explain WHY in one plain sentence, never just "blocked". |

## Buttons — enable/disable, described in plain language
- If sending is off (Review Mode / Paused) → ALL send buttons are disabled with a visible banner
  using `ENGINE_MODE_LABELS[mode].detail` verbatim. Decisions (reject/nurture/block/send for review)
  stay enabled — reviewing never requires sending to be on.
- Call button disabled + "Calling US contacts isn't turned on yet — see Settings" whenever US voice
  isn't cleared. This is the single most important disabled state in the app — never let it look like
  a generic greyed-out button; always show the reason inline, not just on hover.
- "Already Being Worked", "Notify Account Owner", "Add to Ads Audience", and "Blocked — Do Not
  Contact" accounts show **no outreach buttons at all** — only their one correct action (notify owner
  / add to ads / view reason). Don't grey out outreach buttons on these — don't show them.
- Sample-data rows get a small, calm "Sample data" badge — not an alarming "TEST" stamp, not part of
  the page identity.
- Every button opens a confirmation step before it does anything: plain sentence of what will
  actually happen (pull from `STATUS_LABELS_V3` in future tense — "This will place a call to..." /
  "This will log an approval — no email will actually be sent yet, since no email tool is
  connected."), the cost line from `costLabel()`, and a required "why are you doing this" text field.

## Five views

**1. Dashboard — "What needs my attention today?"**
A calm status line at the top (not a console-style banner): use `ENGINE_MODE_LABELS[mode].label` +
`.detail` in one sentence, e.g. "Review Mode — you can review and approve accounts, but nothing is
sent yet." Then plain counts: "Ready for Sales", "Worth a Look", "Already Being Worked", "Notify
Account Owner", "Not Ready Yet", "Add to Ads Audience", "Blocked". A "Needs Your Attention" list
below — same row format as Review Queue (see below), just the top items. A small "Recent Activity"
list pulling from the action log, written entirely through `STATUS_LABELS_V3` — this must never
imply something happened (like a Slack message, or a CRM update) that isn't actually wired up. If
there is genuinely no other integration connected, do not invent example activity for ones that don't
exist (no Slack, no CRM push — only what `STATUS_LABELS_V3` actually covers).

**2. Review Queue — the main work list.**
One row per account. **The recommendation leads the row, visually largest and first** — use
`OUTPUT_TYPE_LABELS[x].label` as a clear colored badge, with `OUTPUT_TYPE_LABELS[x].sub` as a small
caption underneath if useful. The numeric score is small and secondary, never the biggest thing on
the row. Show: company name + domain, `IDENTITY_LABELS[x].label` (how confident we are who this is),
a one-line reason (`why_now`, always run through `visitorSafeCopy`), the recommended next step in
plain words, and a compact "why this status" chip if blocked (via `BLOCK_REASON_LABELS`) or "will
this cost anything" chip (via `costLabel`). Search and filter by company name, by recommendation
type (plain labels, not internal enum values), and by whether it needs your attention.

**3. Account Detail — "Why this recommendation, and what happens if I act on it?"**
Open from any row. Sections, all in plain language:
- **About this account** — name, domain, region, `IDENTITY_LABELS[x]` with its full `.detail`
  sentence (this is the most important sentence on the page — get it right, always via
  `visitorSafeCopy`).
- **What led here** — a short activity history in plain sentences ("Visited our pricing page",
  "Company matched an industry we target", "Someone from this company opened a form"), sourced from
  the underlying events but described as bullet points, not a raw table.
- **Why we're recommending this** — the `why_now` sentence, and for "Worth a Look" accounts, the
  specific reason from `SALES_REVIEW_REASON_LABELS`.
- **How this account scores** (5 plain questions, not 5 abstract numbers):
  "How well do they match who we sell to?" (fit) · "How interested do they seem?" (interest) ·
  "How confident are we who this is?" (identity) · "Can we actually reach them?" (actionability) ·
  "How fresh is this?" (timing). Show each as a simple bar or rating, with the raw number available
  on hover for power users only.
- **People** — the recommended contact first, clearly labelled "Recommended contact", with their
  `IDENTITY_LABELS` confidence tag; you (the operator) can pick a different contact from the list if
  one is shown; other known people at the company listed below, each tagged the same way.
- **What this would cost** — one line from `costLabel()`.
- **Take action** — the buttons for this account's type only (see Buttons above), each opening the
  plain-language confirmation step. If a button is disabled, the reason is visible right on the
  button, not hidden in a tooltip.
- **What happened on the call** (only if a call has already happened) — plain summary of buyer
  interest, next step, and priority, in sentences, not a data table.

**4. Test Signal → rename to "Try a Sample Lead".**
Purpose, stated plainly at the top: "Send a made-up example lead through the system to see how it
gets scored and what shows up in the queue. This safely writes a real test row — it does not contact
anyone." Presets, plain-labelled: "A person from a US company visits our site", "A company in Europe
visits our site (no name, just the company)", "A company in Europe visits and we find a likely
contact", "Someone browses anonymously", "A known contact from our CRM engages", "One of our own team
members (should get blocked)", "A visitor with a personal email address (should not become a company
lead)". This actually sends the sample to the real engine (not a local-only simulation) — after
firing, link straight to where the resulting account will show up in the Review Queue.

**5. Settings → keep as "Settings", not "System Config".**
Plain sections:
- **Is sending turned on?** Three states shown as `ENGINE_MODE_LABELS` cards with full detail
  sentences, not just short labels — the operator should understand exactly what each choice means
  before clicking it. Confirmation required before switching.
- **Which scoring is active?** Admin-only section, `QUEUE_SOURCE_LABELS`, plainly explained — most
  operators will never touch this; visually de-emphasize it compared to the sending toggle.
- **US calling permission.** Explain plainly: "US law requires us to have clear permission before an
  AI system calls someone in the US. Legal needs to confirm this before we turn it on." Show
  locked/unlocked state clearly. To turn on: require typing the exact confirmation phrase shown on
  screen (keep the type-to-confirm mechanic — it's a good safety speed bump) — button labeled
  "Confirm and turn on US calling", never "Clear Gate" or similar jargon.
- **Do-not-contact list** — plain table of who/what is blocked and why, pulled from the suppression
  list.

## Safety rules (block or clearly warn, always in plain language via the label maps above)
Our own company's email/domain · anyone on the do-not-contact list · a US call before calling is
turned on · a call with no valid phone number · an EU email/call without permission on file · an
account with a known owner (offer "notify the owner" instead of reaching out ourselves) · sending
turned off for any outreach action · any outreach button showing up on an account type that should
never get direct outreach (already-being-worked, notify-owner, ads-only, blocked).

## Preconfigured connections (use these EXACT values — they come from the live n8n workflows)
Everything below is already deployed and verified reachable. Do not invent placeholders; wire these:

| Variable | Value | Where it goes |
|---|---|---|
| `N8N_BASE_URL` | `https://n8n.aiexperiments.eu` | Replit Secrets |
| `GOOGLE_SHEET_ID` | `1GDZXumXH_usoxhv4vCjuhSeQMOp0m2aQponcAy3jTgI` | Replit Secrets |
| `N8N_WEBHOOK_SECRET` | `bd5d56de3765349bd7379129d8bae7d6` | Replit Secrets (must equal `ICP_Config.webhook_secret`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (Mihai provides — service account must be shared on the sheet as Viewer) | Replit Secrets |
| `APP_PASSWORD` | (Mihai chooses) | Replit Secrets |

Webhook paths (relative to `N8N_BASE_URL`, all POST, all via the Express server with the
`x-gtm-secret` header — never from the browser): `/webhook/gtm-activate`, `/webhook/gtm-decision`,
`/webhook/gtm-action`, `/webhook/gtm-config`, `/webhook/icp-account-shadow` (Try a Sample Lead ONLY —
never post test signals to `/webhook/icp-signal-intake`).

**Settings must include a Connection Status panel** showing, in plain language: "Live data: connected
/ using sample data" (did the Google Sheet read succeed), "Automation engine: reachable / not
reachable" (can the server reach `N8N_BASE_URL`), and the result of the last action sent. This is how
a non-technical operator knows whether they're looking at real data — never leave them guessing.

**Operational prerequisites the app should surface, not hide:** "Try a Sample Lead" only produces a
visible queue row when the shadow engine workflow is active in n8n AND `account_queue_write` is on —
if a sample lead is fired while writing is off, tell the operator plainly: "Sample sent. Queue
writing is currently off, so it won't appear in the list — turn it on in Settings to see results."

## Design system (DRUID tokens — follow exactly, no improvisation)
Dark mode default with a light-mode toggle (`[data-theme="light"]`).
- **Colors (dark):** page `#0a0f0d` · card `#111816` · border `#1f2924` · input/muted `#1a2220` ·
  primary green `#00e676` (hover `#00c853`, dark text `#0a0f0d` on green) · body text `#ffffff` ·
  muted text `#9ca3af` · destructive `#ef4444` · focus ring `#00e676`.
- **Colors (light):** page `#f5f7f6` · card `#ffffff` · border `#dde0e6` · text `#1a1a1a` · muted
  `#6b7280` · primary `#00c158`.
- **Status colors:** always Tailwind opacity variants, never solid fills — e.g. success
  `bg-[#00e676]/20 text-[#00e676] border-[#00e676]/50`; warn `bg-orange-500/20 text-orange-400
  border-orange-500/30`; error `bg-red-500/20 text-red-400 border-red-500/30`; info
  `bg-blue-500/20 text-blue-400 border-blue-500/30`. Map output-type badges onto this system
  (Ready for Sales = success-green family, Worth a Look = yellow/amber, Already Being Worked = blue,
  Notify Account Owner = teal or purple from the same opacity pattern, Blocked = red, Not Ready =
  muted gray).
- **Typography:** Inter (body; 400/500/600) + Plus Jakarta Sans (headings; 500–800), loaded from
  Google Fonts (`family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800`).
  Headings `font-display tracking-tight`; body `font-sans antialiased`; card titles `text-xl
  font-semibold font-display`; section labels `text-xs font-semibold uppercase tracking-wider
  text-primary`; helper text `text-[11px] text-muted-foreground`.
- **Radius:** base 12px (`rounded-lg`/`rounded-xl`) for buttons, inputs, cards; `rounded-2xl` (16px)
  for modals/drawers; `rounded-full` for pills/badges.
- **Cards:** `rounded-xl border border-border bg-card shadow-sm`; header/content padding `p-6`
  (dense variants `p-5`); primary-accent variant uses `border-l-4 border-l-primary`.
- **Buttons:** primary = solid green with `shadow-lg shadow-primary/20`, `h-11 px-6 rounded-lg
  font-semibold active:scale-[0.98]`, hover `#00c853`; outline = `border-2 border-border
  bg-transparent hover:border-primary hover:text-primary`.
- **Spacing:** 4px grid; standard card grid gap 24px (`gap-6`); form stacks 16px (`space-y-4`).
- Serious internal-ops feel, calm and dense-but-legible — this is a DRUID product surface, and it
  should be visually indistinguishable in style from other DRUID internal apps.

## Build order
1. Sample data, all five views, fully readable end to end using ONLY the plain-language labels above
   — no field names, no raw enum values anywhere on screen. Prove it: a "Worth a Look" account shows
   its plain reason sentence; a US "Ready for Sales" account shows the call button disabled with the
   plain calling-permission sentence; an unconfirmed-identity account never claims a person visited.
2. Real Google Sheets connection, with the one honest "using sample data" badge as the only fallback
   signal — no broader "sandbox" identity anywhere.
3. The four write actions, cheapest first (notify account owner), confirmed round-trip before wiring
   the rest.
4. Confirmation steps + required reason field + status update after action.
5. Settings writes, then Try a Sample Lead last (it reaches the real engine).

## Acceptance checks
- A brand-new visitor reading only the screen — no engineering background — can explain back what
  each button does and why a greyed-out button is greyed out, without asking anyone.
- No sentence anywhere claims a specific unnamed/unconfirmed person did something.
- No status ever says or implies "sent" for an action that only logged.
- The recommendation type is the first, largest thing on every account row — never the score.
- Turning sending off (Review Mode/Paused) visibly disables every send button with a plain sentence
  explaining why, immediately, no page reload needed to understand it.
- Sample data is labelled honestly and small — the whole app never brands itself as a simulator.
- No word from the banned list (webhook, JSON, payload, endpoint, gate, TCPA-unexplained, sandbox,
  simulator, synthetic, mock-as-identity) appears anywhere in rendered text.
