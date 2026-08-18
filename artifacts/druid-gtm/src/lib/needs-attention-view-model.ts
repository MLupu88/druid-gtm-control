import type { Account, AccountListItem } from "@/lib/accounts-api";

export interface AccountIdentity {
  primary: string;
  secondary: string | null;
}

export function needsAttentionAccountIdentity(account: Account): AccountIdentity {
  if (account.companyName) {
    return { primary: account.companyName, secondary: account.companyDomain };
  }
  if (account.companyDomain) {
    return { primary: account.companyDomain, secondary: null };
  }
  return { primary: account.accountKey, secondary: null };
}

// The server has already determined membership from open attention_items
// before pagination. This helper only applies the same page-local identity
// search used by All Accounts; it never interprets latestDecision or removes
// an account from the canonical response for lifecycle reasons.
export function filterCanonicalNeedsAttentionItems(
  items: AccountListItem[],
  search: string,
): AccountListItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;

  return items.filter(
    ({ account }) =>
      account.companyName?.toLowerCase().includes(query) ||
      account.companyDomain?.toLowerCase().includes(query) ||
      account.accountKey.toLowerCase().includes(query),
  );
}

export function formatAttentionReason(reasonCode: string): string {
  return reasonCode
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAttentionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}
