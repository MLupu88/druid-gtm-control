import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  createAccountDecision,
  accountDecisionsQueryKey,
  AccountDecisionsApiError,
  type CreatableRoutingOutput,
} from "@/lib/account-decisions-api";
import { accountDetailQueryKey, type AccountEvaluation } from "@/lib/accounts-api";

interface EffectiveSubmission {
  accountEvaluationId: string;
  routingOutput: CreatableRoutingOutput;
  routingReason: string | null;
}

interface PendingSubmission extends EffectiveSubmission {
  idempotencyKey: string;
}

function sameSubmission(a: EffectiveSubmission, b: EffectiveSubmission): boolean {
  return (
    a.accountEvaluationId === b.accountEvaluationId &&
    a.routingOutput === b.routingOutput &&
    a.routingReason === b.routingReason
  );
}

function describeError(err: unknown): string {
  if (err instanceof AccountDecisionsApiError) {
    switch (err.code) {
      case "operator_identity_required":
        return "Your signed-in session doesn't have a usable operator email configured, so this decision can't be attributed to you. Ask an admin to configure a named operator identity.";
      case "evaluation_not_eligible":
      case "record_not_found":
        return "This evaluation has changed or is no longer eligible for a decision. Refresh the page and try again.";
      case "idempotency_conflict":
        return "This submission conflicts with a previous request. Change the reason (or refresh the page) and try again.";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : "Could not record this decision.";
}

interface DecisionControlsProps {
  accountId: string;
  latestCompletedProductionEvaluation: AccountEvaluation | null;
}

export function DecisionControls({
  accountId,
  latestCompletedProductionEvaluation,
}: DecisionControlsProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const [lastOutcome, setLastOutcome] = useState<"success" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const isSubmittingRef = useRef(false);

  const mutation = useMutation({
    mutationFn: createAccountDecision,
    onSuccess: () => {
      setPending(null);
      setLastOutcome("success");
      setErrorMessage("");
      setReason("");
      void queryClient.invalidateQueries({
        queryKey: accountDecisionsQueryKey(accountId),
      });
      void queryClient.invalidateQueries({
        queryKey: accountDetailQueryKey(accountId),
      });
    },
    onError: (err, variables) => {
      setPending({
        idempotencyKey: variables.idempotencyKey,
        accountEvaluationId: variables.accountEvaluationId,
        routingOutput: variables.routingOutput,
        routingReason: variables.routingReason,
      });
      setLastOutcome("error");
      setErrorMessage(describeError(err));
    },
    onSettled: () => {
      isSubmittingRef.current = false;
    },
  });

  if (!latestCompletedProductionEvaluation) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
            Record a decision
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A decision can be recorded after this account has a saved ICP evaluation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const evaluationId = latestCompletedProductionEvaluation.id;

  function submit(routingOutput: CreatableRoutingOutput) {
    if (isSubmittingRef.current) return;

    const trimmed = reason.trim();
    const effective: EffectiveSubmission = {
      accountEvaluationId: evaluationId,
      routingOutput,
      routingReason: trimmed ? trimmed : null,
    };

    const idempotencyKey =
      pending && sameSubmission(pending, effective)
        ? pending.idempotencyKey
        : crypto.randomUUID();

    setLastOutcome(null);
    isSubmittingRef.current = true;
    mutation.mutate({ idempotencyKey, ...effective });
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Record a decision
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          This records your decision as a persisted, attributable record only — it does
          not send anything externally (no email, no CRM, no ad platform).
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="decision-reason" className="text-sm font-medium">
            Reason (optional)
          </Label>
          <Textarea
            id="decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add a short reason"
            disabled={mutation.isPending}
            className="resize-none h-20 text-sm bg-input border-border focus-visible:ring-primary"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={() => submit("mql")}
            disabled={mutation.isPending}
            className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            Promote to MQL
          </Button>
          <Button
            onClick={() => submit("sales_review")}
            disabled={mutation.isPending}
            variant="outline"
            className="flex-1"
          >
            Keep for review
          </Button>
        </div>

        {mutation.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Saving…
          </div>
        )}

        {!mutation.isPending && lastOutcome === "success" && (
          <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">Decision recorded.</p>
          </div>
        )}

        {!mutation.isPending && lastOutcome === "error" && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{errorMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
