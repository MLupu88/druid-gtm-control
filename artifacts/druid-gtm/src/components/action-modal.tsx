import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Info, Copy, Download, Check } from "lucide-react";
import { BUTTONS, getTruthfulStatusPresentation, resolveLifecycleEvidence, hasIdentifiedContact, IDENTIFIED_CONTACT_REQUIRED_REASON } from "@workspace/gtm-shared";
import {
  type Row,
  type ButtonKey,
  type ComposedDraft,
  rowCostLabel,
  buttonEndpointRoute,
  buttonPostBody,
} from "@/lib/queue-helpers";
import { MessageComposer } from "@/components/message-composer";
import { copyText, downloadText } from "@/lib/clipboard";

interface ActionModalProps {
  open: boolean;
  onClose: () => void;
  buttonKey: ButtonKey;
  row: Row;
  onSuccess?: () => void;
  previewOnly?: boolean;
}

type Phase = "confirm" | "loading" | "success" | "artifact_ready" | "pending" | "error";

interface ArtifactState {
  type: string | null;
  filename: string | null;
  content: string | null;
  // true when the content shown is the operator's own local draft, because the server
  // response genuinely lacked confirmed artifact fields (e.g. an older response shape) —
  // must always be labeled as such, never presented as a persisted/confirmed artifact.
  isLocalFallback: boolean;
}

const COMPOSER_CHANNELS: Partial<Record<ButtonKey, "linkedin" | "email">> = {
  approve_linkedin: "linkedin",
  approve_email: "email",
};

export function ActionModal({
  open,
  onClose,
  buttonKey,
  row,
  onSuccess,
  previewOnly = false,
}: ActionModalProps) {
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>("confirm");
  const [resultMessage, setResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [draft, setDraft] = useState<ComposedDraft & { blocked?: boolean; edited?: boolean }>({ message_draft: "", subject: "" });
  const [artifact, setArtifact] = useState<ArtifactState | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);

  const btn = BUTTONS[buttonKey];
  if (!btn) return null;

  const composerChannel = COMPOSER_CHANNELS[buttonKey];
  const cost = rowCostLabel(row);
  const route = buttonEndpointRoute(buttonKey);

  function handleClose() {
    setReason("");
    setPhase("confirm");
    setResultMessage("");
    setErrorMessage("");
    setArtifact(null);
    setCopied(false);
    setPendingClose(false);
    onClose();
  }

  // Only the confirm phase can have an edited-but-unsubmitted draft worth protecting —
  // once a submission has been attempted (loading/success/artifact_ready/pending/error),
  // the draft's fate is already decided and closing needs no further confirmation.
  function requestClose() {
    if (phase === "confirm" && composerChannel && draft.edited) {
      setPendingClose(true);
      return;
    }
    handleClose();
  }

  async function handleConfirm() {
    if (!reason.trim()) return;

    // Unconditional identified-contact requirement (product decision, 2026-07-24) — MUST
    // run before the previewOnly early return below, so Sample/preview mode can never
    // confirm a prospect-facing draft for an insufficiently identified account. This is
    // defense in depth alongside the button-visibility filter and the composer's own
    // blocked result; it should be unreachable via the normal UI path, since rowButtons()
    // already excludes these buttons for such rows.
    if (composerChannel && !hasIdentifiedContact(row)) {
      setErrorMessage(IDENTIFIED_CONTACT_REQUIRED_REASON);
      setPhase("error");
      return;
    }

    if (previewOnly) {
      // No backend call, ever. Deliberately does NOT call onSuccess() — that would
      // cascade into closing the parent account sheet (AccountDetailSheet's onSuccess
      // -> onAction -> setSelectedRow(null)), which previously made "Preview only"
      // look like it silently closed everything. Nothing happened, so nothing closes;
      // the modal stays open on a neutral state until the operator clicks Done.
      setPhase("pending");
      setResultMessage("Preview complete — no action was sent or recorded.");
      return;
    }

    if (btn.kind === "ui") {
      setPhase("success");
      setResultMessage(btn.honest);
      onSuccess?.();
      return;
    }

    if (!route) {
      setErrorMessage("This action is not yet connected.");
      setPhase("error");
      return;
    }

    setPhase("loading");
    try {
      const body = buttonPostBody(buttonKey, row, reason.trim(), composerChannel ? draft : undefined);
      const res = await fetch(route, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: { final_status?: string };
        lifecycle?: Record<string, unknown>;
        error?: string;
      };

      if (!res.ok || data.error) {
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
        setPhase("error");
        return;
      }

      const finalStatus =
        data.data && typeof data.data === "object"
          ? String((data.data as Record<string, unknown>).final_status ?? "")
          : "";

      // Never fall back to btn.honest here: that describes what the button was expected
      // to do (intent), not what the server actually confirmed happened. Prefer the
      // server-built lifecycle envelope (request_id, strictly whitelisted proof fields —
      // the envelope IS the trusted proof object, not nested under a `.fields` key) when
      // present. resolveLifecycleEvidence NEVER trusts data.data raw as a fallback: an
      // older/missing-lifecycle response is run through extractLifecycleProof's strict
      // whitelist first, so it can never bypass the whitelist by carrying stray fields
      // that were never proof of anything. The phase/message pair is decided entirely by
      // getTruthfulStatusPresentation, the single source of truth for this rule.
      const evidence = resolveLifecycleEvidence(data.lifecycle, data.data);
      const presentation = getTruthfulStatusPresentation(finalStatus, evidence);

      setResultMessage(presentation.message);
      setPhase(presentation.phase as Phase);

      if (presentation.phase === "artifact_ready" && presentation.artifact?.content) {
        // Server-confirmed artifact — sourced ONLY from the whitelisted lifecycle
        // fields getTruthfulStatusPresentation already validated, never raw response data.
        setArtifact({
          type: presentation.artifact.type ?? null,
          filename: presentation.artifact.filename ?? null,
          content: presentation.artifact.content,
          isLocalFallback: false,
        });
      } else if (composerChannel && draft.message_draft.trim()) {
        // The server response genuinely lacked confirmed artifact content (e.g. an
        // older/degraded response shape) — offer the operator's own local draft
        // instead, clearly labeled as such rather than as a persisted artifact.
        const localText =
          composerChannel === "email" && draft.subject.trim()
            ? `Subject: ${draft.subject}\n\n${draft.message_draft}`
            : draft.message_draft;
        setArtifact({
          type: null,
          filename: null,
          content: localText,
          isLocalFallback: true,
        });
      }

      // "Request handled; refresh state" — fires for both persisted and pending
      // outcomes. Not a claim of external execution success.
      onSuccess?.();
    } catch {
      setErrorMessage("Could not reach the server. Please check your connection.");
      setPhase("error");
    }
  }

  async function handleCopyArtifact() {
    if (!artifact?.content) return;
    const ok = await copyText(artifact.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function handleDownloadArtifact() {
    if (!artifact?.content) return;
    const base = row.company_domain || row.company_name || "message";
    const fallbackName = `${composerChannel ?? "message"}-${base}.txt`;
    downloadText(artifact.filename || fallbackName, artifact.content);
  }

  const showResultPhase = phase === "success" || phase === "artifact_ready" || phase === "pending";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-base font-semibold font-display">
            {btn.label}
          </DialogTitle>
        </DialogHeader>

        <div className="px-0 py-4 space-y-4">
          {pendingClose && (
            <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-300">Discard this draft?</p>
                <p className="text-xs text-amber-300/70 mt-1 leading-relaxed">
                  You've edited this message. Closing now will discard your changes.
                </p>
              </div>
            </div>
          )}

          {!pendingClose && phase === "confirm" && (
            <>
              {/* Sample data banner */}
              {previewOnly && (
                <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
                  <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-300 leading-relaxed">
                    Sample data — this shows what would happen in the live version. No action will be sent.
                  </p>
                </div>
              )}

              <p className="text-sm text-foreground leading-relaxed">{btn.honest}</p>

              {composerChannel && (
                <MessageComposer channel={composerChannel} row={row} onDraftChange={setDraft} />
              )}

              {cost && (
                <div className="rounded-lg bg-muted/40 border border-border px-4 py-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Cost
                  </p>
                  <p className="text-sm text-foreground">{cost.label}</p>
                  {cost.detail && (
                    <p className="text-[11px] text-muted-foreground mt-1">{cost.detail}</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="action-reason" className="text-sm font-medium">
                  Why are you doing this?{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="action-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Add a short reason (required)"
                  className="resize-none h-20 text-sm bg-input border-border focus-visible:ring-primary"
                />
                <p className="text-[11px] text-muted-foreground">
                  {previewOnly
                    ? "In the live version, this reason is logged with the action for audit purposes."
                    : "This is logged with the action so anyone reviewing later can see why it was taken."}
                </p>
              </div>
            </>
          )}

          {!pendingClose && phase === "loading" && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="ml-3 text-sm text-muted-foreground">Sending…</span>
            </div>
          )}

          {!pendingClose && showResultPhase && (
            <div className="flex flex-col items-center py-6 text-center gap-3">
              <div
                className={
                  phase === "pending"
                    ? "w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center"
                    : "w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center"
                }
              >
                {phase === "pending" ? (
                  <Info className="w-6 h-6 text-blue-400" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                )}
              </div>
              <p className="text-sm text-foreground leading-relaxed max-w-sm">
                {resultMessage}
              </p>

              {artifact?.content && (
                <div className="w-full text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {artifact.isLocalFallback ? "Your local draft" : "Ready to send yourself"}
                    </p>
                    {artifact.isLocalFallback && (
                      <span className="text-[10px] text-amber-400">Not confirmed by the server</span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs text-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5 max-h-40 overflow-y-auto font-sans">
                    {artifact.content}
                  </pre>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyArtifact}
                      className="h-7 text-xs gap-1.5"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadArtifact}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!pendingClose && phase === "error" && (
            <div className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{errorMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4 gap-2">
          {pendingClose && (
            <>
              <Button variant="outline" onClick={() => setPendingClose(false)} className="flex-1">
                Keep editing
              </Button>
              <Button variant="destructive" onClick={handleClose} className="flex-1">
                Discard changes
              </Button>
            </>
          )}

          {!pendingClose && (phase === "confirm" || phase === "error") && (
            <>
              <Button variant="outline" onClick={requestClose} className="flex-1">
                Cancel
              </Button>
              {phase === "confirm" && (
                <Button
                  onClick={handleConfirm}
                  disabled={!reason.trim() || Boolean(composerChannel && draft.blocked)}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {previewOnly ? "Preview only" : "Confirm"}
                </Button>
              )}
              {phase === "error" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPhase("confirm");
                    setErrorMessage("");
                  }}
                  className="flex-1"
                >
                  Try again
                </Button>
              )}
            </>
          )}

          {!pendingClose && (showResultPhase || phase === "loading") && (
            <Button
              onClick={handleClose}
              disabled={phase === "loading"}
              className="w-full bg-primary text-primary-foreground hover:bg-[#00c853]"
            >
              {phase === "loading" ? "Please wait…" : "Done"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
