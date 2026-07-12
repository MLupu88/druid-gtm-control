import { SectionHeading } from "@/components/ui/SectionHeading";

const CONNECTED = ["Website and forms", "Manual and CSV imports", "Google Sheets", "n8n"];

const ONE_STEP_FURTHER = [
  { label: "RB2B", status: "webhook" },
  { label: "Dealfront", status: "webhook" },
  { label: "PostHog", status: "webhook" },
  { label: "AI-assisted activity interpretation", status: "webhook" },
  { label: "Salesforge", status: "webhook" },
  { label: "HubSpot", status: "manual export" },
  { label: "Paid media", status: "manual export" },
  { label: "LinkedIn export (via Dripify)", status: "manual export" },
  { label: "Google Ads audiences", status: "manual export" },
  { label: "LinkedIn Ads audiences", status: "manual export" },
];

const FURTHER_OUT = [
  { label: "Cognism", status: "waiting on access" },
  { label: "On-demand account research", status: "planned" },
  { label: "Retell", status: "pending approval" },
  { label: "Data platform", status: "pending approval" },
  { label: "Single sign-on", status: "pending approval" },
];

export function ConnectedEcosystem() {
  return (
    <section
      id="ecosystem"
      aria-labelledby="ecosystem-heading"
      className="overflow-hidden border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/3 h-[24rem] w-[24rem] rounded-full bg-violet-500/[0.08] blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl">
        <SectionHeading
          id="ecosystem-heading"
          eyebrow="Ecosystem"
          title="Designed to work with the tools already in your GTM stack."
          description="Some sources connect directly today. Others work through webhook contracts, manual imports or exports while production access is being added."
        />

        <div className="relative mt-16">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-4 hidden h-px bg-gradient-to-r from-cyan-400/50 via-white/10 to-transparent sm:block"
          />

          <div className="space-y-12">
            <div>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-cyan-400" />
                <h3 className="text-base font-semibold text-cyan-200">Closest to the product</h3>
                <span className="text-sm text-white/40">— connected today</span>
              </div>
              <ul className="flex flex-wrap gap-3 pl-0 sm:pl-6">
                {CONNECTED.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-base font-medium text-cyan-100"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="sm:pl-14">
              <div className="mb-4 flex items-baseline gap-3">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-white/40" />
                <h3 className="text-base font-medium text-white/70">One step further</h3>
                <span className="text-sm text-white/35">— webhook or manual today</span>
              </div>
              <ul className="flex flex-wrap gap-2.5 pl-0 sm:pl-6">
                {ONE_STEP_FURTHER.map((tool) => (
                  <li
                    key={tool.label}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-sm text-white/60"
                  >
                    {tool.label}
                    <span className="ml-1.5 text-white/30">· {tool.status}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="opacity-70 sm:pl-28">
              <div className="mb-4 flex items-baseline gap-3">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/25" />
                <h3 className="text-sm font-medium text-white/45">Further out</h3>
              </div>
              <ul className="flex flex-wrap gap-2 pl-0 sm:pl-6">
                {FURTHER_OUT.map((tool) => (
                  <li
                    key={tool.label}
                    className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-white/40"
                  >
                    {tool.label}
                    <span className="ml-1.5 text-white/25">· {tool.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
