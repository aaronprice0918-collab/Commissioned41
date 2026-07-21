import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { guardedMutate } from "@/lib/storeServer";

type Supa = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

// Customer right-to-delete / erasure (SOC 2 P5.2/P6, CCPA/GDPR). Purges one
// customer's PII across the org's stores + storage. DELIBERATELY id-based only —
// a lead id and/or a deal id — never fuzzy name matching, because deleting the
// WRONG customer's records is worse than the gap this closes. leads and deals
// are not structurally linked, so the caller supplies whichever ids apply.
//
// What it removes:
//   leadId  -> the crmLeads entry + the deal-docs folder ${orgId}/${leadId}/
//              (driver's-license + insurance images) + customerMemory notes keyed
//              to that lead's customer name.
//   dealId  -> the deals entry + the jacket PDF ${orgId}/${dealId}.pdf.
// Team-internal data (conversations/messages between staff) is NOT touched — it
// is not the customer's personal data and deleting it would corrupt team threads.

export type EraseTarget = { leadId?: string; dealId?: string };
export type EraseResult = {
  leadRemoved: boolean;
  dealRemoved: boolean;
  dealDocsRemoved: number;
  jacketRemoved: boolean;
  memoryNotesRemoved: number;
  customerName: string | null;
};

/** Preview what an erase WOULD remove, without deleting anything. */
export async function previewErase(supabase: Supa, orgId: string, t: EraseTarget): Promise<EraseResult> {
  return run(supabase, orgId, t, false);
}

/** Perform the erase. */
export async function eraseCustomer(supabase: Supa, orgId: string, t: EraseTarget): Promise<EraseResult> {
  return run(supabase, orgId, t, true);
}

async function readValue(supabase: Supa, orgId: string, key: string): Promise<any> {
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", key).maybeSingle();
  return data?.value ?? null;
}

async function run(supabase: Supa, orgId: string, t: EraseTarget, commit: boolean): Promise<EraseResult> {
  const leadId = String(t.leadId || "").trim();
  const dealId = String(t.dealId || "").trim();
  const result: EraseResult = {
    leadRemoved: false,
    dealRemoved: false,
    dealDocsRemoved: 0,
    jacketRemoved: false,
    memoryNotesRemoved: 0,
    customerName: null,
  };

  // ── Lead + its documents + memory ──────────────────────────────────────────
  if (leadId) {
    const leads: any[] = Array.isArray(await readValue(supabase, orgId, "crmLeads")) ? await readValue(supabase, orgId, "crmLeads") : [];
    const lead = leads.find((l) => l && String(l.id) === leadId);
    if (lead) {
      result.leadRemoved = true;
      result.customerName = String(lead.customer || lead.customerFirstName || "").trim() || null;
      if (commit) {
        await guardedMutate<any[]>(supabase, orgId, "crmLeads", (cur) =>
          (Array.isArray(cur) ? cur : []).filter((l) => String(l?.id) !== leadId),
        );
      }
    }

    // deal-docs: everything under ${orgId}/${leadId}/
    const prefix = `${orgId}/${leadId}`;
    const { data: files } = await supabase.storage.from("deal-docs").list(prefix, { limit: 1000 });
    const paths = (files ?? []).filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    result.dealDocsRemoved = paths.length;
    if (commit && paths.length) {
      const { error } = await supabase.storage.from("deal-docs").remove(paths);
      if (error) throw new Error(`deal-docs remove: ${error.message}`);
    }

    // customerMemory notes keyed to this customer's name (if any).
    if (result.customerName) {
      const mem = await readValue(supabase, orgId, "customerMemory");
      if (mem && typeof mem === "object" && !Array.isArray(mem)) {
        const key = Object.keys(mem).find((k) => k.trim().toLowerCase() === result.customerName!.toLowerCase());
        if (key) {
          result.memoryNotesRemoved = Array.isArray(mem[key]) ? mem[key].length : 1;
          if (commit) {
            await guardedMutate<Record<string, any>>(supabase, orgId, "customerMemory", (cur) => {
              const m = cur && typeof cur === "object" ? { ...cur } : {};
              delete m[key];
              return m;
            });
          }
        }
      }
    }
  }

  // ── Deal + its jacket ───────────────────────────────────────────────────────
  if (dealId) {
    const deals: any[] = Array.isArray(await readValue(supabase, orgId, "deals")) ? await readValue(supabase, orgId, "deals") : [];
    const deal = deals.find((d) => d && String(d.id) === dealId);
    if (deal) {
      result.dealRemoved = true;
      if (!result.customerName) result.customerName = String(deal.customer || "").trim() || null;
      if (commit) {
        await guardedMutate<any[]>(supabase, orgId, "deals", (cur) =>
          (Array.isArray(cur) ? cur : []).filter((d) => String(d?.id) !== dealId),
        );
      }
    }

    const jacketPath = `${orgId}/${dealId}.pdf`;
    const { data: jf } = await supabase.storage.from("jackets").list(orgId, { limit: 1000 });
    const hasJacket = (jf ?? []).some((f) => f.name === `${dealId}.pdf`);
    result.jacketRemoved = hasJacket;
    if (commit && hasJacket) {
      const { error } = await supabase.storage.from("jackets").remove([jacketPath]);
      if (error) throw new Error(`jacket remove: ${error.message}`);
    }
  }

  return result;
}
