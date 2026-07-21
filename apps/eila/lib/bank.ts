import "server-only";
import crypto from "node:crypto";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { appConfig } from "./appConfig";

// Per-subscriber bank connections (Plaid) — the VIP feature. Access tokens are
// encrypted at rest in lite_plaid_items (RLS on, no policies: only the service
// role can read). Settings come from appConfig (env var or lite_app_config
// table), so the operator can manage keys without a deploy. Nothing
// bank-related ever reaches the client except balances + recent transactions,
// which the client stores in the member's own money config like any other edit.

const ITEMS_TABLE = "lite_plaid_items";
const BANK_TRANSACTION_LOOKBACK_DAYS = 92;
const BANK_TRANSACTION_SYNC_LIMIT = 500;

interface BankConfig {
  clientId?: string;
  secret?: string;
  env: string;
  tokenKey?: string;
  redirectUri?: string;
}

async function loadBankConfig(): Promise<BankConfig> {
  const [clientId, secret, env, tokenKey, redirectUri] = await Promise.all([
    appConfig("PLAID_CLIENT_ID"),
    appConfig("PLAID_SECRET"),
    appConfig("PLAID_ENV"),
    appConfig("PLAID_TOKEN_KEY"),
    appConfig("PLAID_REDIRECT_URI"),
  ]);
  return { clientId, secret, env: env ?? "sandbox", tokenKey, redirectUri };
}

export async function bankConfigured(): Promise<boolean> {
  const c = await loadBankConfig();
  const ok = !!(c.clientId && c.secret && c.tokenKey);
  if (!ok) {
    const missing = [!c.clientId && "PLAID_CLIENT_ID", !c.secret && "PLAID_SECRET", !c.tokenKey && "PLAID_TOKEN_KEY"]
      .filter(Boolean)
      .join(",");
    console.error(`[bank] not configured — missing: ${missing}`);
  }
  return ok;
}

function plaidClient(c: BankConfig): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[c.env as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
      baseOptions: { headers: { "PLAID-CLIENT-ID": c.clientId, "PLAID-SECRET": c.secret } },
    }),
  );
}

// ---- token encryption (AES-256-GCM, PLAID_TOKEN_KEY = 64 hex chars) ----

function keyBuf(tokenKey: string | undefined): Buffer {
  if (!tokenKey || tokenKey.length !== 64) throw new Error("PLAID_TOKEN_KEY must be a 32-byte hex string (64 chars).");
  return Buffer.from(tokenKey, "hex");
}

export function encryptToken(plain: string, tokenKey: string | undefined): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(tokenKey), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
}

export function decryptToken(payload: string, tokenKey: string | undefined): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(tokenKey), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// ---- link / exchange / sync ----

export async function createBankLinkToken(userId: string): Promise<string> {
  const c = await loadBankConfig();
  const res = await plaidClient(c).linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "EILA",
    products: ["transactions" as Products],
    country_codes: ["US" as CountryCode],
    language: "en",
    ...(c.redirectUri ? { redirect_uri: c.redirectUri } : {}),
  });
  return res.data.link_token;
}

export async function exchangeAndSaveItem(userId: string, email: string, publicToken: string, institution: string): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("supabase-admin-not-configured");
  const c = await loadBankConfig();
  const ex = await plaidClient(c).itemPublicTokenExchange({ public_token: publicToken });
  const { error } = await admin.from(ITEMS_TABLE).upsert(
    {
      user_id: userId,
      email: email.toLowerCase(),
      item_id: ex.data.item_id,
      access_token_enc: encryptToken(ex.data.access_token, c.tokenKey),
      institution: institution || "Bank",
      status: "active",
    },
    { onConflict: "item_id" },
  );
  if (error) throw new Error(`vault write failed: ${error.message}`);
}

export interface BankAccountView {
  name: string;
  mask: string;
  type: "checking" | "savings" | "credit" | "other";
  balance: number;
}

export interface BankSyncResult {
  institutions: string[];
  accounts: BankAccountView[];
  /** Spendable cash: available balance across checking accounts. */
  checking: number | null;
  /** Saved money across savings/money-market accounts. */
  savings: number | null;
  /** Recent settled outflows/inflows, newest first. */
  transactions: { date: string; name: string; amount: number }[];
  asOf: string; // ISO date
}

function classify(type: string, subtype: string | null): BankAccountView["type"] {
  if (type === "depository") {
    if (subtype && /savings|money market|cd/.test(subtype)) return "savings";
    return "checking";
  }
  if (type === "credit") return "credit";
  return "other";
}

export async function listBankItems(userId: string): Promise<{ id: string; institution: string }[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data } = await admin.from(ITEMS_TABLE).select("id, institution").eq("user_id", userId).eq("status", "active");
  return data ?? [];
}

export async function syncBank(userId: string): Promise<BankSyncResult | null> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("supabase-admin-not-configured");
  const c = await loadBankConfig();
  const plaid = plaidClient(c);
  const { data: items } = await admin
    .from(ITEMS_TABLE)
    .select("id, access_token_enc, institution")
    .eq("user_id", userId)
    .eq("status", "active");
  if (!items?.length) return null;

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - BANK_TRANSACTION_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const result: BankSyncResult = { institutions: [], accounts: [], checking: null, savings: null, transactions: [], asOf: today };

  for (const item of items) {
    const accessToken = decryptToken(item.access_token_enc, c.tokenKey);
    result.institutions.push(item.institution);

    const acc = await plaid.accountsGet({ access_token: accessToken });
    for (const a of acc.data.accounts) {
      const kind = classify(a.type as string, (a.subtype as string | null) ?? null);
      const balance = a.balances.available ?? a.balances.current ?? 0;
      result.accounts.push({ name: a.name, mask: a.mask ?? "", type: kind, balance });
      if (kind === "checking") result.checking = (result.checking ?? 0) + balance;
      if (kind === "savings") result.savings = (result.savings ?? 0) + balance;
    }

    // About three months of settled activity: enough to spot monthly drafts.
    let offset = 0;
    for (;;) {
      const tx = await plaid.transactionsGet({
        access_token: accessToken,
        start_date: start,
        end_date: today,
        options: { count: 100, offset, include_personal_finance_category: false },
      });
      for (const t of tx.data.transactions) {
        if (t.pending) continue;
        // Plaid: positive amount = money out. Flip so outflows are negative (Lite convention).
        result.transactions.push({ date: t.date, name: t.merchant_name ?? t.name, amount: -t.amount });
      }
      offset += tx.data.transactions.length;
      if (offset >= tx.data.total_transactions || tx.data.transactions.length === 0) break;
    }
  }

  result.transactions.sort((a, b) => b.date.localeCompare(a.date));
  result.transactions = result.transactions.slice(0, BANK_TRANSACTION_SYNC_LIMIT);
  console.log(
    `[bank] sync: ${result.accounts.length} accounts, checking=${result.checking}, savings=${result.savings}, tx=${result.transactions.length}`,
  );
  return result;
}

export async function disconnectBank(userId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("supabase-admin-not-configured");
  const c = await loadBankConfig();
  const plaid = plaidClient(c);
  const { data: items } = await admin.from(ITEMS_TABLE).select("id, access_token_enc").eq("user_id", userId);
  let removed = 0;
  for (const item of items ?? []) {
    try {
      await plaid.itemRemove({ access_token: decryptToken(item.access_token_enc, c.tokenKey) });
    } catch (e) {
      console.error("[bank] itemRemove failed (continuing, row still deleted):", e);
    }
    await admin.from(ITEMS_TABLE).delete().eq("id", item.id);
    removed++;
  }
  return removed;
}
