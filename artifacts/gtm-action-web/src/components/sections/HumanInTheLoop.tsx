import { SectionHeading } from "@/components/ui/SectionHeading";

const FORWARD_ACTIONS = ["Notify owner", "Pipeline assist", "Sales review", "Prepare outreach"];
const HOLD_ACTIONS = ["Retarget", "Nurture", "Suppress", "No action"];

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
          eyebrow="Human control"
          title="Automation should reduce busywork, not remove judgment."
          description={
            <>
              <p>
                The system can recommend what should happen next, but a person remains in control
                when the decision could affect a prospect, customer, account owner or active
                opportunity.
              </p>
              <p className="mt-4 text-lg font-medium text-white">
                The objective is not to automate every action. It is to make the next decision
                easier, faster and better informed.
              </p>
            </>
          }
        />

        {/* Decision-routing visual */}
        <div className="mt-16">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-5 py-2.5 text-base font-medium text-amber-200">
              Human review where needed
            </div>
          </div>

          <svg
            aria-hidden="true"
            viewBox="0 0 100 34"
            preserveAspectRatio="none"
            className="mx-auto mt-2 h-16 w-full max-w-3xl sm:h-20"
          >
            <path
              d="M50 0 C50 16, 22 12, 22 32"
              stroke="#fbbf24"
              strokeWidth={0.6}
              fill="none"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M50 0 C50 16, 78 12, 78 32"
              stroke="#fbbf24"
              strokeWidth={0.6}
              fill="none"
              opacity={0.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="mx-auto grid max-w-3xl gap-10 sm:grid-cols-2">
            <div className="text-center sm:text-left">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-cyan-200/80">
                Move the account forward
              </h3>
              <ul className="space-y-3">
                {FORWARD_ACTIONS.map((action) => (
                  <li
                    key={action}
                    className="border-b border-cyan-400/15 pb-3 text-base font-medium text-cyan-100 last:border-b-0"
                  >
                    {action}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-center sm:text-left">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
                Hold or step back
              </h3>
              <ul className="space-y-3">
                {HOLD_ACTIONS.map((action) => (
                  <li
                    key={action}
                    className="border-b border-white/10 pb-3 text-base font-medium text-white/75 last:border-b-0"
                  >
                    {action}
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
