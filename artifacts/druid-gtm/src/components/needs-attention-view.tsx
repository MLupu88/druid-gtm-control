import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  OUTPUT_TYPE_LABELS,
  MOCK_ACCOUNT_QUEUE,
  firstValidNumber,
  countUnresolvedRows,
  QUEUE_QUERY_KEY,
  ACTION_LOG_QUERY_KEY,
} from "@workspace/gtm-shared";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { OutputTypeBadge } from "@/components/output-type-badge";
import { AccountDetailSheet } from "@/components/account-detail-sheet";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useSampleMode } from "@/lib/sample-mode";
import {
  type Row,
  type OutputTypeKey,
  rowOutputType,
  rowNeedsReview,
  safeWhyNow,
  rowIdentityLabel,
  blockReasonText,
} from "@/lib/queue-helpers";
import {
  fetchAccounts,
  accountsListQueryKey,
  ACCOUNTS_LIST_MAX_LIMIT,
  type Account,
  type AccountListItem,
} from "@/lib/accounts-api";
import { cn } from "@/lib/utils";
import { Search, AlertCircle, ArrowRight, Filter, Info } from "lucide-react";

// This is the extracted body of the former top-level "Needs Your
// Attention" page (pages/queue.tsx), mounted inside Accounts' "Needs
// attention" tab. All Sheet-backed data/queries and every existing n8n
// action are unchanged — see ../components/account-detail-sheet.tsx and
// ../components/action-modal.tsx for the unmodified action layer this
// view still drives. The only addition here is best-effort canonical
// account resolution (see resolveCanonicalAccount below) so a row can
// optionally link into its canonical PostgreSQL account page — this
// never changes what the queue itself shows or does.

interface ConfigResponse {
  config: Record<string, string>;
  usingSampleData: boolean;
}
interface QueueResponse {
  source: string;
  tab: string;
  rows: Row[];
  usingSampleData: boolean;
}

type FilterType = "all" | "attention" | "mql_ready" | OutputTypeKey;

// ─── Sample data ──────────────────────────────────────────────────────────────
const SAMPLE_ROWS: Row[] = (
  MOCK_ACCOUNT_QUEUE as unknown as Record<string, unknown>[]
).map(
  (r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, String(v ?? "")]),
    ) as Row,
);
const SAMPLE_SOURCE = "account_queue";

// ─── Canonical account resolution ──────────────────────────────────────────────
// Never by company name — only an exact queue account_key match against
// the canonical accountKey, or (failing that) a normalized-domain match.
// Same domain-normalization convention as the production bootstrap
// importer (trim, lowercase, strip protocol, strip leading www., strip
// trailing slash) so a domain that round-tripped through that importer
// resolves here too.
interface CanonicalLookup {
  byAccountKey: Map<string, Account>;
  byNormalizedDomain: Map<string, Account>;
}

function normalizeDomainForLinking(raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/\/+$/, "");
  return value === "" ? null : value;
}

function buildCanonicalLookup(accounts: Account[]): CanonicalLookup {
  const byAccountKey = new Map<string, Account>();
  const domainCandidates = new Map<string, Account[]>();

  for (const account of accounts) {
    const key = account.accountKey?.trim();
    if (key) byAccountKey.set(key, account);

    const normalizedDomain = normalizeDomainForLinking(account.companyDomain);
    if (normalizedDomain) {
      const candidates = domainCandidates.get(normalizedDomain) ?? [];
      candidates.push(account);
      domainCandidates.set(normalizedDomain, candidates);
    }
  }

  // The domain fallback may only resolve when a normalized domain maps to
  // exactly one canonical account. companyDomain carries no uniqueness
  // guarantee at the backend, so a domain shared by two or more distinct
  // accounts is genuinely ambiguous — it must be left out of this map
  // entirely (never resolved to whichever account happened to come
  // first), so resolveCanonicalAccount falls through to "unresolved" for
  // it, exactly like a domain with no match at all.
  const byNormalizedDomain = new Map<string, Account>();
  for (const [domain, candidates] of domainCandidates) {
    if (candidates.length === 1) {
      byNormalizedDomain.set(domain, candidates[0]!);
    }
  }

  return { byAccountKey, byNormalizedDomain };
}

function resolveCanonicalAccount(row: Row, lookup: CanonicalLookup): Account | null {
  const rawAccountKey = (row.account_key ?? "").trim();
  if (rawAccountKey) {
    const byKey = lookup.byAccountKey.get(rawAccountKey);
    if (byKey) return byKey;
  }
  const normalizedDomain = normalizeDomainForLinking(row.company_domain);
  if (normalizedDomain) {
    const byDomain = lookup.byNormalizedDomain.get(normalizedDomain);
    if (byDomain) return byDomain;
  }
  return null;
}

// ─── View ─────────────────────────────────────────────────────────────────────
export function NeedsAttentionView() {
  const [selected, setSelected] = useState<{
    row: Row;
    canonicalAccountId: string | null;
  } | null>(null);
  const [search, setSearch] = useState("");
  // Default to the unresolved-only view — a row that already has a persisted decision
  // is not something that "needs your attention," so it must not be the default sight.
  const [filter, setFilter] = useState<FilterType>("attention");
  const { viewMode, setViewMode } = useSampleMode();
  const isSampleMode = viewMode === "sample";
  const queryClient = useQueryClient();

  const configQ = useQuery<ConfigResponse>({
    queryKey: ["sheets", "config"],
    queryFn: () =>
      fetch("/api/sheets/config", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ConfigResponse>,
    staleTime: 30_000,
  });

  const queueQ = useQuery<QueueResponse>({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: () =>
      fetch("/api/sheets/queue", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<QueueResponse>,
    staleTime: 30_000,
  });

  // Best-effort canonical linking only — never a second queue/account
  // store. Reuses the exact same fetch + query key the "All accounts"
  // tab uses, so React Query dedupes the request rather than issuing a
  // parallel one when both tabs have been visited.
  const canonicalAccountsQ = useQuery({
    queryKey: accountsListQueryKey({ limit: ACCOUNTS_LIST_MAX_LIMIT }),
    queryFn: () => fetchAccounts({ limit: ACCOUNTS_LIST_MAX_LIMIT }),
    staleTime: 30_000,
  });
  const canonicalLookup = useMemo(
    () =>
      buildCanonicalLookup(
        (canonicalAccountsQ.data?.items ?? []).map((item) => item.account),
      ),
    [canonicalAccountsQ.data],
  );
  // Per-account latest canonical decision summary (id/routingOutput/
  // createdAt), keyed by account id — see AccountListItem.latestDecision
  // in ../lib/accounts-api.ts. Used below to exclude resolved rows whose
  // latest decision is "dismissed" or "mql" from the active view, without
  // a per-row decisions fetch.
  const latestDecisionByAccountId = useMemo(() => {
    const map = new Map<string, AccountListItem["latestDecision"]>();
    for (const item of canonicalAccountsQ.data?.items ?? []) {
      map.set(item.account.id, item.latestDecision);
    }
    return map;
  }, [canonicalAccountsQ.data]);

  const config = configQ.data?.config ?? {};
  const liveRows = queueQ.data?.rows ?? [];
  const liveSource = queueQ.data?.source ?? "signal_queue";
  const usingSampleData = queueQ.data?.usingSampleData ?? false;

  const rows = isSampleMode ? SAMPLE_ROWS : liveRows;
  const source = isSampleMode ? SAMPLE_SOURCE : liveSource;

  // Canonically active rows — the single source every Needs Attention
  // count, chip, filter, search result, and rendered row below derives
  // from. A row drops out here (and only here) once it resolved to a
  // canonical account whose latest persisted decision is "dismissed" or
  // "mql": that is a real, durable decision, so the row must not keep
  // counting or reappearing after refresh. An unresolved row (no
  // canonical match, or no decision recorded yet) is preserved untouched.
  // This predicate must not be reimplemented anywhere else — every
  // downstream count/list reads activeRows, never rows, directly.
  const activeRows = useMemo(
    () =>
      rows.filter((r) => {
        const canonicalAccount = resolveCanonicalAccount(r, canonicalLookup);
        if (!canonicalAccount) return true;
        const latestDecision = latestDecisionByAccountId.get(canonicalAccount.id);
        if (!latestDecision) return true;
        return (
          latestDecision.routingOutput !== "dismissed" &&
          latestDecision.routingOutput !== "mql"
        );
      }),
    [rows, canonicalLookup, latestDecisionByAccountId],
  );

  // The headline, orientation panel, and "Needs attention" chip must all reflect rows
  // that still need a decision — never activeRows.length, which counts every active row
  // regardless of review state.
  const unresolvedCount = useMemo(
    () => countUnresolvedRows(activeRows, source),
    [activeRows, source],
  );

  const presentTypes = useMemo(() => {
    const set = new Set<OutputTypeKey>();
    for (const row of activeRows) set.add(rowOutputType(row, source));
    return Array.from(set);
  }, [activeRows, source]);

  const isMqlReady = (r: Row) => {
    const t = rowOutputType(r, source);
    return t === "MQL";
  };

  const filteredRows = useMemo(() => {
    let result = activeRows;
    if (filter === "attention") {
      result = result.filter((r) => rowNeedsReview(r, source));
    } else if (filter === "mql_ready") {
      result = result.filter(isMqlReady);
    } else if (filter !== "all") {
      result = result.filter((r) => rowOutputType(r, source) === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.company_name?.toLowerCase().includes(q) ||
          r.company_domain?.toLowerCase().includes(q) ||
          r.contact_name?.toLowerCase().includes(q) ||
          r.contact_email?.toLowerCase().includes(q),
      );
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRows, source, filter, search]);

  const loading = queueQ.isLoading;

  function openRow(row: Row) {
    const canonicalAccount = resolveCanonicalAccount(row, canonicalLookup);
    setSelected({ row, canonicalAccountId: canonicalAccount?.id ?? null });
  }

  return (
    <div className="space-y-5">
      {/* Subtitle + view mode toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : isSampleMode
            ? `${unresolvedCount} sample signal${unresolvedCount !== 1 ? "s" : ""} — not from the live review list`
            : `${unresolvedCount} signal${unresolvedCount !== 1 ? "s" : ""} need review`}
        </p>
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Sample data banner */}
      {isSampleMode && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Sample data — these are example signals to illustrate the full review workflow. Actions
            are shown for demonstration only and will not be sent. Switch to Live data to review
            real signals.
          </span>
        </div>
      )}

      {/* Live backend sample data notice */}
      {!isSampleMode && usingSampleData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Sample data — live workbook not connected yet.</span>
        </div>
      )}

      {/* ── Orientation panel ── */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-muted/10">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="font-medium text-foreground/80 text-sm">What this list shows</p>
          <p>
            Each row is an account or buying signal the GTM engine thinks may need action. The
            colored label on the left is the recommendation. The score is secondary — use the
            recommendation, the reason, and whether we are allowed to act to make the call.
          </p>
          {isSampleMode && (
            <p className="text-blue-300/80">
              These are sample signals so stakeholders can understand the workflow. No action will
              be sent.
            </p>
          )}
          {!isSampleMode && !loading && unresolvedCount === 0 && (
            <p>No signals need review right now.</p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company or contact…"
          className="pl-9 h-10 bg-input border-border text-sm"
        />
      </div>

      {/* Legend + helper text + filter chips */}
      <div className="space-y-2">
        {/* Row anatomy helper */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed px-0.5">
          Start with the recommendation on the left. The score helps explain priority, but the
          decision should be based on the recommendation, the reason, and whether we are allowed to
          act.
        </p>

        {/* Compact legend */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-0.5">
          {[
            { term: "Recommendation", def: "What the system thinks should happen next" },
            { term: "Identity", def: "How confident we are about who the visitor is" },
            { term: "Needs review", def: "No human decision recorded yet" },
            { term: "Sample data", def: "Example signal — no action will be sent" },
          ].map(({ term, def }) => (
            <span key={term} className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/60">{term}:</span> {def}
            </span>
          ))}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <FilterChip
            label="All"
            active={filter === "all"}
            count={activeRows.length}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label="Needs attention"
            active={filter === "attention"}
            count={unresolvedCount}
            onClick={() => setFilter("attention")}
          />
          <FilterChip
            label="MQL / Ready for Sales"
            active={filter === "mql_ready"}
            count={activeRows.filter(isMqlReady).length}
            onClick={() => setFilter("mql_ready")}
          />
          {presentTypes
            .filter((t) => t !== "MQL" && t !== "Sales Review")
            .map((type) => (
              <FilterChip
                key={type}
                label={OUTPUT_TYPE_LABELS[type].label}
                active={filter === type}
                count={activeRows.filter((r) => rowOutputType(r, source) === type).length}
                onClick={() => setFilter(type)}
              />
            ))}
        </div>
      </div>

      {/* MQL filter helper */}
      {filter === "mql_ready" && !loading && (
        <p className="text-xs text-muted-foreground px-1">
          Showing accounts that are ready for sales action now.
        </p>
      )}

      {/* Row list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <EmptyState
          hasRows={activeRows.length > 0}
          hasFilter={filter !== "all" || !!search.trim()}
          // On the default "attention" view with no active search, an empty result
          // means everything has been actioned — that's a good outcome, not "try a
          // different filter," so it gets the same friendly message as zero rows.
          showAttentionEmpty={filter === "attention" && !search.trim()}
          isSampleMode={isSampleMode}
          onViewSample={() => setViewMode("sample")}
        />
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row, i) => (
            <QueueRow
              key={row.queue_key ?? row.account_key ?? String(i)}
              row={row}
              source={source}
              isSampleMode={isSampleMode}
              onClick={() => openRow(row)}
            />
          ))}
        </div>
      )}

      {/* Account detail sheet */}
      {selected && (
        <AccountDetailSheet
          row={selected.row}
          source={source}
          config={config}
          canonicalAccountId={selected.canonicalAccountId}
          open={!!selected}
          onClose={() => setSelected(null)}
          previewOnly={isSampleMode}
          onAction={() => {
            setSelected(null);
            // Invalidate (not just refetch this one hook instance) so the persisted
            // decision/final status appears immediately everywhere this query is used.
            // Also invalidate the action-log query — a persisted activation/decision
            // writes a new ICP_Action_Log row, and "Recent activity" reads that query.
            if (!isSampleMode) {
              void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
              void queryClient.invalidateQueries({ queryKey: ACTION_LOG_QUERY_KEY });
            }
          }}
          onDecisionPersisted={() => {
            // Fires the instant promote_mql/promote_mql_owner/dismiss actually
            // persists a canonical decision — independent of onAction above, so
            // the canonical accounts/decisions caches refresh even when the
            // action flow does NOT close the sheet (promote_mql_owner's owner
            // notification failing after the decision itself already saved).
            if (isSampleMode) return;
            void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
            void queryClient.invalidateQueries({
              queryKey: accountsListQueryKey({ limit: ACCOUNTS_LIST_MAX_LIMIT }),
            });
            if (selected.canonicalAccountId) {
              void queryClient.invalidateQueries({
                queryKey: ["account-decisions", selected.canonicalAccountId],
              });
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────
function FilterChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium transition-all border",
        active
          ? "bg-primary/20 text-primary border-primary/50"
          : "bg-white/5 text-muted-foreground border-border hover:bg-white/10 hover:text-foreground",
      )}
    >
      {label}
      {count > 0 && (
        <span
          className={cn(
            "ml-1.5",
            active ? "text-primary/70" : "text-muted-foreground/60",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Queue row ────────────────────────────────────────────────────────────────
function QueueRow({
  row,
  source,
  isSampleMode,
  onClick,
}: {
  row: Row;
  source: string;
  isSampleMode?: boolean;
  onClick: () => void;
}) {
  const outputType = rowOutputType(row, source);
  const identityLabel = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const isTestRow = String(row.test_mode).toLowerCase() === "true";
  const needsAttn = rowNeedsReview(row, source);
  const blockReason = row.block_reason
    ? blockReasonText(row.block_reason)
    : null;
  // Never zero-fill a missing score: firstValidNumber picks the first VALID numeric
  // candidate (account_score, then total_score) — a real "0" counts as valid, and an
  // empty/invalid account_score correctly falls through to total_score.
  const score = firstValidNumber(row.account_score, row.total_score);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:bg-white/[0.03] transition-colors px-4 py-4 group"
    >
      <div className="flex items-start gap-3">
        {/* Recommendation badge */}
        <div className="shrink-0 pt-0.5 w-36 text-left">
          <OutputTypeBadge outputType={outputType} showSub />
          {score !== null && (
            <span className="text-[10px] text-muted-foreground/50 mt-1 block pl-0.5 tabular-nums">
              Score: {score}
            </span>
          )}
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {row.company_name || row.company_domain}
            </span>
            {row.company_domain && row.company_name && (
              <span className="text-xs text-muted-foreground">
                {row.company_domain}
              </span>
            )}
            {identityLabel && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-border text-muted-foreground"
                title="Identity: how confident we are about who the visitor is"
              >
                {identityLabel.label}
              </Badge>
            )}
            {needsAttn && (
              <Badge
                className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full"
                title="Needs review: no human decision has been recorded yet"
              >
                Needs review
              </Badge>
            )}
            {(isTestRow || isSampleMode) && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
                title="Sample data: example signal — no action will be sent"
              >
                Sample data
              </Badge>
            )}
          </div>

          {whyNow && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
              {whyNow}
            </p>
          )}

          {blockReason && (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 mt-2">
              {blockReason}
            </span>
          )}
        </div>

        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({
  hasRows,
  hasFilter,
  showAttentionEmpty,
  isSampleMode,
  onViewSample,
}: {
  hasRows: boolean;
  hasFilter: boolean;
  showAttentionEmpty?: boolean;
  isSampleMode?: boolean;
  onViewSample?: () => void;
}) {
  if (!hasRows || showAttentionEmpty) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No signals need review right now.
        </p>
        <p className="text-xs text-muted-foreground">
          {hasRows
            ? "Everything in the queue has been actioned — nothing is waiting for a decision."
            : "When the GTM engine finds signals that need a decision, they will appear here."}
        </p>
        {!hasRows && !isSampleMode && onViewSample && (
          <Button
            size="sm"
            variant="outline"
            onClick={onViewSample}
            className="text-xs mt-4"
          >
            View sample workflow
          </Button>
        )}
      </div>
    );
  }
  if (hasFilter) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No signals match that filter. Try clearing it.
        </p>
      </div>
    );
  }
  return null;
}
