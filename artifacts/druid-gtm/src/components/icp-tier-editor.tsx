import { Plus, Trash2, ChevronUp, ChevronDown, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { Tier } from "@workspace/evaluator";
import { MAX_TIERS_PER_DIMENSION } from "@workspace/evaluator";
import { newTier, replaceItemAt, removeItemAt, moveItem } from "@/lib/icp-profile-config-editing";
import type { ConfigValidationIssue } from "@/lib/icp-profile-config-validation";

// Tier list editor for Fit and Buying intent — a score only ever means
// something once it's resolved to a tier, and lib/evaluator/src/
// profileConfig.ts requires every dimension to have at least one tier at
// minScore 0 (its own comment calls this the "floor tier", but that word
// never appears in this UI — see the "Starting tier" badge below).
// Duplicate codes/thresholds and a missing starting tier are NOT
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
}: {
  title: string;
  description?: string;
  tiers: Tier[];
  onChange: (next: Tier[]) => void;
  issues: ConfigValidationIssue[];
}) {
  // A tier at minScore 0 is the one every score falls back to when no
  // higher tier's threshold is met — at most one can exist at a time
  // (the schema rejects duplicate minScores), so this is unambiguous.
  const startingTierIndex = tiers.findIndex((t) => t.minScore === 0);

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
          <Plus className="w-3.5 h-3.5 mr-1" /> Add tier
        </Button>
      </div>

      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 rounded-md px-2.5 py-2">
        <Info className="w-3 h-3 shrink-0 mt-0.5" />
        <p>
          Every possible score must resolve to a configured tier. The tier whose
          minimum score is 0 is the starting tier — it&apos;s used whenever no
          higher tier&apos;s threshold is reached. Scores here have no fixed
          maximum; don&apos;t assume a score is &quot;out of 100&quot;.
        </p>
      </div>

      <div className="space-y-1.5">
        {tiers.map((tier, index) => (
          <div key={index} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2">
            <div className="flex-1 min-w-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Tier name</Label>
              <Input
                value={tier.code}
                onChange={(e) =>
                  onChange(replaceItemAt(tiers, index, { ...tier, code: e.target.value }))
                }
                placeholder="e.g. high, warm, qualified"
                className="h-8 text-sm"
              />
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
            {index === startingTierIndex && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 mt-4">
                Starting tier
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
                aria-label="Move tier up"
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
                aria-label="Move tier down"
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
                aria-label="Remove tier"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
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
