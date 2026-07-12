import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  {
    label: "Conservative impact",
    range: "10–15% lower",
    interpretation:
      "Achieved mainly through better filtering — weak-fit signals stop reaching sales before they cost anyone time.",
    emphasized: false,
  },
  {
    label: "Target impact",
    range: "20–30% lower",
    interpretation:
      "The planning range once account-level context and human review are applied consistently.",
    emphasized: true,
  },
  {
    label: "High-impact result",
    range: "30–40% lower",
    interpretation:
      "Realistic where signal coverage is weak today and lead-quality problems are already substantial.",
    emphasized: false,
  },
];

export function ValueImpact() {
  return (
    <section
      id="value-impact"
      aria-labelledby="value-impact-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="value-impact-heading"
          eyebrow="Value impact"
          title="The goal is not more MQLs. It is less waste per sales-approved opportunity."
        />

        <Card className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">
            Your current cost per sales-accepted lead
          </p>
          <p className="mt-1 text-xs text-white/40">
            Shown here at an illustrative €500 example — not a recommended or default baseline.
          </p>

          <div className="mt-4" aria-hidden="true">
            <div className="relative h-2 rounded-full bg-white/10">
              <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" />
              <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-white" />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/40">
            <span>€100</span>
            <span className="font-medium text-white/70">€500 (example)</span>
            <span>€2,000</span>
          </div>
        </Card>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {SCENARIOS.map((scenario) => (
            <Card
              key={scenario.label}
              className={cn(
                scenario.emphasized &&
                  "border-cyan-400/40 bg-gradient-to-b from-cyan-400/10 to-violet-500/10",
              )}
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-white/50">
                {scenario.label}
              </h3>
              <p className="mt-3 text-3xl font-semibold text-white">{scenario.range}</p>
              <p className="mt-1 text-xs text-white/40">per sales-accepted lead</p>
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                {scenario.interpretation}
              </p>
            </Card>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-white/60">
          These ranges are directional planning scenarios, not guaranteed outcomes. Actual impact
          depends on media mix, CRM quality, sales acceptance discipline, signal coverage, and
          current lead-quality problems.
        </p>
      </div>
    </section>
  );
}
