import { SectionHeading } from "@/components/ui/SectionHeading";
import { ArrowRight } from "lucide-react";

const BEFORE = [
  "Every new activity is treated like a new lead",
  "Duplicate activity inflates the apparent opportunity",
  "Sales receives MQLs with little commercial context",
  "Customers and open opportunities can enter the wrong journey",
  "Marketing rarely learns why sales rejected a lead",
];

const AFTER = [
  "Activity is combined around the account",
  "CRM, customer and opportunity context is checked first",
  "Every recommendation includes a clear reason",
  "A person can approve, change or reject the proposed action",
  "The outcome becomes part of the account history",
];

export function ProblemStatement() {
  return (
    <section
      id="problem"
      aria-labelledby="problem-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="problem-heading"
          eyebrow="The problem"
          title="Most GTM stacks collect activity. They do not decide what it means."
        />

        <div className="mt-8 max-w-3xl space-y-4 text-base leading-relaxed text-white/70">
          <p>
            A pricing-page visit might matter. So might a form fill, an ad click, a webinar
            registration or a second visit from the same company.
          </p>
          <p>But none of those actions, on its own, tells you whether sales should act.</p>
          <p>
            The useful picture comes from the combination: who the account is, whether it fits
            your market, what it has already done, whether it is already a customer or open
            opportunity, and whether the activity is strong enough to justify a commercial
            response.
          </p>
          <p className="text-lg font-medium text-white">
            The problem is not a shortage of signals. It is knowing which signals deserve action.
          </p>
        </div>

        <div className="mt-16 grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-8">
          {/* Scattered activity */}
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-wide text-white/40">
              Scattered activity
            </p>
            <div className="space-y-4">
              {BEFORE.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/25" />
                  <p className="text-base text-white/50">{item}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Transformation marker */}
          <div className="flex justify-center py-2 lg:py-0">
            <div className="flex flex-shrink-0 items-center justify-center rounded-full border border-cyan-400/50 bg-cyan-400/10 p-4">
              <ArrowRight aria-hidden="true" className="h-6 w-6 rotate-90 text-cyan-200 lg:rotate-0" />
            </div>
          </div>

          {/* One account picture */}
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-wide text-cyan-200/80">
              One account picture
            </p>
            <ul className="space-y-4 border-l-2 border-cyan-400/30 pl-6">
              {AFTER.map((item) => (
                <li key={item} className="relative text-base text-white/85">
                  <span className="absolute -left-[1.72rem] top-2 h-2.5 w-2.5 rounded-full bg-cyan-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
