const SOURCES = [
  "Website",
  "RB2B",
  "Dealfront",
  "PostHog",
  "HubSpot",
  "Paid media",
  "Forms",
  "Events",
  "Manual lists",
  "Partner signals",
];

const REVIEW_DECISIONS = ["Approve", "Reject", "Suppress", "Nurture", "Retarget", "Send to sales"];

const ACTIONS = [
  "Sales review",
  "Owner alert",
  "Pipeline assist",
  "Retarget",
  "Nurture",
  "Email",
  "LinkedIn export",
  "Voice qualification",
  "Suppress",
];

export function SignalWebPlaceholder() {
  return (
    <figure className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
      <div aria-hidden="true" className="flex flex-col gap-5 lg:grid lg:grid-cols-[1fr_1fr_1fr]">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
            Signal sources
          </p>
          <ul className="flex flex-wrap gap-2">
            {SOURCES.map((source) => (
              <li
                key={source}
                className="rounded-full border border-slate-400/30 bg-slate-400/10 px-3 py-1 text-xs text-slate-200"
              >
                {source}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-blue-400/30 bg-blue-400/10 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-200">
            Account intelligence
          </p>
          <ul className="space-y-1 text-xs text-blue-100/80">
            <li>Fit</li>
            <li>Intent</li>
            <li>Timing</li>
            <li>CRM state</li>
            <li>Committee</li>
            <li>Governance</li>
            <li>Recommended next action</li>
          </ul>

          <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
              Human review gate
            </p>
            <p className="text-xs text-amber-100/80">{REVIEW_DECISIONS.join(" · ")}</p>
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">
            Action, after approval
          </p>
          <ul className="flex flex-wrap gap-2">
            {ACTIONS.map((action) => (
              <li
                key={action}
                className="rounded-full border border-green-400/30 bg-green-400/10 px-3 py-1 text-xs text-green-200"
              >
                {action}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-xs text-white/40">
        Only approved actions move beyond the human review gate. Outcomes return to the account
        picture for reporting and learning.
      </p>

      <figcaption className="sr-only">
        Signal sources — including website activity, RB2B, Dealfront, PostHog, HubSpot, paid
        media, forms, events, manual lists, and partner signals — converge into a single account
        intelligence picture covering fit, intent, timing, CRM state, committee, and governance.
        The system recommends a next action, but nothing proceeds until a human reviews it at the
        human review gate: approve, reject, suppress, nurture, retarget, or send to sales. Only
        after that gate does the action route onward — to sales review, an owner alert, pipeline
        assist, retargeting, nurture, email, LinkedIn export, voice qualification, or suppression —
        and the result feeds back into account reporting.
      </figcaption>
    </figure>
  );
}
