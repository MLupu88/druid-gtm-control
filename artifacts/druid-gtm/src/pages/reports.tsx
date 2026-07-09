import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { STATUS_LABELS_V3 } from "@workspace/gtm-shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useSampleMode } from "@/lib/sample-mode";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
} from "lucide-react";

const ANALYTICS_URL: string =
  (import.meta.env.VITE_MARKETPLACE_ANALYTICS_URL as string | undefined) ||
  "https://datastudio.google.com/u/0/reporting/8475305e-1260-4c51-851d-b2f755d4c82c/page/p_92rv9whn3d";

// ─── Types ───────────────────────────────────────────────────────────────────
type ActionLogRow = Record<string, string>;

interface ActionLogResponse {
  rows: ActionLogRow[];
  usingSampleData: boolean;
}
interface QueueResponse {
  source: string;
  rows: Record<string, string>[];
  usingSampleData: boolean;
}

// ─── Sample data constants ────────────────────────────────────────────────────

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

// ─── CSV download helper ──────────────────────────────────────────────────────
const CSV_COLUMNS = [
  "campaign_name","company_name","company_domain","contact_name","contact_title",
  "linkedin_profile_url","country","industry","recommended_solution","safe_context",
  "message_1","message_2","message_3","status",
];

function downloadCsv(rows: Record<string, string>[], filename: string) {
  const header = CSV_COLUMNS.join(",");
  const body = rows
    .map((r) =>
      CSV_COLUMNS.map((c) => `"${(r[c] ?? "").replace(/"/g, '""')}"`).join(","),
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

// ─── Live data helpers ────────────────────────────────────────────────────────
function deriveLiveCampaigns(rows: ActionLogRow[]): string[] {
  const names = new Set<string>();
  for (const r of rows) if (r.campaign_name) names.add(r.campaign_name);
  return Array.from(names);
}

function deriveLiveStats(rows: ActionLogRow[], campaign: string | null): CampaignStats {
  const filtered = campaign
    ? rows.filter((r) => r.campaign_name === campaign)
    : rows;
  return {
    accounts_reviewed: filtered.length,
    ready_for_sales: filtered.filter((r) =>
      ["called","approved_email_pending_tool","approved_linkedin_pending_tool"].includes(r.final_status),
    ).length,
    worth_a_look: filtered.filter((r) => r.final_status === "manual_review").length,
    nurture: filtered.filter((r) => r.final_status === "nurture").length,
    blocked: filtered.filter((r) => r.final_status === "suppressed").length,
    actions_logged: filtered.length,
    estimated_cost: "See cost breakdown",
  };
}

function deriveLiveCostActions(rows: ActionLogRow[], campaign: string | null): CostAction[] {
  const filtered = campaign
    ? rows.filter((r) => r.campaign_name === campaign)
    : rows;

  const statusMap: Record<string, { type: string; cost_driver: string; exec: string }> = {
    called:                          { type:"AI call",                    cost_driver:"AI telephony call minutes",                    exec:"Active" },
    approved_email_pending_tool:     { type:"Email approval logged",       cost_driver:"Logged — no email tool connected yet",         exec:"Pending tool" },
    approved_linkedin_pending_tool:  { type:"LinkedIn approval logged",    cost_driver:"Logged — prepared for manual export to Dripify",exec:"Manual export" },
    owner_alert_logged:              { type:"Account owner notification",  cost_driver:"Logged — no CRM write connected yet",          exec:"Pending tool" },
    marked_retarget:                 { type:"Retargeting marker",          cost_driver:"Marker set — no ad platform connected yet",    exec:"Pending sync" },
    nurture:                         { type:"Nurture decision",            cost_driver:"No tool activation",                          exec:"Logged" },
    rejected:                        { type:"Not a fit",                   cost_driver:"No tool activation",                          exec:"Logged" },
    suppressed:                      { type:"Blocked / do-not-contact",    cost_driver:"Added to do-not-contact list",                 exec:"Logged" },
  };

  const counts: Record<string, number> = {};
  for (const r of filtered) {
    const st = r.final_status;
    if (st && statusMap[st]) counts[st] = (counts[st] ?? 0) + 1;
  }

  return Object.entries(counts).map(([st, count]) => {
    const m = statusMap[st];
    const is_call = st === "called";
    return {
      type: m.type,
      count,
      unit_cost: is_call ? "~$0.05 / min" : "$0",
      total_cost: is_call ? "~$" + (count * 0.4).toFixed(2) : "$0",
      cost_driver: m.cost_driver,
      execution_status: m.exec,
    };
  });
}

function deriveLiveMom(rows: ActionLogRow[], campaign: string | null): MomMetric[] | null {
  const filtered = campaign
    ? rows.filter((r) => r.campaign_name === campaign)
    : rows;

  const getTs = (r: ActionLogRow) =>
    new Date(r.action_at || r.approved_at || r.timestamp || "");

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();
  const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const prevYear  = thisMonth === 0 ? thisYear - 1 : thisYear;

  const curr = filtered.filter((r) => {
    const d = getTs(r);
    return !isNaN(d.getTime()) && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  const prev = filtered.filter((r) => {
    const d = getTs(r);
    return !isNaN(d.getTime()) && d.getMonth() === prevMonth && d.getFullYear() === prevYear;
  });

  if (!curr.length && !prev.length) return null;
  if (!prev.length) return null; // need 2 months

  const c = {
    accounts: curr.length,
    ready: curr.filter((r) => ["called","approved_email_pending_tool","approved_linkedin_pending_tool"].includes(r.final_status)).length,
    worth: curr.filter((r) => r.final_status === "manual_review").length,
    actions: curr.length,
    blocked: curr.filter((r) => r.final_status === "suppressed").length,
    li_logged: curr.filter((r) => r.final_status === "approved_linkedin_pending_tool").length,
  };
  const p = {
    accounts: prev.length,
    ready: prev.filter((r) => ["called","approved_email_pending_tool","approved_linkedin_pending_tool"].includes(r.final_status)).length,
    worth: prev.filter((r) => r.final_status === "manual_review").length,
    actions: prev.length,
    blocked: prev.filter((r) => r.final_status === "suppressed").length,
    li_logged: prev.filter((r) => r.final_status === "approved_linkedin_pending_tool").length,
  };

  function metric(label: string, cv: number, pv: number, prefix = ""): MomMetric {
    const diff = cv - pv;
    const pct  = pv > 0 ? Math.round((diff / pv) * 100) : (cv > 0 ? 100 : 0);
    return {
      label, current: prefix + cv, previous: prefix + pv,
      change: (diff >= 0 ? "+" : "") + prefix + diff,
      pct: (pct >= 0 ? "+" : "") + pct + "%",
      direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
    };
  }

  return [
    metric("Accounts reviewed",          c.accounts, p.accounts),
    metric("Ready for sales",             c.ready,    p.ready),
    metric("Worth a look",                c.worth,    p.worth),
    metric("Actions logged",              c.actions,  p.actions),
    metric("Blocked / do-not-contact",    c.blocked,  p.blocked),
    metric("LinkedIn approvals logged",   c.li_logged,p.li_logged),
  ];
}

// ─── MoM insight generator ────────────────────────────────────────────────────
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

  // What to look at next
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { viewMode, setViewMode } = useSampleMode();
  const isSample = viewMode === "sample";

  const [selectedId, setSelectedId] = useState<string>(SAMPLE_CAMPAIGNS[0].id);

  const actionLogQ = useQuery<ActionLogResponse>({
    queryKey: ["sheets", "action-log"],
    queryFn: () =>
      fetch("/api/sheets/action-log", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ActionLogResponse>,
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

  const liveRows     = actionLogQ.data?.rows ?? [];
  const liveQueueRows= queueQ.data?.rows     ?? [];
  const loading      = actionLogQ.isLoading  || queueQ.isLoading;

  const liveCampaigns    = useMemo(() => deriveLiveCampaigns(liveRows),   [liveRows]);
  const hasCampaignField = liveRows.some((r) => r.campaign_name);
  const hasLiveData      = liveRows.length > 0 || liveQueueRows.length > 0;

  // Active campaign (sample mode: selectedId; live mode: first live campaign or null)
  const [liveSelectedCampaign, setLiveSelectedCampaign] = useState<string | null>(null);
  const activeLiveCampaign = liveSelectedCampaign ?? (liveCampaigns[0] ?? null);

  // Derived live stats
  const liveStats      = useMemo(() => deriveLiveStats(liveRows, activeLiveCampaign),      [liveRows, activeLiveCampaign]);
  const liveCostActions= useMemo(() => deriveLiveCostActions(liveRows, activeLiveCampaign),[liveRows, activeLiveCampaign]);
  const liveMom        = useMemo(() => deriveLiveMom(liveRows, activeLiveCampaign),        [liveRows, activeLiveCampaign]);

  // Current sample campaign
  const sampleCampaign = SAMPLE_CAMPAIGNS.find((c) => c.id === selectedId) ?? SAMPLE_CAMPAIGNS[0];
  const sampleStats    = SAMPLE_STATS[selectedId]        ?? SAMPLE_STATS[SAMPLE_CAMPAIGNS[0].id];
  const sampleCosts    = SAMPLE_COST_ACTIONS[selectedId] ?? [];
  const sampleLinkedIn = SAMPLE_LINKEDIN_ROWS[selectedId]?? [];
  const sampleMom      = SAMPLE_MOM[selectedId]          ?? [];
  const sampleCsvRows  = SAMPLE_CSV_ROWS[selectedId]     ?? [];

  // CSV for live mode (linkedin-approved rows)
  const liveCsvRows = liveRows
    .filter((r) => r.final_status === "approved_linkedin_pending_tool")
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

  // Empty state for live mode
  if (!isSample && !loading && !hasLiveData) {
    return (
      <div className="p-6 max-w-4xl space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">Campaign signal reports</h1>
            <p className="text-sm text-muted-foreground mt-1">Compare campaign activity, estimated action cost, and manual export progress.</p>
          </div>
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
                disabled
                className="gap-2 text-xs opacity-60 cursor-not-allowed"
              >
                <FileText className="w-3.5 h-3.5" />
                Export campaign report
              </Button>
              <p className="text-[10px] text-muted-foreground/60 text-right max-w-[200px] leading-snug">
                PDF export is planned — not connected yet.
              </p>
            </div>
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center space-y-3">
          <p className="text-sm font-medium text-foreground">No campaign activity has been recorded yet.</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Reports are built from approved and reviewed accounts. Once activity is recorded, it will appear here automatically.
          </p>
          <Button size="sm" variant="outline" className="text-xs mt-1" onClick={() => setViewMode("sample")}>
            View sample report
          </Button>
        </div>
        <DataReadiness liveRows={liveRows} liveQueueRows={liveQueueRows} hasCampaignField={false} hasMom={false} isSample={false} loading={false} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">Campaign signal reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Compare campaign activity, estimated action cost, and manual export progress.</p>
          {ANALYTICS_URL && (
            <p className="text-xs text-muted-foreground/70 mt-2 max-w-lg leading-relaxed">
              Use Marketplace Analytics for traffic and campaign source performance. Use this page for GTM signal review, action cost estimates, manual exports, and month-over-month signal reporting.
            </p>
          )}
        </div>
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
              disabled
              className="gap-2 text-xs opacity-60 cursor-not-allowed"
            >
              <FileText className="w-3.5 h-3.5" />
              Export campaign report
            </Button>
            <p className="text-[10px] text-muted-foreground/60 text-right max-w-[200px] leading-snug">
              PDF export is planned — not connected yet.
            </p>
          </div>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {isSample && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Showing sample data — this illustrates the full reporting workflow. Switch to Live data when campaign activity has been recorded.
        </div>
      )}

      {/* ── 1. Campaign selector ── */}
      <Section title="Campaign">
        {loading ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : !isSample && !hasCampaignField ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">Campaign tracking is not connected yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Once campaign names are recorded with your review decisions, they will appear here for filtering.
            </p>
          </div>
        ) : isSample ? (
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
        ) : (
          <div className="flex flex-wrap gap-2">
            {liveCampaigns.map((c) => (
              <button
                key={c}
                onClick={() => setLiveSelectedCampaign(c)}
                className={cn(
                  "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                  activeLiveCampaign === c
                    ? "bg-primary/20 text-primary border-primary/50"
                    : "bg-card text-muted-foreground border-border hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Campaign meta (sample only) */}
        {isSample && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            <MetaPair label="Status"  value={sampleCampaign.status}    />
            <MetaPair label="Period"  value={sampleCampaign.dateRange} />
            <MetaPair label="Region"  value={sampleCampaign.region}    />
            <MetaPair label="Industry"value={sampleCampaign.industry}  />
            <SampleBadge />
          </div>
        )}
      </Section>

      {/* ── 2. Campaign summary ── */}
      <Section title="Campaign summary">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : (
          <>
            {isSample && <div className="mb-3"><SampleBadge /></div>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Accounts reviewed"   value={String(isSample ? sampleStats.accounts_reviewed : liveStats.accounts_reviewed)} />
              <MetricCard label="Ready for sales"     value={String(isSample ? sampleStats.ready_for_sales   : liveStats.ready_for_sales)}   accent />
              <MetricCard label="Worth a look"        value={String(isSample ? sampleStats.worth_a_look      : liveStats.worth_a_look)}       />
              <MetricCard label="Nurture decisions"   value={String(isSample ? sampleStats.nurture           : liveStats.nurture)}            />
              <MetricCard label="Blocked"             value={String(isSample ? sampleStats.blocked           : liveStats.blocked)}            />
              <MetricCard label="Actions logged"      value={String(isSample ? sampleStats.actions_logged    : liveStats.actions_logged)}     />
              <MetricCard label="Estimated cost"      value={isSample ? sampleStats.estimated_cost : liveStats.estimated_cost}               />
            </div>
          </>
        )}
      </Section>

      {/* ── 3. Cost per action ── */}
      <Section title="Cost per action">
        {isSample && <div className="mb-3"><SampleBadge /></div>}
        {loading ? <Skeleton className="h-40 rounded-xl" /> : (
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
                {(isSample ? sampleCosts : liveCostActions).map((a, i) => (
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
                {!isSample && liveCostActions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      No actions logged yet for this view.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Costs are estimates until production cost feeds are connected. AI call minutes are an approximation.
        </p>
      </Section>

      {/* ── 4. Manual export workflow ── */}
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

        {isSample && <div className="mb-3"><SampleBadge /></div>}

        {loading ? <Skeleton className="h-32 rounded-xl" /> : (
          !isSample && !hasLiveLinkedIn ? (
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
                  {(isSample ? sampleLinkedIn : liveCsvRows.map((r) => ({
                    company_name: r.company_name, company_domain: r.company_domain,
                    country: r.country, industry: r.industry, contact_name: r.contact_name,
                    export_status: "Ready for export",
                  }))).map((row, i) => (
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
          )
        )}

        {/* CSV export */}
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs"
            disabled={isSample ? sampleCsvRows.length === 0 : !hasLiveLinkedIn}
            onClick={() => {
              const rows = isSample ? sampleCsvRows : liveCsvRows;
              const name = isSample
                ? `druid-linkedin-sample-${selectedId}.csv`
                : `druid-linkedin-export-${new Date().toISOString().slice(0,10)}.csv`;
              downloadCsv(rows, name);
            }}
          >
            <Download className="w-3.5 h-3.5" />
            Download LinkedIn CSV
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {isSample
              ? "Downloads sample rows for reference — not real contact data."
              : hasLiveLinkedIn
              ? `${liveCsvRows.length} row${liveCsvRows.length !== 1 ? "s" : ""} ready for export.`
              : "No rows ready for export yet."}
          </p>
        </div>
      </Section>

      {/* ── 5. Month-over-month ── */}
      <Section title="Month-over-month">
        {isSample && <div className="mb-3"><SampleBadge /></div>}
        {loading ? <Skeleton className="h-40 rounded-xl" /> : (
          !isSample && !liveMom ? (
            <div className="rounded-lg border border-border bg-card px-4 py-5 space-y-2">
              <p className="text-sm text-muted-foreground font-medium">Not enough history yet.</p>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                Month-over-month reporting starts once campaign activity is recorded across two calendar months.
              </p>
              <p className="text-xs text-muted-foreground/50 leading-relaxed">
                To enable this, action logs need dated campaign activity for both the current and previous month.
              </p>
            </div>
          ) : (() => {
            const momMetrics = isSample ? sampleMom : (liveMom ?? []);
            const insights = buildMomInsights(momMetrics);
            return (
              <div className="space-y-4">
                {/* Insight summary */}
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

                {/* Comparison table */}
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
                      {momMetrics.map((m, i) => (
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

                {/* "What this means" card */}
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
          })()
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Costs are estimates only. Do not use these figures to report external performance.
        </p>
      </Section>

      {/* ── 6. Cost assumptions ── */}
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

      {/* ── 7. Data readiness ── */}
      <DataReadiness
        liveRows={liveRows}
        liveQueueRows={liveQueueRows}
        hasCampaignField={hasCampaignField}
        hasMom={!isSample && liveMom !== null}
        isSample={isSample}
        loading={loading}
      />

    </div>
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
    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10">
      Sample data
    </Badge>
  );
}

// ─── Execution status badge ───────────────────────────────────────────────────
function ExecStatusBadge({ status }: { status: string }) {
  const cls =
    status === "Active"       ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" :
    status === "Pending tool" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" :
    status === "Manual export"? "text-blue-400 border-blue-500/30 bg-blue-500/10" :
    status === "Pending sync" ? "text-purple-400 border-purple-500/30 bg-purple-500/10" :
    status === "Locked"       ? "text-red-400 border-red-500/30 bg-red-500/10" :
                                "text-muted-foreground border-border bg-muted/30";
  return <Badge variant="outline" className={cn("text-[10px]", cls)}>{status}</Badge>;
}

// ─── Export status badge ──────────────────────────────────────────────────────
function ExportStatusBadge({ status }: { status: string }) {
  const cls =
    status === "Ready for export"     ? "text-blue-400 border-blue-500/30 bg-blue-500/10" :
    status === "Exported for Dripify" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" :
    status === "Imported to Dripify"  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" :
    status === "Outcome received"     ? "text-primary border-primary/30 bg-primary/10" :
                                        "text-muted-foreground border-border bg-muted/30";
  return <Badge variant="outline" className={cn("text-[10px]", cls)}>{status}</Badge>;
}

// ─── Direction icon ───────────────────────────────────────────────────────────
function DirectionIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up")   return <TrendingUp   className="w-3.5 h-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown  className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

// ─── Data readiness ───────────────────────────────────────────────────────────
function DataReadiness({
  liveRows,
  liveQueueRows,
  hasCampaignField,
  hasMom,
  isSample,
  loading,
}: {
  liveRows: ActionLogRow[];
  liveQueueRows: Record<string, string>[];
  hasCampaignField: boolean;
  hasMom: boolean;
  isSample: boolean;
  loading: boolean;
}) {
  const items = [
    {
      label: "Campaign activity source",
      status: loading ? "Checking…" :
        isSample ? "Sample data" :
        liveRows.length > 0 || liveQueueRows.length > 0 ? "Connected" : "No rows yet",
      ok: !loading && (isSample || liveRows.length > 0 || liveQueueRows.length > 0),
    },
    {
      label: "Action log source",
      status: loading ? "Checking…" :
        isSample ? "Sample data" :
        liveRows.length > 0 ? "Connected" : "No rows yet",
      ok: !loading && (isSample || liveRows.length > 0),
    },
    {
      label: "Campaign tracking",
      status: loading ? "Checking…" :
        isSample ? "Sample data" :
        hasCampaignField ? "Connected" : "Not connected yet",
      ok: !loading && (isSample || hasCampaignField),
    },
    {
      label: "LinkedIn export source",
      status: isSample ? "Sample data" :
        liveRows.some((r) => r.final_status === "approved_linkedin_pending_tool") ? "Ready" : "Not connected yet",
      ok: isSample || liveRows.some((r) => r.final_status === "approved_linkedin_pending_tool"),
    },
    {
      label: "Cost data",
      status: "Estimated until vendor spend is connected",
      ok: false,
    },
    {
      label: "Month-over-month comparison",
      status: isSample ? "Sample data" : hasMom ? "Ready" : "Needs two months of dated activity",
      ok: isSample || hasMom,
    },
    {
      label: "PDF export",
      status: "Not connected yet",
      ok: false,
    },
  ];

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
