import { Button } from "@/components/ui/Button";
import { GTM_APP_URL, WALKTHROUGH_MAILTO } from "@/lib/config";

export function FinalCta() {
  return (
    <section
      id="final-cta"
      aria-labelledby="final-cta-heading"
      className="px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h2 id="final-cta-heading" className="text-3xl font-semibold text-white sm:text-4xl">
          Stop sending more leads. Start sending better next actions.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
          See how GTM Action Web can turn fragmented buying activity into decisions that marketing
          and sales can actually use.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button href={GTM_APP_URL} variant="primary">
            Go to the app
          </Button>
          {WALKTHROUGH_MAILTO && (
            <Button href={WALKTHROUGH_MAILTO} variant="secondary">
              Request a walkthrough
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
