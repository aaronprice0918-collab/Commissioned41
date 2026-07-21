"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, Crown, MessageSquareText, Network, Phone, ShieldCheck, UsersRound, Wrench } from "lucide-react";
import { ProfilePhoto, profilePhotoKey } from "@/components/ProfilePhotoUpload";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useTeamLists } from "@/components/TeamProvider";
import { displayPersonName, team, type TeamMember } from "@/lib/data";

type TeamCard = {
  name: string;
  role: TeamMember["role"];
  title: string;
};

function roleColor(role: string) {
  if (role === "Manager" || role === "Administration") return "#f2f6ff"; // leadership — white
  if (role === "F&I" || role === "Sales") return "#6096ff";              // producers — blue
  return "#5fa8ff";                                                       // BDC / Service / Parts — blue
}
const cardId = (name: string) => "tm-" + name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

export default function TeamCommandPage() {
  const { salespeople, managers, financeManagers } = useTeamLists();
  const [selected, setSelected] = useState("");
  const salesTeam = salespeople.map((name) => ({
    name,
    role: team.find((member) => member.name === name)?.role === "BDC" ? ("BDC" as const) : ("Sales" as const),
    title: team.find((member) => member.name === name)?.role === "BDC" ? "BDC" : "Sales",
  }));
  const managerTeam = managers.map((name) => {
    const member = team.find((person) => person.name === name);
    return { name, role: "Manager" as const, title: member?.title || (name.toLowerCase().includes("daryl") ? "General Manager" : "Sales Manager") };
  });
  const financeTeam = financeManagers.map((name) => ({ name, role: "F&I" as const, title: "F&I Manager" }));
  const serviceTeam = team.filter((member) => member.role === "Service").map(toTeamCard);
  const partsTeam = team.filter((member) => member.role === "Parts").map(toTeamCard);
  const adminTeam = team.filter((member) => member.role === "Administration").map(toTeamCard);

  const everyone: TeamCard[] = [...managerTeam, ...financeTeam, ...salesTeam, ...serviceTeam, ...partsTeam, ...adminTeam];
  const pairs: TeamCard[][] = [];
  for (let i = 0; i < everyone.length; i += 2) pairs.push([everyone[i], everyone[i + 1]].filter(Boolean) as TeamCard[]);
  const focusCard = (name: string) => {
    const id = cardId(name);
    setSelected(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div>
      <SectionHeader title="Team" kicker="Your store's living DNA" />

      <section className="rise glass-card mb-5 rounded-[16px] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-mission-gold" />
            <div className="font-display text-2xl font-black text-white">The Team &mdash; your store&rsquo;s DNA</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {([["Managers", "#f2f6ff"], ["F&I / Sales", "#6096ff"], ["BDC / Support", "#5fa8ff"]] as const).map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-white/55">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />{label}
              </span>
            ))}
          </div>
        </div>
        <div className="living-border relative mx-auto flex items-center justify-center" style={{ width: 300, maxWidth: "100%", height: 330, borderRadius: "50% / 52%", background: "radial-gradient(closest-side, rgb(var(--mission-line) / 0.20), rgb(var(--mission-line) / 0.06))" }}>
          <div className="dna-helix" style={{ width: 160 }}>
            {pairs.map((pair, i) => {
              const a = pair[0];
              const b = pair[1];
              return (
                <div key={i} className="dna-pair" style={{ animationDelay: `${(i * -0.34).toFixed(2)}s` }}>
                  {a && <button type="button" className="dna-dot l" style={{ color: roleColor(a.role), background: roleColor(a.role) }} title={`${displayPersonName(a.name)} · ${a.title}`} aria-label={displayPersonName(a.name)} onClick={() => focusCard(a.name)} />}
                  <span className="dna-bar" />
                  {b && <button type="button" className="dna-dot r" style={{ color: roleColor(b.role), background: roleColor(b.role) }} title={`${displayPersonName(b.name)} · ${b.title}`} aria-label={displayPersonName(b.name)} onClick={() => focusCard(b.name)} />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 text-center text-xs text-white/45">{everyone.length} teammates &middot; tap a node to open their card</div>
      </section>

      <section className="glass-card mb-5 overflow-hidden rounded-[12px] p-6">
        <div className="mb-6 flex items-center gap-3">
          <Network className="h-6 w-6 text-mission-gold" />
          <div className="font-display text-2xl font-black text-white">Org Chart</div>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <CommandLane title="Management" people={managerTeam} tone="gold" onFocus={focusCard} />
          <CommandLane title="Sales Floor" people={salesTeam} tone="green" onFocus={focusCard} />
          <CommandLane title="Finance" people={financeTeam} tone="blue" onFocus={focusCard} />
          <CommandLane title="Service" people={serviceTeam} tone="blue" onFocus={focusCard} />
          <CommandLane title="Parts" people={partsTeam} tone="green" onFocus={focusCard} />
          <CommandLane title="Administration" people={adminTeam} tone="gold" onFocus={focusCard} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...managerTeam, ...financeTeam, ...salesTeam, ...serviceTeam, ...partsTeam, ...adminTeam].map((person) => (
          <article key={`${person.role}:${person.name}`} id={cardId(person.name)} className={`glass-card rounded-[12px] p-5 transition ${selected === cardId(person.name) ? "ring-2 ring-mission-green" : ""}`}>
            {(() => {
              const directoryMember = team.find((member) => member.name === person.name);
              return (
                <>
            <div className="flex items-center gap-4">
              <ProfilePhoto photoKey={profilePhotoKey(person.role, person.name)} name={person.name} size="md" />
              <div className="min-w-0">
                <div className="font-display text-xl font-black leading-tight text-white">{displayPersonName(person.name)}</div>
                <div className="mt-1 text-sm font-bold uppercase tracking-[0.12em] text-mission-gold">{person.title}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill tone={person.role === "Manager" || person.role === "Administration" ? "gold" : person.role === "F&I" || person.role === "Service" ? "blue" : "green"}>{person.role}</StatusPill>
              <StatusPill tone="blue">{directoryMember?.employeeNumber ? `#${directoryMember.employeeNumber}` : "Kennesaw Mazda"}</StatusPill>
            </div>
            <div className="mt-4 space-y-1 text-sm leading-6 text-white/58">
              {directoryMember?.phone && <a href={`tel:${directoryMember.phone.replace(/[^0-9+]/g, "")}`} className="block text-mission-green underline-offset-2 transition hover:underline">{directoryMember.phone}</a>}
              {directoryMember?.email && <a href={`mailto:${directoryMember.email}`} className="block break-all text-mission-green underline-offset-2 transition hover:underline">{directoryMember.email}</a>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {directoryMember?.phone && (
                <a href={`tel:${directoryMember.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1.5 rounded-full bg-mission-gold px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
              <Link href="/private-chat" className="inline-flex items-center gap-1.5 rounded-full border border-mission-gold/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
                <MessageSquareText className="h-3.5 w-3.5" /> Message
              </Link>
            </div>
                </>
              );
            })()}
          </article>
        ))}
      </section>
    </div>
  );
}

function CommandLane({ title, people, tone, onFocus }: { title: string; people: TeamCard[]; tone: "gold" | "green" | "blue"; onFocus: (name: string) => void }) {
  const Icon =
    title === "Management" || title === "Administration"
      ? Crown
      : title === "Finance"
        ? ShieldCheck
        : title === "Service"
          ? Wrench
          : title === "Parts"
            ? Boxes
            : UsersRound;

  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-display text-xl font-black text-white">{title}</div>
        <Icon className="h-5 w-5 text-mission-gold" />
      </div>
      <div className="space-y-3">
        {people.length ? (
          people.map((person) => (
            <button
              type="button"
              key={`${person.role}:${person.name}`}
              onClick={() => onFocus(person.name)}
              className="flex w-full items-center gap-3 rounded-[12px] border border-white/10 bg-[#14161c]/75 p-3 text-left transition hover:border-mission-gold/40"
            >
              <ProfilePhoto photoKey={profilePhotoKey(person.role, person.name)} name={person.name} size="md" />
              <div className="min-w-0">
                <div className="font-bold text-white">{displayPersonName(person.name)}</div>
                <StatusPill tone={tone}>{person.title}</StatusPill>
                <div className="mt-1 break-all text-xs leading-5 text-white/48">{team.find((member) => member.name === person.name)?.email || ""}</div>
              </div>
            </button>
          ))
        ) : (
          <div className="rounded-[12px] border border-white/10 bg-[#14161c]/75 p-4 text-sm text-white/56">Add team members in Admin.</div>
        )}
      </div>
    </div>
  );
}

function toTeamCard(member: TeamMember): TeamCard {
  return { name: member.name, role: member.role, title: member.title };
}
