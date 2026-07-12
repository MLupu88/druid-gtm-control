import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { CheckCircle2 } from "lucide-react";

const GATES = [
  "ICP fit",
  "Meaningful intent",
  "Usable CRM context",
  "Realistic route to action",
  "Governance passed",
  "Explicitly accepted by sales",
];

const METRIC_HIERARCHY = [
  "Cost per Sales-Accepted MQL",
  "Sales-Accepted MQL to opportunity conversion",
  "Cost per qualified opportunity",
  "Pipeline and revenue influenced",
];

export function SalesAcceptedMql() {
  return (
    <section
      id="sales-accepted-mql"
      aria-labelledby="sales-accepted-mql-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="sales-accepted-mql-heading"
          eyebrow="Definition"
          title="What counts as a Sales-Accepted MQL"
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
              The six gates
            </h3>
            <ul className="space-y-3">
              {GATES.map((gate) => (
                <li key={gate} className="flex gap-3 text-sm text-white/80">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-300"
                  />
                  <span>{gate}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 border-t border-white/10 pt-6 text-sm leading-relaxed text-white/70">
              A lead counts as a Sales-Accepted MQL only after sales accepts responsibility for a
              defined next step. A marketing score is not acceptance. Rejected leads do not count.
            </p>

            <p className="mt-6 text-lg font-semibold text-cyan-200">
              Measure what sales accepts — not what marketing labels.
            </p>
          </Card>

          <Card>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
              Preferred metric order
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-white/70">
              The system may initially make traditional MQL cost look worse, because fewer weak
              leads get the label. That is expected — these are the metrics that matter more:
            </p>
            <ol className="space-y-3">
              {METRIC_HIERARCHY.map((metric, index) => (
                <li key={metric} className="flex gap-3 text-sm text-white/80">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-cyan-400/30 text-xs font-semibold text-cyan-200">
                    {index + 1}
                  </span>
                  <span>{metric}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </section>
  );
}
