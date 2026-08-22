// LS8 — Account Workspace People tab: canonical people associated with
// this account (people/account_people rows, read via
// ../lib/account-people-api.ts), replacing the former hardcoded "People
// data is not available" placeholder. Renders only real canonical
// fields — no fabricated placeholders for a field a person genuinely
// doesn't have.

import { useQuery } from "@tanstack/react-query";
import { Building2, Linkedin, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineNotice } from "@/components/inline-notice";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  fetchAccountPeople,
  accountPeopleQueryKey,
  type AccountPerson,
} from "@/lib/account-people-api";
import { formatEvidenceTimestamp, providerDisplayName } from "@/lib/account-truth-presentation";
import { personDisplayName, personDisplayNameIsFallback } from "@/lib/account-people-presentation";

interface AccountPeoplePanelProps {
  accountId: string;
}

export function AccountPeoplePanel({ accountId }: AccountPeoplePanelProps) {
  const peopleQ = useQuery({
    queryKey: accountPeopleQueryKey(accountId),
    queryFn: () => fetchAccountPeople(accountId),
  });

  const items = peopleQ.data?.items ?? null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          People
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Canonical people resolved from provider evidence for this account.
        </p>

        {peopleQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        )}

        {peopleQ.isError && (
          <InlineNotice tone="warning" title="People unavailable">
            <div className="space-y-1.5">
              <p>Canonical people could not be loaded.</p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => peopleQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}

        {items && items.length === 0 && (
          <Empty className="min-h-32 rounded-lg border border-dashed border-border bg-card/30">
            <EmptyHeader>
              <EmptyTitle>No canonical people yet</EmptyTitle>
              <EmptyDescription>
                People resolved from trustworthy provider identity (e.g. a work email) will
                appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {items && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PersonRow({ person }: { person: AccountPerson }) {
  const name = personDisplayName(person);
  const nameIsFallback = personDisplayNameIsFallback(person);
  const lastSeen = formatEvidenceTimestamp(person.lastSeenAt);
  const firstSeen = formatEvidenceTimestamp(person.firstSeenAt);

  return (
    <li className="rounded-lg border border-border/60 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground">
            <Building2 className="size-3" />
          </span>
          <span className={nameIsFallback ? "text-xs text-muted-foreground" : "text-sm font-medium text-foreground"}>
            {name}
          </span>
          {person.title && <span className="text-xs text-muted-foreground">— {person.title}</span>}
        </div>
        <Badge variant="outline" className="text-[10px]">
          {providerDisplayName(person.source)}
        </Badge>
      </div>

      {(person.workEmail || person.linkedinUrl) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {person.workEmail && (
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" />
              {person.workEmail}
            </span>
          )}
          {person.linkedinUrl && (
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <Linkedin className="size-3" />
              LinkedIn
            </a>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        {lastSeen && `Last observed ${lastSeen}`}
        {lastSeen && firstSeen && firstSeen !== lastSeen && ` · first observed ${firstSeen}`}
      </p>
    </li>
  );
}
