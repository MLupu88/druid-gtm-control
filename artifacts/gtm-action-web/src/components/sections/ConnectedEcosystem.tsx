import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type GroupTone = "cyan" | "grey" | "amber" | "violet" | "outline";

const GROUPS: { id: string; label: string; items: string[]; tone: GroupTone }[] = [
  {
    id: "connected",
    label: "Connected",
    items: ["Website and forms", "Manual and CSV inputs", "n8n", "Google Sheets"],
    tone: "cyan",
  },
  {
    id: "contract-ready",
    label: "Contract ready",
    items: ["RB2B", "Dealfront", "PostHog", "LLM interpretation", "Salesforge"],
    tone: "grey",
  },
  {
    id: "manual-export",
    label: "Manual export",
    items: [
      "HubSpot",
      "Paid media",
      "LinkedIn export / Dripify workflow",
      "Google Ads audiences",
      "LinkedIn Ads audiences",
    ],
    tone: "amber",
  },
  {
    id: "awaiting-credentials",
    label: "Awaiting credentials",
    items: ["Cognism"],
    tone: "grey",
  },
  {
    id: "planned",
    label: "Planned",
    items: ["Client Radar"],
    tone: "violet",
  },
  {
    id: "post-approval",
    label: "Post-approval",
    items: ["Retell", "Data platform (post-approval)", "SSO (post-approval)"],
    tone: "outline",
  },
];

const TONE_CLASSES: Record<GroupTone, string> = {
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  grey: "border-slate-400/30 bg-slate-400/10 text-slate-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  violet: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  outline: "border-white/20 bg-transparent text-white/60",
};

export function ConnectedEcosystem() {
  return (
    <section
      id="ecosystem"
      aria-labelledby="ecosystem-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="ecosystem-heading"
          eyebrow="Connected ecosystem"
          title="Where signals come from, and how connected each source is"
          description="Conservative, current-state labels — this map does not imply a live integration where one doesn't exist yet. Internal platform and identity products are named generically."
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((group) => (
            <Card key={group.id}>
              <h3
                className={cn(
                  "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                  TONE_CLASSES[group.tone],
                )}
              >
                {group.label}
              </h3>
              <ul className="mt-4 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
