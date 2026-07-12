import { SectionHeading } from "@/components/ui/SectionHeading";

const AVAILABLE_THEMES = [
  {
    theme: "Understanding each account",
    items: [
      "Activity collected from multiple sources",
      "Cleaned up, de-duplicated and combined at the account level",
      "Fit and buying-activity assessment",
    ],
  },
  {
    theme: "Deciding and routing",
    items: [
      "A recommended next action, with an option to recommend only",
      "A queue for sales review, plus account owner alerts",
      "Recommendations to help open opportunities, nurture, or retarget accounts",
      "Suppression and consent checks",
    ],
  },
  {
    theme: "Staying in control",
    items: [
      "A person approves before anything moves forward",
      "A record of every decision and action",
      "Campaign attribution fields",
      "Sample activity for testing the workflow",
      "A protected internal workflow engine",
    ],
  },
];

const IN_DEVELOPMENT = [
  "Recording who accepted an action, when, and what was agreed",
  "Campaign and cost-per-action reporting, including month-over-month comparison",
  "Exportable campaign and action data (PDF and CSV)",
  "Clearer status for each connected source",
  "Better tracking of who reviewed each recommendation",
  "Better demo and sample data",
  "More reliable delivery of account data behind the scenes",
];

const PLANNED = [
  "On-demand company research with an evidence-backed account brief",
  "Signals about a company's technology maturity",
  "A hypothesis for why the product fits, with relevant use cases and likely pain points",
  "Target persona and conversation-angle suggestions",
  "Supporting evidence and confidence level",
  "A chat to ask questions about account fit",
  "Apply selected findings to the account record without losing the original activity",
  "A record of who requested and applied each enrichment",
];

export function ProductCapabilities() {
  return (
    <section
      id="capabilities"
      aria-labelledby="capabilities-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="capabilities-heading"
          eyebrow="Capabilities"
          title="A practical decision layer between your account activity and your GTM teams."
          description="GTM Action Web does not replace your CRM, campaign tools or sales systems. It helps them work from a clearer account picture and a more useful next-action decision."
        />

        {/* Available today — dominant */}
        <div className="mt-16">
          <span className="inline-flex rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-cyan-200">
            Available today
          </span>

          <div className="mt-8 grid gap-x-10 gap-y-10 lg:grid-cols-3">
            {AVAILABLE_THEMES.map((group) => (
              <div key={group.theme}>
                <h3 className="text-lg font-semibold text-white">{group.theme}</h3>
                <ul className="mt-4 space-y-3 border-l-2 border-cyan-400/25 pl-5">
                  {group.items.map((item) => (
                    <li key={item} className="text-base leading-relaxed text-white/75">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* In development — secondary */}
        <div className="mt-16 border-l-2 border-amber-400/30 pl-6">
          <span className="text-sm font-semibold uppercase tracking-wide text-amber-300/80">
            In development
          </span>
          <p className="mt-1 max-w-2xl text-sm italic text-white/35">
            Shown here until it's confirmed reliable enough for daily use, even if the underlying
            code already exists.
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            {IN_DEVELOPMENT.map((item) => (
              <li key={item} className="text-sm text-white/55">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Planned — subdued */}
        <div className="mt-10 border-l-2 border-violet-400/20 pl-6">
          <span className="text-xs font-semibold uppercase tracking-wide text-violet-300/60">
            Planned
          </span>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/35">
            {PLANNED.join(" · ")}
          </p>
        </div>
      </div>
    </section>
  );
}
