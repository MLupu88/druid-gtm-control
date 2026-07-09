// server/n8n.js — server-side ONLY. Posts approvals to n8n with the shared secret.
// The secret never reaches the browser. Import this only from Express route handlers.
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

export async function postToN8n(path, payload) {
  if (!N8N_BASE_URL) throw new Error("N8N_BASE_URL not set");
  const url = `${N8N_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gtm-secret": N8N_WEBHOOK_SECRET || "" },
    body: JSON.stringify({
      ...payload,
      source: "replit_gtm_mission_control",
      approved_at: payload.approved_at || new Date().toISOString()
    })
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

// Every approval payload carries the full row snapshot so the n8n receiver can re-check gates.
export function buildApprovalPayload(row, { approved_by, reason, extra = {} }) {
  return {
    queue_key: row.queue_key,
    company_domain: row.company_domain, company_name: row.company_name,
    contact_email: row.contact_email, contact_name: row.contact_name,
    contact_phone: row.contact_phone, stream: row.stream,
    do_not_contact: row.do_not_contact, dpo_voice_cleared: row.dpo_voice_cleared,
    consent_call: row.consent_call, linkedin: row.linkedin,
    recommended_action: row.recommended_action, recommended_solution: row.recommended_solution,
    why_now: row.why_now, account_score: row.account_score,
    approved_by, reason,
    record_snapshot: row,           // full row, used by gtm-action/retry
    ...extra                         // { channel } | { decision } | { action }
  };
}

// PHASE C: payload for the account queue — carries account_key + queue_source + output_type + selected_contact.
export function buildAccountApprovalPayload(row, { approved_by, reason, channel, selected_contact, queue_source = "account_queue" }) {
  const c = selected_contact || {
    name: row.best_contact_name, email: row.best_contact_email, title: row.best_contact_title,
    phone: row.best_contact_phone, linkedin: row.best_contact_linkedin,
  };
  return {
    account_key: row.account_key,
    queue_source,
    output_type: row.recommended_output,
    channel, // "voice" | "email" | "linkedin"
    region: row.region,
    selected_contact: c,
    // fields the receiver guard reads:
    do_not_contact: c.do_not_contact || row.do_not_contact || "false",
    consent_email: row.consent_email || "", li_basis_cleared: row.li_basis_cleared || "",
    consent_call: row.consent_call || "", dpo_voice_cleared: row.dpo_voice_cleared || "",
    gate_status: row.gate_status || "passed",
    approved_by: approved_by || "operator",
    approved_at: new Date().toISOString(),
    reason: reason || "",
  };
}
