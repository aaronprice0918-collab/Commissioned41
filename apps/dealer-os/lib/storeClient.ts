import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return {};

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// The cold-open cure. After hours away the stored login pass is EXPIRED: the
// first fetches flash it, the server refuses with 401, and every screen used
// to settle for its empty defaults while the pass renewed quietly in the
// background — the "opens on zeros until I hit refresh" bug. Now any 401 gets
// ONE retry with a force-renewed pass before anyone gives up.
let inFlightRefresh: Promise<Record<string, string> | null> | null = null;

async function freshAuthHeaders(): Promise<Record<string, string> | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  // Single-flight: on a cold open EVERY screen can hit 401 in the same
  // instant, and refresh tokens are single-use — eight parallel renewals
  // would fight each other. First caller renews; everyone else awaits it.
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const { data } = await supabase.auth.refreshSession();
        const token = data.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : null;
      } catch {
        return null;
      } finally {
        setTimeout(() => { inFlightRefresh = null; }, 5000);
      }
    })();
  }
  return inFlightRefresh;
}

async function fetchWithAuthRetry(url: string, init: RequestInit): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 401) return first;
  const fresh = await freshAuthHeaders();
  if (!fresh) return first;
  const headers = { ...(init.headers as Record<string, string> | undefined), ...fresh };
  return fetch(url, { ...init, headers });
}

// The last store version this tab has SEEN per key — an opaque write-stamp
// from the server (x-store-version on reads, `version` on write responses).
// Presenting it on a write turns the save into a compare-and-swap: the server
// rejects the write (409) if another device wrote since we last read, which is
// the guard against the stale-tab whole-board clobber.
const storeVersions = new Map<string, string>();

export async function loadStore<T>(key: string): Promise<T | null> {
  try {
    const response = await fetchWithAuthRetry(`/api/store/${key}`, {
      cache: "no-store",
      headers: await authHeaders(),
    });
    if (!response.ok) return null;
    const version = response.headers.get("x-store-version");
    if (version) storeVersions.set(key, version);
    return (await response.json()) as T | null;
  } catch {
    return null;
  }
}

// Returns true only on a confirmed 2xx write. Callers that need to know the
// write actually landed (e.g. a backup before a destructive import) must check
// it; fire-and-forget callers can keep ignoring the return. This legacy path
// does NOT compare-and-swap — use saveStoreGuarded for whole-array boards.
export async function saveStore<T>(key: string, value: T): Promise<boolean> {
  try {
    const res = await fetchWithAuthRetry(`/api/store/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(value),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { version?: string };
      if (data.version) storeVersions.set(key, data.version);
    }
    return res.ok;
  } catch {
    return false;
  }
}

export type GuardedSaveResult<T> =
  // Landed; the server row now carries our value.
  | { ok: true }
  // Another device wrote since this tab last read — the write was REJECTED and
  // the current server copy rides back so the caller can adopt it.
  | { ok: false; conflict: true; value: T | null }
  // Network/server failure — retryable, nothing was decided.
  | { ok: false; conflict: false };

// Compare-and-swap write: only lands if nobody wrote since this tab's last
// read. Falls back to a plain (last-write-wins) save when no version has been
// seen yet — e.g. the first write of a fresh org, or the dev file store before
// its first read.
export async function saveStoreGuarded<T>(key: string, value: T): Promise<GuardedSaveResult<T>> {
  try {
    const version = storeVersions.get(key);
    const res = await fetchWithAuthRetry(`/api/store/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(version ? { "x-store-if-version": version } : {}),
        ...(await authHeaders()),
      },
      body: JSON.stringify(value),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { version?: string };
      if (data.version) storeVersions.set(key, data.version);
      return { ok: true };
    }
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { version?: string; value?: T | null };
      if (data.version) storeVersions.set(key, data.version);
      return { ok: false, conflict: true, value: data.value ?? null };
    }
    return { ok: false, conflict: false };
  } catch {
    return { ok: false, conflict: false };
  }
}
