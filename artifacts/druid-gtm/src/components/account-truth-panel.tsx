// Milestone 3H — current canonical truth (Milestone 3F reconciliation,
// always freshly computed — see GET /internal/accounts/:accountId/truth)
// for the account, with provenance on demand. Deliberately separate from
// ../components/account-facts-panel.tsx: that panel remains the manual
// confirm/correct EDITING surface (untouched by this milestone); this
// panel is a READ-ONLY summary of what Mission Control currently
// believes, reconciling manual facts AND provider observations together.
//
// Every decision that isn't "how does this look on screen" (status
// copy, value formatting, evidence-source labeling, display order) lives
// in ../lib/account-truth-presentation.ts, tested there without a DOM —
// see that module's own comment.

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineNotice } from "@/components/inline-notice";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { TechnicalDetails } from "@/components/technical-details";
import {
  fetchAccountTruth,
  accountTruthQueryKey,
  type AccountTruthField,
  type CanonicalTruthField,
  type EvidenceDTO,
} from "@/lib/account-truth-api";
import {
  buildTruthRowViewModel,
  evidenceSourceLabel,
  evidenceValueText,
  formatEvidenceTimestamp,
  sortFieldsForDisplay,
} from "@/lib/account-truth-presentation";

interface AccountTruthPanelProps {
  accountId: string;
}

export function AccountTruthPanel({ accountId }: AccountTruthPanelProps) {
  const truthQ = useQuery({
    queryKey: accountTruthQueryKey(accountId),
    queryFn: () => fetchAccountTruth(accountId),
  });

  const sortedFields = truthQ.data ? sortFieldsForDisplay(truthQ.data.fields) : null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Company &amp; CRM truth
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Reconciled from every confirmed source. A conflict stays visible even after a canonical
          value has been selected.
        </p>

        {truthQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        )}

        {truthQ.isError && (
          <InlineNotice tone="warning" title="Current truth unavailable">
            <div className="space-y-1.5">
              <p>
                Company/CRM confirmation status could not be loaded. Existing account facts remain
                accurate below.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => truthQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}

        {sortedFields && (
          <Accordion type="multiple">
            {sortedFields.map((field) => (
              <TruthRow key={field.canonicalField} field={field} />
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function TruthRow({ field }: { field: AccountTruthField }) {
  const viewModel = buildTruthRowViewModel(field.canonicalField, field);

  return (
    <AccordionItem value={field.canonicalField}>
      <AccordionTrigger className="text-sm py-2">
        <div className="flex flex-1 items-center justify-between gap-3 pr-2">
          <span className="text-xs font-medium text-foreground">{viewModel.label}</span>
          <span className="flex items-center gap-2">
            <span className="text-sm text-foreground">{viewModel.valueText}</span>
            <Badge variant={viewModel.badgeVariant} className="text-[10px]">
              {viewModel.statusText}
            </Badge>
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-2">
        <ProvenanceDetail field={field} />
      </AccordionContent>
    </AccordionItem>
  );
}

function ProvenanceDetail({ field }: { field: AccountTruthField }) {
  const hasEvidence =
    field.selectedEvidence !== null ||
    field.supportingEvidence.length > 0 ||
    field.conflictingEvidence.length > 0;

  return (
    <div className="space-y-2 text-xs">
      {field.rationale && <p className="text-muted-foreground leading-relaxed">{field.rationale}</p>}

      {field.selectedEvidence && (
        <EvidenceGroup label="Selected" canonicalField={field.canonicalField} entries={[field.selectedEvidence]} />
      )}
      {field.supportingEvidence.length > 0 && (
        <EvidenceGroup
          label="Supporting"
          canonicalField={field.canonicalField}
          entries={field.supportingEvidence}
        />
      )}
      {field.conflictingEvidence.length > 0 && (
        <EvidenceGroup
          label="Conflicting"
          canonicalField={field.canonicalField}
          entries={field.conflictingEvidence}
        />
      )}
      {!hasEvidence && <p className="text-muted-foreground/70">No evidence recorded yet.</p>}

      <TechnicalDetails summary="Technical details">
        <ul className="space-y-1 font-mono text-[11px] text-muted-foreground/80">
          <li>
            <span className="text-muted-foreground/50">Policy:</span> {field.policyVersion}
          </li>
          <li>
            <span className="text-muted-foreground/50">Computed:</span>{" "}
            {formatEvidenceTimestamp(field.computedAt) ?? "—"}
          </li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}

function EvidenceGroup({
  label,
  canonicalField,
  entries,
}: {
  label: string;
  canonicalField: CanonicalTruthField;
  entries: EvidenceDTO[];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1">{label}</p>
      <ul className="space-y-1">
        {entries.map((evidence, index) => (
          <li key={`${evidence.kind}-${evidence.id}-${index}`}>
            <EvidenceLine canonicalField={canonicalField} evidence={evidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceLine({
  canonicalField,
  evidence,
}: {
  canonicalField: CanonicalTruthField;
  evidence: EvidenceDTO;
}) {
  const source = evidenceSourceLabel(evidence);
  const value = evidenceValueText(canonicalField, evidence);
  const observedAt =
    evidence.kind === "unknown" ? null : formatEvidenceTimestamp(evidence.observedAt);

  return (
    <p className="text-foreground">
      <span className="font-medium">{source}</span> — {value}
      {observedAt && <span className="text-muted-foreground/70"> · {observedAt}</span>}
    </p>
  );
}
