import { Button } from "@/components/ui/Button";
import { SignalWebPlaceholder } from "@/components/signal-web/SignalWebPlaceholder";
import { GTM_APP_URL, WALKTHROUGH_MAILTO } from "@/lib/config";

export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="relative overflow-hidden border-b border-white/10 px-4 pb-20 pt-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-cyan-300/80">
            A human-governed signal-to-action system for B2B growth teams
          </p>
          <h1 id="hero-heading" className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Turn scattered buying signals into sales-approved action.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
            GTM Action Web connects website activity, CRM context, campaign engagement, account
            intelligence, and enrichment signals into one shared account picture. It recommends
            the most appropriate next action — and keeps a human in control of what is approved,
            suppressed, nurtured, exported, or sent to sales.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button href={GTM_APP_URL} variant="primary">
              Go to the app
            </Button>
            {WALKTHROUGH_MAILTO && (
              <Button href={WALKTHROUGH_MAILTO} variant="secondary">
                Request a walkthrough
              </Button>
            )}
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium text-white/70 underline-offset-4 hover:text-cyan-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              See how it works
            </a>
          </div>
        </div>

        <SignalWebPlaceholder />
      </div>
    </section>
  );
}
