import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { composeLinkedinDraft, composeEmailDraft } from "@workspace/gtm-shared";
import { copyText, downloadText } from "@/lib/clipboard";
import { RefreshCw, Copy, Download, Info, Check } from "lucide-react";
import type { Row } from "@/lib/queue-helpers";

interface MessageComposerProps {
  channel: "linkedin" | "email";
  row: Row;
  onDraftChange: (draft: { message_draft: string; subject: string; blocked?: boolean; edited?: boolean }) => void;
}

// composeLinkedinDraft/composeEmailDraft return different shapes (text vs subject+body);
// normalized to one shape immediately so the rest of this component works with a single,
// non-union type regardless of channel.
interface NormalizedDraft {
  message: string;
  subject: string;
  fallback: boolean;
  // blocked=true means an identified contact is required and this row doesn't have one
  // (product decision, 2026-07-24) — no greeting, subject, body, copy, download, approval,
  // or confirmation may be offered in this state. Distinct from `fallback`, which still
  // produces real (if generic) copy.
  blocked: boolean;
  blockedReason: string;
  signalContext: string;
  usedFields: string[];
}

// Draft generation is a pure, side-effect-free client-side operation (no network call,
// no LLM) — see @workspace/gtm-shared's messageComposer.js. This component only ever
// edits/copies/downloads the LOCAL draft; it never calls /api/n8n/activate itself —
// that stays the caller's (ActionModal's) responsibility once the operator confirms.
export function MessageComposer({ channel, row, onDraftChange }: MessageComposerProps) {
  const isEmail = channel === "email";

  function generate(): NormalizedDraft {
    if (isEmail) {
      const d = composeEmailDraft(row);
      return { message: d.body, subject: d.subject, fallback: d.fallback, blocked: Boolean(d.blocked), blockedReason: d.blockedReason ?? "", signalContext: d.signalContext, usedFields: d.usedFields };
    }
    const d = composeLinkedinDraft(row);
    return { message: d.text, subject: "", fallback: d.fallback, blocked: Boolean(d.blocked), blockedReason: d.blockedReason ?? "", signalContext: d.signalContext, usedFields: d.usedFields };
  }

  const [generated, setGenerated] = useState<NormalizedDraft>(generate);
  const [subject, setSubject] = useState(generated.subject);
  const [text, setText] = useState(generated.message);
  const [copied, setCopied] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Whether the operator has changed the text away from what was last generated — a plain
  // equality check against the current generated baseline, recomputed fresh on every
  // render (not separately tracked state), so it can never drift out of sync with what is
  // actually on screen.
  const isEdited = text !== generated.message || (isEmail && subject !== generated.subject);

  // Report the current draft up to the parent whenever it changes, so the caller can
  // read the latest value at approve-time without lifting this state itself. `blocked`
  // and `edited` let ActionModal independently refuse confirmation / warn before
  // discarding — defense in depth alongside this component's own guards (product
  // decision, PR 2).
  useEffect(() => {
    onDraftChange({ message_draft: text, subject: isEmail ? subject : "", blocked: generated.blocked, edited: isEdited });
    // onDraftChange itself is intentionally omitted (not memoized by the caller; including
    // it would re-run this on every parent re-render) — the suppression below is still
    // necessary for that reason alone, even with isEdited now listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, subject, generated.blocked, generated.message, generated.subject, isEdited]);

  function doReset() {
    const fresh = generate();
    setGenerated(fresh);
    setSubject(fresh.subject);
    setText(fresh.message);
    setShowResetConfirm(false);
  }

  function handleResetClick() {
    if (isEdited) {
      setShowResetConfirm(true);
    } else {
      doReset();
    }
  }

  async function handleCopy() {
    const full = isEmail && subject ? `Subject: ${subject}\n\n${text}` : text;
    const ok = await copyText(full);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function handleDownload() {
    const full = isEmail && subject ? `Subject: ${subject}\n\n${text}` : text;
    const base = row.company_domain || row.company_name || "draft";
    downloadText(`${channel}-draft-${base}.txt`, full);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {isEmail ? "Email draft" : "LinkedIn message draft"}
        </Label>
        {!generated.blocked && !showResetConfirm && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetClick}
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Reset from signals
          </Button>
        )}
      </div>

      {showResetConfirm && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <p className="text-[11px] text-amber-300 leading-relaxed">
            This will discard your edits and restore the original draft from signals.
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowResetConfirm(false)} className="h-7 text-xs">
              Keep editing
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={doReset} className="h-7 text-xs">
              Reset anyway
            </Button>
          </div>
        </div>
      )}

      {generated.blocked ? (
        // No greeting, subject, body, copy, download, approval, or confirmation is
        // available in this state — see hasIdentifiedContact() (product decision,
        // 2026-07-24). This holds in Sample/preview mode too.
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-300 leading-relaxed">
            {generated.blockedReason || "A draft isn't available for this account."}
          </p>
        </div>
      ) : (
        <>
          {generated.fallback && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300 leading-relaxed">
                Limited signal detail was available for this account, so this is a general message —
                edit it before approving.
              </p>
            </div>
          )}

          {generated.signalContext && (
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Why this is recommended: {generated.signalContext}
            </p>
          )}

          {isEmail && (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="h-9 text-sm bg-input border-border"
            />
          )}

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="resize-none h-32 text-sm bg-input border-border focus-visible:ring-primary"
            placeholder={isEmail ? "Email body" : "LinkedIn message"}
          />

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1.5">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy draft"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleDownload} className="h-7 text-xs gap-1.5">
              <Download className="w-3 h-3" />
              Download draft
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            This draft is not sent from here.{" "}
            {isEmail
              ? "Approving saves it as a persisted record — no email tool is connected."
              : "Approving prepares plain text you copy or download and send yourself — not sent automatically."}
          </p>
        </>
      )}
    </div>
  );
}
