import { Plus, Trash2, ChevronUp, ChevronDown, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Tier } from "@workspace/evaluator";
import { MAX_TIERS_PER_DIMENSION } from "@workspace/evaluator";
import { newTier, replaceItemAt, removeItemAt, moveItem } from "@/lib/icp-profile-config-editing";
import type { ConfigValidationIssue } from "@/lib/icp-profile-config-validation";
import { humanizeBandLabel } from "@/lib/icp-profile-business-summary";

// Band (tier) list editor for Fit and Buying intent — a score only ever
// means something once it's resolved to a band, and lib/evaluator/src/
// profileConfig.ts requires every dimension to have at least one band at
// minScore 0 (its own comment calls this the "floor tier", but that word
// never appears in this UI — see the "Fallback band" badge below).
// Duplicate codes/thresholds and a missing fallback band are NOT
// re-validated here; they're read straight from the same
// IcpProfileConfigV1Schema run the whole draft goes through (see
// ../lib/icp-profile-config-validation.ts) via the `issues` prop, so this
// section can never disagree with the authoritative schema.

export function TierEditor({
  title,
  description,
  tiers,
  onChange,
  issues,
  /** Sum of the dimension's currently configured positive rule weights — a safe theoretical upper bound (reached only if every configured rule matched at once), not a claim that this score is actually reachable by a real account (some conditions may be mutually exclusive). Used only to flag bands whose threshold exceeds even this upper bound, and therefore are definitely unreachable; never changes what gets saved. */
  configuredMaximumPoints,
}: {
  title: string;
  description?: string;
  tiers: Tier[];
  onChange: (next: Tier[]) => void;
  issues: ConfigValidationIssue[];
  configuredMaximumPoints: number;
}) {
  // A band at minScore 0 is the one every score falls back to when no
  // higher band's threshold is met — at most one can exist at a time
  // (the schema rejects duplicate minScores), so this is unambiguous.
  const fallbackBandIndex = tiers.findIndex((t) => t.minScore === 0);

  function handleAdd() {
    onChange([...tiers, newTier()]);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          onClick={handleAdd}
          disabled={tiers.length >= MAX_TIERS_PER_DIMENSION}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add band
        </Button>
      </div>

      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 rounded-md px-2.5 py-2">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <p>
          Every possible score must resolve to a configured band. The band whose
          minimum score is 0 is the fallback band — it&apos;s used whenever no
          higher band&apos;s threshold is reached. Scores here have no fixed
          maximum; don&apos;t assume a score is &quot;out of 100&quot;.
        </p>
      </div>

      <div className="space-y-1.5">
        {tiers.map((tier, index) => {
          const unreachable = tier.minScore > 0 && tier.minScore > configuredMaximumPoints;
          return (
          <div key={index} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2">
            <div className="flex-1 min-w-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Band name</Label>
              <Input
                value={tier.code}
                onChange={(e) =>
                  onChange(replaceItemAt(tiers, index, { ...tier, code: e.target.value }))
                }
                placeholder="e.g. high, warm, qualified"
                className="h-8 text-sm"
              />
              {tier.code.trim() !== "" && (
                <p className="text-[10px] text-muted-foreground/60">
                  Shown as: {humanizeBandLabel(tier.code)}
                </p>
              )}
            </div>
            <div className="w-32 shrink-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Minimum score</Label>
              <Input
                type="number"
                min={0}
                value={tier.minScore}
                onChange={(e) =>
                  onChange(
                    replaceItemAt(tiers, index, {
                      ...tier,
                      minScore: Number(e.target.value),
                    }),
                  )
                }
                className="h-8 text-sm"
              />
            </div>
            {index === fallbackBandIndex && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 mt-4">
                Fallback band
              </Badge>
            )}
            {unreachable && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 shrink-0 mt-4 text-amber-400 border-amber-500/30 bg-amber-500/10"
                title={`Requires ${tier.minScore} points, but the total configured rule weights only add up to ${configuredMaximumPoints}.`}
              >
                Cannot be reached with configured weights
              </Badge>
            )}
            <div className="flex items-center gap-0.5 shrink-0 mt-4">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange(moveItem(tiers, index, -1))}
                disabled={index === 0}
                aria-label="Move band up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange(moveItem(tiers, index, 1))}
                disabled={index === tiers.length - 1}
                aria-label="Move band down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-400 hover:text-red-300"
                onClick={() => onChange(removeItemAt(tiers, index))}
                disabled={tiers.length <= 1}
                aria-label="Remove band"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>

      {issues.length > 0 && (
        <ul className="space-y-0.5">
          {issues.map((issue, i) => (
            <li key={i} className="text-[11px] text-red-400 flex items-start gap-1">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
