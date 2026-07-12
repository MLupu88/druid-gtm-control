import { useId, useState } from "react";

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const LIMITS = {
  volume: { min: 10, max: 5000, step: 10, default: 250 },
  cost: { min: 10, max: 2000, step: 10, default: 300 },
  rejection: { min: 0, max: 100, step: 1, default: 60 },
  wasteReduction: { min: 0, max: 75, step: 1, default: 25 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function MqlCostEstimator() {
  const volumeId = useId();
  const costRangeId = useId();
  const costNumberId = useId();
  const costLegendId = useId();
  const rejectionId = useId();
  const wasteReductionId = useId();
  const methodologyId = useId();

  const [volume, setVolume] = useState(LIMITS.volume.default);
  const [cost, setCost] = useState(LIMITS.cost.default);
  const [costText, setCostText] = useState(String(LIMITS.cost.default));
  const [rejectionPercent, setRejectionPercent] = useState(LIMITS.rejection.default);
  const [wasteReductionPercent, setWasteReductionPercent] = useState(LIMITS.wasteReduction.default);

  function handleVolumeChange(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setVolume(clamp(parsed, LIMITS.volume.min, LIMITS.volume.max));
    }
  }

  function handleCostRangeChange(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const safe = clamp(parsed, LIMITS.cost.min, LIMITS.cost.max);
      setCost(safe);
      setCostText(String(safe));
    }
  }

  function handleCostTextChange(raw: string) {
    setCostText(raw);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) {
      setCost(clamp(parsed, LIMITS.cost.min, LIMITS.cost.max));
    }
  }

  function handleCostBlur() {
    setCostText(String(cost));
  }

  function handleRejectionChange(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setRejectionPercent(clamp(parsed, LIMITS.rejection.min, LIMITS.rejection.max));
    }
  }

  function handleWasteReductionChange(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setWasteReductionPercent(clamp(parsed, LIMITS.wasteReduction.min, LIMITS.wasteReduction.max));
    }
  }

  const rejectionRate = rejectionPercent / 100;
  const wasteReductionRate = wasteReductionPercent / 100;

  const monthlyMqlSpend = volume * cost;
  const monthlySpendAtRisk = monthlyMqlSpend * rejectionRate;
  const monthlyPotentialSavings = monthlySpendAtRisk * wasteReductionRate;
  const annualPotentialSavings = monthlyPotentialSavings * 12;
  const mqlsRecoveredPerMonth = Math.round(volume * rejectionRate * wasteReductionRate);

  return (
    <div className="mt-12 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-start lg:gap-16">
      {/* Inputs */}
      <div className="space-y-9">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor={volumeId} className="text-base font-medium text-white/85">
              Monthly MQL volume
            </label>
            <output htmlFor={volumeId} className="text-base font-semibold text-cyan-200">
              {NUMBER_FORMAT.format(volume)}
            </output>
          </div>
          <input
            id={volumeId}
            type="range"
            className="awv-slider mt-3"
            min={LIMITS.volume.min}
            max={LIMITS.volume.max}
            step={LIMITS.volume.step}
            value={volume}
            aria-describedby={methodologyId}
            onChange={(e) => handleVolumeChange(e.target.value)}
          />
          <div className="mt-1.5 flex justify-between text-xs text-white/35">
            <span>{LIMITS.volume.min}</span>
            <span>{LIMITS.volume.max}</span>
          </div>
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend id={costLegendId} className="mb-3 block text-base font-medium text-white/85">
            Average cost per MQL
          </legend>
          <div className="flex items-center gap-4">
            <input
              id={costRangeId}
              type="range"
              className="awv-slider flex-1"
              min={LIMITS.cost.min}
              max={LIMITS.cost.max}
              step={LIMITS.cost.step}
              value={cost}
              aria-labelledby={costLegendId}
              aria-describedby={methodologyId}
              onChange={(e) => handleCostRangeChange(e.target.value)}
            />
            <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5">
              <span aria-hidden="true" className="text-white/40">
                €
              </span>
              <input
                id={costNumberId}
                type="number"
                inputMode="numeric"
                min={LIMITS.cost.min}
                max={LIMITS.cost.max}
                step={LIMITS.cost.step}
                value={costText}
                aria-labelledby={costLegendId}
                aria-describedby={methodologyId}
                onChange={(e) => handleCostTextChange(e.target.value)}
                onBlur={handleCostBlur}
                className="w-20 bg-transparent text-right text-base text-white outline-none"
              />
            </div>
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-white/35">
            <span>€{LIMITS.cost.min}</span>
            <span>€{LIMITS.cost.max}</span>
          </div>
        </fieldset>

        <div>
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor={rejectionId} className="text-base font-medium text-white/85">
              Percentage rejected or not acted on by sales
            </label>
            <output htmlFor={rejectionId} className="text-base font-semibold text-cyan-200">
              {rejectionPercent}%
            </output>
          </div>
          <input
            id={rejectionId}
            type="range"
            className="awv-slider mt-3"
            min={LIMITS.rejection.min}
            max={LIMITS.rejection.max}
            step={LIMITS.rejection.step}
            value={rejectionPercent}
            aria-describedby={methodologyId}
            onChange={(e) => handleRejectionChange(e.target.value)}
          />
          <div className="mt-1.5 flex justify-between text-xs text-white/35">
            <span>{LIMITS.rejection.min}%</span>
            <span>{LIMITS.rejection.max}%</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-4">
            <label htmlFor={wasteReductionId} className="text-base font-medium text-white/85">
              Estimated reduction in wasted MQLs
            </label>
            <output htmlFor={wasteReductionId} className="text-base font-semibold text-cyan-200">
              {wasteReductionPercent}%
            </output>
          </div>
          <input
            id={wasteReductionId}
            type="range"
            className="awv-slider mt-3"
            min={LIMITS.wasteReduction.min}
            max={LIMITS.wasteReduction.max}
            step={LIMITS.wasteReduction.step}
            value={wasteReductionPercent}
            aria-describedby={methodologyId}
            onChange={(e) => handleWasteReductionChange(e.target.value)}
          />
          <div className="mt-1.5 flex justify-between text-xs text-white/35">
            <span>{LIMITS.wasteReduction.min}%</span>
            <span>{LIMITS.wasteReduction.max}%</span>
          </div>
        </div>

        <p id={methodologyId} className="max-w-xl text-sm leading-relaxed text-white/40">
          This estimate assumes that a portion of currently rejected MQL spend can be avoided or
          redirected through better account context, qualification and routing. Actual results
          depend on channel mix, sales process, data quality and adoption.
        </p>
      </div>

      {/* Results */}
      <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.06] to-violet-500/[0.05] p-6 sm:p-8">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-white/45">
              Total monthly MQL spend
            </p>
            <output className="mt-1 block text-2xl font-semibold text-white">
              {CURRENCY_FORMAT.format(monthlyMqlSpend)}
            </output>
          </div>

          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-white/45">
              Estimated monthly spend tied to rejected MQLs
            </p>
            <output className="mt-1 block text-2xl font-semibold text-white">
              {CURRENCY_FORMAT.format(monthlySpendAtRisk)}
            </output>
          </div>

          <div className="border-t border-white/10 pt-5">
            <p className="text-sm font-medium uppercase tracking-wide text-cyan-200/70">
              Potential monthly savings
            </p>
            <output className="mt-1 block bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-4xl font-bold text-transparent">
              {CURRENCY_FORMAT.format(monthlyPotentialSavings)}
            </output>
          </div>

          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-cyan-200/70">
              Potential annual savings
            </p>
            <output className="mt-1 block bg-gradient-to-r from-cyan-300 to-violet-400 bg-clip-text text-4xl font-bold text-transparent">
              {CURRENCY_FORMAT.format(annualPotentialSavings)}
            </output>
          </div>

          <div className="border-t border-white/10 pt-5">
            <p className="text-sm font-medium uppercase tracking-wide text-white/45">
              MQLs redirected or avoided each month
            </p>
            <output className="mt-1 block text-2xl font-semibold text-white">
              {NUMBER_FORMAT.format(mqlsRecoveredPerMonth)}
            </output>
          </div>
        </div>
      </div>
    </div>
  );
}
