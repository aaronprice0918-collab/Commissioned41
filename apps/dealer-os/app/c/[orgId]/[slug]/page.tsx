import { notFound } from "next/navigation";
import { DigitalCard } from "@/components/DigitalCard";
import { employeeSlug, findEmployeeBySlug, cardRoleLabel } from "@/lib/employeeDirectory";
import { displayPersonName, mergeStoreSettings } from "@/lib/data";
import { defaultProfilePhotoForName } from "@/lib/profilePhotos";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";

const dealershipLogo = "/brand/kennesaw-mazda-premium.jpg";

// The org-aware public business card: /c/<orgId>/<slug>. Works for EVERY
// tenant — the roster comes from the org's own saved `team` store and the
// store name from its settings; the email comes from the person's real login
// profile (never fabricated). The founding store's hand-curated directory
// (titles, phones, photos) enriches its own people. The legacy /card/<slug>
// route stays for Kennesaw's already-printed QR codes.
export const revalidate = 300; // cards change rarely; cache lightly

type RosterPerson = { name: string; role: "Sales" | "Manager" | "F&I" };

async function loadOrgCard(orgId: string, slug: string) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const [{ data: teamRow }, { data: settingsRow }] = await Promise.all([
    supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "team").maybeSingle(),
    supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "storeSettings").maybeSingle(),
  ]);
  const team = teamRow?.value ?? {};
  const roster: RosterPerson[] = [
    ...((Array.isArray(team.salespeople) ? team.salespeople : []) as string[]).map((name) => ({ name, role: "Sales" as const })),
    ...((Array.isArray(team.managers) ? team.managers : []) as string[]).map((name) => ({ name, role: "Manager" as const })),
    ...((Array.isArray(team.financeManagers) ? team.financeManagers : []) as string[]).map((name) => ({ name, role: "F&I" as const })),
  ];
  const person = roster.find((p) => employeeSlug(p.name) === slug);
  if (!person) return null;

  // Real contact info only: the person's login email from user_profiles.
  const { data: profiles } = await supabase
    .from("user_profiles").select("email, employee_name, display_name").eq("org_id", orgId);
  const profile = (profiles ?? []).find(
    (p: any) => employeeSlug(String(p.employee_name || p.display_name || "")) === slug,
  );

  const settings = mergeStoreSettings(settingsRow?.value ?? null);
  return {
    name: person.name,
    role: person.role,
    email: (profile?.email as string) || undefined,
    storeName: settings.storeName,
  };
}

export default async function OrgEmployeeCardPage({ params }: { params: Promise<{ orgId: string; slug: string }> }) {
  const { orgId: rawOrgId, slug } = await params;
  const orgId = decodeURIComponent(rawOrgId);
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();

  // Founding store: the curated directory carries richer data (title, phone,
  // photo) — use it when the person is in it.
  if (orgId === DEFAULT_ORG_ID) {
    const member = findEmployeeBySlug(slug);
    if (member) {
      const profilePhoto = defaultProfilePhotoForName(member.name) || dealershipLogo;
      return (
        <main className="grid min-h-screen place-items-center bg-gradient-to-b from-[#eef3fb] via-[#e7eefb] to-[#dde8fa] px-5 py-10">
          <DigitalCard
            data={{
              name: member.name,
              displayName: displayPersonName(member.name),
              title: cardRoleLabel(member),
              org: "Kennesaw Mazda",
              phone: member.phone || undefined,
              email: member.email || undefined,
              employeeNumber: member.employeeNumber,
              publicUrl: undefined,
              photoSrc: profilePhoto,
              photoContain: profilePhoto === dealershipLogo,
            }}
          />
        </main>
      );
    }
  }

  const card = await loadOrgCard(orgId, slug);
  if (!card) notFound();

  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-[#eef3fb] via-[#e7eefb] to-[#dde8fa] px-5 py-10">
      <DigitalCard
        data={{
          name: card.name,
          displayName: displayPersonName(card.name),
          title: card.role === "F&I" ? "F&I Manager" : card.role === "Manager" ? "Sales Manager" : "Sales Consultant",
          org: card.storeName,
          email: card.email,
          publicUrl: undefined,
          photoSrc: defaultProfilePhotoForName(card.name) || "",
        }}
      />
    </main>
  );
}
