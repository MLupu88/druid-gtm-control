import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium leading-4",
  {
    variants: {
      tone: {
        neutral:
          "border-status-neutral-border bg-status-neutral text-status-neutral-foreground",
        info: "border-status-info-border bg-status-info text-status-info-foreground",
        success:
          "border-status-success-border bg-status-success text-status-success-foreground",
        warning:
          "border-status-warning-border bg-status-warning text-status-warning-foreground",
        danger:
          "border-status-danger-border bg-status-danger text-status-danger-foreground",
      },
      dot: {
        true: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        false: "",
      },
    },
    defaultVariants: {
      tone: "neutral",
      dot: false,
    },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, tone, dot, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(statusBadgeVariants({ tone, dot }), className)}
      {...props}
    />
  ),
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge, statusBadgeVariants };
