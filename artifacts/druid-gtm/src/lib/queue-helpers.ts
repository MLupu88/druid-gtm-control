import {
  OUTPUT_TYPE_LABELS,
  IDENTITY_LABELS,
  BLOCK_REASON_LABELS,
  STATUS_LABELS_V3,
  STATUS_FALLBACK_LABEL,
  humanizeToken,
  needsReview,
  needsReviewAccount,
  visitorSafeCopy,
  costLabel,
  BUTTONS,
  buttonsForOutput,
  buttonDisabled,
  buttonDisabledPhaseC,
} from "@workspace/gtm-shared";

export type Row = Record<string, string>;
export type OutputTypeKey = keyof typeof OUTPUT_TYPE_LABELS;
export type ButtonKey = keyof typeof BUTTONS;

// Map signal-queue row → OUTPUT_TYPE key using score_tier + engine_status
export function signalOutputType(row: Row): OutputTypeKey {
  const status = String(row.engine_status ?? "").toLowerCase();
  const gate = String(row.gate_status ?? "").toLowerCase();
  const blockReason = String(row.block_reason ?? "").toLowerCase();
  if (
    status === "suppressed" ||
    (gate === "failed" && (blockReason.includes("internal") || blockReason.includes("excluded")))
  )
    return "Suppressed";
  const tier = String(row.score_tier ?? "").toLowerCase();
  if (tier === "outbound_now") return "MQL";
  if (tier === "sales_review") return "Sales Review";
  if (tier === "nurture") return "Nurture";
  return "Sales Review";
}

// Map account-queue row → OUTPUT_TYPE key
export function accountOutputType(row: Row): OutputTypeKey {
  const out = row.recommended_output as OutputTypeKey;
  return OUTPUT_TYPE_LABELS[out] ? out : "Sales Review";
}

// Get output type from any row given source
export function rowOutputType(row: Row, source: string): OutputTypeKey {
  return String(source).toLowerCase() === "account_queue"
    ? accountOutputType(row)
    : signalOutputType(row);
}

// Does this row need the operator's attention?
export function rowNeedsReview(row: Row, source: string): boolean {
  return String(source).toLowerCase() === "account_queue"
    ? needsReviewAccount(row)
    : needsReview(row);
}

// Get the identity label for a row
export function rowIdentityLabel(row: Row, source: string) {
  let key: string;
  if (String(source).toLowerCase() === "account_queue") {
    key = row.identity_resolution ?? "";
  } else {
    const res = String(row.resolution_level ?? "").toLowerCase();
    if (res === "person") key = "identified_contact";
    else if (res === "company") key = "company_level";
    else key = "anonymous";
  }
  return IDENTITY_LABELS[key as keyof typeof IDENTITY_LABELS] ?? null;
}

// Tailwind classes for output type badge
export function outputTypeBadgeClasses(out: OutputTypeKey): string {
  switch (out) {
    case "MQL":
      return "bg-[#00e676]/20 text-[#00e676] border-[#00e676]/50";
    case "Sales Review":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "Pipeline Assist":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "Owner Alert":
      return "bg-teal-500/20 text-teal-400 border-teal-500/30";
    case "Nurture":
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
    case "Retarget":
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "Suppressed":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  }
}

// Human-readable block reason — never leaks a raw internal enum (e.g. "excluded:internal")
export function blockReasonText(reason: string): string {
  return (
    BLOCK_REASON_LABELS[reason as keyof typeof BLOCK_REASON_LABELS] ?? humanizeToken(reason)
  );
}

// Human-readable status label — falls back to the same neutral, non-overclaiming
// wording used everywhere else, never the raw final_status string.
export function statusLabelText(status: string): string {
  return STATUS_LABELS_V3[status as keyof typeof STATUS_LABELS_V3] ?? STATUS_FALLBACK_LABEL;
}

// Get safe why_now text for display
export function safeWhyNow(row: Row): string {
  const result = visitorSafeCopy(row.why_now ?? "", row.visitor_claim_allowed ?? "false");
  return result.text;
}

// Get cost label for a row
export function rowCostLabel(row: Row) {
  return costLabel(row);
}

// Buttons available for a row
export function rowButtons(row: Row, source: string): ButtonKey[] {
  const out = rowOutputType(row, source);
  return (buttonsForOutput(out) as ButtonKey[]).filter((k) => BUTTONS[k]);
}

// Is a button disabled for a row (signal queue path)?
export function isButtonDisabled(
  buttonKey: ButtonKey,
  row: Row,
): { disabled: boolean; reason: string } {
  return buttonDisabled(buttonKey, row);
}

// Is a button disabled for an account-queue row?
export function isButtonDisabledAccount(
  buttonKey: ButtonKey,
  row: Row,
  cfg: Record<string, string>,
): boolean {
  return buttonDisabledPhaseC(buttonKey, row, cfg);
}

// Determine which server route to call for a button
export function buttonEndpointRoute(buttonKey: ButtonKey): string | null {
  const btn = BUTTONS[buttonKey];
  if (!btn || btn.kind !== "server") return null;
  const endpoint = (btn as { kind: "server"; endpoint: string }).endpoint;
  switch (endpoint) {
    case "activate":
      return "/api/n8n/activate";
    case "decision":
      return "/api/n8n/decision";
    case "action":
      return "/api/n8n/action";
    default:
      return null;
  }
}

// Build POST body for a button action.
// Operator identity (approved_by / approved_by_email / approved_at) is
// derived server-side from the authenticated session, not sent by the client.
export function buttonPostBody(
  buttonKey: ButtonKey,
  row: Row,
  reason: string,
): Record<string, unknown> {
  const btn = BUTTONS[buttonKey];
  const body = btn.kind === "server"
    ? (btn as { kind: "server"; body?: Record<string, unknown> }).body ?? {}
    : {};
  return {
    ...body,
    row,
    reason,
  };
}
