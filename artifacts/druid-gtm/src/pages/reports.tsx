import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import {
  Download,
  ExternalLink,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
} from "lucide-react";
import {
  DECISION_LABELS,
  OUTPUT_TYPE_LABELS,
  ACTION_TYPE_LABELS,
  humanizeToken,
  getTruthfulStatusPresentation,
  isLinkedinSelfServeStatus,
} from "@workspace/gtm-shared";

// Live-data presentation helpers — map raw enums/values from the campaign-report API
// to business language for on-screen tables and the human-readable PDF export. The
// CSV export is left raw on purpose: it's an operational/interchange format, not
// something an operator reads directly.

function decisionLabel(decision: string): string {
  if (!decision) return "";
  return DECISION_LABELS[decision as keyof typeof DECISION_LABELS] ?? humanizeToken(decision);
}

// Never falls back to the raw enum — an unmapped output type is humanized, not shown verbatim.
function outputLabel(out: string): string {
  if (!out) return "";
  return OUTPUT_TYPE_LABELS[out as keyof typeof OUTPUT_TYPE_LABELS]?.label ?? humanizeToken(out);
}

// action_type describes the REQUESTED operation (e.g. "Notify account owner"),
// never a claim that it was externally completed. Kept separate from outputLabel —
// action_type and recommended_output are different concepts.
function actionTypeLabel(actionType: string): string {
  if (!actionType) return "";
  return (
    ACTION_TYPE_LABELS[actionType as keyof typeof ACTION_TYPE_LABELS] ?? humanizeToken(actionType)
  );
}

// recommended_action / recommended_solution are usually already human-written text
// from the sheet (e.g. "Approve email sequence (Salesforge)") — only humanize values
// that look like a raw enum token (snake_case / single lowercase word, no spaces or
// punctuation), so we never rewrite text that's already readable.
function humanizeIfEnumLike(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  const looksEnumLike = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(trimmed);
  return looksEnumLike ? humanizeToken(trimmed) : value;
}

// Status text for a live report row — reuses the exact same proof-based rule as the
// Cockpit action modal (getTruthfulStatusPresentation): only shows a confirmed-success
// phrase when the row carries explicit persistence/execution proof fields; otherwise
// the neutral request/status wording. `row` is typed `unknown` on purpose so any report
// row type can be passed as evidence without a cast or loosening that type's definition.
function liveStatusLabel(status: string, row: unknown, emptyFallback: string): string {
  if (!status) return emptyFallback;
  return getTruthfulStatusPresentation(status, row).message;
}

const ANALYTICS_URL: string =
  (import.meta.env.VITE_MARKETPLACE_ANALYTICS_URL as string | undefined) ||
  "https://datastudio.google.com/u/0/reporting/8475305e-1260-4c51-851d-b2f755d4c82c/page/p_92rv9whn3d";

interface MomMetric {
  label: string;
  current: string;
  previous: string;
  change: string;
  pct: string;
  direction: "up" | "down" | "flat";
}

// ─── CSV download helper (generic — column set is passed in by each caller) ──────
const CSV_COLUMNS = [
  "campaign_name","company_name","company_domain","contact_name","contact_title",
  "linkedin_profile_url","country","industry","recommended_solution","safe_context",
  "message_1","message_2","message_3","status",
];

// Campaign-wide operational export — one row per record from the canonical
// campaign packet (attention accounts, recommendations, decisions, actions, outcomes).
const OPERATIONAL_CSV_COLUMNS = [
  "record_type","campaign_key","campaign_name","period_start","period_end",
  "account_key","company_name","company_domain","why_now",
  "recommended_output","recommended_action","recommended_solution",
  "decision","final_status","action_type","action_at",
  "outcome","outcome_status","actual_cost","estimated_cost","cost_status",
];

function downloadCsv(rows: Record<string, string>[], filename: string, columns: string[]) {
  const header = columns.join(",");
  const body = rows
    .map((r) =>
      columns.map((c) => `"${(r[c] ?? "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function pdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfFilenameSlug(value: string): string {
  return pdfText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}


// ─── Canonical campaign-report contract (GET /api/sheets/campaign-report) ───────
// Types mirror artifacts/api-server/src/routes/sheets.ts exactly. The cockpit
// must not recompute any of these numbers — the endpoint is the single source
// of truth for live campaign reporting.

interface CampaignSummaryDef {
  campaign_key: string;
  campaign_name: string;
  signal_count: number;
  account_count: number;
  action_count: number;
}

type CampaignPeriodMode = "campaign_lifetime" | "selected_period";

interface CampaignPeriod {
  start: string | null;
  end: string | null;
  mode: CampaignPeriodMode;
}

interface CampaignReportSummary {
  signals: number;
  unique_accounts: number;
  accounts_reviewed: number;
  accounts_requiring_attention: number;
  recommended_actions: number;
  human_decisions: number;
  actions_logged: number;
  outcomes_recorded: number;
  actual_cost_actions: number;
  estimated_cost_actions: number;
  unavailable_cost_actions: number;
}

interface AttentionAccount {
  account_key: string;
  company_name: string;
  company_domain: string;
  why_now: string;
  recommended_output: string;
  recommended_action: string;
  recommended_solution: string;
  final_status: string;
}

interface Recommendation {
  account_key: string;
  company_name: string;
  company_domain: string;
  why_now: string;
  recommended_output: string;
  recommended_action: string;
  recommended_solution: string;
}

interface DecisionRecord {
  account_key: string;
  company_name: string;
  company_domain: string;
  decision: string;
  decided_at: string;
  why_now: string;
}

type CostStatus = "actual" | "estimated" | "unavailable";

interface ActionRecord {
  account_key: string;
  company_name: string;
  company_domain: string;
  action_type: string;
  recommended_output: string;
  recommended_action: string;
  final_status: string;
  status: string;
  why_now: string;
  action_at: string;
  actual_cost: string;
  estimated_cost: string;
  cost_status: CostStatus;
  outcome: string;
  outcome_status: string;
}

interface OutcomeRecord {
  account_key: string;
  company_name: string;
  company_domain: string;
  outcome: string;
  outcome_status: string;
  recorded_at: string;
}

interface CostRecord {
  account_key: string;
  company_name: string;
  action_type: string;
  actual_cost: string;
  estimated_cost: string;
  cost_status: CostStatus;
}

interface ManualExportCounts {
  linkedin_ready: number;
  linkedin_exported: number;
  linkedin_imported: number;
  outcomes_received: number;
}

interface AttributionSummary {
  total: number;
  attributed: number;
  unattributed: number;
}

interface CampaignReportResponse {
  campaigns: CampaignSummaryDef[];
  selected_campaign: { campaign_key: string; campaign_name: string } | null;
  period: CampaignPeriod;
  summary: CampaignReportSummary;
  attention_accounts: AttentionAccount[];
  recommendations: Recommendation[];
  decisions: DecisionRecord[];
  actions: ActionRecord[];
  outcomes: OutcomeRecord[];
  costs: CostRecord[];
  manual_exports: ManualExportCounts;
  attribution: Record<string, AttributionSummary>;
  limitations: string[];
  usingSampleData: boolean;
}

class CampaignReportAuthError extends Error {}
class CampaignReportRequestError extends Error {}

async function fetchCampaignReport(params: {
  campaign: string | null;
  start: string | null;
  end: string | null;
}): Promise<CampaignReportResponse> {
  const qs = new URLSearchParams();
  if (params.campaign) qs.set("campaign", params.campaign);
  if (params.start) qs.set("start", params.start);
  if (params.end) qs.set("end", params.end);
  const query = qs.toString();

  const res = await fetch(`/api/sheets/campaign-report${query ? `?${query}` : ""}`, {
    credentials: "include",
  });

  if (res.status === 401 || res.status === 403) {
    throw new CampaignReportAuthError(
      "You are not authorized to view live campaign reports. Sign in again.",
    );
  }

  if (!res.ok) {
    let message = `Campaign report request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Response body wasn't JSON — keep the generic message.
    }
    throw new CampaignReportRequestError(message);
  }

  return (await res.json()) as CampaignReportResponse;
}

// ─── Reporting-period controls ───────────────────────────────────────────────────
type PeriodMode = "lifetime" | "this_month" | "previous_month" | "custom";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// All month-bounds computation happens in UTC (not local time). The endpoint
// (parseCampaignDateBoundary in sheets.ts) treats bare YYYY-MM-DD strings as
// UTC day boundaries, so the frontend must resolve "this/previous month"
// against the same calendar the backend will apply them to — otherwise a
// user's local timezone offset could shift which records land in which
// bucket near month edges.
function monthBoundsFor(year: number, monthIndex0: number): { start: string; end: string } {
  const start = `${year}-${pad2(monthIndex0 + 1)}-01`;
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const end = `${year}-${pad2(monthIndex0 + 1)}-${pad2(lastDay)}`;
  return { start, end };
}

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  return monthBoundsFor(now.getUTCFullYear(), now.getUTCMonth());
}

function previousMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const monthIndex0 = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return monthBoundsFor(year, monthIndex0);
}

function resolvePeriodRange(
  mode: PeriodMode,
  customStart: string,
  customEnd: string,
): { start: string | null; end: string | null } {
  if (mode === "this_month") return currentMonthBounds();
  if (mode === "previous_month") return previousMonthBounds();
  if (mode === "custom") return { start: customStart || null, end: customEnd || null };
  return { start: null, end: null };
}

function periodPickerLabel(
  mode: PeriodMode,
  customStart: string,
  customEnd: string,
): string {
  if (mode === "this_month") {
    const b = currentMonthBounds();
    return `This month (${b.start} to ${b.end})`;
  }
  if (mode === "previous_month") {
    const b = previousMonthBounds();
    return `Previous month (${b.start} to ${b.end})`;
  }
  if (mode === "custom") {
    if (customStart || customEnd) {
      return `Custom (${customStart || "…"} to ${customEnd || "…"})`;
    }
    return "Custom period";
  }
  return "Campaign lifetime";
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function formatResolvedPeriod(period: CampaignPeriod | undefined): string {
  if (!period) return "Unknown";
  if (period.mode === "campaign_lifetime") return "Campaign lifetime (no date filter)";
  const start = formatDateOnly(period.start);
  const end = formatDateOnly(period.end);
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Through ${end}`;
  return "Selected period";
}

// ─── Live month-over-month (diff/percent formatting only — no reclassification) ─
function buildLiveMomMetrics(
  current: CampaignReportSummary,
  previous: CampaignReportSummary,
): MomMetric[] {
  const metric = (label: string, cv: number, pv: number): MomMetric => {
    const diff = cv - pv;
    const pct = pv > 0 ? Math.round((diff / pv) * 100) : cv > 0 ? 100 : 0;
    return {
      label,
      current: String(cv),
      previous: String(pv),
      change: (diff >= 0 ? "+" : "") + diff,
      pct: pv === 0 && cv === 0 ? "0%" : (pct >= 0 ? "+" : "") + pct + "%",
      direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
    };
  };

  return [
    metric("Signals", current.signals, previous.signals),
    metric("Unique accounts", current.unique_accounts, previous.unique_accounts),
    metric("Accounts reviewed", current.accounts_reviewed, previous.accounts_reviewed),
    metric("Accounts requiring attention", current.accounts_requiring_attention, previous.accounts_requiring_attention),
    metric("Recommended actions", current.recommended_actions, previous.recommended_actions),
    metric("Human decisions", current.human_decisions, previous.human_decisions),
    metric("Actions logged", current.actions_logged, previous.actions_logged),
    metric("Outcomes recorded", current.outcomes_recorded, previous.outcomes_recorded),
  ];
}

function formatCostStatusSummary(summary: CampaignReportSummary): string {
  return `${summary.actual_cost_actions} actual · ${summary.estimated_cost_actions} estimated · ${summary.unavailable_cost_actions} unavailable`;
}

const ATTRIBUTION_SOURCE_LABELS: Record<string, string> = {
  signal_events: "Signal events",
  account_records: "Account records",
  review_queue: "Review queue",
  account_queue: "Account queue",
  action_log: "Action log",
};

// Operational CSV: one row per record in the canonical packet, denormalized
// with the resolved campaign/period so every row is self-describing.
function buildOperationalCsvRows(report: CampaignReportResponse): Record<string, string>[] {
  const campaign_key = report.selected_campaign?.campaign_key ?? "";
  const campaign_name = report.selected_campaign?.campaign_name ?? "";
  const period_start = report.period.start ?? "";
  const period_end = report.period.end ?? "";
  const base = { campaign_key, campaign_name, period_start, period_end };

  const attention = report.attention_accounts.map((a) => ({
    ...base,
    record_type: "attention_account",
    account_key: a.account_key,
    company_name: a.company_name,
    company_domain: a.company_domain,
    why_now: a.why_now,
    recommended_output: a.recommended_output,
    recommended_action: a.recommended_action,
    recommended_solution: a.recommended_solution,
    final_status: a.final_status,
  }));

  const recommendations = report.recommendations.map((r) => ({
    ...base,
    record_type: "recommendation",
    account_key: r.account_key,
    company_name: r.company_name,
    company_domain: r.company_domain,
    why_now: r.why_now,
    recommended_output: r.recommended_output,
    recommended_action: r.recommended_action,
    recommended_solution: r.recommended_solution,
  }));

  const decisions = report.decisions.map((d) => ({
    ...base,
    record_type: "decision",
    account_key: d.account_key,
    company_name: d.company_name,
    company_domain: d.company_domain,
    why_now: d.why_now,
    decision: d.decision,
    action_at: d.decided_at,
  }));

  const actions = report.actions.map((a) => ({
    ...base,
    record_type: "action",
    account_key: a.account_key,
    company_name: a.company_name,
    company_domain: a.company_domain,
    why_now: a.why_now,
    recommended_output: a.recommended_output,
    recommended_action: a.recommended_action,
    final_status: a.final_status,
    action_type: a.action_type,
    action_at: a.action_at,
    outcome: a.outcome,
    outcome_status: a.outcome_status,
    actual_cost: a.actual_cost,
    estimated_cost: a.estimated_cost,
    cost_status: a.cost_status,
  }));

  const outcomes = report.outcomes.map((o) => ({
    ...base,
    record_type: "outcome",
    account_key: o.account_key,
    company_name: o.company_name,
    company_domain: o.company_domain,
    outcome: o.outcome,
    outcome_status: o.outcome_status,
    action_at: o.recorded_at,
  }));

  return [...attention, ...recommendations, ...decisions, ...actions, ...outcomes];
}

// ─── Campaign PDF export (jsPDF/autoTable) ───────────────────────────────────────

interface LiveCampaignPdfInput {
  campaignName: string;
  campaignKey: string;
  periodLabel: string;
  resolvedPeriod: CampaignPeriod;
  summary: CampaignReportSummary;
  attentionAccounts: AttentionAccount[];
  recommendations: Recommendation[];
  decisions: DecisionRecord[];
  actions: ActionRecord[];
  outcomes: OutcomeRecord[];
  costs: CostRecord[];
  manualExports: ManualExportCounts;
  attribution: Record<string, AttributionSummary>;
  limitations: string[];
  momMetrics: MomMetric[] | null;
  usingSampleData: boolean;
}

async function downloadLiveCampaignPdf(input: LiveCampaignPdfInput): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const tableDoc = doc as typeof doc & {
    lastAutoTable?: {
      finalY: number;
    };
  };

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const footerReserve = 18;

  const generatedAt = new Date();
  const campaignName = pdfText(input.campaignName) || "Campaign";

  doc.setProperties({
    title: `${campaignName} - Campaign Signal Report`,
    subject: "DRUID GTM campaign signal report",
    author: "DRUID GTM Mission Control",
    creator: "DRUID GTM Mission Control",
  });

  let y = 0;

  const ensureSpace = (requiredHeight = 18) => {
    if (y + requiredHeight > pageHeight - footerReserve) {
      doc.addPage();
      y = 16;
    }
  };

  const drawWrapped = (
    value: string,
    fontSize = 9,
    color: [number, number, number] = [56, 61, 71],
  ) => {
    const lines = doc.splitTextToSize(pdfText(value), contentWidth) as string[];
    ensureSpace(lines.length * 4.2 + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    doc.text(lines, margin, y);
    y += lines.length * 4.2 + 3;
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(91, 74, 163);
    doc.text(pdfText(title).toUpperCase(), margin, y);
    y += 2;
    doc.setDrawColor(91, 74, 163);
    doc.setLineWidth(0.35);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  };

  const updateYAfterTable = () => {
    y = (tableDoc.lastAutoTable?.finalY ?? y) + 7;
  };

  const drawTableOrEmpty = (
    head: string[],
    rows: string[][],
    emptyMessage: string,
    columnStyles: Record<number, { cellWidth?: number; halign?: "left" | "right" | "center" }>,
    fontSize = 8,
  ) => {
    const body = rows.length ? rows : [[emptyMessage, ...Array(head.length - 1).fill("")]];
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      theme: "grid",
      margin: { left: margin, right: margin, bottom: footerReserve },
      styles: {
        font: "helvetica",
        fontSize,
        cellPadding: 2.2,
        overflow: "linebreak",
        textColor: "#20242C",
        lineColor: "#D9DCE3",
        lineWidth: 0.15,
      },
      headStyles: { fillColor: "#5B4AA3", textColor: "#FFFFFF", fontStyle: "bold" },
      columnStyles,
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    updateYAfterTable();
  };

  // Header
  doc.setFillColor(91, 74, 163);
  doc.rect(0, 0, pageWidth, 27, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("DRUID GTM Mission Control", margin, 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Campaign signal report — Live data", margin, 19);

  y = 37;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(31, 35, 43);

  const campaignTitleLines = doc.splitTextToSize(campaignName, contentWidth) as string[];
  doc.text(campaignTitleLines, margin, y);
  y += campaignTitleLines.length * 7 + 1;

  const metadata = [
    "Mode: Live data",
    `Campaign key: ${input.campaignKey || "—"}`,
    `Period: ${input.periodLabel}`,
    `Generated: ${generatedAt.toLocaleString("en-GB")}`,
  ].filter(Boolean);

  drawWrapped(metadata.join(" | "), 8.5, [90, 95, 105]);

  if (input.usingSampleData) {
    ensureSpace(14);
    doc.setFillColor(255, 247, 224);
    doc.setDrawColor(224, 174, 65);
    doc.roundedRect(margin, y, contentWidth, 10, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(130, 84, 0);
    doc.text(
      "Google Sheets is not configured — live figures cannot be produced until it is connected.",
      margin + 4,
      y + 6.4,
    );
    y += 16;
  }

  // 1. Campaign overview
  drawSectionTitle("Campaign overview");
  autoTable(doc, {
    startY: y,
    head: [["Field", "Value"]],
    body: [
      ["Campaign name", pdfText(campaignName)],
      ["Campaign key", pdfText(input.campaignKey)],
      ["Mode", "Live data"],
    ],
    theme: "grid",
    margin: { left: margin, right: margin, bottom: footerReserve },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.4, overflow: "linebreak", textColor: "#20242C", lineColor: "#D9DCE3", lineWidth: 0.15 },
    headStyles: { fillColor: "#5B4AA3", textColor: "#FFFFFF", fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 140 } },
    showHead: "everyPage",
  });
  updateYAfterTable();

  // 2. Reporting period
  drawSectionTitle("Reporting period");
  drawWrapped(`Requested: ${input.periodLabel}`, 9);
  drawWrapped(`Resolved by the campaign-report endpoint: ${formatResolvedPeriod(input.resolvedPeriod)}`, 9);

  // 3. Signal and unique-account totals
  drawSectionTitle("Signal and unique-account totals");
  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Signals", pdfText(input.summary.signals)],
      ["Unique accounts", pdfText(input.summary.unique_accounts)],
      ["Accounts reviewed", pdfText(input.summary.accounts_reviewed)],
      ["Accounts requiring attention", pdfText(input.summary.accounts_requiring_attention)],
      ["Recommended actions", pdfText(input.summary.recommended_actions)],
      ["Human decisions", pdfText(input.summary.human_decisions)],
      ["Actions logged", pdfText(input.summary.actions_logged)],
      ["Outcomes recorded", pdfText(input.summary.outcomes_recorded)],
      ["Cost-data status", pdfText(formatCostStatusSummary(input.summary))],
    ],
    theme: "grid",
    margin: { left: margin, right: margin, bottom: footerReserve },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.4, overflow: "linebreak", textColor: "#20242C", lineColor: "#D9DCE3", lineWidth: 0.15 },
    headStyles: { fillColor: "#5B4AA3", textColor: "#FFFFFF", fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 90, halign: "right", fontStyle: "bold" } },
    showHead: "everyPage",
  });
  updateYAfterTable();

  // 4. Accounts requiring attention
  drawSectionTitle("Accounts requiring attention");
  drawTableOrEmpty(
    ["Company", "Why now", "Recommended", "Status"],
    input.attentionAccounts.map((a) => [
      pdfText(a.company_domain ? `${a.company_name} (${a.company_domain})` : a.company_name),
      pdfText(a.why_now),
      pdfText(
        [
          outputLabel(a.recommended_output),
          humanizeIfEnumLike(a.recommended_action),
          humanizeIfEnumLike(a.recommended_solution),
        ].filter(Boolean).join(" / "),
      ),
      pdfText(liveStatusLabel(a.final_status, a, "Not yet decided")),
    ]),
    "No accounts currently require attention.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 100 }, 2: { cellWidth: 90 }, 3: { cellWidth: 40 } },
    7.8,
  );

  // 5. Recommended GTM actions and why-now
  drawSectionTitle("Recommended GTM actions and why-now");
  drawTableOrEmpty(
    ["Company", "Recommended", "Why now"],
    input.recommendations.map((r) => [
      pdfText(r.company_domain ? `${r.company_name} (${r.company_domain})` : r.company_name),
      pdfText(
        [
          outputLabel(r.recommended_output),
          humanizeIfEnumLike(r.recommended_action),
          humanizeIfEnumLike(r.recommended_solution),
        ].filter(Boolean).join(" / "),
      ),
      pdfText(r.why_now),
    ]),
    "No recommendations recorded.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 90 }, 2: { cellWidth: 140 } },
    7.8,
  );

  // 6. Human decisions taken
  drawSectionTitle("Human decisions taken");
  drawTableOrEmpty(
    ["Company", "Decision", "Decided at", "Why now"],
    input.decisions.map((d) => [
      pdfText(d.company_domain ? `${d.company_name} (${d.company_domain})` : d.company_name),
      pdfText(decisionLabel(d.decision)),
      pdfText(d.decided_at || "—"),
      pdfText(d.why_now),
    ]),
    "No human decisions recorded.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 55 }, 2: { cellWidth: 40 }, 3: { cellWidth: 135 } },
    7.8,
  );

  // 7. Actions logged
  drawSectionTitle("Actions logged");
  drawTableOrEmpty(
    ["Company", "Action type", "Status", "Action at", "Cost status"],
    input.actions.map((a) => [
      pdfText(a.company_domain ? `${a.company_name} (${a.company_domain})` : a.company_name),
      pdfText(actionTypeLabel(a.action_type)),
      pdfText(liveStatusLabel(a.final_status || a.status, a, "—")),
      pdfText(a.action_at || "—"),
      pdfText(a.cost_status),
    ]),
    "No actions logged.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 55 }, 2: { cellWidth: 55 }, 3: { cellWidth: 40 }, 4: { cellWidth: 35 } },
    7.8,
  );

  // 8. Outcomes
  drawSectionTitle("Outcomes");
  drawTableOrEmpty(
    ["Company", "Outcome", "Outcome status", "Recorded at"],
    input.outcomes.map((o) => [
      pdfText(o.company_domain ? `${o.company_name} (${o.company_domain})` : o.company_name),
      pdfText(o.outcome),
      pdfText(o.outcome_status),
      pdfText(o.recorded_at || "—"),
    ]),
    "No outcome data connected.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 90 }, 2: { cellWidth: 55 }, 3: { cellWidth: 40 } },
    7.8,
  );

  // 9. Cost-per-action/status view
  drawSectionTitle("Cost per action / status");
  drawTableOrEmpty(
    ["Company", "Action type", "Actual cost", "Estimated cost", "Cost status"],
    input.costs.map((c) => [
      pdfText(c.company_name),
      pdfText(actionTypeLabel(c.action_type)),
      pdfText(c.actual_cost || "—"),
      pdfText(c.estimated_cost || "—"),
      pdfText(c.cost_status),
    ]),
    "Actual vendor spend unavailable — no cost records for this period.",
    { 0: { cellWidth: 65 }, 1: { cellWidth: 55 }, 2: { cellWidth: 40 }, 3: { cellWidth: 45 }, 4: { cellWidth: 45 } },
    7.8,
  );

  // 10. Current month vs previous month
  drawSectionTitle("Current month versus previous month");
  if (input.momMetrics?.length) {
    autoTable(doc, {
      startY: y,
      head: [["Metric", "This month", "Last month", "Change"]],
      body: input.momMetrics.map((metric) => [
        pdfText(metric.label),
        pdfText(metric.current),
        pdfText(metric.previous),
        pdfText(`${metric.change} ${metric.pct}`),
      ]),
      theme: "grid",
      margin: { left: margin, right: margin, bottom: footerReserve },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2.2, overflow: "linebreak", textColor: "#20242C", lineColor: "#D9DCE3", lineWidth: 0.15 },
      headStyles: { fillColor: "#5B4AA3", textColor: "#FFFFFF", fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 42, halign: "right" }, 2: { cellWidth: 42, halign: "right" }, 3: { cellWidth: 48, halign: "right" } },
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });
    updateYAfterTable();
  } else {
    drawWrapped(
      "Not enough campaign history is available yet to compare this month with the previous month.",
      8.5,
    );
  }

  // 11. Manual LinkedIn export status
  drawSectionTitle("Manual LinkedIn export status");
  autoTable(doc, {
    startY: y,
    head: [["Status", "Count"]],
    body: [
      ["Ready for export", pdfText(input.manualExports.linkedin_ready)],
      ["Exported for Dripify", pdfText(input.manualExports.linkedin_exported)],
      ["Imported to Dripify", pdfText(input.manualExports.linkedin_imported)],
      ["Outcomes received", pdfText(input.manualExports.outcomes_received)],
    ],
    theme: "grid",
    margin: { left: margin, right: margin, bottom: footerReserve },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.4, overflow: "linebreak", textColor: "#20242C", lineColor: "#D9DCE3", lineWidth: 0.15 },
    headStyles: { fillColor: "#5B4AA3", textColor: "#FFFFFF", fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 60, halign: "right" } },
    showHead: "everyPage",
  });
  updateYAfterTable();
  drawWrapped(
    "LinkedIn activity is prepared for manual CSV export and import into Dripify. No LinkedIn message is sent automatically from this application.",
    8,
    [100, 104, 113],
  );

  // 12. Attribution diagnostics
  drawSectionTitle("Attribution diagnostics");
  const attributionRows = Object.entries(input.attribution).map(([key, value]) => [
    pdfText(ATTRIBUTION_SOURCE_LABELS[key] ?? key),
    pdfText(value.total),
    pdfText(value.attributed),
    pdfText(value.unattributed),
  ]);
  drawTableOrEmpty(
    ["Source", "Total records", "Attributed", "Unattributed"],
    attributionRows,
    "No attribution data available.",
    { 0: { cellWidth: 90 }, 1: { cellWidth: 60, halign: "right" }, 2: { cellWidth: 60, halign: "right" }, 3: { cellWidth: 60, halign: "right" } },
    8.5,
  );

  // 13. Assumptions and data limitations
  drawSectionTitle("Assumptions and data limitations");

  const assumptions = [
    "Costs are estimates until production vendor cost feeds are connected.",
    "Email approvals are logged only; no email-sending tool is connected.",
    "LinkedIn approvals are prepared for manual import into Dripify.",
    "Account owner notifications are logged until CRM writeback is connected.",
    "Retargeting markers do not spend advertising budget until an ad-platform sync is connected.",
    "Nurture, not-a-fit, and blocked decisions have no direct tool cost.",
  ];
  for (const assumption of assumptions) {
    drawWrapped(`- ${assumption}`, 8.2);
  }

  drawWrapped("Data limitations for this reporting period:", 8.5, [56, 61, 71]);
  if (input.limitations.length) {
    for (const limitation of input.limitations) {
      drawWrapped(`- ${limitation}`, 8.2);
    }
  } else {
    drawWrapped("- No data limitations reported for this period.", 8.2);
  }

  // Footer and pagination
  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setDrawColor(214, 217, 225);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(112, 116, 126);
    doc.text(pdfText(`DRUID GTM Mission Control - ${campaignName}`), margin, pageHeight - 6);
    doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }

  const filenameCampaign = pdfFilenameSlug(campaignName) || "campaign";
  const filenameDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`druid-live-campaign-report-${filenameCampaign}-${filenameDate}.pdf`);
}

// ─── Action Log (kept only for the existing LinkedIn execution CSV export) ──────
type ActionLogRow = Record<string, string>;

interface ActionLogResponse {
  rows: ActionLogRow[];
  usingSampleData: boolean;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [pdfExporting, setPdfExporting] = useState(false);

  const [selectedCampaignKey, setSelectedCampaignKey] = useState<string | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("lifetime");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const customRangeInvalid =
    periodMode === "custom" && Boolean(customStart) && Boolean(customEnd) && customStart > customEnd;

  const resolvedRequestPeriod = useMemo(
    () => resolvePeriodRange(periodMode, customStart, customEnd),
    [periodMode, customStart, customEnd],
  );

  const thisMonthRange = useMemo(() => currentMonthBounds(), []);
  const previousMonthRange = useMemo(() => previousMonthBounds(), []);

  // Action log — kept ONLY because the canonical endpoint does not carry the
  // per-message copy (message_1/2/3) the existing LinkedIn execution CSV needs.
  // It is not used for any live campaign summary number.
  const actionLogQ = useQuery<ActionLogResponse>({
    queryKey: ["sheets", "action-log"],
    queryFn: () =>
      fetch("/api/sheets/action-log", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ActionLogResponse>,
    staleTime: 30_000,
  });

  // Canonical campaign-report query — single source of truth for live reporting.
  const campaignReportQ = useQuery<CampaignReportResponse, Error>({
    queryKey: [
      "sheets",
      "campaign-report",
      selectedCampaignKey,
      resolvedRequestPeriod.start,
      resolvedRequestPeriod.end,
    ],
    queryFn: () =>
      fetchCampaignReport({
        campaign: selectedCampaignKey,
        start: resolvedRequestPeriod.start,
        end: resolvedRequestPeriod.end,
      }),
    staleTime: 30_000,
    retry: 1,
  });

  // Lock in the resolved default campaign the first time it's seen, so every
  // subsequent request (including period changes) passes an explicit
  // campaign_key and never depends on the endpoint's default-campaign logic again.
  useEffect(() => {
    if (
      selectedCampaignKey === null &&
      campaignReportQ.data?.selected_campaign?.campaign_key
    ) {
      setSelectedCampaignKey(campaignReportQ.data.selected_campaign.campaign_key);
    }
  }, [selectedCampaignKey, campaignReportQ.data]);

  // Month-over-month: two explicit requests (current month, previous month),
  // both pinned to the operator's selected campaign_key.
  const momCurrentQ = useQuery<CampaignReportResponse, Error>({
    queryKey: ["sheets", "campaign-report", "mom-current", selectedCampaignKey, thisMonthRange.start, thisMonthRange.end],
    queryFn: () =>
      fetchCampaignReport({
        campaign: selectedCampaignKey,
        start: thisMonthRange.start,
        end: thisMonthRange.end,
      }),
    enabled: Boolean(selectedCampaignKey),
    staleTime: 30_000,
    retry: 1,
  });

  const momPreviousQ = useQuery<CampaignReportResponse, Error>({
    queryKey: ["sheets", "campaign-report", "mom-previous", selectedCampaignKey, previousMonthRange.start, previousMonthRange.end],
    queryFn: () =>
      fetchCampaignReport({
        campaign: selectedCampaignKey,
        start: previousMonthRange.start,
        end: previousMonthRange.end,
      }),
    enabled: Boolean(selectedCampaignKey),
    staleTime: 30_000,
    retry: 1,
  });

  const liveMomMetrics = useMemo(() => {
    if (!momCurrentQ.data || !momPreviousQ.data) return null;
    return buildLiveMomMetrics(momCurrentQ.data.summary, momPreviousQ.data.summary);
  }, [momCurrentQ.data, momPreviousQ.data]);

  // CSV for live mode (linkedin-approved rows) — unchanged source (action log),
  // unchanged shape, unchanged behavior. Accepts both the older
  // approved_linkedin_pending_tool status and the current approved_linkedin_export_ready
  // status so already-persisted older rows keep showing up in this export.
  const liveRows = actionLogQ.data?.rows ?? [];
  const liveCsvRows = liveRows
    .filter((r) => isLinkedinSelfServeStatus(r.final_status))
    .map((r) => ({
      campaign_name: r.campaign_name ?? "",
      company_name:  r.company_name  ?? "",
      company_domain:r.company_domain?? "",
      contact_name:  r.contact_name  ?? "",
      contact_title: r.contact_title ?? "",
      linkedin_profile_url: r.linkedin_profile_url ?? "",
      country:       r.country       ?? "",
      industry:      r.industry      ?? "",
      recommended_solution: r.recommended_solution ?? "",
      safe_context:  r.why_now       ?? "",
      message_1:"", message_2:"", message_3:"",
      status: "Ready for export",
    }));
  const hasLiveLinkedIn = liveCsvRows.length > 0;

  const operationalCsvRows = useMemo(() => {
    if (!campaignReportQ.data) return [];
    return buildOperationalCsvRows(campaignReportQ.data);
  }, [campaignReportQ.data]);

  async function handleLivePdfExport() {
    const data = campaignReportQ.data;
    if (!data || !data.selected_campaign) return;

    setPdfExporting(true);
    try {
      await downloadLiveCampaignPdf({
        campaignName: data.selected_campaign.campaign_name,
        campaignKey: data.selected_campaign.campaign_key,
        periodLabel: periodPickerLabel(periodMode, customStart, customEnd),
        resolvedPeriod: data.period,
        summary: data.summary,
        attentionAccounts: data.attention_accounts,
        recommendations: data.recommendations,
        decisions: data.decisions,
        actions: data.actions,
        outcomes: data.outcomes,
        costs: data.costs,
        manualExports: data.manual_exports,
        attribution: data.attribution,
        limitations: data.limitations,
        momMetrics: liveMomMetrics,
        usingSampleData: data.usingSampleData,
      });
    } catch (error) {
      console.error("Live campaign PDF export failed", error);
      window.alert(
        "The campaign report could not be generated. Check the browser console for details.",
      );
    } finally {
      setPdfExporting(false);
    }
  }

  function handleOperationalCsvExport() {
    const data = campaignReportQ.data;
    if (!data) return;
    const rows = buildOperationalCsvRows(data);
    const name = `druid-operational-export-${pdfFilenameSlug(
      data.selected_campaign?.campaign_name ?? "campaign",
    )}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(rows, name, OPERATIONAL_CSV_COLUMNS);
  }

  // ── Canonical campaign-report endpoint is the source of truth ──

  const headerControls = (
    <div className="flex items-start gap-3 flex-wrap">
      {ANALYTICS_URL && (
        <a
          href={ANALYTICS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open Marketplace Analytics
        </a>
      )}
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          className="gap-2 text-xs"
          disabled={!campaignReportQ.data || operationalCsvRows.length === 0}
          onClick={handleOperationalCsvExport}
        >
          <Download className="w-3.5 h-3.5" />
          Download operational CSV
        </Button>
        <p className="text-[10px] text-muted-foreground/60 text-right max-w-[220px] leading-snug">
          Campaign-wide export of attention accounts, recommendations, decisions, actions, and outcomes.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={pdfExporting || !campaignReportQ.data?.selected_campaign}
          className="gap-2 text-xs"
          onClick={() => void handleLivePdfExport()}
        >
          <FileText className="w-3.5 h-3.5" />
          {pdfExporting ? "Generating PDF..." : "Export campaign report"}
        </Button>
        <p className="text-[10px] text-muted-foreground/60 text-right max-w-[220px] leading-snug">
          {campaignReportQ.data?.selected_campaign
            ? "Exports the selected live campaign as a PDF."
            : "Select a campaign before exporting."}
        </p>
      </div>
    </div>
  );

  const pageHeader = (
    <PageHeader
      title="DRUID Signals reports"
      description={
        <>
          <p>Compare campaign activity, estimated action cost, and manual export progress.</p>
          {ANALYTICS_URL && (
            <p className="text-xs text-muted-foreground/70 mt-2 max-w-lg leading-relaxed">
              Use Marketplace Analytics for traffic and campaign source performance. Use this page for DRUID Signals review, action cost estimates, manual exports, and month-over-month signal reporting.
            </p>
          )}
        </>
      }
      actions={headerControls}
    />
  );

  // Loading (first fetch, nothing to show yet)
  if (campaignReportQ.isLoading && !campaignReportQ.data) {
    return (
      <PageLayout width="wide" className="space-y-8">
        {pageHeader}
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </PageLayout>
    );
  }

  // Request failure — never fall back to sample numbers.
  if (campaignReportQ.isError) {
    const isAuthError = campaignReportQ.error instanceof CampaignReportAuthError;
    return (
      <PageLayout width="wide" className="space-y-5">
        {pageHeader}
        <InlineNotice
          tone="danger"
          title={isAuthError
            ? "You're not authorized to view live campaign reports."
            : "The campaign report could not be loaded."}
        >
          <p>
            {campaignReportQ.error?.message ?? "An unexpected error occurred while contacting the reporting endpoint."}
          </p>
          {!isAuthError && (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => void campaignReportQ.refetch()}>
              Retry
            </Button>
          )}
        </InlineNotice>
      </PageLayout>
    );
  }

  const report = campaignReportQ.data;

  // Defensive — should not happen once isLoading/isError are both false, but keeps TS honest.
  if (!report) {
    return (
      <PageLayout width="wide" className="space-y-8">
        {pageHeader}
        <Skeleton className="h-40 rounded-xl" />
      </PageLayout>
    );
  }

  // No campaigns at all (e.g. Google Sheets not configured, or nothing recorded yet).
  if (report.campaigns.length === 0) {
    return (
      <PageLayout width="wide" className="space-y-5">
        {pageHeader}
        {report.usingSampleData && (
          <InlineNotice tone="warning">
            Google Sheets is not configured — live figures cannot be produced until it's connected.
          </InlineNotice>
        )}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No campaigns have been recorded yet.</EmptyTitle>
            <EmptyDescription>
            Reports are built from campaign activity in the canonical reporting endpoint. Once activity is recorded, campaigns will appear here automatically.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        {report.limitations.length > 0 && (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs font-semibold text-foreground mb-1.5">Data limitations</p>
            {report.limitations.map((l, i) => (
              <p key={i} className="text-xs text-muted-foreground">{l}</p>
            ))}
          </div>
        )}
      </PageLayout>
    );
  }

  const resolvedPeriodText = formatResolvedPeriod(report.period);
  const attentionAccounts = report.attention_accounts;
  const recommendations = report.recommendations;
  const decisions = report.decisions;
  const actions = report.actions;
  const outcomes = report.outcomes;
  const costs = report.costs;

  const momLoading = momCurrentQ.isLoading || momPreviousQ.isLoading;
  const momError = momCurrentQ.isError || momPreviousQ.isError;

  return (
    <PageLayout width="wide" className="space-y-8">
      {pageHeader}

      {report.usingSampleData && (
        <InlineNotice tone="warning">
          Google Sheets is not configured — the figures below reflect an empty campaign packet, not invented data.
        </InlineNotice>
      )}

      {/* Campaign selector */}
      <Section title="Campaign">
        <div className="flex flex-wrap gap-2">
          {report.campaigns.map((c) => (
            <button
              key={c.campaign_key}
              onClick={() => setSelectedCampaignKey(c.campaign_key)}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                selectedCampaignKey === c.campaign_key
                  ? "bg-primary/20 text-primary border-primary/50"
                  : "bg-card text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {c.campaign_name}
            </button>
          ))}
        </div>
        {report.selected_campaign && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            <MetaPair label="Campaign key" value={report.selected_campaign.campaign_key} />
          </div>
        )}
      </Section>

      {/* Reporting period */}
      <Section title="Reporting period">
        <div className="flex flex-wrap gap-2">
          {([
            { mode: "lifetime", label: "Campaign lifetime" },
            { mode: "this_month", label: "This month" },
            { mode: "previous_month", label: "Previous month" },
            { mode: "custom", label: "Custom period" },
          ] as { mode: PeriodMode; label: string }[]).map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setPeriodMode(opt.mode)}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                periodMode === opt.mode
                  ? "bg-primary/20 text-primary border-primary/50"
                  : "bg-card text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {periodMode === "custom" && (
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Start
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-40"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              End
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-40"
              />
            </label>
          </div>
        )}
        {customRangeInvalid && (
          <p className="text-xs text-red-400 mt-2">
            Start date is after end date — no records can match this range. Adjust the dates above.
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Resolved period: <span className="text-foreground font-medium">{resolvedPeriodText}</span>
        </p>
      </Section>

      {/* Campaign summary */}
      <Section title="Campaign summary">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Signals"                      value={String(report.summary.signals)} />
          <MetricCard label="Unique accounts"               value={String(report.summary.unique_accounts)} />
          <MetricCard label="Accounts reviewed"             value={String(report.summary.accounts_reviewed)} />
          <MetricCard label="Accounts requiring attention"  value={String(report.summary.accounts_requiring_attention)} accent />
          <MetricCard label="Recommended actions"           value={String(report.summary.recommended_actions)} />
          <MetricCard label="Human decisions"               value={String(report.summary.human_decisions)} />
          <MetricCard label="Actions logged"                value={String(report.summary.actions_logged)} />
          <MetricCard label="Outcomes recorded"             value={String(report.summary.outcomes_recorded)} />
          <MetricCard label="Cost-data status"              value={formatCostStatusSummary(report.summary)} />
        </div>
      </Section>

      {/* Accounts requiring attention */}
      <Section title="Accounts requiring attention">
        {attentionAccounts.length === 0 ? (
          <EmptyNote text="No accounts currently require attention." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Why now</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Recommended</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attentionAccounts.map((a, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {a.company_name}
                      {a.company_domain && <span className="text-xs text-muted-foreground ml-1.5">{a.company_domain}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px]">{a.why_now || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        outputLabel(a.recommended_output),
                        humanizeIfEnumLike(a.recommended_action),
                        humanizeIfEnumLike(a.recommended_solution),
                      ].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {liveStatusLabel(a.final_status, a, "Not yet decided")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Recommendations and why-now */}
      <Section title="Recommendations and why-now">
        {recommendations.length === 0 ? (
          <EmptyNote text="No recommendations recorded." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Recommended</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Why now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommendations.map((r, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {r.company_name}
                      {r.company_domain && <span className="text-xs text-muted-foreground ml-1.5">{r.company_domain}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        outputLabel(r.recommended_output),
                        humanizeIfEnumLike(r.recommended_action),
                        humanizeIfEnumLike(r.recommended_solution),
                      ].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[320px]">{r.why_now || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Human decisions */}
      <Section title="Human decisions">
        {decisions.length === 0 ? (
          <EmptyNote text="No human decisions recorded." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Decision</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Decided at</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Why now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {d.company_name}
                      {d.company_domain && <span className="text-xs text-muted-foreground ml-1.5">{d.company_domain}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{decisionLabel(d.decision)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{d.decided_at || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px]">{d.why_now || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Actions */}
      <Section title="Actions">
        {actions.length === 0 ? (
          <EmptyNote text="No actions logged." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Action type</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Action at</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Cost status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((a, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {a.company_name}
                      {a.company_domain && <span className="text-xs text-muted-foreground ml-1.5">{a.company_domain}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{actionTypeLabel(a.action_type) || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {liveStatusLabel(a.final_status || a.status, a, "—")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.action_at || "—"}</TableCell>
                    <TableCell><CostStatusBadge status={a.cost_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Outcomes */}
      <Section title="Outcomes">
        {outcomes.length === 0 ? (
          <EmptyNote text="No outcome data connected." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Outcome</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Outcome status</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Recorded at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {o.company_name}
                      {o.company_domain && <span className="text-xs text-muted-foreground ml-1.5">{o.company_domain}</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.outcome || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.outcome_status || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.recorded_at || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Cost per action / status */}
      <Section title="Cost per action / status">
        {costs.length === 0 ? (
          <EmptyNote text="Actual vendor spend unavailable — no cost records for this period." />
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Action type</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Actual cost</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Estimated cost</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Cost status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((c, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">{c.company_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{actionTypeLabel(c.action_type) || "—"}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{c.actual_cost || "—"}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{c.estimated_cost || "—"}</TableCell>
                    <TableCell><CostStatusBadge status={c.cost_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Costs come directly from the campaign-report endpoint. This app never estimates a dollar figure itself.
        </p>
      </Section>

      {/* Manual export workflow — LinkedIn via Dripify (unchanged CSV export) */}
      <Section title="Manual export workflow — LinkedIn via Dripify">
        <div className="rounded-lg bg-muted/20 border border-border px-4 py-4 text-sm text-foreground space-y-2 mb-4">
          <p className="font-medium">How LinkedIn outreach works in the current setup</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            LinkedIn execution happens outside this app through a manual import/export workflow.
            When you approve a LinkedIn message here, the approval is logged and the row is prepared for export.
            A team member then downloads the CSV and imports it into Dripify manually.
            Outcomes can be imported back once they are available.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MetricCard label="Ready for export"      value={String(report.manual_exports.linkedin_ready)} />
          <MetricCard label="Exported for Dripify"   value={String(report.manual_exports.linkedin_exported)} />
          <MetricCard label="Imported to Dripify"    value={String(report.manual_exports.linkedin_imported)} />
          <MetricCard label="Outcomes received"      value={String(report.manual_exports.outcomes_received)} />
        </div>

        {!hasLiveLinkedIn ? (
          <div className="rounded-lg border border-border bg-card px-4 py-4">
            <p className="text-sm text-muted-foreground">LinkedIn export tracking is not connected yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              When LinkedIn approvals are logged with export status, they will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Company</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Country</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Industry</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Contact</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Export status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveCsvRows.map((row, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">
                      {row.company_name}
                      {row.company_domain && (
                        <span className="text-xs text-muted-foreground ml-1.5">{row.company_domain}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.country}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.industry}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.contact_name || "—"}</TableCell>
                    <TableCell>
                      <ExportStatusBadge status="Ready for export" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs"
            disabled={!hasLiveLinkedIn}
            onClick={() => {
              downloadCsv(
                liveCsvRows,
                `druid-linkedin-export-${new Date().toISOString().slice(0, 10)}.csv`,
                CSV_COLUMNS,
              );
            }}
          >
            <Download className="w-3.5 h-3.5" />
            Download LinkedIn CSV
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {hasLiveLinkedIn
              ? `${liveCsvRows.length} row${liveCsvRows.length !== 1 ? "s" : ""} ready for export.`
              : "No rows ready for export yet."}
          </p>
        </div>
      </Section>

      {/* Month-over-month */}
      <Section title="Month-over-month">
        {!selectedCampaignKey ? (
          <EmptyNote text="Select a campaign to see month-over-month comparison." />
        ) : momLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : momError ? (
          <EmptyNote text="Month-over-month comparison could not be loaded." />
        ) : liveMomMetrics ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Metric</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">This month</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Last month</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Change</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveMomMetrics.map((m, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm text-foreground">{m.label}</TableCell>
                    <TableCell className="text-sm font-semibold text-right tabular-nums text-foreground">{m.current}</TableCell>
                    <TableCell className="text-sm text-right tabular-nums text-muted-foreground">{m.previous}</TableCell>
                    <TableCell className={cn(
                      "text-sm text-right tabular-nums font-medium",
                      m.direction === "up"   ? "text-emerald-400" :
                      m.direction === "down" ? "text-red-400"     : "text-muted-foreground",
                    )}>
                      {m.change} <span className="text-[10px] opacity-70">{m.pct}</span>
                    </TableCell>
                    <TableCell>
                      <DirectionIcon direction={m.direction} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyNote text="Not enough campaign history is available yet to compare this month with the previous month." />
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          This month vs. previous month use two independent campaign-report requests for the same campaign; only the difference and percentage shown are computed in the browser.
        </p>
      </Section>

      {/* Cost assumptions */}
      <Section title="Cost assumptions">
        <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
          {[
            "Costs shown come directly from the campaign-report endpoint (actual_cost, estimated_cost, cost_status). This app does not estimate dollar figures.",
            "Email approvals are logged until an email-sending tool is connected. No email has left the system.",
            "LinkedIn approvals are prepared for manual import into Dripify. LinkedIn does not receive anything automatically — a team member imports the CSV.",
            "Account owner notifications are logged until CRM writeback is connected. Nothing is written to HubSpot automatically.",
            "Retargeting markers do not spend ad budget until an ad sync is connected. These are markers for later.",
          ].map((line, i) => (
            <div key={i} className="flex items-start gap-2">
              <ChevronRight className="w-3 h-3 text-primary shrink-0 mt-0.5" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Attribution and data limitations */}
      <Section title="Attribution and data limitations">
        <div className="rounded-xl border border-border overflow-hidden mb-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs text-muted-foreground font-medium">Source</TableHead>
                <TableHead className="text-xs text-muted-foreground font-medium text-right">Total records</TableHead>
                <TableHead className="text-xs text-muted-foreground font-medium text-right">Attributed</TableHead>
                <TableHead className="text-xs text-muted-foreground font-medium text-right">Unattributed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(report.attribution).map(([key, value]) => (
                <TableRow key={key} className="hover:bg-white/[0.02]">
                  <TableCell className="text-sm text-foreground">{ATTRIBUTION_SOURCE_LABELS[key] ?? key}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-foreground">{value.total}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-muted-foreground">{value.attributed}</TableCell>
                  <TableCell className={cn(
                    "text-sm text-right tabular-nums font-medium",
                    value.unattributed > 0 ? "text-amber-400" : "text-muted-foreground",
                  )}>
                    {value.unattributed}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {report.limitations.length === 0 ? (
          <EmptyNote text="No data limitations reported for this period." />
        ) : (
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            {report.limitations.map((l, i) => (
              <div key={i} className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <span>{l}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageLayout>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">{title}</h2>
        <Separator className="mt-2 bg-border/60" />
      </div>
      {children}
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="border-border bg-card rounded-xl">
      <CardContent className="p-4">
        <p className={cn("text-2xl font-bold tabular-nums", accent ? "text-primary" : "text-foreground")}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">{label}</p>
      </CardContent>
    </Card>
  );
}

// ─── Meta pair ────────────────────────────────────────────────────────────────
function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      {label}: <span className="text-foreground font-medium">{value}</span>
    </span>
  );
}

// ─── Empty state note (honest, no invented numbers) ──────────────────────────
function EmptyNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

// ─── Export status badge ──────────────────────────────────────────────────────
function ExportStatusBadge({ status }: { status: string }) {
  const tone =
    status === "Ready for export" ? "info" :
    status === "Exported for Dripify" ? "warning" :
    status === "Imported to Dripify" || status === "Outcome received" ? "success" :
    "neutral";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

// ─── Cost status badge (live mode — mirrors the endpoint's cost_status) ──────
function CostStatusBadge({ status }: { status: string }) {
  const tone =
    status === "actual" ? "success" :
    status === "estimated" ? "warning" :
    "neutral";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
}

// ─── Direction icon ───────────────────────────────────────────────────────────
function DirectionIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up")   return <TrendingUp   className="w-3.5 h-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown  className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

