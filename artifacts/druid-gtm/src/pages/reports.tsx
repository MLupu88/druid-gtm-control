import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSampleMode } from "@/lib/sample-mode";
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

// ─── Sample-mode types & data (unchanged — sample experience is preserved as-is) ──

interface Campaign {
  id: string;
  name: string;
  region: string;
  industry: string;
  dateRange: string;
  status: string;
}

const SAMPLE_CAMPAIGNS: Campaign[] = [
  { id: "insurance_claims_us",        name: "Insurance Claims Automation — US",        region: "United States",  industry: "Insurance",          dateRange: "May – Jun 2026", status: "Active" },
  { id: "healthcare_scheduling_emea", name: "Healthcare Patient Scheduling — EMEA",    region: "Europe",         industry: "Healthcare",          dateRange: "May – Jun 2026", status: "Active" },
  { id: "banking_self_service",       name: "Banking Customer Self-Service — Global",  region: "Global",         industry: "Banking & Finance",   dateRange: "May – Jun 2026", status: "Active" },
  { id: "marketplace_emea",           name: "Marketplace Publisher Recruitment — EMEA",region: "Europe",         industry: "Technology",          dateRange: "May – Jun 2026", status: "Active" },
];

interface CampaignStats {
  accounts_reviewed: number;
  ready_for_sales: number;
  worth_a_look: number;
  nurture: number;
  blocked: number;
  actions_logged: number;
  estimated_cost: string;
}

const SAMPLE_STATS: Record<string, CampaignStats> = {
  insurance_claims_us:        { accounts_reviewed:24, ready_for_sales:6, worth_a_look:8,  nurture:5, blocked:3, actions_logged:14, estimated_cost:"~$1.20" },
  healthcare_scheduling_emea: { accounts_reviewed:18, ready_for_sales:3, worth_a_look:7,  nurture:4, blocked:2, actions_logged:10, estimated_cost:"~$0.00" },
  banking_self_service:       { accounts_reviewed:31, ready_for_sales:9, worth_a_look:11, nurture:6, blocked:4, actions_logged:20, estimated_cost:"~$2.40" },
  marketplace_emea:           { accounts_reviewed:12, ready_for_sales:2, worth_a_look:5,  nurture:3, blocked:1, actions_logged:7,  estimated_cost:"~$0.00" },
};

interface CostAction {
  type: string;
  count: number;
  unit_cost: string;
  total_cost: string;
  cost_driver: string;
  execution_status: string;
}

const SAMPLE_COST_ACTIONS: Record<string, CostAction[]> = {
  insurance_claims_us: [
    { type:"AI call",                         count:3,  unit_cost:"~$0.05 / min", total_cost:"~$1.20",  cost_driver:"AI telephony call minutes (avg ~8 min/call)",          execution_status:"Active" },
    { type:"Email approval logged",           count:4,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no email tool connected yet",                   execution_status:"Pending tool" },
    { type:"LinkedIn approval logged",        count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — prepared for manual export to Dripify",         execution_status:"Manual export" },
    { type:"Account owner notification",      count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no CRM write connected yet",                    execution_status:"Pending tool" },
    { type:"Retargeting marker",              count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Marker set — no ad platform connected yet",              execution_status:"Pending sync" },
    { type:"Nurture decision",                count:5,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation — decision recorded only",            execution_status:"Logged" },
    { type:"Not a fit",                       count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation — decision recorded only",            execution_status:"Logged" },
    { type:"Blocked / do-not-contact",        count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation — added to do-not-contact list",      execution_status:"Logged" },
  ],
  healthcare_scheduling_emea: [
    { type:"AI call",                         count:0,  unit_cost:"~$0.05 / min", total_cost:"$0",      cost_driver:"No calls placed (EMEA region — voice not cleared)",      execution_status:"Locked" },
    { type:"Email approval logged",           count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no email tool connected yet",                   execution_status:"Pending tool" },
    { type:"LinkedIn approval logged",        count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — prepared for manual export to Dripify",         execution_status:"Manual export" },
    { type:"Account owner notification",      count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no CRM write connected yet",                    execution_status:"Pending tool" },
    { type:"Retargeting marker",              count:0,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Marker set — no ad platform connected yet",              execution_status:"Pending sync" },
    { type:"Nurture decision",                count:4,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Not a fit",                       count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Blocked / do-not-contact",        count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Added to do-not-contact list",                           execution_status:"Logged" },
  ],
  banking_self_service: [
    { type:"AI call",                         count:4,  unit_cost:"~$0.05 / min", total_cost:"~$2.40",  cost_driver:"AI telephony call minutes (avg ~12 min/call)",           execution_status:"Active" },
    { type:"Email approval logged",           count:6,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no email tool connected yet",                   execution_status:"Pending tool" },
    { type:"LinkedIn approval logged",        count:4,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — prepared for manual export to Dripify",         execution_status:"Manual export" },
    { type:"Account owner notification",      count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no CRM write connected yet",                    execution_status:"Pending tool" },
    { type:"Retargeting marker",              count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Marker set — no ad platform connected yet",              execution_status:"Pending sync" },
    { type:"Nurture decision",                count:6,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Not a fit",                       count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Blocked / do-not-contact",        count:4,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Added to do-not-contact list",                           execution_status:"Logged" },
  ],
  marketplace_emea: [
    { type:"AI call",                         count:0,  unit_cost:"~$0.05 / min", total_cost:"$0",      cost_driver:"No calls placed",                                        execution_status:"Locked" },
    { type:"Email approval logged",           count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no email tool connected yet",                   execution_status:"Pending tool" },
    { type:"LinkedIn approval logged",        count:2,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — prepared for manual export to Dripify",         execution_status:"Manual export" },
    { type:"Account owner notification",      count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Logged — no CRM write connected yet",                    execution_status:"Pending tool" },
    { type:"Retargeting marker",              count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Marker set — no ad platform connected yet",              execution_status:"Pending sync" },
    { type:"Nurture decision",                count:3,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Not a fit",                       count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"No tool activation",                                     execution_status:"Logged" },
    { type:"Blocked / do-not-contact",        count:1,  unit_cost:"$0",           total_cost:"$0",      cost_driver:"Added to do-not-contact list",                           execution_status:"Logged" },
  ],
};

interface LinkedInExportRow {
  company_name: string;
  company_domain: string;
  country: string;
  industry: string;
  contact_name: string;
  export_status: string;
}

const SAMPLE_LINKEDIN_ROWS: Record<string, LinkedInExportRow[]> = {
  insurance_claims_us: [
    { company_name:"Acme Insurance",    company_domain:"acme-insure.com",   country:"US", industry:"Insurance",  contact_name:"Jordan Rivera",  export_status:"Ready for export" },
    { company_name:"SafeGuard Mutual",  company_domain:"safeguard.com",     country:"US", industry:"Insurance",  contact_name:"",               export_status:"Ready for export" },
    { company_name:"ClaimsFirst",       company_domain:"claimsfirst.com",   country:"US", industry:"Insurance",  contact_name:"Alex Torrez",    export_status:"Exported for Dripify" },
  ],
  healthcare_scheduling_emea: [
    { company_name:"StadtKlinik Group", company_domain:"stadtklinik.de",    country:"DE", industry:"Healthcare", contact_name:"",               export_status:"Ready for export" },
    { company_name:"EuroCare Health",   company_domain:"eurocare.eu",       country:"NL", industry:"Healthcare", contact_name:"Sophie Linden",  export_status:"Exported for Dripify" },
    { company_name:"MedikZentrum",      company_domain:"medikzentrum.de",   country:"DE", industry:"Healthcare", contact_name:"",               export_status:"Imported to Dripify" },
  ],
  banking_self_service: [
    { company_name:"Globex Corp",       company_domain:"globex.com",        country:"US", industry:"Banking",    contact_name:"Morgan Chen",    export_status:"Exported for Dripify" },
    { company_name:"EuroBank AG",       company_domain:"eurobank.eu",       country:"DE", industry:"Banking",    contact_name:"",               export_status:"Ready for export" },
    { company_name:"FinanceFirst",      company_domain:"financefirst.com",  country:"GB", industry:"Finance",    contact_name:"Sam Wright",     export_status:"Imported to Dripify" },
    { company_name:"NordCredit",        company_domain:"nordcredit.se",     country:"SE", industry:"Banking",    contact_name:"",               export_status:"No outcome yet" },
  ],
  marketplace_emea: [
    { company_name:"TechPub EMEA",      company_domain:"techpub.eu",        country:"DE", industry:"Technology", contact_name:"Lena Braun",     export_status:"Ready for export" },
    { company_name:"MarketLink",        company_domain:"marketlink.io",     country:"FR", industry:"Technology", contact_name:"",               export_status:"Ready for export" },
  ],
};

interface MomMetric {
  label: string;
  current: string;
  previous: string;
  change: string;
  pct: string;
  direction: "up" | "down" | "flat";
}

const SAMPLE_MOM: Record<string, MomMetric[]> = {
  insurance_claims_us: [
    { label:"Accounts reviewed",            current:"24",   previous:"17",  change:"+7",    pct:"+41%", direction:"up" },
    { label:"Ready for sales",              current:"6",    previous:"4",   change:"+2",    pct:"+50%", direction:"up" },
    { label:"Worth a look",                 current:"8",    previous:"6",   change:"+2",    pct:"+33%", direction:"up" },
    { label:"Actions logged",               current:"14",   previous:"9",   change:"+5",    pct:"+56%", direction:"up" },
    { label:"Estimated cost",               current:"~$1.20","previous":"~$0.80", change:"+$0.40",pct:"+50%",direction:"up" },
    { label:"Estimated cost per ready-for-sales account", current:"~$0.20","previous":"~$0.20",change:"$0",pct:"0%",direction:"flat" },
    { label:"Blocked / do-not-contact",     current:"3",    previous:"2",   change:"+1",    pct:"+50%", direction:"up" },
    { label:"LinkedIn approvals logged",    current:"2",    previous:"1",   change:"+1",    pct:"+100%",direction:"up" },
    { label:"LinkedIn rows exported",       current:"0",    previous:"0",   change:"0",     pct:"0%",   direction:"flat" },
  ],
  healthcare_scheduling_emea: [
    { label:"Accounts reviewed",            current:"18",   previous:"11",  change:"+7",    pct:"+64%", direction:"up" },
    { label:"Ready for sales",              current:"3",    previous:"2",   change:"+1",    pct:"+50%", direction:"up" },
    { label:"Worth a look",                 current:"7",    previous:"5",   change:"+2",    pct:"+40%", direction:"up" },
    { label:"Actions logged",               current:"10",   previous:"6",   change:"+4",    pct:"+67%", direction:"up" },
    { label:"Estimated cost",               current:"$0.00","previous":"$0.00",change:"$0", pct:"0%",   direction:"flat" },
    { label:"Estimated cost per ready-for-sales account",current:"$0.00","previous":"$0.00",change:"$0",pct:"0%",direction:"flat" },
    { label:"Blocked / do-not-contact",     current:"2",    previous:"1",   change:"+1",    pct:"+100%",direction:"up" },
    { label:"LinkedIn approvals logged",    current:"3",    previous:"2",   change:"+1",    pct:"+50%", direction:"up" },
    { label:"LinkedIn rows exported",       current:"1",    previous:"0",   change:"+1",    pct:"new",  direction:"up" },
  ],
  banking_self_service: [
    { label:"Accounts reviewed",            current:"31",   previous:"22",  change:"+9",    pct:"+41%", direction:"up" },
    { label:"Ready for sales",              current:"9",    previous:"6",   change:"+3",    pct:"+50%", direction:"up" },
    { label:"Worth a look",                 current:"11",   previous:"8",   change:"+3",    pct:"+38%", direction:"up" },
    { label:"Actions logged",               current:"20",   previous:"14",  change:"+6",    pct:"+43%", direction:"up" },
    { label:"Estimated cost",               current:"~$2.40","previous":"~$1.80",change:"+$0.60",pct:"+33%",direction:"up" },
    { label:"Estimated cost per ready-for-sales account",current:"~$0.27","previous":"~$0.30",change:"-$0.03",pct:"-10%",direction:"down" },
    { label:"Blocked / do-not-contact",     current:"4",    previous:"3",   change:"+1",    pct:"+33%", direction:"up" },
    { label:"LinkedIn approvals logged",    current:"4",    previous:"3",   change:"+1",    pct:"+33%", direction:"up" },
    { label:"LinkedIn rows exported",       current:"1",    previous:"0",   change:"+1",    pct:"new",  direction:"up" },
  ],
  marketplace_emea: [
    { label:"Accounts reviewed",            current:"12",   previous:"7",   change:"+5",    pct:"+71%", direction:"up" },
    { label:"Ready for sales",              current:"2",    previous:"1",   change:"+1",    pct:"+100%",direction:"up" },
    { label:"Worth a look",                 current:"5",    previous:"3",   change:"+2",    pct:"+67%", direction:"up" },
    { label:"Actions logged",               current:"7",    previous:"4",   change:"+3",    pct:"+75%", direction:"up" },
    { label:"Estimated cost",               current:"$0.00","previous":"$0.00",change:"$0", pct:"0%",   direction:"flat" },
    { label:"Estimated cost per ready-for-sales account",current:"$0.00","previous":"$0.00",change:"$0",pct:"0%",direction:"flat" },
    { label:"Blocked / do-not-contact",     current:"1",    previous:"0",   change:"+1",    pct:"new",  direction:"up" },
    { label:"LinkedIn approvals logged",    current:"2",    previous:"1",   change:"+1",    pct:"+100%",direction:"up" },
    { label:"LinkedIn rows exported",       current:"0",    previous:"0",   change:"0",     pct:"0%",   direction:"flat" },
  ],
};

// Sample CSV rows (one per campaign for LinkedIn export)
const SAMPLE_CSV_ROWS: Record<string, Record<string, string>[]> = {
  insurance_claims_us: [
    { campaign_name:"Insurance Claims Automation — US", company_name:"Acme Insurance", company_domain:"acme-insure.com", contact_name:"Jordan Rivera", contact_title:"Director of Customer Experience", linkedin_profile_url:"", country:"US", industry:"Insurance", recommended_solution:"Customer Self-Service & Claims Automation", safe_context:"Acme Insurance appears to be exploring claims automation solutions.", message_1:"Hi [first name], I noticed Acme Insurance has been exploring claims automation — happy to share how we help insurers reduce handling time.", message_2:"Following up briefly — is reducing manual claims handling a priority this quarter?", message_3:"Last note from me for now — would a short call to walk through the workflow make sense?", status:"Ready for export" },
    { campaign_name:"Insurance Claims Automation — US", company_name:"SafeGuard Mutual", company_domain:"safeguard.com", contact_name:"", contact_title:"", linkedin_profile_url:"", country:"US", industry:"Insurance", recommended_solution:"Claims Automation", safe_context:"The company appears to be exploring claims automation.", message_1:"Hi [first name], we help insurance teams automate routine claims steps — happy to share a quick example.", message_2:"Following up — is automating your claims process on your roadmap?", message_3:"I'll leave it here for now, but happy to reconnect when the timing works.", status:"Ready for export" },
    { campaign_name:"Insurance Claims Automation — US", company_name:"ClaimsFirst", company_domain:"claimsfirst.com", contact_name:"Alex Torrez", contact_title:"VP Operations", linkedin_profile_url:"", country:"US", industry:"Insurance", recommended_solution:"Customer Self-Service & Claims Automation", safe_context:"ClaimsFirst appears to be exploring self-service automation.", message_1:"Hi Alex, I noticed ClaimsFirst has been exploring self-service automation — happy to share how we've helped similar teams.", message_2:"Following up briefly — is this a priority for your ops team this half?", message_3:"I'll leave it here for now — happy to reconnect when the time is right.", status:"Exported for Dripify" },
  ],
  healthcare_scheduling_emea: [
    { campaign_name:"Healthcare Patient Scheduling — EMEA", company_name:"StadtKlinik Group", company_domain:"stadtklinik.de", contact_name:"", contact_title:"", linkedin_profile_url:"", country:"DE", industry:"Healthcare", recommended_solution:"Patient Scheduling & Intake Automation", safe_context:"The company appears to be exploring patient scheduling automation.", message_1:"Hallo, we help healthcare groups automate patient scheduling to reduce front-desk load — happy to share a quick overview.", message_2:"Following up briefly — is reducing scheduling overhead on your radar this quarter?", message_3:"I'll leave it here for now — happy to reconnect when the timing works.", status:"Ready for export" },
    { campaign_name:"Healthcare Patient Scheduling — EMEA", company_name:"EuroCare Health", company_domain:"eurocare.eu", contact_name:"Sophie Linden", contact_title:"Head of Operations", linkedin_profile_url:"", country:"NL", industry:"Healthcare", recommended_solution:"Patient Scheduling & Intake Automation", safe_context:"EuroCare Health appears to be exploring intake automation.", message_1:"Hi Sophie, I noticed EuroCare Health has been exploring scheduling automation — happy to share how we help similar teams.", message_2:"Following up briefly — is automating patient intake on your roadmap?", message_3:"I'll leave it here for now — happy to reconnect when the timing is right.", status:"Exported for Dripify" },
  ],
  banking_self_service: [
    { campaign_name:"Banking Customer Self-Service — Global", company_name:"Globex Corp", company_domain:"globex.com", contact_name:"Morgan Chen", contact_title:"Head of Digital", linkedin_profile_url:"", country:"US", industry:"Banking", recommended_solution:"Customer Self-Service & Claims Automation", safe_context:"Globex Corp appears to be exploring self-service automation.", message_1:"Hi Morgan, I noticed Globex has been exploring self-service automation — happy to share how we help banks reduce call center volume.", message_2:"Following up briefly — is this a priority for your team this quarter?", message_3:"I'll leave it here for now — happy to reconnect when the timing works.", status:"Exported for Dripify" },
    { campaign_name:"Banking Customer Self-Service — Global", company_name:"EuroBank AG", company_domain:"eurobank.eu", contact_name:"", contact_title:"", linkedin_profile_url:"", country:"DE", industry:"Banking", recommended_solution:"Banking Self-Service Automation", safe_context:"The company appears to be exploring customer self-service solutions.", message_1:"Hallo, we help banking teams automate routine customer queries — happy to share a quick overview.", message_2:"Following up briefly — is this a priority for your digital team?", message_3:"I'll leave it here for now — happy to reconnect when the timing is right.", status:"Ready for export" },
  ],
  marketplace_emea: [
    { campaign_name:"Marketplace Publisher Recruitment — EMEA", company_name:"TechPub EMEA", company_domain:"techpub.eu", contact_name:"Lena Braun", contact_title:"Director of Partnerships", linkedin_profile_url:"", country:"DE", industry:"Technology", recommended_solution:"Marketplace Publisher Recruitment Automation", safe_context:"TechPub EMEA appears to be exploring marketplace automation.", message_1:"Hi Lena, I noticed TechPub has been exploring marketplace automation — happy to share how we help publishers recruit at scale.", message_2:"Following up briefly — is publisher recruitment automation on your roadmap?", message_3:"I'll leave it here for now — happy to reconnect when the timing works.", status:"Ready for export" },
    { campaign_name:"Marketplace Publisher Recruitment — EMEA", company_name:"MarketLink", company_domain:"marketlink.io", contact_name:"", contact_title:"", linkedin_profile_url:"", country:"FR", industry:"Technology", recommended_solution:"Marketplace Publisher Recruitment Automation", safe_context:"The company appears to be exploring publisher recruitment.", message_1:"Bonjour, we help marketplace teams automate publisher outreach — happy to share a quick overview.", message_2:"Following up briefly — is scaling publisher recruitment a priority this quarter?", message_3:"I'll leave it here for now — happy to reconnect when the timing is right.", status:"Ready for export" },
  ],
};

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

// ─── MoM insight generator (sample mode only — see live MoM section below) ───────
interface MomInsights {
  bullets: string[];
  whatNext: string[];
}

function buildMomInsights(metrics: MomMetric[]): MomInsights {
  const get = (label: string) => metrics.find((m) => m.label === label);
  const bullets: string[] = [];
  const whatNext: string[] = [];

  const accounts = get("Accounts reviewed");
  const ready    = get("Ready for sales");
  const cost     = get("Estimated cost");
  const costPer  = get("Estimated cost per ready-for-sales account");
  const blocked  = get("Blocked / do-not-contact");
  const liLogged = get("LinkedIn approvals logged");
  const liExp    = get("LinkedIn rows exported");

  if (accounts) {
    if (accounts.direction === "up")
      bullets.push(`More accounts were reviewed this month — ${accounts.current}, up from ${accounts.previous}.`);
    else if (accounts.direction === "down")
      bullets.push(`Fewer accounts were reviewed this month — ${accounts.current}, down from ${accounts.previous}.`);
    else
      bullets.push(`Account review volume stayed flat at ${accounts.current}.`);
  }

  if (ready) {
    if (ready.direction === "up")
      bullets.push(`Ready-for-sales accounts increased to ${ready.current}, up from ${ready.previous} last month.`);
    else if (ready.direction === "down")
      bullets.push(`Ready-for-sales accounts decreased to ${ready.current}, down from ${ready.previous}.`);
    else
      bullets.push(`Ready-for-sales count held steady at ${ready.current}.`);
  }

  if (cost) {
    if (cost.direction === "up")
      bullets.push(`Estimated cost increased to ${cost.current} (${cost.pct}), in line with higher activity.`);
    else if (cost.direction === "down")
      bullets.push(`Estimated cost decreased to ${cost.current} (${cost.pct}).`);
    else
      bullets.push(`Estimated cost stayed flat.`);
  }

  if (liLogged && !(liLogged.direction === "flat" && liLogged.current === "0")) {
    if (liLogged.direction === "up")
      bullets.push(`LinkedIn approval activity increased — ${liLogged.current} logged this month, up from ${liLogged.previous}.`);
    else if (liLogged.direction === "down")
      bullets.push(`LinkedIn approvals decreased to ${liLogged.current}.`);
  }

  if (blocked) {
    if (blocked.direction === "up")
      bullets.push(`Blocked accounts also increased — worth reviewing data quality and suppression rules.`);
    else if (blocked.direction === "down")
      bullets.push(`Blocked account count decreased — fewer accounts are being filtered out.`);
  }

  if (ready) {
    const n = parseInt(ready.current, 10);
    if (!isNaN(n) && n > 0)
      whatNext.push(`${ready.current} account${n !== 1 ? "s are" : " is"} ready for sales — review any pending approvals in the queue.`);
  }
  if (liLogged) {
    const n = parseInt(liLogged.current, 10);
    if (!isNaN(n) && n > 0)
      whatNext.push(`${liLogged.current} LinkedIn approval${n !== 1 ? "s are" : " is"} logged — download the CSV to prepare for manual import into Dripify.`);
  }
  if (blocked?.direction === "up")
    whatNext.push(`Blocked count increased — check the do-not-contact list and suppression rules for this campaign.`);
  if (costPer?.direction === "flat")
    whatNext.push(`Cost efficiency held steady — cost per ready-for-sales account did not change.`);
  if (liExp && parseInt(liExp.current, 10) === 0 && liLogged && parseInt(liLogged.current, 10) > 0)
    whatNext.push(`No rows have been exported yet for this month — the CSV is ready to download.`);

  return { bullets, whatNext };
}

// ─── Sample PDF (unchanged — the existing working export) ───────────────────────

interface CampaignPdfMeta {
  status?: string;
  period?: string;
  region?: string;
  industry?: string;
}

interface CampaignPdfInput {
  campaignName: string;
  mode: "sample";
  campaignMeta?: CampaignPdfMeta;
  stats: CampaignStats;
  costActions: CostAction[];
  linkedinRows: LinkedInExportRow[];
  momMetrics: MomMetric[] | null;
}

async function downloadCampaignPdf(input: CampaignPdfInput): Promise<void> {
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
    const lines = doc.splitTextToSize(
      pdfText(value),
      contentWidth,
    ) as string[];

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

  // Header
  doc.setFillColor(91, 74, 163);
  doc.rect(0, 0, pageWidth, 27, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("DRUID GTM Mission Control", margin, 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Campaign signal report", margin, 19);

  y = 37;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(31, 35, 43);

  const campaignTitleLines = doc.splitTextToSize(
    campaignName,
    contentWidth,
  ) as string[];

  doc.text(campaignTitleLines, margin, y);
  y += campaignTitleLines.length * 7 + 1;

  const metadata = [
    "Mode: Sample data",
    input.campaignMeta?.status
      ? `Status: ${input.campaignMeta.status}`
      : "",
    input.campaignMeta?.period
      ? `Period: ${input.campaignMeta.period}`
      : "",
    input.campaignMeta?.region
      ? `Region: ${input.campaignMeta.region}`
      : "",
    input.campaignMeta?.industry
      ? `Industry: ${input.campaignMeta.industry}`
      : "",
    `Generated: ${generatedAt.toLocaleString("en-GB")}`,
  ].filter(Boolean);

  drawWrapped(metadata.join(" | "), 8.5, [90, 95, 105]);

  ensureSpace(14);

  doc.setFillColor(255, 247, 224);
  doc.setDrawColor(224, 174, 65);
  doc.roundedRect(
    margin,
    y,
    contentWidth,
    10,
    2,
    2,
    "FD",
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(130, 84, 0);
  doc.text(
    "SAMPLE DATA - This report is for workflow demonstration and must not be used as external performance reporting.",
    margin + 4,
    y + 6.4,
  );

  y += 16;

  // Campaign summary
  drawSectionTitle("Campaign summary");

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Accounts reviewed", pdfText(input.stats.accounts_reviewed)],
      ["Ready for sales", pdfText(input.stats.ready_for_sales)],
      ["Worth a look", pdfText(input.stats.worth_a_look)],
      ["Nurture decisions", pdfText(input.stats.nurture)],
      ["Blocked", pdfText(input.stats.blocked)],
      ["Actions logged", pdfText(input.stats.actions_logged)],
      ["Estimated cost", pdfText(input.stats.estimated_cost)],
    ],
    theme: "grid",
    margin: {
      left: margin,
      right: margin,
      bottom: footerReserve,
    },
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 2.4,
      overflow: "linebreak",
      textColor: "#20242C",
      lineColor: "#D9DCE3",
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: "#5B4AA3",
      textColor: "#FFFFFF",
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 55, halign: "right", fontStyle: "bold" },
    },
    showHead: "everyPage",
  });

  updateYAfterTable();

  // Cost breakdown
  drawSectionTitle("Cost per action");

  const costRows = input.costActions.length
    ? input.costActions.map((action) => [
        pdfText(action.type),
        pdfText(action.count),
        pdfText(action.unit_cost),
        pdfText(action.total_cost),
        pdfText(action.cost_driver),
        pdfText(action.execution_status),
      ])
    : [[
        "No actions logged",
        "0",
        "$0",
        "$0",
        "No action data is available for this campaign.",
        "Not available",
      ]];

  autoTable(doc, {
    startY: y,
    head: [[
      "Action type",
      "Count",
      "Unit cost",
      "Total",
      "Cost driver",
      "Status",
    ]],
    body: costRows,
    theme: "grid",
    margin: {
      left: margin,
      right: margin,
      bottom: footerReserve,
    },
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2.1,
      overflow: "linebreak",
      valign: "top",
      textColor: "#20242C",
      lineColor: "#D9DCE3",
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: "#5B4AA3",
      textColor: "#FFFFFF",
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 17, halign: "right" },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 25, halign: "right" },
      4: { cellWidth: 105 },
      5: { cellWidth: 35 },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  updateYAfterTable();

  drawWrapped(
    "Costs shown in this report are estimates until production vendor cost feeds are connected.",
    8,
    [100, 104, 113],
  );

  // LinkedIn workflow
  drawSectionTitle("Manual LinkedIn export workflow");

  const linkedinRows = input.linkedinRows.length
    ? input.linkedinRows.map((row) => [
        pdfText(
          row.company_domain
            ? `${row.company_name} (${row.company_domain})`
            : row.company_name,
        ),
        pdfText(row.country),
        pdfText(row.industry),
        pdfText(row.contact_name || "-"),
        pdfText(row.export_status),
      ])
    : [[
        "No LinkedIn rows",
        "",
        "",
        "",
        "Nothing ready for export",
      ]];

  autoTable(doc, {
    startY: y,
    head: [[
      "Company",
      "Country",
      "Industry",
      "Contact",
      "Export status",
    ]],
    body: linkedinRows,
    theme: "grid",
    margin: {
      left: margin,
      right: margin,
      bottom: footerReserve,
    },
    styles: {
      font: "helvetica",
      fontSize: 7.8,
      cellPadding: 2.2,
      overflow: "linebreak",
      textColor: "#20242C",
      lineColor: "#D9DCE3",
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: "#5B4AA3",
      textColor: "#FFFFFF",
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 25 },
      2: { cellWidth: 45 },
      3: { cellWidth: 60 },
      4: { cellWidth: 48 },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
  });

  updateYAfterTable();

  drawWrapped(
    "LinkedIn activity is prepared for manual CSV export and import into Dripify. No LinkedIn message is sent automatically from this application.",
    8,
    [100, 104, 113],
  );

  // Month-over-month
  drawSectionTitle("Month-over-month");

  if (input.momMetrics?.length) {
    autoTable(doc, {
      startY: y,
      head: [[
        "Metric",
        "This month",
        "Last month",
        "Change",
      ]],
      body: input.momMetrics.map((metric) => [
        pdfText(metric.label),
        pdfText(metric.current),
        pdfText(metric.previous),
        pdfText(`${metric.change} ${metric.pct}`),
      ]),
      theme: "grid",
      margin: {
        left: margin,
        right: margin,
        bottom: footerReserve,
      },
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2.2,
        overflow: "linebreak",
        textColor: "#20242C",
        lineColor: "#D9DCE3",
        lineWidth: 0.15,
      },
      headStyles: {
        fillColor: "#5B4AA3",
        textColor: "#FFFFFF",
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 130 },
        1: { cellWidth: 42, halign: "right" },
        2: { cellWidth: 42, halign: "right" },
        3: { cellWidth: 48, halign: "right" },
      },
      showHead: "everyPage",
      rowPageBreak: "avoid",
    });

    updateYAfterTable();

    const insights = buildMomInsights(input.momMetrics);

    if (insights.bullets.length) {
      drawSectionTitle("Management interpretation");

      for (const insight of insights.bullets) {
        drawWrapped(`- ${insight}`, 8.5);
      }
    }

    if (insights.whatNext.length) {
      drawSectionTitle("What to do next");

      for (const nextStep of insights.whatNext) {
        drawWrapped(`- ${nextStep}`, 8.5);
      }
    }
  } else {
    drawWrapped(
      "Not enough dated campaign history is available yet. Month-over-month reporting requires activity across two calendar months.",
      8.5,
    );
  }

  // Assumptions and operational status
  drawSectionTitle("Operational assumptions");

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

  // Footer and pagination
  const pageCount = doc.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);

    doc.setDrawColor(214, 217, 225);
    doc.setLineWidth(0.2);
    doc.line(
      margin,
      pageHeight - 11,
      pageWidth - margin,
      pageHeight - 11,
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(112, 116, 126);

    doc.text(
      pdfText(`DRUID GTM Mission Control - ${campaignName}`),
      margin,
      pageHeight - 6,
    );

    doc.text(
      `Page ${pageNumber} of ${pageCount}`,
      pageWidth - margin,
      pageHeight - 6,
      { align: "right" },
    );
  }

  const filenameCampaign = pdfFilenameSlug(campaignName) || "campaign";
  const filenameDate = generatedAt.toISOString().slice(0, 10);

  doc.save(
    `druid-sample-campaign-report-${filenameCampaign}-${filenameDate}.pdf`,
  );
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

// ─── Live PDF (extends the same jsPDF/autoTable approach as the sample PDF) ──────
// Kept as a separate function (rather than branching inside downloadCampaignPdf)
// so the existing, already-validated sample PDF path is never touched by live-mode changes.

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
  const { viewMode, setViewMode } = useSampleMode();
  const isSample = viewMode === "sample";

  // Sample-mode state (unchanged)
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_CAMPAIGNS[0].id);
  const [pdfExporting, setPdfExporting] = useState(false);

  // Live-mode state
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
    enabled: !isSample,
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
    enabled: !isSample,
    staleTime: 30_000,
    retry: 1,
  });

  // Lock in the resolved default campaign the first time it's seen, so every
  // subsequent request (including period changes) passes an explicit
  // campaign_key and never depends on the endpoint's default-campaign logic again.
  useEffect(() => {
    if (
      !isSample &&
      selectedCampaignKey === null &&
      campaignReportQ.data?.selected_campaign?.campaign_key
    ) {
      setSelectedCampaignKey(campaignReportQ.data.selected_campaign.campaign_key);
    }
  }, [isSample, selectedCampaignKey, campaignReportQ.data]);

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
    enabled: !isSample && Boolean(selectedCampaignKey),
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
    enabled: !isSample && Boolean(selectedCampaignKey),
    staleTime: 30_000,
    retry: 1,
  });

  const liveMomMetrics = useMemo(() => {
    if (isSample || !momCurrentQ.data || !momPreviousQ.data) return null;
    return buildLiveMomMetrics(momCurrentQ.data.summary, momPreviousQ.data.summary);
  }, [isSample, momCurrentQ.data, momPreviousQ.data]);

  // Current sample campaign (unchanged)
  const sampleCampaign = SAMPLE_CAMPAIGNS.find((c) => c.id === selectedId) ?? SAMPLE_CAMPAIGNS[0];
  const sampleStats    = SAMPLE_STATS[selectedId]        ?? SAMPLE_STATS[SAMPLE_CAMPAIGNS[0].id];
  const sampleCosts    = SAMPLE_COST_ACTIONS[selectedId] ?? [];
  const sampleLinkedIn = SAMPLE_LINKEDIN_ROWS[selectedId]?? [];
  const sampleMom      = SAMPLE_MOM[selectedId]          ?? [];
  const sampleCsvRows  = SAMPLE_CSV_ROWS[selectedId]     ?? [];

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
    if (isSample || !campaignReportQ.data) return [];
    return buildOperationalCsvRows(campaignReportQ.data);
  }, [isSample, campaignReportQ.data]);

  async function handleSamplePdfExport() {
    setPdfExporting(true);
    try {
      await downloadCampaignPdf({
        campaignName: sampleCampaign.name,
        mode: "sample",
        campaignMeta: {
          status: sampleCampaign.status,
          period: sampleCampaign.dateRange,
          region: sampleCampaign.region,
          industry: sampleCampaign.industry,
        },
        stats: sampleStats,
        costActions: sampleCosts,
        linkedinRows: sampleLinkedIn,
        momMetrics: sampleMom,
      });
    } catch (error) {
      console.error("Sample campaign PDF export failed", error);
      window.alert(
        "The campaign report could not be generated. Check the browser console for details.",
      );
    } finally {
      setPdfExporting(false);
    }
  }

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

  // ── Sample mode: unchanged experience ──────────────────────────────────────
  if (isSample) {
    return (
      <PageLayout width="wide" className="space-y-8">
        {/* Header */}
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
          actions={
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
                disabled={pdfExporting}
                className="gap-2 text-xs"
                onClick={() => void handleSamplePdfExport()}
              >
                <FileText className="w-3.5 h-3.5" />
                {pdfExporting ? "Generating PDF..." : "Export campaign report"}
              </Button>
              <p className="text-[10px] text-muted-foreground/60 text-right max-w-[220px] leading-snug">
                Exports the selected sample campaign as a PDF.
              </p>
            </div>
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
            </div>
          }
        />

        <InlineNotice tone="info">
          Showing sample data — this illustrates the full reporting workflow. Switch to Live data when campaign activity has been recorded.
        </InlineNotice>

        {/* Campaign selector */}
        <Section title="Campaign">
          <div className="flex flex-wrap gap-2">
            {SAMPLE_CAMPAIGNS.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                  selectedId === c.id
                    ? "bg-primary/20 text-primary border-primary/50"
                    : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-border/80",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            <MetaPair label="Status"  value={sampleCampaign.status}    />
            <MetaPair label="Period"  value={sampleCampaign.dateRange} />
            <MetaPair label="Region"  value={sampleCampaign.region}    />
            <MetaPair label="Industry"value={sampleCampaign.industry}  />
            <SampleBadge />
          </div>
        </Section>

        {/* Campaign summary */}
        <Section title="Campaign summary">
          <div className="mb-3"><SampleBadge /></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Accounts reviewed"   value={String(sampleStats.accounts_reviewed)} />
            <MetricCard label="Ready for sales"     value={String(sampleStats.ready_for_sales)}   accent />
            <MetricCard label="Worth a look"        value={String(sampleStats.worth_a_look)}       />
            <MetricCard label="Nurture decisions"   value={String(sampleStats.nurture)}            />
            <MetricCard label="Blocked"             value={String(sampleStats.blocked)}            />
            <MetricCard label="Actions logged"      value={String(sampleStats.actions_logged)}     />
            <MetricCard label="Estimated cost"      value={sampleStats.estimated_cost}             />
          </div>
        </Section>

        {/* Cost per action */}
        <Section title="Cost per action">
          <div className="mb-3"><SampleBadge /></div>
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-xs text-muted-foreground font-medium">Action type</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Count</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Unit cost</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium text-right">Total</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Cost driver</TableHead>
                  <TableHead className="text-xs text-muted-foreground font-medium">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleCosts.map((a, i) => (
                  <TableRow key={i} className="hover:bg-white/[0.02]">
                    <TableCell className="text-sm font-medium text-foreground">{a.type}</TableCell>
                    <TableCell className="text-sm text-right tabular-nums text-foreground">{a.count}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{a.unit_cost}</TableCell>
                    <TableCell className="text-sm text-right font-medium text-foreground">{a.total_cost}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px]">{a.cost_driver}</TableCell>
                    <TableCell>
                      <ExecStatusBadge status={a.execution_status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Costs are estimates until production cost feeds are connected. AI call minutes are an approximation.
          </p>
        </Section>

        {/* Manual export workflow */}
        <Section title="Manual export workflow — LinkedIn via Dripify">
          <div className="rounded-lg bg-muted/20 border border-border px-4 py-4 text-sm text-foreground space-y-2 mb-4">
            <p className="font-medium">How LinkedIn outreach works in the current setup</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              LinkedIn execution happens outside this app through a manual import/export workflow.
              When you approve a LinkedIn message here, the approval is logged and the row is prepared for export.
              A team member then downloads the CSV and imports it into Dripify manually.
              Outcomes can be imported back once they are available.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {["Ready for export","Exported for Dripify","Imported to Dripify","Outcome received"].map((s) => (
                <div key={s} className="rounded-lg border border-border bg-card px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground leading-snug">{s}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3"><SampleBadge /></div>

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
                {sampleLinkedIn.map((row, i) => (
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
                      <ExportStatusBadge status={row.export_status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-xs"
              disabled={sampleCsvRows.length === 0}
              onClick={() => {
                downloadCsv(sampleCsvRows, `druid-linkedin-sample-${selectedId}.csv`, CSV_COLUMNS);
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Download LinkedIn CSV
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Downloads sample rows for reference — not real contact data.
            </p>
          </div>
        </Section>

        {/* Month-over-month */}
        <Section title="Month-over-month">
          <div className="mb-3"><SampleBadge /></div>
          {(() => {
            const insights = buildMomInsights(sampleMom);
            return (
              <div className="space-y-4">
                {insights.bullets.length > 0 && (
                  <div className="rounded-lg bg-muted/20 border border-border px-4 py-3 space-y-1.5">
                    {insights.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed">
                        <span className="text-primary mt-0.5 shrink-0">›</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                )}

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
                      {sampleMom.map((m, i) => (
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

                {insights.whatNext.length > 0 && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                    <p className="text-xs font-semibold text-primary mb-2">What this means</p>
                    <div className="space-y-1">
                      {insights.whatNext.map((line, i) => (
                        <p key={i} className="text-xs text-foreground/70 leading-relaxed">{line}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <p className="text-[11px] text-muted-foreground mt-2">
            Costs are estimates only. Do not use these figures to report external performance.
          </p>
        </Section>

        {/* Cost assumptions */}
        <Section title="Cost assumptions">
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            {[
              "Costs shown are estimates until production cost feeds are connected.",
              "AI calls may consume call minutes and telephony — the figures shown assume an average call duration.",
              "Email approvals are logged until an email-sending tool is connected. No email has left the system.",
              "LinkedIn approvals are prepared for manual import into Dripify. LinkedIn does not receive anything automatically — a team member imports the CSV.",
              "Account owner notifications are logged until CRM writeback is connected. Nothing is written to HubSpot automatically.",
              "Retargeting markers do not spend ad budget until an ad sync is connected. These are markers for later.",
              "Nurture, not-a-fit, and blocked decisions have no direct tool cost.",
              "Actual cost per action requires production action logs plus vendor cost data, which are not connected yet.",
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </Section>

        <DataReadiness isSample />
      </PageLayout>
    );
  }

  // ── Live mode: canonical campaign-report endpoint is the source of truth ──

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
      <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
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
          <EmptyContent>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setViewMode("sample")}>
              View sample report
            </Button>
          </EmptyContent>
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

// ─── Sample badge ─────────────────────────────────────────────────────────────
function SampleBadge() {
  return (
    <StatusBadge tone="warning">
      Sample data
    </StatusBadge>
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

// ─── Execution status badge (sample cost table) ──────────────────────────────
function ExecStatusBadge({ status }: { status: string }) {
  const tone =
    status === "Active"       ? "success" :
    status === "Pending tool" ? "warning" :
    status === "Manual export" || status === "Pending sync" ? "info" :
    status === "Locked" ? "danger" :
    "neutral";
  return <StatusBadge tone={tone}>{status}</StatusBadge>;
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

// ─── Data readiness (sample mode only — live mode uses the Attribution section) ─
function DataReadiness({ isSample }: { isSample: boolean }) {
  const items = [
    { label: "Campaign activity source",       status: "Sample data", ok: true },
    { label: "Action log source",              status: "Sample data", ok: true },
    { label: "Campaign tracking",              status: "Sample data", ok: true },
    { label: "LinkedIn export source",         status: "Sample data", ok: true },
    { label: "Cost data",                      status: "Sample data", ok: true },
    { label: "Month-over-month comparison",    status: "Sample data", ok: true },
  ];

  if (!isSample) return null;

  return (
    <Section title="Data readiness">
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableBody>
            {items.map((item, i) => (
              <TableRow key={i} className="hover:bg-white/[0.02]">
                <TableCell className="text-sm text-foreground">{item.label}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      item.ok
                        ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                        : "text-muted-foreground border-border bg-muted/30",
                    )}
                  >
                    {item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
