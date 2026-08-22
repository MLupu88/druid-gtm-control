// Milestone 4A — Account Workspace Intelligence tab: read-only Account
// Brain claims (account_claims rows, read via
// ../lib/account-claims-api.ts). Every claim ever recorded is shown,
// grouped by claim key — including superseded and contradicting rows —
// never just the currently-winning one, so an operator can see the full
// evidence trail and any unresolved disagreement Mission Control never
// invented a winner for. No write UI here — 4A is service-layer-only for
// writes (see ../../artifacts/api-server/src/services/accountClaims.ts's
// own module comment).

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineNotice } from "@/components/inline-notice";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fetchAccountClaims, accountClaimsQueryKey, type AccountClaim } from "@/lib/account-claims-api";
import {
  claimKeyLabel,
  claimLifecycle,
  claimEvidenceSourceLabel,
  displayClaimValue,
  formatClaimTimestamp,
  groupClaimsByKey,
  originLabel,
} from "@/lib/account-claims-presentation";

interface AccountClaimsPanelProps {
  accountId: string;
}

export function AccountClaimsPanel({ accountId }: AccountClaimsPanelProps) {
  const claimsQ = useQuery({
    queryKey: accountClaimsQueryKey(accountId),
    queryFn: () => fetchAccountClaims(accountId),
  });

  const items = claimsQ.data?.items ?? null;
  const groups = items ? groupClaimsByKey(items) : null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Claims
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Every Account Brain claim recorded for this account, including superseded and
          contradicting assertions — Mission Control never invents a winner between disagreeing
          sources.
        </p>

        {claimsQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        )}

        {claimsQ.isError && (
          <InlineNotice tone="warning" title="Claims unavailable">
            <div className="space-y-1.5">
              <p>Account Brain claims could not be loaded.</p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => claimsQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}

        {groups && groups.size === 0 && (
          <Empty className="min-h-32 rounded-lg border border-dashed border-border bg-card/30">
            <EmptyHeader>
              <EmptyTitle>No claims yet</EmptyTitle>
              <EmptyDescription>
                Claims recorded from evidence, research, or operator confirmation will appear
                here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {groups && groups.size > 0 && (
          <ul className="space-y-3">
            {[...groups.entries()].map(([claimKey, claims]) => (
              <ClaimKeyGroup key={claimKey} claimKey={claimKey} claims={claims} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClaimKeyGroup({ claimKey, claims }: { claimKey: string; claims: AccountClaim[] }) {
  const current = claims.find((c) => c.isCurrent) ?? null;
  const history = claims.filter((c) => c !== current);

  return (
    <li className="rounded-lg border border-border/60 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-foreground">{claimKeyLabel(claimKey)}</span>
        {current ? (
          <span className="text-sm text-foreground">
            {displayClaimValue(current.valueType, current.value)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Unknown</span>
        )}
      </div>

      {current && <ClaimRow claim={current} />}

      {history.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1 text-[11px] text-muted-foreground">
              <ChevronDown className="size-3" />
              {history.length} earlier assertion{history.length === 1 ? "" : "s"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {history.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}

function ClaimRow({ claim }: { claim: AccountClaim }) {
  const lifecycle = claimLifecycle(claim);
  const createdAt = formatClaimTimestamp(claim.createdAt);

  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={lifecycle.badgeVariant} className="text-[10px]">
          {lifecycle.text}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {originLabel(claim.origin)}
        </Badge>
        {claim.confidence && (
          <span className="text-[10px] text-muted-foreground capitalize">{claim.confidence} confidence</span>
        )}
      </div>

      {claim.status === "active" && (
        <p className="text-xs text-foreground">{displayClaimValue(claim.valueType, claim.value)}</p>
      )}
      {claim.correctionReason && (
        <p className="text-[11px] text-muted-foreground italic">"{claim.correctionReason}"</p>
      )}

      {claim.evidence.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {claim.evidence.map((evidence) => (
            <li key={`${evidence.kind}:${evidence.id}`}>
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                {claimEvidenceSourceLabel(evidence)}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        {claim.recordedBy ? `${claim.recordedBy} · ` : ""}
        {createdAt ? `Recorded ${createdAt}` : null}
      </p>
    </div>
  );
}
