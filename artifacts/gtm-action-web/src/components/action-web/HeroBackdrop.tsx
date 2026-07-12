import { useParallax } from "@/lib/useParallax";

const FLOATING_DOTS = [
  { top: "20%", left: "18%", tone: "bg-cyan-300/70", drift: "awv-drift-a" },
  { top: "64%", left: "10%", tone: "bg-violet-300/70", drift: "awv-drift-b" },
  { top: "28%", left: "80%", tone: "bg-cyan-300/60", drift: "awv-drift-c" },
  { top: "72%", left: "74%", tone: "bg-violet-300/60", drift: "awv-drift-a" },
  { top: "46%", left: "92%", tone: "bg-cyan-300/50", drift: "awv-drift-b" },
];

export function HeroBackdrop() {
  const ref = useParallax<HTMLDivElement>(10);

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="awv-dot-grid absolute inset-0 opacity-30"
        style={{ maskImage: "radial-gradient(ellipse 60% 55% at 50% 15%, black, transparent)" }}
      />

      <div className="awv-drift-a absolute -left-24 -top-24 h-72 w-72">
        <div
          className="h-full w-full rounded-full bg-cyan-400/20 blur-3xl"
          style={{ transform: "translate3d(calc(var(--px, 0px) * 0.6), calc(var(--py, 0px) * 0.6), 0)" }}
        />
      </div>

      <div className="awv-drift-b absolute -right-16 top-10 h-80 w-80">
        <div
          className="h-full w-full rounded-full bg-violet-500/20 blur-3xl"
          style={{ transform: "translate3d(calc(var(--px, 0px) * -0.5), calc(var(--py, 0px) * -0.5), 0)" }}
        />
      </div>

      <div className="awv-drift-c absolute bottom-[-5rem] left-1/3 h-64 w-64">
        <div
          className="h-full w-full rounded-full bg-cyan-400/10 blur-3xl"
          style={{ transform: "translate3d(calc(var(--px, 0px) * 0.3), calc(var(--py, 0px) * 0.3), 0)" }}
        />
      </div>

      {FLOATING_DOTS.map((dot, index) => (
        <div key={index} className={`${dot.drift} absolute`} style={{ top: dot.top, left: dot.left }}>
          <span className={`block h-1.5 w-1.5 rounded-full ${dot.tone}`} />
        </div>
      ))}
    </div>
  );
}
