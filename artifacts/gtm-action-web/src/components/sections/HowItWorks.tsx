import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";

const STEPS = [
  {
    title: "Listen",
    description:
      "Collect signals from website, CRM, intent, campaign, partner, and enrichment sources.",
  },
  {
    title: "Build the account picture",
    description: "Normalize, deduplicate, enrich, and combine activity at the account level.",
  },
  {
    title: "Decide what it means",
    description:
      "Assess ICP fit, intent, timing, buying context, route to action, and disqualifiers.",
  },
  {
    title: "Keep a human in control",
    description:
      "Recommend the next action, but require human review where commercial or compliance judgment matters.",
  },
  {
    title: "Act and learn",
    description:
      "Prepare or route the approved action, record the outcome, and use it in campaign and account reporting.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="how-it-works-heading"
          eyebrow="How it works"
          title="How the Action Web works"
        />

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/30 text-sm font-semibold text-cyan-200">
                  {index + 1}
                </span>
                <h3 className="text-base font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">{step.description}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
