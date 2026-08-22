// M3.5 — RB2B live signal last-mile: minimum truthful Account Workspace
// Activity visibility. Deliberately NOT the final ZoomInfo-style
// People/Activity UX (no filtering, no grouping, no per-provider
// summarization) — this exists to prove a real identified RB2B visitor
// is actually visible in Mission Control end to end. rawValue is shown
// verbatim (behind TechnicalDetails) rather than this component
// inventing provider-specific field parsing.

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineNotice } from "@/components/inline-notice";
import { TechnicalDetails } from "@/components/technical-details";
import {
  fetchAccountActivity,
  accountActivityQueryKey,
  type AccountActivityItem,
} from "@/lib/account-activity-api";
import { formatEvidenceTimestamp, providerDisplayName } from "@/lib/account-truth-presentation";
import { Mail, Linkedin } from "lucide-react";
import {
  extractRb2bActivityFields,
  formatRb2bLocation,
  hasAnyRb2bActivityFields,
} from "@/lib/account-activity-presentation";

interface AccountRecentActivityPanelProps {
  accountId: string;
}

export function AccountRecentActivityPanel({ accountId }: AccountRecentActivityPanelProps) {
  const activityQ = useQuery({
    queryKey: accountActivityQueryKey(accountId),
    queryFn: () => fetchAccountActivity(accountId),
  });

  const items = activityQ.data?.items ?? null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Recent activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Behavioral signals recorded for this account, newest first.
        </p>

        {activityQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        )}

        {activityQ.isError && (
          <InlineNotice tone="warning" title="Activity unavailable">
            <div className="space-y-1.5">
              <p>Recent activity could not be loaded.</p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => activityQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}

        {items && items.length === 0 && (
          <p className="text-xs text-muted-foreground/70">No recorded activity yet.</p>
        )}

        {items && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ item }: { item: AccountActivityItem }) {
  const occurredAt = formatEvidenceTimestamp(item.occurredAt);

  // Provider-scoped on purpose (see extractRb2bActivityFields's own
  // module comment) — never applied to a non-RB2B row's rawValue.
  const rb2bFields = item.provider === "rb2b" ? extractRb2bActivityFields(item.rawValue) : null;
  const showRb2bSummary = rb2bFields !== null && hasAnyRb2bActivityFields(rb2bFields);
  const location = rb2bFields ? formatRb2bLocation(rb2bFields) : null;

  return (
    <li className="rounded-lg border border-border/60 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {providerDisplayName(item.provider)}
          </Badge>
          <span className="text-xs font-medium text-foreground">{item.eventType}</span>
        </span>
        {occurredAt && <span className="text-[11px] text-muted-foreground/70">{occurredAt}</span>}
      </div>

      {showRb2bSummary && rb2bFields && (
        <div className="space-y-1">
          {(rb2bFields.personName || rb2bFields.title) && (
            <p className="text-xs text-foreground">
              {rb2bFields.personName && <span className="font-medium">{rb2bFields.personName}</span>}
              {rb2bFields.personName && rb2bFields.title && " — "}
              {rb2bFields.title && <span className="text-muted-foreground">{rb2bFields.title}</span>}
            </p>
          )}
          {rb2bFields.pageVisited && (
            <p className="truncate text-[11px] text-muted-foreground">
              Visited <span className="font-mono">{rb2bFields.pageVisited}</span>
            </p>
          )}
          {(location || rb2bFields.hasEmail || rb2bFields.hasLinkedin) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
              {location && <span>{location}</span>}
              {rb2bFields.hasEmail && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3" /> Email available
                </span>
              )}
              {rb2bFields.hasLinkedin && (
                <span className="inline-flex items-center gap-1">
                  <Linkedin className="size-3" /> LinkedIn available
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <TechnicalDetails summary="Raw event data">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80">
          {JSON.stringify(item.rawValue, null, 2)}
        </pre>
      </TechnicalDetails>
    </li>
  );
}
