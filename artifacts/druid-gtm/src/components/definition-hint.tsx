// LS7 — reusable inline-explainability primitive. Renders a subtle
// INFO icon (never a warning/exclamation icon — those are reserved for
// actual warnings) that reveals a term's definition from the central
// ../lib/definitions.ts registry. Built on the existing Radix
// Popover primitive already used elsewhere in this repo — no new
// component library.
//
// Accessibility / interaction contract (all three, not just one):
//   - hover opens it (desktop mouse)
//   - keyboard focus opens it (Tab reaches the icon button directly —
//     the explanation is available without ever pressing a key beyond
//     Tab, and never depends solely on hover)
//   - click/tap opens it (native to the underlying Popover trigger —
//     covers touch devices, where hover never fires)
//   - Escape / clicking outside closes it (native Popover behavior)
// The trigger is a real <button> with an aria-label naming the term, so
// it is both keyboard-reachable and announced correctly by a screen
// reader; the popover content itself is plain, readable text.

import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEFINITIONS, type DefinitionKey } from "@/lib/definitions";

export interface DefinitionHintProps {
  term: DefinitionKey;
  className?: string;
}

export function DefinitionHint({ term, className }: DefinitionHintProps) {
  const [open, setOpen] = useState(false);
  const entry = DEFINITIONS[term];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does "${entry.term}" mean?`}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          className={cn(
            "inline-flex size-3.5 shrink-0 items-center justify-center align-middle text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3 text-xs">
        <p className="font-semibold text-foreground">{entry.term}</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">{entry.meaning}</p>
        <p className="mt-1.5 leading-relaxed text-muted-foreground/70">{entry.basis}</p>
      </PopoverContent>
    </Popover>
  );
}
