"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Landmark, LockKeyhole, Save, Settings, Trash2, UsersRound, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useDeals } from "@/components/DealProvider";
import { usePayPlans, defaultSalesPlan, type PayPlan, type PayRole, type SalesPlan } from "@/components/PayPlanProvider";
import { defaultTeamLists, useTeamLists, type TeamLists } from "@/components/TeamProvider";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

const textareaClass = "min-h-[340px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-4 text-base leading-7 text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";
type AccessUser = {
  id: string;
  email: string;
  displayName: string;
  employeeName: string;
  role: PayRole | "Admin" | "BDC";
  isOwner: boolean;
};

export default function AdminPage() {
  const { isAdmin, isOwner, secureMode } = useAuth();
  const teamLists = useTeamLists();
  const { deals, clearDeals } = useDeals();
  const payPlanStore = usePayPlans();
  const [tab, setTab] = useState<"roster" | "people" | "pay">("roster");
  const [saved, setSaved] = useState(false);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [accessSaved, setAccessSaved] = useState("");
  const [accessError, setAccessError] = useState("");
  const [draft, setDraft] = useState({
    salespeople: teamLists.salespeople.join("\n"),
    managers: teamLists.managers.join("\n"),
    financeManagers: teamLists.financeManagers.join("\n"),
    lienholders: teamLists.lienholders.join("\n"),
  });
  // The provider loads the saved roster ASYNC after this page mounts — until
  // the admin actually types, keep the draft synced to the live lists so a
  // deep-link + immediate "Save" can never write the placeholder defaults
  // over the store's real roster.
  const rosterDirty = useRef(false);
  useEffect(() => {
    if (rosterDirty.current) return;
    setDraft({
      salespeople: teamLists.salespeople.join("\n"),
      managers: teamLists.managers.join("\n"),
      financeManagers: teamLists.financeManagers.join("\n"),
      lienholders: teamLists.lienholders.join("\n"),
    });
  }, [teamLists.salespeople, teamLists.managers, teamLists.financeManagers, teamLists.lienholders]);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = getSupabaseBrowserClient();
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadUsers = useCallback(async () => {
    setAccessError("");
    const response = await fetch("/api/users", { cache: "no-store", headers: await authHeaders() });
    if (!response.ok) {
      setAccessError("Could not load user access.");
      return;
    }
    setUsers(await response.json());
  }, [authHeaders]);

  useEffect(() => {
    if (isAdmin) void loadUsers();
  }, [isAdmin, loadUsers]);

  async function saveUserAccess(user: AccessUser) {
    setAccessSaved("");
    setAccessError("");
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(user),
    });
    if (!response.ok) {
      setAccessError("Could not save user access.");
      return;
    }
    setAccessSaved(user.email);
    await loadUsers();
  }

  async function createUser(input: { email: string; employeeName: string; role: string; password: string }) {
    setAccessSaved("");
    setAccessError("");
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "create", ...input }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAccessError(data.error || "Could not create login.");
      return false;
    }
    setAccessSaved(input.email);
    await loadUsers();
    return true;
  }

  async function deleteUser(user: AccessUser) {
    setAccessSaved("");
    setAccessError("");
    const response = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ id: user.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAccessError(data.error || "Could not remove this login.");
      return;
    }
    await loadUsers();
  }

  function parseNames(value: string) {
    return value
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function save() {
    const next: TeamLists = {
      salespeople: parseNames(draft.salespeople),
      managers: parseNames(draft.managers),
      financeManagers: parseNames(draft.financeManagers),
      lienholders: parseNames(draft.lienholders),
    };

    teamLists.updateTeamLists(next);
    setSaved(true);
  }

  function reset() {
    rosterDirty.current = false;
    teamLists.resetTeamLists();
    setDraft({
      salespeople: defaultTeamLists.salespeople.join("\n"),
      managers: defaultTeamLists.managers.join("\n"),
      financeManagers: defaultTeamLists.financeManagers.join("\n"),
      lienholders: defaultTeamLists.lienholders.join("\n"),
    });
    setSaved(false);
  }

  function confirmClearDeals() {
    const confirmation = window.prompt("Type CLEAR DEALS to delete every saved deal.");
    if (confirmation === "CLEAR DEALS") clearDeals();
  }

  return (
    <div>
      <SectionHeader title="Admin" kicker="Easy roster control" />
      {secureMode && !isAdmin && !isOwner ? (
        <div className="glass-card rounded-[12px] p-10 text-center">
          <LockKeyhole className="mx-auto h-10 w-10 text-mission-gold" />
          <div className="mt-4 font-display text-3xl font-black text-white">Admin access required.</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">Roster, lender, and pay-plan setup is restricted to Admin access.</p>
        </div>
      ) : (
      <>
      {/* One screen, one job — tabs keep Admin from being a wall of inputs. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {([["roster", "Roster"], ["people", "People & Logins"], ["pay", "Pay Plans"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-full px-4 py-2.5 text-sm font-black uppercase tracking-[0.1em] transition ${tab === key ? "bg-mission-gold text-mission-navy shadow-gold" : "border border-white/12 text-white/60 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "roster" && (
      <>
      <div className="glass-card mb-5 rounded-[12px] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
              <Settings className="h-6 w-6" />
            </div>
            <div>
              <div className="font-display text-2xl font-black text-white">Update the people and lenders in the system</div>
              <div className="text-sm leading-6 text-white/56">Put one item per line. Save it, then Deal Entry dropdowns use the updated lists.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {saved && <StatusPill tone="green">Saved</StatusPill>}
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/40 hover:text-white"
            >
              Reset
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={confirmClearDeals}
                className="rounded-full border border-mission-red/30 bg-mission-red/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-red transition hover:border-mission-red/60"
              >
                Clear Deal Data
              </button>
            )}
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110"
            >
              <Save className="h-4 w-4" />
              Save Admin Updates
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-4">
        <RosterEditor
          title="Salespeople + BDC"
          count={parseNames(draft.salespeople).length}
          value={draft.salespeople}
          icon="people"
          onChange={(value) => {
            rosterDirty.current = true;
            setSaved(false);
            setDraft((current) => ({ ...current, salespeople: value }));
          }}
        />
        <RosterEditor
          title="Sales Managers"
          count={parseNames(draft.managers).length}
          value={draft.managers}
          icon="people"
          onChange={(value) => {
            rosterDirty.current = true;
            setSaved(false);
            setDraft((current) => ({ ...current, managers: value }));
          }}
        />
        <RosterEditor
          title="F&I Managers"
          count={parseNames(draft.financeManagers).length}
          value={draft.financeManagers}
          icon="people"
          onChange={(value) => {
            rosterDirty.current = true;
            setSaved(false);
            setDraft((current) => ({ ...current, financeManagers: value }));
          }}
        />
        <RosterEditor
          title="Lienholders / Banks"
          count={parseNames(draft.lienholders).length}
          value={draft.lienholders}
          icon="bank"
          onChange={(value) => {
            rosterDirty.current = true;
            setSaved(false);
            setDraft((current) => ({ ...current, lienholders: value }));
          }}
        />
      </div>
      </>
      )}

      {tab === "people" && (
      <>
      <OwnerAccessPanel
        canManage={isAdmin}
        users={users}
        accessSaved={accessSaved}
        accessError={accessError}
        onChange={(nextUser) => setUsers((current) => current.map((user) => (user.id === nextUser.id ? nextUser : user)))}
        onSave={saveUserAccess}
        onCreate={createUser}
        onDelete={deleteUser}
      />
      <div className="glass-card mb-5 rounded-[12px] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display text-xl font-black text-white">Deal data status</div>
            <div className="mt-1 text-sm text-white/56">
              {deals.length === 0 ? "No deals are currently saved. You are ready for real entries." : `${deals.length} deals are currently saved in this browser.`}
            </div>
          </div>
          <StatusPill tone={deals.length === 0 ? "green" : "gold"}>{deals.length === 0 ? "Clean" : "Data Loaded"}</StatusPill>
        </div>
      </div>
      </>
      )}

      {tab === "pay" && (
      <PayPlanEditor
        salespeople={parseNames(draft.salespeople)}
        managers={parseNames(draft.managers)}
        financeManagers={parseNames(draft.financeManagers)}
        payPlans={payPlanStore.payPlans}
        savePayPlan={payPlanStore.savePayPlan}
        savePayPlans={payPlanStore.savePayPlans}
        resetPayPlans={payPlanStore.resetPayPlans}
      />
      )}
      </>
      )}
    </div>
  );
}

function PayPlanEditor({
  salespeople,
  managers,
  financeManagers,
  payPlans,
  savePayPlan,
  savePayPlans,
  resetPayPlans,
}: {
  salespeople: string[];
  managers: string[];
  financeManagers: string[];
  payPlans: PayPlan[];
  savePayPlan: (plan: PayPlan) => void;
  savePayPlans: (plans: PayPlan[]) => void;
  resetPayPlans: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [bulkSaved, setBulkSaved] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [role, setRole] = useState<PayRole>("Sales");
  const people = useMemo(() => {
    if (role === "Sales") return salespeople;
    if (role === "Manager") return managers;
    return financeManagers;
  }, [financeManagers, managers, role, salespeople]);
  const [personName, setPersonName] = useState(people[0] || "");
  const [plan, setPlan] = useState<PayPlan>(() => planFor(payPlans, people[0] || "", role));

  useEffect(() => {
    const nextPerson = people.includes(personName) ? personName : people[0] || "";
    setPersonName(nextPerson);
    setPlan(planFor(payPlans, nextPerson, role));
    setSaved(false);
  }, [payPlans, people, personName, role]);

  function updateNumber(key: keyof PayPlan, value: string) {
    setSaved(false);
    setPlan((current) => ({ ...current, [key]: Number(value) || 0 }));
  }

  // Salespeople use the structured commission plan (plan.sales), not the flat fields.
  function updateSales(key: keyof SalesPlan, value: string) {
    setSaved(false);
    setPlan((current) => ({ ...current, sales: { ...(current.sales ?? defaultSalesPlan), [key]: Number(value) || 0 } }));
  }
  function updateVolumeTier(index: number, field: "units" | "bonus", value: string) {
    setSaved(false);
    setPlan((current) => {
      const sp = current.sales ?? defaultSalesPlan;
      const volumeTiers = sp.volumeTiers.map((tier, i) => (i === index ? { ...tier, [field]: Number(value) || 0 } : tier));
      return { ...current, sales: { ...sp, volumeTiers } };
    });
  }

  function save() {
    savePayPlan({ ...plan, personName, role });
    setSaved(true);
  }

  function applyToDepartment() {
    savePayPlans(people.map((person) => ({ ...plan, personName: person, role })));
    setSaved(true);
  }

  function importBulk() {
    const plans = bulkText
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.split(",").map((cell) => cell.trim()))
      .filter((cells) => cells.length >= 10)
      .map(([personName, roleValue, monthlyBase, flatPerUnit, frontGrossPct, backGrossPct, totalGrossPct, productUnitBonus, unitBonusThreshold, unitBonusAmount]) => ({
        personName,
        role: normalizeRole(roleValue),
        monthlyBase: Number(monthlyBase) || 0,
        flatPerUnit: Number(flatPerUnit) || 0,
        frontGrossPct: Number(frontGrossPct) || 0,
        backGrossPct: Number(backGrossPct) || 0,
        totalGrossPct: Number(totalGrossPct) || 0,
        productUnitBonus: Number(productUnitBonus) || 0,
        unitBonusThreshold: Number(unitBonusThreshold) || 0,
        unitBonusAmount: Number(unitBonusAmount) || 0,
      }));

    savePayPlans(plans);
    setBulkSaved(true);
  }

  const salesPlan = plan.sales ?? defaultSalesPlan;

  return (
    <section className="glass-card mb-5 rounded-[12px] p-5">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div>
            <div className="font-display text-2xl font-black text-white">Private Pay Plan Setup</div>
            <div className="text-sm leading-6 text-white/56">Sales, Sales Manager, and F&I can each have different department plans. Individual overrides are saved by person.</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {saved && <StatusPill tone="green">Pay Plan Saved</StatusPill>}
          <button type="button" onClick={resetPayPlans} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/40 hover:text-white">
            Reset Pay Plans
          </button>
          <button type="button" onClick={applyToDepartment} className="rounded-full border border-mission-green/40 bg-mission-green/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-green transition hover:border-mission-green/70">
            Apply to Department
          </button>
          <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
            <Save className="h-4 w-4" />
            Save Pay Plan
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PayField label="Role">
          <select className={payInputClass} value={role} onChange={(event) => setRole(event.target.value as PayRole)}>
            <option>Sales</option>
            <option>Manager</option>
            <option>F&I</option>
          </select>
        </PayField>
        <PayField label="Employee">
          <select className={payInputClass} value={personName} onChange={(event) => setPersonName(event.target.value)}>
            {people.map((person) => (
              <option key={person}>{person}</option>
            ))}
          </select>
        </PayField>
      </div>

      {role === "Sales" ? (
        <div className="mt-5 space-y-5">
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">New-Vehicle Commission (by front gross)</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <PayField label={`Flat at / above $${salesPlan.newHighMin}`}><input className={payInputClass} type="number" value={salesPlan.newHighFlat} onChange={(e) => updateSales("newHighFlat", e.target.value)} /></PayField>
              <PayField label="High band starts at ($ gross)"><input className={payInputClass} type="number" value={salesPlan.newHighMin} onChange={(e) => updateSales("newHighMin", e.target.value)} /></PayField>
              <PayField label={`Flat down to $${salesPlan.newMidMin}`}><input className={payInputClass} type="number" value={salesPlan.newMidFlat} onChange={(e) => updateSales("newMidFlat", e.target.value)} /></PayField>
              <PayField label="Mid band floor ($ gross)"><input className={payInputClass} type="number" value={salesPlan.newMidMin} onChange={(e) => updateSales("newMidMin", e.target.value)} /></PayField>
              <PayField label="Mini (below mid band)"><input className={payInputClass} type="number" value={salesPlan.newMiniFlat} onChange={(e) => updateSales("newMiniFlat", e.target.value)} /></PayField>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Used-Vehicle Commission</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <PayField label="Standard %"><input className={payInputClass} type="number" value={salesPlan.usedPct} onChange={(e) => updateSales("usedPct", e.target.value)} /></PayField>
              <PayField label="High % (above threshold)"><input className={payInputClass} type="number" value={salesPlan.usedHighPct} onChange={(e) => updateSales("usedHighPct", e.target.value)} /></PayField>
              <PayField label="High % threshold ($ gross)"><input className={payInputClass} type="number" value={salesPlan.usedHighMin} onChange={(e) => updateSales("usedHighMin", e.target.value)} /></PayField>
              <PayField label="Minimum commission ($)"><input className={payInputClass} type="number" value={salesPlan.usedMinCommission} onChange={(e) => updateSales("usedMinCommission", e.target.value)} /></PayField>
              <PayField label="Other class flat ($)"><input className={payInputClass} type="number" value={salesPlan.miniCommission} onChange={(e) => updateSales("miniCommission", e.target.value)} /></PayField>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Monthly Volume Bonus (units → bonus $)</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {salesPlan.volumeTiers.map((tier, i) => (
                <div key={i} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-1 text-sm text-white">
                    <input className={payInputClass} type="number" value={tier.units} onChange={(e) => updateVolumeTier(i, "units", e.target.value)} />
                    <span className="px-1 text-white/45">→ $</span>
                    <input className={payInputClass} type="number" value={tier.bonus} onChange={(e) => updateVolumeTier(i, "bonus", e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Bonuses</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <PayField label="Finance bonus: min units"><input className={payInputClass} type="number" value={salesPlan.financeBonusUnits} onChange={(e) => updateSales("financeBonusUnits", e.target.value)} /></PayField>
              <PayField label="Finance bonus: min back PVR ($)"><input className={payInputClass} type="number" value={salesPlan.financeBonusBackPvr} onChange={(e) => updateSales("financeBonusBackPvr", e.target.value)} /></PayField>
              <PayField label="Finance bonus amount ($)"><input className={payInputClass} type="number" value={salesPlan.financeBonusAmount} onChange={(e) => updateSales("financeBonusAmount", e.target.value)} /></PayField>
              <PayField label="Fast start: units"><input className={payInputClass} type="number" value={salesPlan.fastStartUnits} onChange={(e) => updateSales("fastStartUnits", e.target.value)} /></PayField>
              <PayField label="Fast start: by day of month"><input className={payInputClass} type="number" value={salesPlan.fastStartByDay} onChange={(e) => updateSales("fastStartByDay", e.target.value)} /></PayField>
              <PayField label="Fast start amount ($)"><input className={payInputClass} type="number" value={salesPlan.fastStartAmount} onChange={(e) => updateSales("fastStartAmount", e.target.value)} /></PayField>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PayField label="Monthly Base / Draw"><input className={payInputClass} type="number" value={plan.monthlyBase} onChange={(event) => updateNumber("monthlyBase", event.target.value)} /></PayField>
          <PayField label="Flat Per Unit"><input className={payInputClass} type="number" value={plan.flatPerUnit} onChange={(event) => updateNumber("flatPerUnit", event.target.value)} /></PayField>
          <PayField label="Front Gross %"><input className={payInputClass} type="number" value={plan.frontGrossPct} onChange={(event) => updateNumber("frontGrossPct", event.target.value)} /></PayField>
          <PayField label="Back Gross %"><input className={payInputClass} type="number" value={plan.backGrossPct} onChange={(event) => updateNumber("backGrossPct", event.target.value)} /></PayField>
          <PayField label="Total Gross %"><input className={payInputClass} type="number" value={plan.totalGrossPct} onChange={(event) => updateNumber("totalGrossPct", event.target.value)} /></PayField>
          <PayField label="Product Unit Bonus"><input className={payInputClass} type="number" value={plan.productUnitBonus} onChange={(event) => updateNumber("productUnitBonus", event.target.value)} /></PayField>
          <PayField label="Unit Bonus Threshold"><input className={payInputClass} type="number" value={plan.unitBonusThreshold} onChange={(event) => updateNumber("unitBonusThreshold", event.target.value)} /></PayField>
          <PayField label="Unit Bonus Amount"><input className={payInputClass} type="number" value={plan.unitBonusAmount} onChange={(event) => updateNumber("unitBonusAmount", event.target.value)} /></PayField>
        </div>
      )}

      <div className="mt-5 rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-display text-xl font-black text-white">Bulk Pay Plan Paste</div>
            <div className="mt-1 text-sm text-white/56">Paste rows from a spreadsheet in this order: Name, Role, Monthly Base, Flat Per Unit, Front %, Back %, Total %, Product Bonus, Unit Threshold, Unit Bonus.</div>
          </div>
          <div className="flex gap-2">
            {bulkSaved && <StatusPill tone="green">Imported</StatusPill>}
            <button type="button" onClick={importBulk} className="rounded-full border border-mission-gold/40 px-4 py-2 text-sm font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
              Import Pasted Plans
            </button>
          </div>
        </div>
        <textarea value={bulkText} onChange={(event) => { setBulkSaved(false); setBulkText(event.target.value); }} className="min-h-[150px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 font-mono text-sm leading-6 text-white outline-none focus:border-mission-gold/60" spellCheck={false} />
      </div>
    </section>
  );
}

function OwnerAccessPanel({
  canManage,
  users,
  accessSaved,
  accessError,
  onChange,
  onSave,
  onCreate,
  onDelete,
}: {
  canManage: boolean;
  users: AccessUser[];
  accessSaved: string;
  accessError: string;
  onChange: (user: AccessUser) => void;
  onSave: (user: AccessUser) => void;
  onCreate: (input: { email: string; employeeName: string; role: string; password: string }) => Promise<boolean>;
  onDelete: (user: AccessUser) => void | Promise<void>;
}) {
  const [nu, setNu] = useState({ email: "", employeeName: "", role: "Sales", password: "" });
  const [creating, setCreating] = useState(false);

  async function submitCreate() {
    setCreating(true);
    const ok = await onCreate(nu);
    setCreating(false);
    if (ok) setNu({ email: "", employeeName: "", role: "Sales", password: "" });
  }

  if (!canManage) {
    return (
      <section className="glass-card mb-5 rounded-[12px] p-5">
        <div className="flex items-center gap-3">
          <LockKeyhole className="h-6 w-6 text-mission-gold" />
          <div>
            <div className="font-display text-2xl font-black text-white">Staff Access &amp; Logins</div>
            <div className="text-sm leading-6 text-white/56">Admin access is required to add staff and set roles.</div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-card mb-5 rounded-[12px] p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <UsersRound className="h-6 w-6 text-mission-gold" />
          <div>
            <div className="font-display text-2xl font-black text-white">Staff Access &amp; Logins</div>
            <div className="text-sm leading-6 text-white/56">Add a login for a new employee and set what each person can see. Everyone here is in your store only.</div>
          </div>
        </div>
        {accessError && <StatusPill tone="red">{accessError}</StatusPill>}
      </div>

      {/* Create a new staff login */}
      <div className="mb-5 rounded-[12px] border border-mission-gold/20 bg-mission-gold/[0.05] p-4">
        <div className="mb-3 font-display text-lg font-black text-white">Add an Employee Login</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input className={payInputClass} placeholder="work email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <input className={payInputClass} placeholder="full name" value={nu.employeeName} onChange={(e) => setNu({ ...nu, employeeName: e.target.value })} />
          <select className={payInputClass} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            <option>Sales</option>
            <option>BDC</option>
            <option>F&I</option>
            <option>Manager</option>
            <option>Admin</option>
          </select>
          <input className={payInputClass} placeholder="temp password (8+)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <button
            type="button"
            onClick={submitCreate}
            disabled={creating || !nu.email || nu.password.length < 8}
            className="rounded-full bg-mission-gold px-4 py-2 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create Login"}
          </button>
        </div>
        <div className="mt-2 text-xs leading-5 text-white/45">They sign in with this email + temp password — share it with them and have them change it after first login.</div>
      </div>

      {users.length === 0 ? (
        <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-white/58">
          No staff yet. Add your first employee login above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-mission-gold/20 bg-mission-gold/10">
                {["Email", "Employee Name", "Role", "Control"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-white/8">
                  <td className="px-4 py-4 font-bold text-white">{user.email}</td>
                  <td className="px-4 py-4">
                    <input
                      className={payInputClass}
                      value={user.employeeName}
                      onChange={(event) => onChange({ ...user, employeeName: event.target.value })}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <select
                      className={payInputClass}
                      value={user.role}
                      disabled={user.isOwner}
                      onChange={(event) => onChange({ ...user, role: event.target.value as AccessUser["role"] })}
                    >
                      <option>Sales</option>
                      <option>BDC</option>
                      <option>F&I</option>
                      <option>Manager</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      {user.isOwner && <StatusPill tone="gold">Owner</StatusPill>}
                      {accessSaved === user.email && <StatusPill tone="green">Saved</StatusPill>}
                      <button
                        type="button"
                        onClick={() => onSave(user)}
                        className="rounded-full bg-mission-gold px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110"
                      >
                        Save Access
                      </button>
                      {!user.isOwner && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Remove ${user.employeeName || user.email}? This deletes their login and they lose all access right away. Their past deals stay on record.`)) {
                              void onDelete(user);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-mission-red/30 bg-mission-red/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-red transition hover:border-mission-red/60"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const payInputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition focus:border-mission-gold/60";

function PayField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</span>
      {children}
    </label>
  );
}

function planFor(payPlans: PayPlan[], personName: string, role: PayRole): PayPlan {
  return (
    payPlans.find((item) => item.personName === personName && item.role === role) || {
      personName,
      role,
      monthlyBase: 0,
      flatPerUnit: role === "Sales" ? 200 : 0,
      frontGrossPct: role === "Sales" ? 25 : role === "Manager" ? 2 : 0,
      backGrossPct: role === "F&I" ? 12 : 0,
      totalGrossPct: 0,
      productUnitBonus: role === "F&I" ? 40 : 0,
      unitBonusThreshold: role === "Manager" ? 130 : role === "F&I" ? 45 : 12,
      unitBonusAmount: role === "Manager" ? 2000 : role === "F&I" ? 1000 : 750,
      sales: role === "Sales" ? defaultSalesPlan : undefined,
    }
  );
}

function normalizeRole(value: string): PayRole {
  const cleaned = value.toLowerCase();
  if (cleaned.includes("f")) return "F&I";
  if (cleaned.includes("manager")) return "Manager";
  return "Sales";
}

function RosterEditor({
  title,
  count,
  value,
  onChange,
  icon,
}: {
  title: string;
  count: number;
  value: string;
  onChange: (value: string) => void;
  icon: "people" | "bank";
}) {
  const Icon = icon === "bank" ? Landmark : UsersRound;
  const names = value.split("\n").map((name) => name.trim()).filter(Boolean);
  const noun = icon === "bank" ? "lender" : "name";

  function removeName(target: string) {
    if (!window.confirm(`Remove ${target}? It comes off the dropdowns once you Save.`)) return;
    onChange(names.filter((name) => name !== target).join("\n"));
  }

  return (
    <section className="glass-card rounded-[12px] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-mission-gold" />
          <div className="font-display text-xl font-black text-white">{title}</div>
        </div>
        <StatusPill tone="gold">{count} names</StatusPill>
      </div>
      {names.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {names.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-3 pr-1.5 text-sm font-semibold text-white/80"
            >
              {name}
              <button
                type="button"
                onClick={() => removeName(name)}
                aria-label={`Remove ${name}`}
                className="grid h-7 w-7 place-items-center rounded-full text-white/40 transition hover:bg-mission-red/20 hover:text-mission-red"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className={textareaClass} spellCheck={false} placeholder={`One ${noun} per line`} />
    </section>
  );
}
