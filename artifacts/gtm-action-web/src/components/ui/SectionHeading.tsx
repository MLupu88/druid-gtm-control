import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-300/80">
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="text-3xl font-semibold text-white sm:text-4xl">
        {title}
      </h2>
      {description && (
        <div className="mt-4 text-base leading-relaxed text-white/70">{description}</div>
      )}
    </div>
  );
}
