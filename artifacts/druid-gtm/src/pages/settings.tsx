import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ENGINE_MODE_LABELS,
  QUEUE_SOURCE_LABELS,
  CONFIG_DANGER,
} from "@workspace/gtm-shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SettingsNav } from "@/components/settings-nav";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertTriangle,
  Lock,
  Unlock,
  FlaskConical,
} from "lucide-react";

interface ConfigResponse {
  config: Record<string, string>;
  usingSampleData: boolean;
}
interface QueueResponse {
  source: string;
  tab: string;
  rows: Record<string, string>[];
  usingSampleData: boolean;
}
interface SuppressionResponse {
  rows: Record<string, string>[];
  usingSampleData: boolean;
}
interface N8nStatusResponse {
  configured: boolean;
  reachable: boolean | null;
}

// ─── Config mutation helper ───────────────────────────────────────────────────
async function postConfig(payload: {
  key: string;
  value: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/n8n/config", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      approved_by: "operator",
      approved_at: new Date().toISOString(),
    }),
  });
  const data = (await res
    .json()
    .catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not reach the automation engine.");
  return data as { ok: boolean };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const qc = useQueryClient();

  const configQ = useQuery<ConfigResponse>({
    queryKey: ["sheets", "config"],
    queryFn: () =>
      fetch("/api/sheets/config", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ConfigResponse>,
    staleTime: 30_000,
  });

  const queueQ = useQuery<QueueResponse>({
    queryKey: ["sheets", "queue"],
    queryFn: () =>
      fetch("/api/sheets/queue", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<QueueResponse>,
    staleTime: 30_000,
  });

  const suppressionQ = useQuery<SuppressionResponse>({
    queryKey: ["sheets", "suppression"],
    queryFn: () =>
      fetch("/api/sheets/suppression", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<SuppressionResponse>,
    staleTime: 60_000,
  });

  const n8nQ = useQuery<N8nStatusResponse>({
    queryKey: ["n8n", "status"],
    queryFn: () =>
      fetch("/api/n8n/status", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<N8nStatusResponse>,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const configMutation = useMutation({
    mutationFn: postConfig,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sheets", "config"] });
    },
  });

  const config = configQ.data?.config ?? {};
  const usingSampleData = queueQ.data?.usingSampleData ?? true;
  const queueCount = queueQ.data?.rows?.length ?? 0;
  const suppressionRows = suppressionQ.data?.rows ?? [];
  const suppressionCount = suppressionRows.length;

  const engineModeKey = (
    config.engine_mode ?? "recommend_only"
  ) as keyof typeof ENGINE_MODE_LABELS;
  const currentMode =
    ENGINE_MODE_LABELS[engineModeKey] ?? ENGINE_MODE_LABELS.recommend_only;

  const queueSourceKey = (
    config.queue_source ?? "signal_queue"
  ) as keyof typeof QUEUE_SOURCE_LABELS;
  const currentSource =
    QUEUE_SOURCE_LABELS[queueSourceKey] ?? QUEUE_SOURCE_LABELS.signal_queue;

  const usVoiceCleared =
    String(config.us_voice_cleared ?? "false").toLowerCase() === "true";
  const accountQueueWriteOn =
    String(config.account_queue_write ?? "off").toLowerCase() === "on";

  const n8nConfigured = n8nQ.data?.configured ?? false;
  const n8nReachable = n8nQ.data?.reachable ?? null;
  const configLoading = configQ.isLoading || queueQ.isLoading;
  const n8nConnected = n8nConfigured && n8nReachable === true;

  return (
    <PageLayout width="narrow" className="space-y-8">
      <SettingsNav />
      <PageHeader title="Settings" description="Review and adjust how the system behaves." />

      {/* 1. Is sending turned on? */}
      <SettingsSection
        title="Is sending turned on?"
        description="Controls whether approved actions actually go out or are just logged for later."
      >
        {configLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : (
          <EngineModeCards
            current={engineModeKey}
            onSwitch={(newMode, reason) =>
              configMutation.mutate({
                key: "engine_mode",
                value: newMode,
                reason,
              })
            }
            n8nConnected={n8nConnected}
            mutating={configMutation.isPending}
          />
        )}
        {!n8nConnected && !configLoading && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Changes are disabled — the automation connection isn't available right now.
          </p>
        )}
        {configMutation.isError && (
          <InlineNotice tone="danger" className="mt-3">
            {configMutation.error?.message ?? "Something went wrong."}
          </InlineNotice>
        )}
      </SettingsSection>

      {/* 2. New review items */}
      <SettingsSection
        title="New review items"
        description="Controls whether new signals from scoring are added to the review list."
      >
        {configLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : (
          <QueueWriteSection
            queueWriteOn={accountQueueWriteOn}
            onToggle={(value, reason) =>
              configMutation.mutate({
                key: "account_queue_write",
                value,
                reason,
              })
            }
            n8nConnected={n8nConnected}
            mutating={configMutation.isPending}
          />
        )}
        {!n8nConnected && !configLoading && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Changes are disabled — the automation connection isn't available right now.
          </p>
        )}
      </SettingsSection>

      {/* 3. Which scoring model is active? — admin only, de-emphasized */}
      <SettingsSection
        title="Which scoring model is active?"
        description="Admin-only — most operators won't need to change this. It controls which queue the system writes to."
        deEmphasized
      >
        {configLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              {currentSource.label}
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {currentSource.detail}
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Changing this is disabled for now. It affects where review items are read from.
        </p>
      </SettingsSection>

      {/* 4. US calling permission */}
      <SettingsSection
        title="US calling permission"
        description="US law requires clear permission before an AI system calls someone in the US. Legal must confirm this before it can be turned on."
      >
        {configLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : (
          <UsVoicePanel
            cleared={usVoiceCleared}
            onConfirm={(reason) =>
              configMutation.mutate({
                key: "us_voice_cleared",
                value: "true",
                reason,
              })
            }
            n8nConnected={n8nConnected}
            mutating={configMutation.isPending}
          />
        )}
      </SettingsSection>

      {/* 5. Do-not-contact list */}
      <SettingsSection
        title="Do-not-contact list"
        description="Companies and contacts that must never be reached out to."
      >
        {suppressionQ.isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : suppressionRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              {suppressionQ.data?.usingSampleData
                ? "Live suppression data not connected."
                : "The do-not-contact list is empty."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Company / Contact
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Reason
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Added
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressionRows.slice(0, 50).map((row, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell className="text-sm text-foreground">
                      {row.company_name ||
                        row.company_domain ||
                        row.email ||
                        row.domain ||
                        "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.reason || row.block_reason || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.added_at || row.created_at || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {suppressionRows.length > 50 && (
              <p className="text-xs text-muted-foreground px-4 py-3 border-t border-border">
                Showing first 50 of {suppressionRows.length} entries.
              </p>
            )}
          </div>
        )}
      </SettingsSection>

      {/* 6. Sample workflow */}
      <SettingsSection
        title="Sample workflow"
        description="Use this only to send a safe example through the scoring workflow while the production workflows are being finalized."
      >
        <div className="rounded-xl border border-border bg-card px-4 py-4 flex items-start gap-4">
          <FlaskConical className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground font-medium">Open sample workflow</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Sends a safe example signal through the scoring engine. Nothing is sent to real contacts.
            </p>
          </div>
          <a
            href="/sample-lead"
            className="hover-elevate shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-xs font-medium text-foreground transition-colors"
          >
            Open
          </a>
        </div>
      </SettingsSection>

      {/* 7. Connection status */}
      <SettingsSection
        title="Connection status"
        description="Current state of your data and automation connections."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="Live data" loading={configLoading}>
            {usingSampleData ? (
              <StatusBadge tone="warning" dot>
                Using sample data
              </StatusBadge>
            ) : (
              <StatusBadge tone="success" dot>
                Connected
              </StatusBadge>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {usingSampleData
                ? "Live data not connected — showing sample data."
                : `Reading live data. ${queueCount} account${queueCount !== 1 ? "s" : ""} in queue.`}
            </p>
          </StatCard>

          <StatCard title="Active scoring view" loading={configLoading}>
            <p className="font-medium text-foreground">{currentSource.label}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {currentSource.detail}
            </p>
          </StatCard>

          <StatCard title="Sending state" loading={configLoading}>
            <StatusBadge
              tone={currentMode.color === "green" ? "success" : currentMode.color === "amber" ? "warning" : "danger"}
              dot
            >
              {currentMode.label}
            </StatusBadge>
            <p className="text-xs text-muted-foreground mt-2">
              {currentMode.detail}
            </p>
          </StatCard>

          <StatCard title="Automation engine" loading={n8nQ.isLoading}>
            {!n8nConfigured ? (
              <StatusBadge tone="neutral" dot>
                Not connected
              </StatusBadge>
            ) : n8nReachable ? (
              <StatusBadge tone="success" dot>
                Reachable
              </StatusBadge>
            ) : (
              <StatusBadge tone="warning" dot>
                Not responding
              </StatusBadge>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {!n8nConfigured
                ? "Automation engine URL is not configured."
                : n8nReachable
                ? "Engine is up and responding."
                : "Engine URL is configured but not responding right now."}
            </p>
          </StatCard>

          <Card className="sm:col-span-2 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Live counts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {queueQ.isLoading || suppressionQ.isLoading ? (
                <div className="flex gap-10">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                </div>
              ) : (
                <div className="flex gap-10">
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-foreground">
                      {queueCount}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Signals in the review list
                    </p>
                  </div>
                  <div className="w-px bg-border self-stretch" />
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-foreground">
                      {suppressionCount}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      On the do-not-contact list
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </SettingsSection>
    </PageLayout>
  );
}

// ─── Engine mode cards ────────────────────────────────────────────────────────
function EngineModeCards({
  current,
  onSwitch,
  n8nConnected,
  mutating,
}: {
  current: string;
  onSwitch: (mode: string, reason: string) => void;
  n8nConnected: boolean;
  mutating: boolean;
}) {
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const modes = Object.entries(ENGINE_MODE_LABELS) as [
    string,
    (typeof ENGINE_MODE_LABELS)[keyof typeof ENGINE_MODE_LABELS],
  ][];

  function openConfirm(mode: string) {
    if (mode === current || !n8nConnected) return;
    setPendingMode(mode);
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!pendingMode || !reason.trim()) return;
    onSwitch(pendingMode, reason.trim());
    setConfirmOpen(false);
    setReason("");
    setPendingMode(null);
  }

  function handleCancel() {
    setConfirmOpen(false);
    setReason("");
    setPendingMode(null);
  }

  const dotMap: Record<string, string> = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-red-500",
  };

  return (
    <>
      <div className="space-y-2">
        {modes.map(([key, meta]) => {
          const isActive = current === key;
          return (
            <button
              key={key}
              onClick={() => openConfirm(key)}
              disabled={isActive || !n8nConnected || mutating}
              className={cn(
                "w-full text-left rounded-xl border px-4 py-3 transition-all",
                isActive
                  ? "border-primary/40 bg-primary/10"
                  : n8nConnected
                  ? "border-border bg-card hover-elevate hover:border-border/80 cursor-pointer"
                  : "border-border bg-card opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    dotMap[meta.color] ?? "bg-zinc-500",
                  )}
                />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    isActive ? "text-primary" : "text-foreground",
                  )}
                >
                  {meta.label}
                </span>
                {isActive && (
                  <Badge className="ml-auto text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full">
                    Active
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 pl-4 leading-relaxed">
                {meta.detail}
              </p>
            </button>
          );
        })}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
          <DialogHeader className="border-b border-border pb-4">
            <DialogTitle className="text-base font-semibold font-display">
              Change sending mode?
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {pendingMode && (
              <p className="text-sm text-foreground leading-relaxed">
                You're switching to{" "}
                <span className="font-semibold">
                  {
                    ENGINE_MODE_LABELS[
                      pendingMode as keyof typeof ENGINE_MODE_LABELS
                    ]?.label
                  }
                </span>
                {" — "}
                {
                  ENGINE_MODE_LABELS[
                    pendingMode as keyof typeof ENGINE_MODE_LABELS
                  ]?.detail
                }
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Why are you making this change?{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add a brief reason (required)"
                className="resize-none h-20 text-sm bg-input border-border focus-visible:ring-primary"
              />
            </div>
          </div>
          <DialogFooter className="border-t border-border pt-4 gap-2">
            <Button variant="outline" onClick={handleCancel} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!reason.trim()}
              className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
            >
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Queue write toggle ───────────────────────────────────────────────────────
function QueueWriteSection({
  queueWriteOn,
  onToggle,
  n8nConnected,
  mutating,
}: {
  queueWriteOn: boolean;
  onToggle: (value: "on" | "off", reason: string) => void;
  n8nConnected: boolean;
  mutating: boolean;
}) {
  const [pendingValue, setPendingValue] = useState<"on" | "off" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const options = [
    {
      value: "on" as const,
      label: "On",
      detail:
        "New accounts from scoring will be added to the review list.",
      dot: "bg-emerald-400",
    },
    {
      value: "off" as const,
      label: "Off",
      detail:
        "Scoring continues to run, but new account review rows will not appear in the list.",
      dot: "bg-zinc-500",
    },
  ];

  const currentValue = queueWriteOn ? "on" : "off";

  function openConfirm(value: "on" | "off") {
    if (value === currentValue || !n8nConnected) return;
    setPendingValue(value);
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!pendingValue || !reason.trim()) return;
    onToggle(pendingValue, reason.trim());
    setConfirmOpen(false);
    setReason("");
    setPendingValue(null);
  }

  function handleCancel() {
    setConfirmOpen(false);
    setReason("");
    setPendingValue(null);
  }

  return (
    <>
      <div className="space-y-2">
        {options.map((opt) => {
          const isActive = currentValue === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => openConfirm(opt.value)}
              disabled={isActive || !n8nConnected || mutating}
              className={cn(
                "w-full text-left rounded-xl border px-4 py-3 transition-all",
                isActive
                  ? "border-primary/40 bg-primary/10"
                  : n8nConnected
                  ? "border-border bg-card hover-elevate hover:border-border/80 cursor-pointer"
                  : "border-border bg-card opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn("w-2 h-2 rounded-full shrink-0", opt.dot)}
                />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    isActive ? "text-primary" : "text-foreground",
                  )}
                >
                  {opt.label}
                </span>
                {isActive && (
                  <Badge className="ml-auto text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full">
                    Active
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 pl-4 leading-relaxed">
                {opt.detail}
              </p>
            </button>
          );
        })}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
          <DialogHeader className="border-b border-border pb-4">
            <DialogTitle className="text-base font-semibold font-display">
              Change queue writing?
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {pendingValue && (
              <p className="text-sm text-foreground leading-relaxed">
                You're turning queue writing{" "}
                <span className="font-semibold">
                  {pendingValue === "on" ? "On" : "Off"}
                </span>
                {" — "}
                {pendingValue === "on"
                  ? "new accounts from scoring will start appearing in the review list."
                  : "scoring will keep running, but no new review rows will be added to the list."}
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Why are you making this change?{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add a brief reason (required)"
                className="resize-none h-20 text-sm bg-input border-border focus-visible:ring-primary"
              />
            </div>
          </div>
          <DialogFooter className="border-t border-border pt-4 gap-2">
            <Button variant="outline" onClick={handleCancel} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!reason.trim()}
              className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
            >
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── US voice panel ───────────────────────────────────────────────────────────
function UsVoicePanel({
  cleared,
  onConfirm,
  n8nConnected,
  mutating,
}: {
  cleared: boolean;
  onConfirm: (reason: string) => void;
  n8nConnected: boolean;
  mutating: boolean;
}) {
  const [showUnlock, setShowUnlock] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [reason, setReason] = useState("");

  const required = CONFIG_DANGER.confirmText;
  const phraseMatch = typedPhrase.trim() === required;

  function handleUnlock() {
    if (!phraseMatch || !reason.trim()) return;
    onConfirm(reason.trim());
    setShowUnlock(false);
    setTypedPhrase("");
    setReason("");
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          cleared
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-amber-500/30 bg-amber-500/10",
        )}
      >
        {cleared ? (
          <Unlock className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              cleared ? "text-emerald-300" : "text-amber-300",
            )}
          >
            {cleared ? "US calling is permitted" : "US calling is locked"}
          </p>
          <p
            className={cn(
              "text-xs mt-0.5 leading-relaxed",
              cleared ? "text-emerald-300/70" : "text-amber-300/70",
            )}
          >
            {cleared
              ? "Legal has confirmed you can make AI calls to US contacts."
              : "US law requires written permission before calling US contacts with an AI system. Legal needs to sign off before this can be unlocked."}
          </p>
        </div>
      </div>

      {!cleared && (
        <>
          {!showUnlock ? (
            <Button
              variant="outline"
              onClick={() => setShowUnlock(true)}
              disabled={!n8nConnected || mutating}
              className="text-sm"
            >
              Confirm and turn on US calling
            </Button>
          ) : (
            <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300 leading-relaxed">
                  {CONFIG_DANGER.warning}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Type exactly to confirm:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {required}
                  </span>
                </Label>
                <Input
                  value={typedPhrase}
                  onChange={(e) => setTypedPhrase(e.target.value)}
                  placeholder={required}
                  className="h-10 text-sm bg-input border-border focus-visible:ring-primary font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Confirmation reason{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Legal confirmed via email on 2026-07-01"
                  className="resize-none h-16 text-sm bg-input border-border focus-visible:ring-primary"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowUnlock(false);
                    setTypedPhrase("");
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!phraseMatch || !reason.trim() || mutating}
                  onClick={handleUnlock}
                  className="bg-primary text-primary-foreground hover:bg-[#00c853] shadow-primary/20 shadow-lg"
                >
                  Confirm and turn on US calling
                </Button>
              </div>
            </div>
          )}
          {!n8nConnected && (
            <p className="text-[11px] text-muted-foreground">
              This control is disabled — the automation connection isn't available right now.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function SettingsSection({
  title,
  description,
  children,
  deEmphasized,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  deEmphasized?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2
          className={cn(
            "font-semibold font-display tracking-tight",
            deEmphasized
              ? "text-base text-muted-foreground"
              : "text-lg text-foreground",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  title,
  children,
  loading,
}: {
  title: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-48" />
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
