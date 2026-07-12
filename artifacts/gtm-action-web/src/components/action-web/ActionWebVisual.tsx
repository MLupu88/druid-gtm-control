import { ChevronDown, ArrowRight } from "lucide-react";
import { useParallax } from "@/lib/useParallax";

type WebNode = { label: string; x: number; y: number; approved?: boolean };

const HUB = { x: 350, y: 340, r: 86 };
const REVIEW = { x: 890, y: 340, w: 210, h: 64 };
const NODE_W = 190;
const NODE_H = 52;

const INPUTS: WebNode[] = [
  { label: "Website activity", x: 115, y: 50 },
  { label: "Forms", x: 115, y: 166 },
  { label: "CRM", x: 115, y: 282 },
  { label: "Campaign engagement", x: 115, y: 398 },
  { label: "Intent data", x: 115, y: 514 },
  { label: "Account enrichment", x: 115, y: 630 },
];

const CONTEXT: WebNode[] = [
  { label: "ICP fit", x: 590, y: 50 },
  { label: "Buying activity", x: 630, y: 166 },
  { label: "CRM status", x: 590, y: 282 },
  { label: "Opportunity context", x: 630, y: 398 },
  { label: "Known people", x: 590, y: 514 },
  { label: "Timing", x: 630, y: 630 },
];

const ACTIONS: WebNode[] = [
  { label: "Owner alert", x: 1140, y: 35, approved: true },
  { label: "Pipeline assist", x: 1180, y: 122 },
  { label: "Sales review", x: 1140, y: 209 },
  { label: "Prepare outreach", x: 1180, y: 296 },
  { label: "Retarget", x: 1140, y: 383 },
  { label: "Nurture", x: 1180, y: 470 },
  { label: "Suppress", x: 1140, y: 557 },
  { label: "No action", x: 1180, y: 644 },
];

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

const approvedAction = ACTIONS[0];
const dotSourceInput = INPUTS[2];
const DOT_1_PATH = curve(
  dotSourceInput.x + NODE_W / 2,
  dotSourceInput.y,
  HUB.x - HUB.r,
  HUB.y,
);
const DOT_2_PATH = curve(
  REVIEW.x + REVIEW.w / 2,
  REVIEW.y,
  approvedAction.x - NODE_W / 2,
  approvedAction.y,
);

const FOREGROUND_TRANSFORM = {
  transform: "translate3d(calc(var(--px, 0px) * 0.08), calc(var(--py, 0px) * 0.08), 0)",
};
const CONNECTOR_TRANSFORM = {
  transform: "translate3d(calc(var(--px, 0px) * 0.15), calc(var(--py, 0px) * 0.15), 0)",
};
const BACKDROP_TRANSFORM = {
  transform: "translate3d(calc(var(--px, 0px) * 0.35), calc(var(--py, 0px) * 0.35), 0)",
};

const NEUTRAL_STROKE = "rgba(255,255,255,0.36)";
const NEUTRAL_FILL = "rgba(255,255,255,0.07)";
const NEUTRAL_TEXT = "#f1f5f9";

function RectNode({
  node,
  stroke,
  fill,
  text,
}: {
  node: WebNode;
  stroke: string;
  fill: string;
  text: string;
}) {
  return (
    <g>
      <rect
        x={node.x - NODE_W / 2}
        y={node.y - NODE_H / 2}
        width={NODE_W}
        height={NODE_H}
        rx={26}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="middle" fontSize={14} fill={text}>
        {node.label}
      </text>
    </g>
  );
}

function NumberStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="bg-gradient-to-b from-cyan-300 to-violet-400 bg-clip-text text-4xl font-bold leading-none text-transparent sm:text-5xl">
        {value}
      </span>
      <span className="mt-2 text-sm font-medium uppercase tracking-wide text-white/50">{label}</span>
    </div>
  );
}

export function ActionWebVisual() {
  const ref = useParallax<HTMLDivElement>(26);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
      {/* Desktop / tablet: network diagram */}
      <figure className="hidden lg:block">
        <div ref={ref} aria-hidden="true">
          <svg viewBox="0 0 1300 680" className="w-full" role="img">
            <defs>
              <radialGradient id="awv-hub-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </radialGradient>
            </defs>

            <style>
              {`
                @media (prefers-reduced-motion: no-preference) {
                  .awv-dot-1 {
                    offset-path: path('${DOT_1_PATH}');
                    animation: awv-travel 3.2s linear infinite;
                  }
                  .awv-dot-2 {
                    offset-path: path('${DOT_2_PATH}');
                    animation: awv-travel 3.6s linear infinite;
                    animation-delay: 1.4s;
                  }
                }
                @keyframes awv-travel {
                  from { offset-distance: 0%; }
                  to { offset-distance: 100%; }
                }
              `}
            </style>

            <g style={BACKDROP_TRANSFORM}>
              <circle cx={HUB.x} cy={HUB.y} r={150} fill="url(#awv-hub-glow)" />
            </g>

            <g style={CONNECTOR_TRANSFORM}>
              {INPUTS.map((n) => (
                <path
                  key={`in-${n.label}`}
                  d={curve(n.x + NODE_W / 2, n.y, HUB.x - HUB.r, HUB.y)}
                  fill="none"
                  stroke="rgba(34,211,238,0.28)"
                  strokeWidth={1.5}
                />
              ))}
              {CONTEXT.map((n) => (
                <path
                  key={`hub-${n.label}`}
                  d={curve(HUB.x + HUB.r, HUB.y, n.x - NODE_W / 2, n.y)}
                  fill="none"
                  stroke="rgba(167,139,250,0.28)"
                  strokeWidth={1.5}
                />
              ))}
              {CONTEXT.map((n) => (
                <path
                  key={`ctx-${n.label}`}
                  d={curve(n.x + NODE_W / 2, n.y, REVIEW.x - REVIEW.w / 2, REVIEW.y)}
                  fill="none"
                  stroke="rgba(251,191,36,0.26)"
                  strokeWidth={1.5}
                />
              ))}
              {ACTIONS.map((n) => (
                <path
                  key={`act-${n.label}`}
                  d={curve(REVIEW.x + REVIEW.w / 2, REVIEW.y, n.x - NODE_W / 2, n.y)}
                  fill="none"
                  stroke={n.approved ? "#4ade80" : "rgba(255,255,255,0.2)"}
                  strokeWidth={n.approved ? 2.5 : 1.5}
                  opacity={n.approved ? 0.9 : 1}
                />
              ))}
              <circle className="awv-dot-1" cx={dotSourceInput.x + NODE_W / 2} cy={dotSourceInput.y} r={5} fill="#22d3ee" />
              <circle className="awv-dot-2" cx={REVIEW.x + REVIEW.w / 2} cy={REVIEW.y} r={5} fill="#4ade80" />
            </g>

            <g style={FOREGROUND_TRANSFORM}>
              <circle
                cx={HUB.x}
                cy={HUB.y}
                r={HUB.r}
                fill="rgba(34,211,238,0.12)"
                stroke="#22d3ee"
                strokeWidth={2}
              />
              <text x={HUB.x} y={HUB.y - 9} textAnchor="middle" fontSize={16} fontWeight={600} fill="#ecfeff">
                One account
              </text>
              <text x={HUB.x} y={HUB.y + 15} textAnchor="middle" fontSize={16} fontWeight={600} fill="#ecfeff">
                picture
              </text>

              {INPUTS.map((n) => (
                <RectNode key={n.label} node={n} stroke={NEUTRAL_STROKE} fill={NEUTRAL_FILL} text={NEUTRAL_TEXT} />
              ))}

              {CONTEXT.map((n) => (
                <RectNode
                  key={n.label}
                  node={n}
                  stroke="rgba(167,139,250,0.55)"
                  fill="rgba(167,139,250,0.1)"
                  text="#ede9fe"
                />
              ))}

              <rect
                x={REVIEW.x - REVIEW.w / 2}
                y={REVIEW.y - REVIEW.h / 2}
                width={REVIEW.w}
                height={REVIEW.h}
                rx={30}
                fill="rgba(251,191,36,0.1)"
                stroke="#fbbf24"
                strokeWidth={2}
              />
              <text x={REVIEW.x} y={REVIEW.y - 8} textAnchor="middle" fontSize={14.5} fontWeight={600} fill="#fffbeb">
                Human review
              </text>
              <text x={REVIEW.x} y={REVIEW.y + 14} textAnchor="middle" fontSize={14.5} fontWeight={600} fill="#fffbeb">
                where needed
              </text>

              {ACTIONS.map((n) =>
                n.approved ? (
                  <g key={n.label}>
                    <text
                      x={n.x}
                      y={n.y - NODE_H / 2 - 12}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill="#4ade80"
                    >
                      Approved action
                    </text>
                    <RectNode node={n} stroke="#4ade80" fill="rgba(74,222,128,0.16)" text="#f0fdf4" />
                  </g>
                ) : (
                  <RectNode key={n.label} node={n} stroke={NEUTRAL_STROKE} fill={NEUTRAL_FILL} text={NEUTRAL_TEXT} />
                ),
              )}
            </g>
          </svg>
        </div>

        <figcaption className="sr-only">
          Website, CRM, campaign, intent, and enrichment activity from many sources are combined
          into one account picture. That picture is checked against fit, buying activity, CRM
          status, opportunity context, known people, and timing. A person reviews the
          recommendation where it matters, then the account is routed to the appropriate next
          action: owner alert, pipeline assist, sales review, prepare outreach, retarget, nurture,
          suppress, or no action. In this example, the owner alert has been approved.
        </figcaption>
      </figure>

      {/* Mobile: vertical flow */}
      <div className="space-y-3 lg:hidden">
        <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Activity sources
          </p>
          <ul className="flex flex-wrap gap-2">
            {INPUTS.map((n) => (
              <li
                key={n.label}
                className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-white/80"
              >
                {n.label}
              </li>
            ))}
          </ul>
        </div>

        <ChevronDown aria-hidden="true" className="mx-auto h-5 w-5 text-white/30" />

        <div className="rounded-2xl border border-cyan-400/40 bg-cyan-400/10 p-4">
          <p className="text-base font-semibold text-cyan-100">One account picture</p>
          <p className="mt-1 text-sm text-cyan-100/70">
            Checked against fit, buying activity, CRM status, opportunity context, known people,
            and timing.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {CONTEXT.map((n) => (
              <li
                key={n.label}
                className="rounded-full border border-violet-400/40 bg-violet-400/10 px-3.5 py-1.5 text-sm text-violet-100"
              >
                {n.label}
              </li>
            ))}
          </ul>
        </div>

        <ChevronDown aria-hidden="true" className="mx-auto h-5 w-5 text-white/30" />

        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-center">
          <p className="text-base font-semibold text-amber-100">Human review where needed</p>
        </div>

        <ChevronDown aria-hidden="true" className="mx-auto h-5 w-5 text-white/30" />

        <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Recommended actions
          </p>
          <ul className="flex flex-wrap gap-2">
            {ACTIONS.map((n) =>
              n.approved ? (
                <li key={n.label} className="flex flex-col items-start gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-green-300">
                    Approved action
                  </span>
                  <span className="rounded-full border border-green-400/50 bg-green-400/15 px-3.5 py-1.5 text-sm text-green-100">
                    {n.label}
                  </span>
                </li>
              ) : (
                <li
                  key={n.label}
                  className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-white/80"
                >
                  {n.label}
                </li>
              ),
            )}
          </ul>
        </div>

        <p className="sr-only">
          Website, CRM, campaign, intent, and enrichment activity from many sources are combined
          into one account picture. That picture is checked against fit, buying activity, CRM
          status, opportunity context, known people, and timing. A person reviews the
          recommendation where it matters, then the account is routed to the appropriate next
          action, such as an owner alert, pipeline assist, sales review, prepare outreach,
          retarget, nurture, suppress, or no action.
        </p>
      </div>

      {/* Structure at a glance */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4 border-t border-white/10 pt-8 sm:gap-6">
        <NumberStat value="6" label="activity sources" />
        <ArrowRight aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-white/30" />
        <NumberStat value="1" label="account picture" />
        <ArrowRight aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-white/30" />
        <NumberStat value="8" label="possible next actions" />
      </div>

      {/* Worked example tied to the approved action above */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
          Example: what the recommendation looks like
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Account</p>
            <p className="mt-1 text-base text-white/85">
              Acme Robotics — strong ICP fit, existing opportunity in play
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Reason to act now</p>
            <p className="mt-1 text-base text-white/85">
              Renewed pricing-page visits and a second contact engaging while the opportunity is
              open
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/40">Recommended action</p>
            <p className="mt-1 flex items-center gap-2 text-base font-medium text-green-200">
              Owner alert
              <span className="rounded-full border border-green-400/50 bg-green-400/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-green-300">
                Approved
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
