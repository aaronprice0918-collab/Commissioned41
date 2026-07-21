"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { Copy, ExternalLink, QrCode } from "lucide-react";
import { ProfilePhotoUploader, profilePhotoKey } from "@/components/ProfilePhotoUpload";
import { useProfilePhotos } from "@/components/ProfilePhotoProvider";
import { isDefaultProfilePhoto } from "@/lib/profilePhotos";
import { DigitalCard } from "@/components/DigitalCard";
import { SectionHeader } from "@/components/SectionHeader";
import { cardRoleLabel, contactEmailFor, employeeCardUrl, employeeSlug } from "@/lib/employeeDirectory";
import { displayPersonName, team } from "@/lib/data";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { authHeaders } from "@/lib/storeClient";

// Cards are ROSTER-driven now: everyone in the org's team lists gets one, and
// the public URL is org-aware (/c/<orgId>/<slug>) so it works for every
// tenant. The founding store's curated directory still enriches its own
// people (titles, phones, photos); the legacy /card/<slug> QR links keep
// working for them.
export default function BusinessCardPage() {
  const storeName = useStoreSettings().settings.storeName || "the store";
  const { salespeople, managers, financeManagers } = useTeamLists();
  const [orgId, setOrgId] = useState("");
  useEffect(() => {
    // The org id for the public URL — the billing status endpoint already
    // returns the caller's org.
    (async () => {
      try {
        const res = await fetch("/api/billing", { cache: "no-store", headers: await authHeaders() });
        const data = await res.json().catch(() => null);
        if (data?.orgId) setOrgId(String(data.orgId));
      } catch {}
    })();
  }, []);
  const rosterPeople = [
    ...salespeople.map((name) => ({ key: `Sales:${name}`, name, role: "Sales Consultant" })),
    ...managers.map((name) => ({ key: `Manager:${name}`, name, role: "Sales Manager" })),
    ...financeManagers.map((name) => ({ key: `F&I:${name}`, name, role: "F&I Manager" })),
  ];
  const directoryPeople = team.map((member) => ({
    key: `${member.role}:${member.name}`,
    name: member.name,
    role: cardRoleLabel(member),
  }));
  // Roster names win (they're the org's truth); directory fills in anyone
  // not on the roster (founding-store extras like Service/Parts).
  const seen = new Set(rosterPeople.map((p) => p.name));
  const people = [...rosterPeople, ...directoryPeople.filter((p) => !seen.has(p.name))];
  const [selectedKey, setSelectedKey] = useState(people[0]?.key || "");
  const [origin, setOrigin] = useState("https://missionos.commissioned41.com");
  const [copied, setCopied] = useState(false);
  const member = people.find((person) => person.key === selectedKey) || people[0] || { key: "Team:Kennesaw Mazda", name: "Kennesaw Mazda", role: "Team" };
  const directoryMember = team.find((person) => person.name === member.name);
  const roleLabel = directoryMember ? cardRoleLabel(directoryMember) : member.role;
  const photoKey = profilePhotoKey(roleLabel, member.name);
  const { photoFor } = useProfilePhotos();
  const dealershipLogo = "/brand/kennesaw-mazda-premium.jpg";
  const photoSrc = photoFor(photoKey) || dealershipLogo;
  // Logos/built-in artwork fit whole inside the circle; real uploads fill it.
  const photoContain = photoSrc === dealershipLogo || isDefaultProfilePhoto(photoSrc);
  const email = directoryMember?.email || contactEmailFor(member.name);
  const phone = directoryMember?.phone || undefined;
  const employeeNumber = directoryMember?.employeeNumber;
  const inDirectory = team.some((person) => person.name === member.name);
  const publicPath = inDirectory ? employeeCardUrl(member.name) : orgId ? `/c/${orgId}/${employeeSlug(member.name)}` : "";
  const publicUrl = `${origin}${publicPath}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(publicUrl)}`;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="mx-auto max-w-md">
      <SectionHeader title="Business Card" kicker="Your digital identity" />

      <label className="mb-5 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-white/42">Whose card</span>
        <select className="min-h-12 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 py-2 text-sm leading-5 text-white outline-none focus:border-mission-green/60" value={member.key} onChange={(event) => setSelectedKey(event.target.value)}>
          {people.map((person) => (
            <option key={person.key} value={person.key}>{displayPersonName(person.name)} - {person.role}</option>
          ))}
        </select>
      </label>

      {/* Live preview — the exact card a customer sees when they open the link */}
      <DigitalCard
        data={{
          name: member.name,
          displayName: displayPersonName(member.name),
          title: roleLabel,
          org: storeName,
          phone,
          email,
          employeeNumber,
          publicUrl,
          photoSrc,
          photoContain,
        }}
      />

      {/* Share tools */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-white/12 px-3 py-2 text-[12px] font-black uppercase tracking-[0.1em] text-white/80 transition hover:border-mission-green/50 hover:text-white">
          <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy link"}
        </button>
        <a href={publicPath} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-white/12 px-3 py-2 text-[12px] font-black uppercase tracking-[0.1em] text-white/80 transition hover:border-white/35 hover:text-white">
          <ExternalLink className="h-4 w-4" /> Open live
        </a>
      </div>

      {/* QR — print it, put it on a desk placard, add it to an email signature */}
      <div className="glass-card mt-4 flex items-center gap-4 rounded-[14px] p-4">
        {/* The QR plate must be TRUE white in every theme — a scanner needs dark-on-light. */}
        <a href={publicPath} target="_blank" rel="noreferrer" style={{ ["--c41-white" as string]: "255 255 255" }} className="block w-28 shrink-0 rounded-[12px] bg-white p-2.5 ring-1 ring-slate-900/10 transition hover:scale-[1.02]">
          <img src={qrUrl} alt={`QR code for ${displayPersonName(member.name)} business card`} className="h-full w-full" />
        </a>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-mission-green"><QrCode className="h-3.5 w-3.5" /> Scan to open</div>
          <p className="mt-1 text-[13px] leading-5 text-white/60">Point a phone camera at this and the live card opens — one tap to call, text, or save the contact. Print it, add it to an email signature, or drop it on the desk.</p>
        </div>
      </div>

      <div className="mt-4"><ProfilePhotoUploader photoKey={photoKey} name={member.name} /></div>
    </div>
  );
}
