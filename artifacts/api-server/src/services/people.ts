// LS8 — canonical People read model for the Account Workspace People tab.
//
// Reads ONLY already-persisted canonical rows (people/account_people) —
// no observation JSON is parsed here, no recomputation, no scoring. The
// person/account association itself is produced exclusively by
// ../services/identityResolution.ts's planPersonResolution/
// applyPersonPlan/upsertAccountPerson (via ../services/rb2bIdentity.ts for
// RB2B, and reusable unmodified by any future provider) — this module is
// a pure read, mirroring ../services/accountTruth.ts's and
// ../services/accountActivity.ts's own "throws AccountNotFoundError for
// an unknown account" convention.
//
// title lives on account_people (a fact about this person's relationship
// to THIS account), never on people itself — see
// lib/db/src/schema/accountPeople.ts's own module comment.

import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountPeople, accounts, people } from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

export interface AccountPersonDTO {
  id: string;
  fullName: string | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  /** This account's relationship-specific title for this person — see account_people.title's own module comment: a title is a fact about a relationship to one account, not about the person globally. */
  title: string | null;
  /** The provider(s) that contributed evidence for this specific account_people association (see account_people.source). Currently one row per (account, person) pair, so this is a single value, not an array — kept as a string, not re-parsed into a list, until a genuine multi-provider merge exists. */
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Every canonical Person currently associated with this account, newest
 * last-seen first. Never fabricates a placeholder row for "no people
 * yet" — an empty array is the honest, correct answer when no
 * account_people row exists for this account.
 */
export async function getAccountPeople(
  db: Db,
  accountId: string,
): Promise<AccountPersonDTO[]> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const rows = await db
    .select({
      id: people.id,
      fullName: people.fullName,
      workEmail: people.workEmail,
      linkedinUrl: people.linkedinUrl,
      title: accountPeople.title,
      source: accountPeople.source,
      firstSeenAt: accountPeople.firstSeenAt,
      lastSeenAt: accountPeople.lastSeenAt,
    })
    .from(accountPeople)
    .innerJoin(people, eq(accountPeople.personId, people.id))
    .where(eq(accountPeople.accountId, accountId))
    .orderBy(desc(accountPeople.lastSeenAt), desc(people.id));

  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    workEmail: row.workEmail,
    linkedinUrl: row.linkedinUrl,
    title: row.title,
    source: row.source,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));
}
