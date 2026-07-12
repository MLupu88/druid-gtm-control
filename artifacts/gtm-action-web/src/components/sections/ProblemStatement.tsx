import { SectionHeading } from "@/components/ui/SectionHeading";
import { Card } from "@/components/ui/Card";
import { Check, X } from "lucide-react";

const BEFORE = [
  "Isolated signals treated as if each one proves intent on its own",
  "Duplicate records across tools inflating the apparent lead count",
  "Weak-fit leads that pass a form-fill threshold but not a commercial one",
  "No CRM context to confirm the signal is connected to a real account",
  "Sales rejects most MQLs, and the rejection is rarely fed back",
];

const AFTER = [
  "Account-level context that ties every signal back to a real buyer",
  "Combined signals assessed together, not counted one at a time",
  "Customer and opportunity checks before anything is labelled a lead",
  "An explicit \"why now\" for every recommended action",
  "Human approval before an action reaches sales or a prospect",
  "Recorded sales acceptance, not just a marketing-assigned score",
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
          title="A click is not an MQL. A form fill is not always an opportunity."
        />

        <div className="mt-8 max-w-3xl space-y-4 text-base leading-relaxed text-white/70">
          <p>
            Most GTM systems count isolated actions — a form fill, an ad click, a page visit, a
            webinar registration, a CRM contact, an anonymous visit — as if each one, alone,
            proves that sales should act. None of them do.
          </p>
          <p className="text-lg font-medium text-white">
            The problem is not a shortage of signals. The problem is deciding which combinations
            of signals justify commercial action.
          </p>
          <p>GTM Action Web is the governed layer between signal collection and execution.</p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Card>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
              Before
            </h3>
            <ul className="space-y-3">
              {BEFORE.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-white/70">
                  <X aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="border-cyan-400/20 bg-cyan-400/[0.03]">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-cyan-200/80">
              After
            </h3>
            <ul className="space-y-3">
              {AFTER.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-white/80">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
