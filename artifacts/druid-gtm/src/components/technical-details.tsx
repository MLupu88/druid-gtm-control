import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Small, reusable collapsed disclosure for raw/technical values (rule
// IDs, field paths, tier codes, raw error strings) that a plain-language
// UI still needs to preserve for traceability without making them the
// primary thing a GTM user reads. Defaults closed. Used by both
// account-icp-preview-panel.tsx and client-radar-research-panel.tsx so
// the two "here's the technical detail behind that friendly message"
// patterns stay visually consistent.
export function TechnicalDetails({
  summary = "Technical details",
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors">
        <ChevronRight
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 pl-4 border-l border-border/60">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
