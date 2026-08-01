import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Non-destructive warning shown wherever the exact legacy "Starter ICP"
// bootstrap configuration is detected (see
// ../lib/icp-legacy-starter-detection.ts) — on the profile detail/editor
// for that profile's version, and on any account preview/official
// evaluation result that was actually run against it. This component
// never offers to edit, republish, or otherwise mutate the legacy
// profile — the only action is a link to create or open a real profile
// elsewhere. Uses the shared Alert primitive's semantic styling
// (amber-800/amber-300 dual-tone text, same accessible convention as
// every other warning surface) rather than a one-off hardcoded color.

export function LegacyStarterWarning() {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-300">
        Legacy starter configuration
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-amber-900/90 dark:text-amber-200/90">
          This profile only confirms that a company record exists. It does not define a
          meaningful production ICP. Create a new profile with real company-fit,
          buying-intent, actionability, and eligibility criteria.
        </p>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10"
        >
          <Link href="/settings/icp-profiles">Open ICP profiles</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
