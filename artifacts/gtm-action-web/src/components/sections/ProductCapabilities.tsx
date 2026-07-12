import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const AVAILABLE = [
  "Multi-source signal intake",
  "Signal normalization",
  "Account-level aggregation",
  "Deduplication and replay protection",
  "ICP and intent scoring",
  "Recommended GTM outcome",
  "Sales review queue",
  "Owner alerts",
  "Pipeline-assist recommendations",
  "Nurture and retargeting recommendations",
  "Suppression and consent gates",
  "Human approval",
  "Decision and action logs",
  "Recommend-only operating mode",
  "Campaign attribution fields",
  "Sample and test signal workflows",
  "Protected n8n control plane",
];

const IN_DEVELOPMENT = [
  "Sales-acceptance capture: who accepted, when, and the agreed next step",
  "Campaign reports",
  "PDF campaign export",
  "CSV action export",
  "Current month versus previous month",
  "Cost-per-action reporting",
  "Clearer health and integration status",
  "Improved server-derived operator identity",
  "Better demo and sample data",
  "Account Shadow payload reliability improvements",
];

const PLANNED = [
  "On-demand company research",
  "Evidence-backed account brief",
  "Company AI stack and maturity signals",
  "Product-fit hypothesis",
  "Relevant use-case mapping",
  "Likely operational pain points",
  "Target persona suggestions",
  "Recommended conversation angle",
  "Source evidence and confidence",
  '"Ask about fit" analyst chat',
  "Apply selected findings to the account record",
  "Preserve the original signal while enriching the account picture",
  "Audit trail for who requested and applied the enrichment",
];

type ColumnTone = "cyan" | "amber" | "violet";

const TONE_CLASSES: Record<ColumnTone, string> = {
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  violet: "border-violet-400/30 bg-violet-400/10 text-violet-200",
};

const COLUMNS: {
  id: string;
  label: string;
  items: string[];
  tone: ColumnTone;
  note?: string;
}[] = [
  { id: "available", label: "Available now", items: AVAILABLE, tone: "cyan" },
  {
    id: "in-development",
    label: "In development",
    items: IN_DEVELOPMENT,
    tone: "amber",
    note: "Listed here until functionally verified as management-ready, even where code has already landed.",
  },
  {
    id: "planned",
    label: "Planned — Client Radar",
    items: PLANNED,
    tone: "violet",
  },
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
          eyebrow="Product capabilities"
          title="What's available, what's in development, and what's planned"
          description="Stated honestly in three states, so no visitor mistakes a planned feature for a live one."
        />

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {COLUMNS.map((column) => (
            <Card key={column.id}>
              <h3
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                  TONE_CLASSES[column.tone],
                )}
              >
                {column.label}
              </h3>
              <ul className="mt-4 space-y-2">
                {column.items.map((item) => (
                  <li key={item} className="text-sm leading-relaxed text-white/70">
                    {item}
                  </li>
                ))}
              </ul>
              {column.note && (
                <p className="mt-4 border-t border-white/10 pt-4 text-xs italic text-white/40">
                  {column.note}
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
