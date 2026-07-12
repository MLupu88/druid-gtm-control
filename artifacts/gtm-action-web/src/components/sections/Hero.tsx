import { Button } from "@/components/ui/Button";
import { ActionWebVisual } from "@/components/action-web/ActionWebVisual";
import { HeroBackdrop } from "@/components/action-web/HeroBackdrop";
import { GTM_APP_URL, WALKTHROUGH_MAILTO } from "@/lib/config";

export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="relative overflow-hidden border-b border-white/10 px-4 pb-20 pt-16 sm:px-6 lg:px-8"
    >
      <HeroBackdrop />

      <div className="relative mx-auto max-w-4xl text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-cyan-300/80">
          From buying activity to the right next action
        </p>
        <h1 id="hero-heading" className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
          Know which accounts deserve attention — and what to do next.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
          GTM Action Web connects the activity around an account — what it viewed, which
          campaigns it engaged with, what your CRM already knows, and whether it fits your market
          — then recommends the next move: alert the account owner, help an existing opportunity,
          send it for sales review, retarget it, keep nurturing it, or leave it alone.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
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

      <div className="relative mx-auto mt-14 max-w-7xl">
        <ActionWebVisual />
      </div>
    </section>
  );
}
