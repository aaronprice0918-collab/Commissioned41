"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppData, CompModel, Deal, IlaMemory, Industry, LifeItem, ProductDef, Profile, Role } from "./types";
import { INDUSTRY_DEAL } from "./industry";
import { ensureDeals } from "./migrate";
import { getSupabase, STATE_TABLE } from "./supabase";
import type { Condition, PayPlan } from "./payplan/types";
import { MoneyConfig } from "./money/types";
import { defaultPlan, makePlan } from "./payplan/plans";
import { reconcileImport } from "./loggImport";
import { relock } from "./biometric";

export { defaultPlan };

const KEY = "missionos-lite-v1";

// Migrate a legacy CompModel (pre-engine) into a normalized PayPlan, so existing
// stored/synced profiles keep working after the engine refactor.
export function compToPlan(comp: CompModel): PayPlan {
  const tiers = [
    ...(comp.unitTiers || []).map((t, i) => ({ id: `u${i}`, label: `${t.units}-unit bonus`, metric: "units" as const, threshold: t.units, kind: "flat" as const, amount: t.bonus })),
    ...(comp.grossTiers || []).map((t, i) => ({ id: `g${i}`, label: `Gross bonus`, metric: "totalGross" as const, threshold: t.gross, kind: "flat" as const, amount: t.bonus })),
  ];
  const bonuses = comp.spiffs ? [{ id: "spiffs", label: "Monthly spiffs", condition: { metric: "units" as const, op: "gte" as const, value: 0 }, effect: { kind: "flat" as const, amount: comp.spiffs } }] : [];
  // Kickers: `?? default` keeps the old-model default for comps that never
  // stored the field, but an EXPLICIT 0 means the store disabled it — the old
  // `|| 0.5` was inventing pay for those plans. And a grid comp keeps its
  // monthly spiffs too; they were silently dropped (July 8 audit).
  const pvrAdd = comp.grid ? comp.grid.pvrBonusAdd ?? 0.5 : 0;
  const vscAdd = comp.grid ? comp.grid.vscBonusAdd ?? 0.5 : 0;
  const gridKickers = comp.grid
    ? [
        ...(pvrAdd > 0 ? [{ id: "pvr1900", label: "PVR $1,900+", condition: { metric: "pvr" as const, op: "gte" as const, value: comp.grid.pvrBonusThreshold || 1900 }, effect: { kind: "addRatePct" as const, amount: pvrAdd } }] : []),
        ...(vscAdd > 0 ? [{ id: "vsc50", label: "VSC penetration 50%+", condition: { metric: "vscPenetration" as const, op: "gte" as const, value: comp.grid.vscBonusThreshold || 50 }, effect: { kind: "addRatePct" as const, amount: vscAdd } }] : []),
      ]
    : [];
  return makePlan({
    role: comp.role,
    base: { salary: 0, frontPct: comp.frontCommissionPct, backPct: comp.backCommissionPct, perUnit: comp.flatPerUnit, perProduct: comp.productBonusPerUnit, basis: "total" },
    grid: comp.grid ? { xAxis: "pvr", x: comp.grid.pvr, yAxis: "ppt", y: comp.grid.ppt, rates: comp.grid.rates, basis: "back" } : undefined,
    tiers,
    bonuses: [...gridKickers, ...bonuses],
    draw: comp.draw ? { amount: comp.draw, period: "monthly", recoverable: true } : undefined,
    guaranteeFloor: comp.guarantee || undefined,
    goalUnits: comp.goalUnits,
    taxRate: comp.taxRate,
  });
}

function normalizePlan(plan: PayPlan): PayPlan {
  let changed = false;
  const bonuses = plan.bonuses.map((b) => {
    const normalizeCondition = (c: Condition): Condition => {
      if (c.metric === "vscPenetration" && c.op === "gt" && c.value === 50) {
        changed = true;
        return { ...c, op: "gte" as const };
      }
      const isAaronPvrKicker = b.id === "pvr1900" || /PVR.*1,?900/i.test(b.label);
      if (isAaronPvrKicker && b.effect.kind === "addRatePct" && b.effect.amount === 0.5 && c.metric === "pvr" && c.op === "gt" && c.value === 1900) {
        changed = true;
        return { ...c, op: "gte" as const };
      }
      return c;
    };
    const condition = Array.isArray(b.condition) ? b.condition.map(normalizeCondition) : normalizeCondition(b.condition);
    if (condition === b.condition) return b;
    const label = b.label
      .replace(/VSC penetration over 50%/i, "VSC penetration 50%+")
      .replace(/PVR over \$1,900/i, "PVR $1,900+");
    return { ...b, label, condition };
  });
  return changed ? { ...plan, bonuses } : plan;
}

// Ensure any loaded profile has a PayPlan (migrate legacy `comp`) and an
// `industry` (profiles created before the industry field existed default to
// automotive — the only industry the app supported until now).
function ensurePlan(data: AppData): AppData {
  let d = ensureDeals(data);
  let p = d.profile;
  if (!p) return d;
  if (!p.industry) p = { ...p, industry: "automotive" };
  if (p.plan) {
    const plan = normalizePlan(p.plan);
    // Profiles migrated BEFORE the July-5 guaranteeFloor fix carry a plan
    // whose guarantee was dropped in conversion; the legacy comp still holds
    // it — patch it back once (never overwrite a guarantee the user set).
    if (p.comp?.guarantee && !p.plan.guaranteeFloor) {
      return { ...d, profile: { ...p, plan: { ...plan, guaranteeFloor: p.comp.guarantee } } };
    }
    return plan === p.plan ? { ...d, profile: p } : { ...d, profile: { ...p, plan } };
  }
  if (p.comp) return { ...d, profile: { ...p, plan: compToPlan(p.comp) } };
  return { ...d, profile: { ...p, plan: defaultPlan(p.role) } };
}

function uid() {
  try { return crypto.randomUUID(); } catch { return "d" + Date.now() + Math.floor(Math.random() * 1e6); }
}

const NAMES = ["Marcus Bell", "Tina Alvarez", "The Okafors", "Dwight Soto", "Renee Park", "Jamal Carter", "Priya Nair", "Ben Whitfield", "Gloria Mendez", "Tyler Roads", "Sofia Marin", "Andre Cole", "Kim Tran", "Leah Foster", "Omar Haddad", "Casey Lin", "Will Boone", "Nadia Reyes", "Grant Hill", "Mia Donovan"];

// Per-industry demo shape: what a believable month looks like in that world.
// `delivered` is the sales-role monthly volume; money ranges are the primary
// channel; secondary/addons only where the industry has them. Items are real
// things a rep in that industry would recognize instantly.
interface DemoCfg { items: string[]; delivered: number; amtLo: number; amtHi: number; secLo: number; secHi: number; addLo: number; addHi: number }
const DEMO: Record<Industry, DemoCfg> = {
  automotive: { items: ["CX-5", "CX-30", "CX-90", "Mazda3", "CX-50", "MX-5", "CX-70"], delivered: 9, amtLo: 900, amtHi: 2400, secLo: 700, secHi: 2000, addLo: 0, addHi: 3 },
  rv_boats_powersports: { items: ["Travel trailer 26ft", "Pontoon 22ft", "SxS 1000", "Fifth wheel", "Jet ski", "Bass boat"], delivered: 6, amtLo: 1500, amtHi: 4200, secLo: 800, secHi: 2600, addLo: 0, addHi: 3 },
  real_estate: { items: ["412 Maple St", "88 Lakeview Dr", "2205 Birch Ct", "17 Windsong Ln", "930 Ashford Way"], delivered: 2, amtLo: 6800, amtHi: 12500, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  mortgage: { items: ["30yr conventional", "FHA purchase", "VA purchase", "Cash-out refi", "Jumbo purchase"], delivered: 5, amtLo: 210000, amtHi: 480000, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  insurance: { items: ["Auto + home bundle", "Term life 20yr", "Homeowners", "Auto full coverage", "Small business GL"], delivered: 26, amtLo: 900, amtHi: 3400, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  furniture: { items: ["Sectional + ottoman", "King bedroom set", "Dining set 6pc", "Recliner pair", "Sleeper sofa"], delivered: 24, amtLo: 1800, amtHi: 8600, secLo: 0, secHi: 0, addLo: 0, addHi: 2 },
  jewelry: { items: ["1.2ct solitaire", "Rolex Datejust", "Diamond studs", "Tennis bracelet", "Custom band"], delivered: 15, amtLo: 1200, amtHi: 14500, secLo: 0, secHi: 0, addLo: 0, addHi: 1 },
  solar_roofing: { items: ["8.4kW system", "Full re-roof", "10.2kW + battery", "Roof + gutters", "6.8kW system"], delivered: 5, amtLo: 17500, amtHi: 44000, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  recruiting: { items: ["Sr. engineer @ Acme", "Controller @ Northpoint", "PM @ Helix", "Sales dir @ Vantage"], delivered: 2, amtLo: 17000, amtHi: 32000, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  saas: { items: ["Acme Corp — 24 seats", "Northpoint — enterprise", "Helix — 60 seats", "Vantage — expansion"], delivered: 4, amtLo: 14000, amtHi: 62000, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  financial_services: { items: ["IRA rollover", "Fixed annuity", "529 plan", "Managed account", "Term policy"], delivered: 8, amtLo: 2200, amtHi: 9500, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
  other: { items: ["Package A", "Premium plan", "Custom order", "Upgrade"], delivered: 12, amtLo: 900, amtHi: 5200, secLo: 0, secHi: 0, addLo: 0, addHi: 0 },
};

// Role multiplier on volume: structuring specialists and managers see far more
// deals cross their desk than an individual producer; setters log activity.
const ROLE_VOLUME: Record<Role, number> = { sales: 1, finance: 4, sales_manager: 6, bdc: 2 };

// A realistic month of activity so the dashboard is alive on first open —
// industry-true items and money, scaled to the role's normal volume, spread
// across the month so pace/paycheck numbers are meaningful. Deterministic
// (no RNG) so it stays stable across renders and devices.
export function demoDeals(role: Role = "sales", industry: Industry = "automotive"): Deal[] {
  const cfg = DEMO[industry];
  const spec = INDUSTRY_DEAL[industry];
  const cats = spec.categories?.map((c) => c.id) ?? [undefined];
  const now = new Date();
  const today = now.getDate();
  const d = (day: number) => new Date(now.getFullYear(), now.getMonth(), Math.min(Math.max(day, 1), today)).toISOString();
  const vary = (i: number, lo: number, hi: number) => (hi <= lo ? lo : lo + ((i * 137) % (hi - lo + 1)));
  const mk = (o: Partial<Deal>): Deal => ({
    id: uid(), date: d(today), customer: "", item: "", category: undefined,
    amount: 0, secondary: 0, addons: 0, reserve: 0, status: "delivered", demo: true, ...o,
  });

  const delivered = Math.max(2, Math.round(cfg.delivered * ROLE_VOLUME[role] * (role === "bdc" ? 1 : 1)));
  const out: Deal[] = [];
  for (let i = 0; i < delivered; i++) {
    const day = Math.max(1, Math.round(((i + 1) / delivered) * today));
    out.push(mk({
      customer: NAMES[i % NAMES.length],
      item: cfg.items[i % cfg.items.length],
      category: cats[i % cats.length],
      amount: role === "bdc" ? 0 : vary(i, cfg.amtLo, cfg.amtHi),
      secondary: role === "bdc" ? 0 : vary(i + 3, cfg.secLo, cfg.secHi),
      addons: vary(i, cfg.addLo, cfg.addHi),
      date: d(day),
    }));
  }

  // A small live pipeline so the follow-up queue and "likely" projection breathe.
  const live: { s: Deal["status"]; n: number; note?: string }[] = [
    { s: "finance", n: 1 }, { s: "pending", n: 1 },
    { s: "working", n: 1, note: "Comparing options — needs a nudge" }, { s: "appointment", n: 2 },
  ];
  let k = 0;
  for (const grp of live) for (let j = 0; j < grp.n; j++, k++) {
    out.push(mk({
      customer: NAMES[(k + 7) % NAMES.length],
      item: cfg.items[(k + 2) % cfg.items.length],
      category: cats[k % cats.length],
      amount: vary(k, cfg.amtLo, cfg.amtHi),
      secondary: vary(k + 1, cfg.secLo, cfg.secHi),
      addons: vary(k, cfg.addLo, cfg.addHi),
      status: grp.s, note: grp.note,
      followUpAt: grp.s === "appointment" || grp.s === "finance" ? d(today) : undefined,
    }));
  }
  return out;
}

interface Ctx {
  data: AppData;
  /** Live read of the latest written state (dataRef.current). React state
   *  snapshots go stale across awaits — long async flows (EILA's multi-round
   *  tool turns) read THIS at each step so they never act on, or write from,
   *  a frozen turn-start copy. Every mutator updates it synchronously. */
  getData: () => AppData;
  ready: boolean;
  account: { id: string; email: string } | null;
  syncing: boolean;
  syncError: boolean;
  /** True once the signed-in user's cloud copy has been checked at least once.
   *  Until then, "no local profile" does NOT mean "new user" — their profile
   *  may still be on its way down (sign-out wipes the device on purpose). */
  cloudChecked: boolean;
  /** The last cloud check FAILED (network blip, outage). With no local profile
   *  the app must offer a retry, NOT onboarding — rebuilding a "new" profile
   *  over a temporarily unreachable cloud copy would overwrite the real one. */
  cloudError: boolean;
  setProfile: (name: string, role: Role, industry: Industry, plan: PayPlan, fileName?: string) => void;
  updatePlan: (plan: PayPlan) => void;
  updateProducts: (products: ProductDef[]) => void;
  updateJacketOrder: (jacketOrder: string[]) => void;
  updateDaysOff: (daysOff: number[]) => void;
  updateMoney: (money: MoneyConfig) => void;
  addDeal: (deal: Omit<Deal, "id">) => void;
  addDeals: (deals: Omit<Deal, "id">[]) => void;
  importDeals: (deals: Omit<Deal, "id">[]) => { added: number; updated: number };
  updateDeal: (id: string, patch: Partial<Deal>) => void;
  removeDeal: (id: string) => void;
  addLifeItem: (item: Omit<LifeItem, "id" | "createdAt">) => void;
  updateLifeItem: (id: string, patch: Partial<LifeItem>) => void;
  removeLifeItem: (id: string) => void;
  addIlaMemories: (notes: string[]) => void;
  forgetIlaMemory: (id: string) => void;
  clearSampleData: () => void;
  resetAll: () => void;
  signUp: (email: string, password: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (newPassword: string) => Promise<string | null>;
}

const MissionCtx = createContext<Ctx | null>(null);

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>({ profile: null, deals: [] });
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cloudChecked, setCloudChecked] = useState(false);
  const [cloudError, setCloudError] = useState(false);

  const dataRef = useRef(data); dataRef.current = data;
  const accountRef = useRef(account); accountRef.current = account;
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // initial on-device load
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setData(ensurePlan(JSON.parse(raw))); } catch {}
    setReady(true);
  }, []);

  // Cross-tab adoption: another tab of this same account just wrote the blob —
  // take it as OUR new baseline (memory + ref only; it's already in
  // localStorage, and re-persisting would fire a duplicate cloud push).
  // Without this, two open tabs each kept their mount-time snapshot and
  // blind-overwrote each other's work locally AND in the cloud (July 8 audit,
  // HIGH: log a deal in tab A, log one in tab B → A's deal erased everywhere).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || e.newValue == null) return;
      try {
        const next = ensurePlan(JSON.parse(e.newValue) as AppData);
        dataRef.current = next;
        setData(next);
      } catch { /* corrupt/foreign blob — keep our state */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const writeLocal = useCallback((next: AppData) => {
    dataRef.current = next; // synchronous — sequential mutations (EILA multi-tool turns) chain instead of clobbering
    setData(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }, []);

  // Timestamp arbitration (July 5 audit DL-3): every local edit stamps
  // dirtyAt; every successful push records what the cloud now holds. On any
  // app-open/sign-in we compare — newer side wins, instead of blind clobber.
  const DIRTY_KEY = "missionos-lite-dirty-at";
  const stampDirty = () => { try { localStorage.setItem(DIRTY_KEY, new Date().toISOString()); } catch {} };
  const dirtyAt = () => { try { return localStorage.getItem(DIRTY_KEY) || ""; } catch { return ""; } };

  // debounced write-through to the cloud (only when signed in). Push errors
  // are CHECKED (supabase resolves {error}, it doesn't throw) and surfaced.
  const [syncError, setSyncError] = useState(false);
  const pendingPush = useRef<AppData | null>(null);
  const doPush = useCallback(async (blob: AppData) => {
    const sb = getSupabase(); const acct = accountRef.current;
    if (!sb || !acct) return;
    const stamp = new Date().toISOString();
    const { error } = await sb.from(STATE_TABLE).upsert({ user_id: acct.id, data: blob, updated_at: stamp });
    if (error) { console.error("[sync] push failed", error); setSyncError(true); }
    else { pendingPush.current = null; setSyncError(false); }
  }, []);
  const pushRemote = useCallback((next: AppData) => {
    const sb = getSupabase(); const acct = accountRef.current;
    if (!sb || !acct) return;
    pendingPush.current = next;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => { void doPush(next); }, 600);
  }, [doPush]);
  // Flush any pending debounced push NOW (sign-out, reset, tab-hide).
  const flushPush = useCallback(async () => {
    if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
    if (pendingPush.current) await doPush(pendingPush.current);
  }, [doPush]);

  const persist = useCallback((next: AppData) => { writeLocal(next); stampDirty(); pushRemote(next); }, [writeLocal, pushRemote]);

  // Reconcile device vs cloud by timestamp — used on sign-in AND app open.
  // Returns whether the cloud ANSWERED (even "empty row" is an answer);
  // false = we couldn't reach it and know nothing.
  const reconcile = useCallback(async (userId: string): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb) return false;
    setSyncing(true);
    setCloudError(false);
    try {
      const { data: row, error } = await sb.from(STATE_TABLE).select("data,updated_at").eq("user_id", userId).maybeSingle();
      // A failed READ must never be treated as "new user" — that path
      // upserts the local (possibly empty) blob OVER the cloud row and
      // destroys their backup. On any error: pull nothing, push nothing.
      if (error) throw error;
      const remote = (row as { data?: AppData; updated_at?: string } | null);
      if (remote?.data?.profile) {
        const cloudAt = remote.updated_at || "";
        const localAt = dirtyAt();
        if (localAt && dataRef.current.profile && localAt > cloudAt) {
          // Device has newer work (e.g. edited offline) — push it up.
          await doPush(dataRef.current);
        } else {
          writeLocal(ensurePlan(remote.data)); // cloud is newer → pull
          try { localStorage.setItem(DIRTY_KEY, cloudAt); } catch {}
        }
      } else if (remote?.data) {
        // The row EXISTS but holds no profile — that's an explicit RESET pushed
        // from some device, not a blank slate. Same timestamp arbitration as
        // any other state: blindly seeding local over it resurrected data the
        // user deliberately erased (July 8 audit).
        const cloudAt = remote.updated_at || "";
        const localAt = dirtyAt();
        if (dataRef.current.profile) {
          if (localAt && localAt > cloudAt) await doPush(dataRef.current); // local work is newer than the reset
          else {
            writeLocal({ profile: null, deals: [] }); // adopt the reset
            try { localStorage.setItem(DIRTY_KEY, cloudAt); } catch {}
          }
        }
      } else if (dataRef.current.profile) {
        // No row at all — a genuinely fresh cloud home. Seed it.
        await doPush(dataRef.current);
      }
      return true;
    } catch (e) {
      console.error("[sync] reconcile failed — leaving cloud untouched", e);
      setCloudError(true);
      return false;
    }
    finally { setSyncing(false); }
  }, [writeLocal, doPush]);

  // auth: hydrate the session and react to sign-in/out
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setCloudChecked(true); return; } // no cloud to wait for
    let active = true;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (active && session?.user) setAccount({ id: session.user.id, email: session.user.email ?? "" });
    });
    const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      setAccount(user ? { id: user.id, email: user.email ?? "" } : null);
      // The NEXT person to sign in on this device must wait for their own
      // cloud pull — a stale `true` here would flash onboarding at them.
      if (event === "SIGNED_OUT") setCloudChecked(false);
      // INITIAL_SESSION = the PWA reopening while already signed in — the case
      // that never pulled before, letting a stale phone clobber newer work.
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && user) {
        // Only a cloud ANSWER opens the gate. A failed read sets cloudError
        // instead, and the page offers a retry — falling through to
        // onboarding here would let a "new" default profile overwrite the
        // real one the moment the network came back.
        if (await reconcile(user.id)) setCloudChecked(true);
      }
    });
    // Coming back to a long-lived tab/PWA: flush anything pending, re-check the cloud.
    const onVisible = () => {
      if (document.visibilityState === "visible" && accountRef.current) void reconcile(accountRef.current.id).then((ok) => { if (ok) setCloudChecked(true); });
      else if (document.visibilityState === "hidden") void flushPush();
    };
    document.addEventListener("visibilitychange", onVisible);
    // pagehide too: iOS Safari / PWA kills can skip the hidden transition, and
    // pagehide is the last reliable moment to start the final push.
    const onPageHide = () => { void flushPush(); };
    window.addEventListener("pagehide", onPageHide);
    return () => { active = false; sub.subscription.unsubscribe(); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("pagehide", onPageHide); };
  }, [reconcile, flushPush]);

  const api = useMemo<Ctx>(() => ({
    data, ready, account, syncing, syncError, cloudChecked, cloudError,
    getData: () => dataRef.current,
    setProfile: (name, role, industry, plan, fileName) =>
      persist({
        profile: { name, role, industry, plan, payPlanFileName: fileName, createdAt: new Date().toISOString() },
        // Seed an industry-true demo month on first setup so the dashboard is
        // alive in THEIR world (a realtor sees closings, a jeweler sees pieces).
        deals: dataRef.current.deals.length ? dataRef.current.deals : demoDeals(role, industry),
        lifeItems: dataRef.current.lifeItems ?? [],
      }),
    updatePlan: (plan) =>
      persist({ ...dataRef.current, profile: dataRef.current.profile ? { ...dataRef.current.profile, plan } : null }),
    // The user's own F&I product menu (names, unit weights, spiffs).
    updateProducts: (products) =>
      persist({ ...dataRef.current, profile: dataRef.current.profile ? { ...dataRef.current.profile, products } : null }),
    updateJacketOrder: (jacketOrder) =>
      persist({ ...dataRef.current, profile: dataRef.current.profile ? { ...dataRef.current.profile, jacketOrder } : null }),
    // Weekdays the user doesn't sell — pace extrapolates over working days.
    updateDaysOff: (daysOff) =>
      persist({ ...dataRef.current, profile: dataRef.current.profile ? { ...dataRef.current.profile, daysOff } : null }),
    // The Money area (bills, goals, balance, payday) — EILA's CFO side.
    updateMoney: (money) =>
      persist({ ...dataRef.current, profile: dataRef.current.profile ? { ...dataRef.current.profile, money } : null }),
    // Adding a real deal auto-clears the seeded sample month, so the dashboard
    // becomes the user's own numbers the moment they log their first deal.
    addDeal: (deal) =>
      persist({ ...dataRef.current, deals: [{ ...deal, id: uid() }, ...dataRef.current.deals.filter((d) => !d.demo)] }),
    // Bulk add (THE LOGG import) — one persist for the whole month so it's a
    // single sync, and demo data clears just like a single add.
    addDeals: (list) =>
      persist({ ...dataRef.current, deals: [...list.map((deal) => ({ ...deal, id: uid() })), ...dataRef.current.deals.filter((d) => !d.demo)] }),
    // THE LOGG re-import: match on Deal # and UPDATE existing deals (so adjusted
    // numbers re-sync) instead of duplicating; only genuinely new deals are added.
    importDeals: (list) => {
      const existing = dataRef.current.deals.filter((d) => !d.demo);
      const { deals, added, updated } = reconcileImport(existing, list, uid);
      persist({ ...dataRef.current, deals });
      return { added, updated };
    },
    updateDeal: (id, patch) =>
      persist({ ...dataRef.current, deals: dataRef.current.deals.map((d) => (d.id === id ? { ...d, ...patch } : d)) }),
    removeDeal: (id) => persist({ ...dataRef.current, deals: dataRef.current.deals.filter((d) => d.id !== id) }),
    // EILA's everyday-life layer: appointments, errands, reminders, and tasks
    // that belong to the rep, not the dealership CRM.
    addLifeItem: (item) =>
      persist({ ...dataRef.current, lifeItems: [{ ...item, id: uid(), createdAt: new Date().toISOString() }, ...(dataRef.current.lifeItems ?? [])] }),
    updateLifeItem: (id, patch) =>
      persist({ ...dataRef.current, lifeItems: (dataRef.current.lifeItems ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
    removeLifeItem: (id) =>
      persist({ ...dataRef.current, lifeItems: (dataRef.current.lifeItems ?? []).filter((i) => i.id !== id) }),
    // EILA's learning: append freshly-distilled memory notes (newest first),
    // dedupe on the note text, cap the list so her context stays sharp.
    // Reads dataRef.current (NOT the closed-over `data`): reflection fires
    // asynchronously AFTER an EILA turn, so by the time this lands the plan may
    // already have changed (e.g. set_pay_goal). Spreading a stale `data` here
    // would stamp the OLD profile back over that change — the "goal reverts to
    // $6k" bug. dataRef.current is always the latest written state.
    addIlaMemories: (notes) => {
      const existing = dataRef.current.ilaMemories ?? [];
      const seen = new Set(existing.map((m) => m.note.trim().toLowerCase()));
      const fresh: IlaMemory[] = notes
        .map((n) => n.trim())
        .filter((n) => n && !seen.has(n.toLowerCase()))
        .map((note) => ({ id: uid(), date: new Date().toISOString(), note }));
      if (!fresh.length) return;
      persist({ ...dataRef.current, ilaMemories: [...fresh, ...existing].slice(0, 40) });
    },
    // Let the rep correct EILA — drop a memory she got wrong.
    forgetIlaMemory: (id) => persist({ ...dataRef.current, ilaMemories: (dataRef.current.ilaMemories ?? []).filter((m) => m.id !== id) }),
    // Manually drop the sample month but keep the profile + pay plan.
    clearSampleData: () => persist({ ...dataRef.current, deals: dataRef.current.deals.filter((d) => !d.demo) }),
    resetAll: () => { persist({ profile: null, deals: [], lifeItems: [] }); void flushPush(); },
    signUp: async (email, password) => {
      const sb = getSupabase(); if (!sb) return "Sync isn't set up yet.";
      const { error } = await sb.auth.signUp({ email, password });
      return error ? error.message : null;
    },
    signIn: async (email, password) => {
      const sb = getSupabase(); if (!sb) return "Sync isn't set up yet.";
      const { error } = await sb.auth.signInWithPassword({ email, password });
      return error ? error.message : null;
    },
    // relock() clears "unlocked this session" — without it, sessionStorage
    // would still say unlocked if a different person signs in on the same
    // device/tab afterward, skipping their own Face ID prompt entirely
    // (relock() was dead code, never wired up anywhere — audit finding, July 5).
    signOut: async () => {
      const sb = getSupabase();
      await flushPush(); // last-600ms edits reach the cloud BEFORE the session dies
      await sb?.auth.signOut();
      // Clear the DEVICE so the next person to sign in/up on it doesn't
      // inherit this user's finances (their cloud copy is untouched).
      // lite-ent-ok too — the cached entitlement pass must not carry over to
      // whoever signs in next in this same tab (July 8 audit).
      try { localStorage.removeItem(KEY); localStorage.removeItem(DIRTY_KEY); sessionStorage.removeItem("lite-ent-ok"); } catch {}
      dataRef.current = { profile: null, deals: [], lifeItems: [] };
      setData({ profile: null, deals: [], lifeItems: [] });
      relock();
    },
    // Sends a recovery link to the email's inbox (if an account exists — Supabase
    // returns success either way so we can't leak which emails are registered).
    // The link lands on /reset-password, which establishes a temporary recovery
    // session and lets them set a new password.
    requestPasswordReset: async (email) => {
      const sb = getSupabase(); if (!sb) return "Sync isn't set up yet.";
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return error ? error.message : null;
    },
    // Only valid inside the temporary recovery session /reset-password sets up
    // from the emailed link — Supabase rejects this otherwise.
    updatePassword: async (newPassword) => {
      const sb = getSupabase(); if (!sb) return "Sync isn't set up yet.";
      const { error } = await sb.auth.updateUser({ password: newPassword });
      return error ? error.message : null;
    },
  }), [data, ready, account, syncing, syncError, cloudChecked, cloudError, persist]);

  return <MissionCtx.Provider value={api}>{children}</MissionCtx.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionCtx);
  if (!ctx) throw new Error("useMission must be used within MissionProvider");
  return ctx;
}
