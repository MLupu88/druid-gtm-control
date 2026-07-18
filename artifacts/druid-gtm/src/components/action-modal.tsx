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
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { BUTTONS, getTruthfulStatusPresentation } from "@workspace/gtm-shared";
import {
  type Row,
  type ButtonKey,
  rowCostLabel,
  buttonEndpointRoute,
  buttonPostBody,
} from "@/lib/queue-helpers";

interface ActionModalProps {
  open: boolean;
  onClose: () => void;
  buttonKey: ButtonKey;
  row: Row;
  onSuccess?: () => void;
  previewOnly?: boolean;
}

type Phase = "confirm" | "loading" | "success" | "pending" | "error";

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

  const btn = BUTTONS[buttonKey];
  if (!btn) return null;

  const cost = rowCostLabel(row);
  const route = buttonEndpointRoute(buttonKey);

  function handleClose() {
    setReason("");
    setPhase("confirm");
    setResultMessage("");
    setErrorMessage("");
    onClose();
  }

  async function handleConfirm() {
    if (!reason.trim()) return;

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
      const body = buttonPostBody(buttonKey, row, reason.trim());
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
      // server-built lifecycle envelope (request_id, strictly whitelisted proof fields)
      // when present; fall back to the raw n8n data for older/other response shapes.
      // The phase/message pair is decided entirely by getTruthfulStatusPresentation,
      // the single source of truth for this rule.
      const evidence: Record<string, unknown> | undefined =
        data.lifecycle && typeof data.lifecycle === "object"
          ? data.lifecycle
          : (data.data as Record<string, unknown> | undefined);
      const { phase: resultPhase, message } = getTruthfulStatusPresentation(
        finalStatus,
        evidence,
      );

      setResultMessage(message);
      setPhase(resultPhase as Phase);
      // "Request handled; refresh state" — fires for both persisted and pending
      // outcomes. Not a claim of external execution success.
      onSuccess?.();
    } catch {
      setErrorMessage("Could not reach the server. Please check your connection.");
      setPhase("error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-base font-semibold font-display">
            {btn.label}
          </DialogTitle>
        </DialogHeader>

        <div className="px-0 py-4 space-y-4">
          {phase === "confirm" && (
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

          {phase === "loading" && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="ml-3 text-sm text-muted-foreground">Sending…</span>
            </div>
          )}

          {phase === "success" && (
            <div className="flex flex-col items-center py-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm text-foreground leading-relaxed max-w-sm">
                {resultMessage}
              </p>
            </div>
          )}

          {phase === "pending" && (
            <div className="flex flex-col items-center py-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center">
                <Info className="w-6 h-6 text-blue-400" />
              </div>
              <p className="text-sm text-foreground leading-relaxed max-w-sm">
                {resultMessage}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex items-start gap-3 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{errorMessage}</p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4 gap-2">
          {(phase === "confirm" || phase === "error") && (
            <>
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              {phase === "confirm" && (
                <Button
                  onClick={handleConfirm}
                  disabled={!reason.trim()}
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
          {(phase === "success" || phase === "pending" || phase === "loading") && (
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
