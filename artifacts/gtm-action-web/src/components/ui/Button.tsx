import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-cyan-400 to-violet-500 text-navy-950 hover:from-cyan-300 hover:to-violet-400",
  secondary:
    "border border-white/20 text-white hover:border-cyan-400/60 hover:text-cyan-200",
  ghost: "text-white/70 hover:text-white",
};

export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
