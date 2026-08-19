import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const inlineNoticeVariants = cva(
  "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-5",
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
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

const icons = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
} as const;

export interface InlineNoticeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof inlineNoticeVariants> {
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }> | null;
}

const InlineNotice = React.forwardRef<HTMLDivElement, InlineNoticeProps>(
  ({ className, tone, title, icon, children, ...props }, ref) => {
    const resolvedTone = tone ?? "neutral";
    const Icon = icon === undefined ? icons[resolvedTone] : icon;
    return (
      <div
        ref={ref}
        role={resolvedTone === "danger" ? "alert" : "status"}
        className={cn(inlineNoticeVariants({ tone: resolvedTone }), className)}
        {...props}
      >
        {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
        <div className="min-w-0">
          {title && <p className="font-medium text-current">{title}</p>}
          {children && (
            <div className={cn(title && "mt-0.5", "text-current/85")}>
              {children}
            </div>
          )}
        </div>
      </div>
    );
  },
);
InlineNotice.displayName = "InlineNotice";

export { InlineNotice, inlineNoticeVariants };
