// Company facts panel (Unit 2 Slice 1) — lets an operator manually
// confirm or correct one of the five supported company attributes for an
// account. Every confirmed value shown here is labeled "Manually
// confirmed" with its operator and date, matching what a future official
// evaluation's frozen evidence envelope will actually contain (see
// artifacts/api-server/src/services/accountFactsSnapshotEvidence.ts) —
// this panel never implies more than that.
//
// Deliberately thin: every decision that isn't "how does this look on
// screen" (view-model text, submission validation/args, error
// classification) lives in ../lib/account-facts-presentation.ts, tested
// there without a DOM — see that module's own comment.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import {
  fetchAccountFacts,
  recordAccountFact,
  accountFactsQueryKey,
  ACCOUNT_FACT_FIELDS,
  ACCOUNT_FACT_REGION_VALUES,
  type AccountFact,
  type AccountFactField,
} from "@/lib/account-facts-api";
import {
  buildFactRowViewModel,
  buildRecordAccountFactArgs,
  currentForField,
  describeAccountFactsError,
  displayFactValue,
  formatFactDateTime,
  historyForField,
} from "@/lib/account-facts-presentation";

const REGION_LABELS: Record<string, string> = {
  us: "US",
  emea: "EMEA",
  other: "Other",
};

interface AccountFactsPanelProps {
  accountId: string;
}

export function AccountFactsPanel({ accountId }: AccountFactsPanelProps) {
  const factsQ = useQuery({
    queryKey: accountFactsQueryKey(accountId),
    queryFn: () => fetchAccountFacts(accountId),
  });

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Confirmed account facts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          These manually confirmed values belong to the account record. Unconfirmed fields remain
          unknown — nothing here is guessed.
        </p>

        {factsQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {factsQ.isError && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">
              {factsQ.error instanceof Error
                ? factsQ.error.message
                : "Could not load company facts."}
            </p>
          </div>
        )}

        {factsQ.data && (
          <div className="divide-y divide-border">
            {ACCOUNT_FACT_FIELDS.map((field) => (
              <FactRow
                key={field}
                accountId={accountId}
                field={field}
                current={currentForField(factsQ.data!.current, field)}
                history={historyForField(factsQ.data!.history, field)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FactRow({
  accountId,
  field,
  current,
  history,
}: {
  accountId: string;
  field: AccountFactField;
  current: AccountFact | null;
  history: AccountFact[];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [value, setValue] = useState(current?.value ?? "");
  const [correctionReason, setCorrectionReason] = useState("");
  const [conflict, setConflict] = useState(false);

  const mutation = useMutation({
    mutationFn: recordAccountFact,
    onSuccess: async () => {
      setEditing(false);
      setCorrectionReason("");
      setConflict(false);
      await queryClient.invalidateQueries({ queryKey: accountFactsQueryKey(accountId) });
    },
    onError: (err) => {
      if (describeAccountFactsError(err).kind === "conflict") {
        setConflict(true);
      }
    },
  });

  function startEditing() {
    setValue(current?.value ?? "");
    setCorrectionReason("");
    setConflict(false);
    mutation.reset();
    setEditing(true);
  }

  // Re-fetches current/history so `current` (a prop, derived from the
  // parent's query) picks up the fresh value on the next render — the
  // operator's in-progress `value`/`correctionReason` state is
  // deliberately left untouched, only the stale expectedCurrentFactId
  // baseline this correction targets needs to catch up. See
  // account-facts-presentation.test.ts's "preserves the operator's draft"
  // coverage of buildRecordAccountFactArgs, the pure function this relies
  // on: it takes draftValue/draftCorrectionReason independently of
  // currentFactId, so refreshing the id alone never loses the draft.
  async function refreshAndRetry() {
    setConflict(false);
    mutation.reset();
    await queryClient.invalidateQueries({ queryKey: accountFactsQueryKey(accountId) });
  }

  function submit() {
    const result = buildRecordAccountFactArgs({
      accountId,
      field,
      currentFactId: current?.id ?? null,
      draftValue: value,
      draftCorrectionReason: correctionReason,
    });
    if (!result.ok) return;
    mutation.mutate(result.args);
  }

  const viewModel = buildFactRowViewModel(field, current);
  const isCorrection = current !== null;
  const reasonMissing = isCorrection && !correctionReason.trim();
  const errorPresentation = mutation.error ? describeAccountFactsError(mutation.error) : null;

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{viewModel.label}</p>
          {viewModel.confirmed ? (
            <p className="text-sm text-foreground mt-0.5">
              {viewModel.valueText}
              <span className="block text-[11px] text-muted-foreground/70 mt-0.5">
                {viewModel.attributionText}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">{viewModel.statusText}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => setShowHistory((v) => !v)}
            >
              History
              {showHistory ? (
                <ChevronUp className="w-3 h-3 ml-1" />
              ) : (
                <ChevronDown className="w-3 h-3 ml-1" />
              )}
            </Button>
          )}
          {!editing && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={startEditing}
            >
              {viewModel.actionLabel}
            </Button>
          )}
        </div>
      </div>

      {showHistory && history.length > 0 && (
        <ul className="mt-2 space-y-1.5 rounded-lg bg-muted/30 px-3 py-2">
          {history.map((entry) => (
            <li key={entry.id} className="text-[11px] text-muted-foreground/80">
              {displayFactValue(field, entry.value)} — {entry.recordedBy},{" "}
              {formatFactDateTime(entry.observedAt)}
              {entry.correctionReason && (
                <span className="italic"> ({entry.correctionReason})</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-input/40 p-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{viewModel.label}</Label>
            {field === "company.region" ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select a region" />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_FACT_REGION_VALUES.map((regionValue) => (
                    <SelectItem key={regionValue} value={regionValue}>
                      {REGION_LABELS[regionValue]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={`Enter ${viewModel.label.toLowerCase()}`}
                className="h-8 text-sm"
              />
            )}
          </div>

          {isCorrection && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">
                Correction reason (required)
              </Label>
              <Textarea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Why is this being corrected?"
                className="resize-none h-16 text-sm"
              />
            </div>
          )}

          {conflict && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  This value changed since it was last loaded.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={refreshAndRetry}
                >
                  Refresh and retry
                </Button>
              </div>
            </div>
          )}

          {!conflict && errorPresentation?.kind === "generic" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300 leading-relaxed">
                {errorPresentation.message}
              </p>
            </div>
          )}

          {mutation.isSuccess && (
            <div className="flex items-center gap-2 text-[11px] text-primary">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved.
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-3 text-[11px]"
              disabled={mutation.isPending || !value.trim() || reasonMissing}
              onClick={submit}
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-3 text-[11px]"
              disabled={mutation.isPending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
