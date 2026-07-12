import { SectionHeading } from "@/components/ui/SectionHeading";
import { ArrowRight, FileText } from "lucide-react";

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
          title="See what happened after the signal."
          description="The useful question is not only how much activity came in. It is what the system recommended, what a person approved, whether sales accepted it, what happened next and what it cost."
        />

        <div className="mt-16 space-y-16">
          {/* Row 1: text left, visual right */}
          <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-16">
            <div className="lg:w-1/3">
              <h3 className="text-xl font-semibold text-white">
                How much activity came in, and from where?
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:w-2/3">
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-base text-white/75">
                Campaign summary
              </span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-white/25" />
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-base text-white/75">
                Activity by source
              </span>
            </div>
          </div>

          {/* Row 2: visual left, text right */}
          <div className="flex flex-col-reverse items-center gap-8 lg:flex-row lg:gap-16">
            <div className="flex flex-wrap items-center gap-2 lg:w-2/3">
              {["Accounts requiring attention", "Recommended actions", "Human decisions", "Sales acceptance", "Action status"].map(
                (item, i, arr) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/[0.06] px-3.5 py-1.5 text-sm text-cyan-100">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      {item}
                    </span>
                    {i < arr.length - 1 && (
                      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-white/20" />
                    )}
                  </span>
                ),
              )}
            </div>
            <div className="lg:w-1/3">
              <h3 className="text-xl font-semibold text-white">
                What did the system recommend, and what happened next?
              </h3>
            </div>
          </div>

          {/* Row 3: text left, visual right */}
          <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-16">
            <div className="lg:w-1/3">
              <h3 className="text-xl font-semibold text-white">
                What did it cost, and how does it compare?
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:w-2/3">
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-base text-white/75">
                Estimated or imported costs
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-base text-white/75">
                Month-over-month comparison
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-sm text-white/60">
                <FileText aria-hidden="true" className="h-3.5 w-3.5" /> PDF
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-sm text-white/60">
                <FileText aria-hidden="true" className="h-3.5 w-3.5" /> CSV
              </span>
            </div>
          </div>
        </div>

        <p className="mt-6 max-w-3xl text-sm italic text-white/40">
          Reporting language is deliberate: logged, recommended, prepared, approved, exported,
          sent, and completed. Never executed or delivered without downstream confirmation.
          Assumptions and data limitations are always shown alongside the numbers.
        </p>
      </div>
    </section>
  );
}
