import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type ChipTone = "cyan" | "red" | "amber" | "grey" | "violet";

const DECISION_CHIPS: { label: string; tone: ChipTone }[] = [
  { label: "Approve", tone: "cyan" },
  { label: "Reject", tone: "red" },
  { label: "Suppress", tone: "red" },
  { label: "Send to sales review", tone: "amber" },
  { label: "Notify owner", tone: "grey" },
  { label: "Nurture", tone: "grey" },
  { label: "Retarget", tone: "grey" },
  { label: "Prepare outreach", tone: "grey" },
  { label: "Request enrichment", tone: "violet" },
];

const TONE_CLASSES: Record<ChipTone, string> = {
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  red: "border-red-400/30 bg-red-400/10 text-red-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  grey: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  violet: "border-violet-400/30 bg-violet-400/10 text-violet-200",
};

export function HumanInTheLoop() {
  return (
    <section
      id="human-in-the-loop"
      aria-labelledby="human-in-the-loop-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="human-in-the-loop-heading"
          eyebrow="Human in the loop"
          title="Automation recommends. People decide."
          description="Every recommendation explains what was observed, why the action is suggested, what policy checks applied, and whether execution actually occurred."
        />

        <Card className="mt-10">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Decisions available at the review gate
          </h3>
          <ul className="flex flex-wrap gap-2">
            {DECISION_CHIPS.map((chip) => (
              <li
                key={chip.label}
                className={cn("rounded-full border px-4 py-1.5 text-sm", TONE_CLASSES[chip.tone])}
              >
                {chip.label}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
