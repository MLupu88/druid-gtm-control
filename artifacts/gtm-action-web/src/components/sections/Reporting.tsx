import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";

const REPORTING_ITEMS = [
  "Campaign summary",
  "Signals by source",
  "Accounts requiring attention",
  "Recommended actions",
  "Human decisions",
  "Sales acceptance",
  "Action status",
  "Estimated or imported costs",
  "Month-over-month comparison",
  "PDF campaign export",
  "CSV action export",
  "Assumptions and data limitations",
];

export function Reporting() {
  return (
    <section
      id="reporting"
      aria-labelledby="reporting-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="reporting-heading"
          eyebrow="Reporting"
          title="See what happened, what was approved, and what it cost."
        />

        <Card className="mt-10">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REPORTING_ITEMS.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-white/70">
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <p className="mt-6 max-w-3xl text-xs italic text-white/40">
          Reporting language is deliberate: logged, prepared, approved, exported, sent, and
          completed. Never executed or delivered without downstream confirmation.
        </p>
      </div>
    </section>
  );
}
