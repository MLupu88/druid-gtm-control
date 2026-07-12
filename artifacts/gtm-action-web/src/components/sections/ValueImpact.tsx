import { SectionHeading } from "@/components/ui/SectionHeading";
import { MqlCostEstimator } from "@/components/estimator/MqlCostEstimator";

export function ValueImpact() {
  return (
    <section
      id="value-impact"
      aria-labelledby="value-impact-heading"
      className="border-b border-white/10 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          id="value-impact-heading"
          eyebrow="Value impact"
          title="What does poor qualification cost you?"
          description="Use your own numbers to estimate how much budget may be tied up in MQLs that sales cannot use."
        />
        <p className="mt-3 text-sm italic text-white/40">
          This is a directional planning tool, not a financial promise.
        </p>

        <MqlCostEstimator />
      </div>
    </section>
  );
}
