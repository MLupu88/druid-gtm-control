import { SectionHeading } from "@/components/ui/SectionHeading";
import { Check, ArrowRight } from "lucide-react";

const CHECKS = [
  "The account fits the target market",
  "The activity is commercially meaningful",
  "The account or person can be identified",
  "Customer and open-opportunity conflicts have been checked",
  "There is a clear reason to act now",
  "An owner or reviewer accepts the proposed next step",
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
          eyebrow="A better MQL"
          title="An MQL should count only when sales accepts the next step."
        />

        <div className="mt-6 max-w-3xl text-lg leading-relaxed text-white/70">
          <p>
            A marketing-qualified lead, or MQL, often tells sales that someone did something. It
            does not always explain whether the account is worth pursuing, why the timing matters
            or what sales should do next.
          </p>
        </div>

        {/* Qualification gate sequence */}
        <div className="relative mt-16">
          <p className="mb-8 text-sm font-semibold uppercase tracking-wide text-white/40">
            What an account passes through
          </p>

          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-[52px] hidden h-px bg-gradient-to-r from-cyan-400/50 via-cyan-400/25 to-transparent sm:block"
          />

          <div className="grid gap-8 sm:grid-cols-3 lg:grid-cols-6">
            {CHECKS.map((check) => (
              <div key={check} className="relative flex flex-col items-start gap-3">
                <span className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-cyan-400/50 bg-navy-900 text-cyan-200">
                  <Check aria-hidden="true" className="h-4 w-4" />
                </span>
                <p className="text-base leading-snug text-white/80">{check}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <ArrowRight aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-cyan-300" />
            <span className="rounded-full border border-cyan-400/50 bg-cyan-400/10 px-5 py-2 text-base font-semibold text-cyan-100">
              Sales-ready recommendation
            </span>
          </div>

          <p className="mt-10 max-w-2xl text-xl font-semibold text-cyan-200">
            The result is not simply another marketing score. It is a reasoned recommendation that
            sales can accept, reject or redirect.
          </p>
        </div>
      </div>
    </section>
  );
}
