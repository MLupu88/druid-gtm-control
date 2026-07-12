import { SectionHeading } from "@/components/ui/SectionHeading";

const STEPS = [
  {
    title: "Listen for meaningful activity",
    description:
      "Collect activity from your website, CRM, campaigns, intent tools, partners and enrichment sources.",
  },
  {
    title: "Build one account picture",
    description:
      "Clean up duplicate activity and combine the available company, person and engagement context around the account.",
  },
  {
    title: "Decide what it probably means",
    description:
      "Check fit, intent, timing, customer status, opportunity context and the strength of the buying activity.",
  },
  {
    title: "Put the right action in front of a person",
    description:
      "Recommend the next step and require review where commercial judgment, consent or compliance matters.",
  },
  {
    title: "Record what happened",
    description:
      "Track the recommendation, the human decision, the action status and the eventual outcome so future decisions have better context.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="overflow-hidden border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[28rem] w-[46rem] -translate-x-1/2 rounded-full bg-cyan-400/[0.06] blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeading
          id="how-it-works-heading"
          eyebrow="How it works"
          title="From scattered activity to a decision someone can use."
        />

        <div className="mt-16 lg:flex lg:items-start lg:gap-10">
          {/* Oversized 5 — a sibling, never forces vertical stacking of the steps */}
          <div className="mb-10 flex items-center gap-4 lg:mb-0 lg:flex-shrink-0 lg:flex-col lg:items-start lg:gap-2">
            <span className="bg-gradient-to-b from-cyan-300 to-violet-400 bg-clip-text text-7xl font-bold leading-none text-transparent sm:text-8xl">
              5
            </span>
            <span className="text-sm font-semibold uppercase tracking-wide text-white/40">
              steps, start to finish
            </span>
          </div>

          {/* Timeline */}
          <div className="relative flex-1">
            <div
              aria-hidden="true"
              className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-cyan-400/60 via-white/15 to-violet-400/40 lg:left-0 lg:right-0 lg:top-4 lg:bottom-auto lg:h-px lg:w-auto lg:bg-gradient-to-r"
            />

            <ol className="relative space-y-10 lg:grid lg:grid-cols-5 lg:gap-6 lg:space-y-0">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative pl-10 lg:pl-0">
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-cyan-300 bg-navy-900 text-sm font-semibold text-cyan-200 lg:relative lg:mb-4"
                  >
                    {index + 1}
                  </span>
                  <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-white/70">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
