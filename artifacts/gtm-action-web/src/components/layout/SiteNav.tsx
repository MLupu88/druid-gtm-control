import { Button } from "@/components/ui/Button";
import { GTM_APP_URL } from "@/lib/config";
import druidLogoWhite from "@/assets/druid-logo-white.png";

const NAV_LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#human-in-the-loop", label: "Human control" },
  { href: "#sales-accepted-mql", label: "A better MQL" },
  { href: "#value-impact", label: "Value impact" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#ecosystem", label: "Ecosystem" },
  { href: "#reporting", label: "Reporting" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-navy-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a href="#top" className="flex flex-shrink-0 items-center gap-2.5">
          <img src={druidLogoWhite} alt="Druid AI" className="h-5 w-auto sm:h-6" />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-wide text-white">GTM Action Web</span>
            <span className="max-w-[10.5rem] text-[11px] font-normal leading-snug text-white/45 sm:max-w-none sm:whitespace-nowrap">
              (a Druid Community GTM &amp; Growth innovation)
            </span>
          </span>
        </a>

        <nav aria-label="Section navigation" className="hidden xl:block">
          <ul className="flex items-center gap-6 text-base text-white/70">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden xl:block">
          <Button href={GTM_APP_URL} variant="primary" className="px-5 py-2 text-sm">
            Go to the app
          </Button>
        </div>

        <details className="relative xl:hidden">
          <summary className="list-none cursor-pointer rounded p-2 text-base font-medium text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">
            Menu
          </summary>
          <nav
            aria-label="Section navigation (mobile)"
            className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-navy-950 p-4 shadow-xl"
          >
            <ul className="flex flex-col gap-3 text-base text-white/80">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="block py-1 hover:text-cyan-200">
                    {link.label}
                  </a>
                </li>
              ))}
              <li className="pt-2">
                <Button href={GTM_APP_URL} variant="primary" className="w-full justify-center">
                  Go to the app
                </Button>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
