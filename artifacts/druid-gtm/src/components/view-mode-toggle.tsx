import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/sample-mode";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
  className?: string;
}

export function ViewModeToggle({ viewMode, onChange, className }: ViewModeToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5",
        className,
      )}
    >
      <button
        onClick={() => onChange("live")}
        className={cn(
          "px-3 py-1.5 rounded-[7px] text-xs font-medium transition-all",
          viewMode === "live"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Live data
      </button>
      <button
        onClick={() => onChange("sample")}
        className={cn(
          "px-3 py-1.5 rounded-[7px] text-xs font-medium transition-all",
          viewMode === "sample"
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Sample data
      </button>
    </div>
  );
}
