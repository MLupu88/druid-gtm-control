import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pageLayoutVariants = cva(
  "mx-auto w-full px-[var(--page-gutter)] py-[var(--page-block-padding)] sm:py-6",
  {
    variants: {
      width: {
        narrow: "max-w-[var(--content-width-narrow)]",
        standard: "max-w-[var(--content-width-standard)]",
        wide: "max-w-[var(--content-width-wide)]",
        full: "max-w-none",
      },
    },
    defaultVariants: {
      width: "standard",
    },
  },
);

export interface PageLayoutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof pageLayoutVariants> {}

const PageLayout = React.forwardRef<HTMLDivElement, PageLayoutProps>(
  ({ className, width, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(pageLayoutVariants({ width }), className)}
      {...props}
    />
  ),
);
PageLayout.displayName = "PageLayout";

interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}

const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, description, eyebrow, actions, className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn(
        "flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="text-xl font-semibold leading-7 tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description && (
          <div className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  ),
);
PageHeader.displayName = "PageHeader";

const PageToolbar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="toolbar"
    className={cn(
      "flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between",
      className,
    )}
    {...props}
  />
));
PageToolbar.displayName = "PageToolbar";

export { PageLayout, PageHeader, PageToolbar, pageLayoutVariants };
