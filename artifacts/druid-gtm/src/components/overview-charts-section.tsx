// LS5 — Live Shell Closure: the two canonical Overview charts
// ("Observations over time", "Observations by source"). Deliberately
// plain bar charts — no gradients, no pie/gauge/3D, no decorative
// animation — reusing the existing recharts + ui/chart.tsx primitives
// already in this repo (no new charting dependency needed). Both charts
// share one fetch (GET /api/internal/overview/charts) and therefore one
// loading/error state; each has its own honest empty-state message.
//
// LS5 terminology correction: titles/labels below say "Observations",
// not "Signals" — both charts count raw canonical `observations` ROWS
// (see ../../api-server/src/services/overviewCharts.ts's own comment),
// not distinct external events. One RB2B visit, one HubSpot refresh, or
// one Client Radar research run can each produce multiple observation
// rows (HubSpot in particular: up to 9 per refresh) — so
// "Observations by source" is explicitly a view of canonical data
// VOLUME by provider, not a comparable external-event/occurrence count
// across providers. The underlying API fields
// (signalsOverTime/signalsByProvider) are intentionally left unchanged
// — this is a user-facing copy correction only, no API churn.

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { DefinitionHint } from "@/components/definition-hint";
import { providerDisplayName } from "@/lib/account-truth-presentation";
import type { OverviewCharts } from "@/lib/overview-charts-api";
import { formatChartDayLabel } from "@/lib/overview-charts-presentation";
import type { DefinitionKey } from "@/lib/definitions";

export interface OverviewChartsSectionProps {
  charts: OverviewCharts | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const TIME_SERIES_CONFIG: ChartConfig = {
  count: { label: "Observations", color: "hsl(var(--chart-1))" },
};

const PROVIDER_CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function OverviewChartsSection({ charts, isLoading, isError, onRetry }: OverviewChartsSectionProps) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
        Observation trends
      </p>

      {isError && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>Overview charts could not be loaded.</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineNotice>
      )}

      {!isError && (isLoading || !charts) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      )}

      {!isError && !isLoading && charts && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChartCard
            title="Observations over time"
            hint="observations_captured"
            subtitle={`Last ${charts.timeframe.days} calendar days, by day captured (UTC)`}
          >
            <SignalsOverTimeChart points={charts.signalsOverTime} />
          </ChartCard>
          <ChartCard
            title="Observations by source"
            hint="observations_by_source"
            subtitle={`Last ${charts.timeframe.days} calendar days`}
          >
            {charts.signalsByProvider.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 py-8 text-center">
                No observations recorded yet.
              </p>
            ) : (
              <SignalsByProviderChart slices={charts.signalsByProvider} />
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  hint,
  children,
}: {
  title: string;
  subtitle: string;
  hint?: DefinitionKey;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-1 text-xs font-medium text-foreground">
        {title}
        {hint && <DefinitionHint term={hint} />}
      </p>
      <p className="text-[10px] text-muted-foreground/70 mb-2">{subtitle}</p>
      {children}
    </div>
  );
}

function SignalsOverTimeChart({ points }: { points: OverviewCharts["signalsOverTime"] }) {
  return (
    <ChartContainer config={TIME_SERIES_CONFIG} className="aspect-[3/1] w-full">
      <BarChart data={points} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={formatChartDayLabel}
          tickLine={false}
          axisLine={false}
          fontSize={10}
        />
        <YAxis hide allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => formatChartDayLabel(String(value))} />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={2} />
      </BarChart>
    </ChartContainer>
  );
}

function SignalsByProviderChart({ slices }: { slices: OverviewCharts["signalsByProvider"] }) {
  const config: ChartConfig = Object.fromEntries(
    slices.map((slice, i) => [
      slice.provider,
      { label: providerDisplayName(slice.provider), color: PROVIDER_CHART_COLORS[i % PROVIDER_CHART_COLORS.length] },
    ]),
  );
  const data = slices.map((slice) => ({
    provider: slice.provider,
    label: providerDisplayName(slice.provider),
    count: slice.count,
  }));

  return (
    <ChartContainer config={config} className="aspect-[3/1] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={10}
          width={80}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={2}>
          {data.map((entry, i) => (
            <Cell key={entry.provider} fill={PROVIDER_CHART_COLORS[i % PROVIDER_CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
