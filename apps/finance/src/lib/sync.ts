import type { Transaction as PlaidTxn } from "plaid";
import { plaid } from "./plaid";
import { prisma } from "./db";
import { decrypt } from "./crypto";
import { mapCategory, normalizeAmount, signedBalance } from "./mappers";

export interface SyncResult {
  accounts: number;
  added: number;
  modified: number;
  removed: number;
}

/** Pull balances + transactions for one linked item into the database. */
export async function syncItem(itemRowId: string): Promise<SyncResult> {
  const item = await prisma.plaidItem.findUnique({ where: { id: itemRowId } });
  if (!item) throw new Error(`PlaidItem ${itemRowId} not found`);
  const accessToken = decrypt(item.accessToken);

  // 1) Accounts + balances (authoritative snapshot).
  const accRes = await plaid.accountsGet({ access_token: accessToken });
  for (const a of accRes.data.accounts) {
    const data = {
      name: a.name,
      officialName: a.official_name ?? null,
      mask: a.mask ?? null,
      type: a.type as string,
      subtype: (a.subtype as string | null) ?? null,
      currentBalance: signedBalance(a.type as string, a.balances.current),
      availableBalance: a.balances.available ?? null,
      creditLimit: a.balances.limit ?? null,
      isoCurrency: a.balances.iso_currency_code ?? "USD",
    };
    await prisma.account.upsert({
      where: { plaidAccountId: a.account_id },
      create: { plaidAccountId: a.account_id, plaidItemId: item.id, ...data },
      update: data,
    });
  }

  // Map Plaid account ids → our row ids for transaction FKs.
  const accounts = await prisma.account.findMany({ where: { plaidItemId: item.id } });
  const accountIdByPlaid = new Map(accounts.map((a) => [a.plaidAccountId, a.id]));

  // 2) Transactions via cursor sync (handles added / modified / removed).
  let cursor = item.cursor ?? undefined;
  const added: PlaidTxn[] = [];
  const modified: PlaidTxn[] = [];
  const removed: string[] = [];
  let hasMore = true;

  while (hasMore) {
    const res = await plaid.transactionsSync({ access_token: accessToken, cursor });
    added.push(...res.data.added);
    modified.push(...res.data.modified);
    removed.push(...res.data.removed.map((r) => r.transaction_id).filter(Boolean) as string[]);
    hasMore = res.data.has_more;
    cursor = res.data.next_cursor;
  }

  for (const t of [...added, ...modified]) {
    const accountId = accountIdByPlaid.get(t.account_id);
    if (!accountId) continue;
    const isInflow = t.amount < 0; // Plaid: negative = inflow
    const pfc = t.personal_finance_category;
    const data = {
      accountId,
      date: new Date(t.date),
      name: t.name,
      merchantName: t.merchant_name ?? null,
      amount: normalizeAmount(t.amount),
      category: mapCategory(pfc?.primary, pfc?.detailed, isInflow),
      plaidCategory: pfc?.primary ?? null,
      pending: t.pending,
    };
    await prisma.transaction.upsert({
      where: { plaidTransactionId: t.transaction_id },
      create: { plaidTransactionId: t.transaction_id, ...data },
      update: data,
    });
  }

  if (removed.length) {
    await prisma.transaction.deleteMany({ where: { plaidTransactionId: { in: removed } } });
  }

  await prisma.plaidItem.update({ where: { id: item.id }, data: { cursor } });

  return { accounts: accRes.data.accounts.length, added: added.length, modified: modified.length, removed: removed.length };
}

/** Sync every linked item. Returns aggregate counts. */
export async function syncAll(): Promise<SyncResult> {
  const items = await prisma.plaidItem.findMany({ where: { status: "active" } });
  const totals: SyncResult = { accounts: 0, added: 0, modified: 0, removed: 0 };
  for (const item of items) {
    try {
      const r = await syncItem(item.id);
      totals.accounts += r.accounts;
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
    } catch (e) {
      // One bad item shouldn't abort the rest; surface in logs.
      console.error(`sync failed for item ${item.id}:`, e);
    }
  }
  return totals;
}
