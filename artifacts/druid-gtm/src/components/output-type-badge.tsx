import { OUTPUT_TYPE_LABELS } from "@workspace/gtm-shared";
import { outputTypeBadgeClasses, type OutputTypeKey } from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";

interface OutputTypeBadgeProps {
  outputType: OutputTypeKey;
  showSub?: boolean;
  className?: string;
}

export function OutputTypeBadge({
  outputType,
  showSub = false,
  className,
}: OutputTypeBadgeProps) {
  const meta = OUTPUT_TYPE_LABELS[outputType] ?? OUTPUT_TYPE_LABELS["Nurture"];
  const classes = outputTypeBadgeClasses(outputType);
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border",
          classes,
        )}
      >
        {meta.label}
      </span>
      {showSub && meta.sub && (
        <span className="text-[11px] text-muted-foreground pl-0.5">{meta.sub}</span>
      )}
    </div>
  );
}
