"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, MessageSquarePlus, MessageSquareText, Send, Users, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/components/AuthProvider";
import { usePrivateChat, type Conversation } from "@/components/ChatProvider";
import { useTeamLists } from "@/components/TeamProvider";
import { canonicalPersonName, displayPersonName } from "@/lib/data";

type Person = { key: string; name: string; role: string };
type ComposeMode = null | "direct" | "group";

export default function PrivateChatPage() {
  const { salespeople, managers, financeManagers } = useTeamLists();
  const { profile, secureMode } = useAuth();
  const { conversations, messagesFor, ensureDirect, createGroup, sendToConversation } = usePrivateChat();

  const people = useMemo<Person[]>(
    () => [
      ...salespeople.map((name) => ({ key: `Sales:${name}`, name, role: "Sales" })),
      ...managers.map((name) => ({ key: `Manager:${name}`, name, role: "Manager" })),
      ...financeManagers.map((name) => ({ key: `F&I:${name}`, name, role: "F&I" })),
    ],
    [financeManagers, managers, salespeople]
  );

  const current = useMemo(() => {
    if (!profile?.employeeName) return null;
    const employeeName = canonicalPersonName(profile.employeeName);
    const profileRole = profile.role === "Admin" ? "Manager" : profile.role;
    return (
      people.find((person) => person.name === employeeName && person.role === profileRole) ||
      people.find((person) => person.name === employeeName) ||
      null
    );
  }, [people, profile]);
  const me = current?.key || "";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeMode>(null);
  const [groupPicks, setGroupPicks] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // My conversations, newest activity first.
  const myConversations = useMemo(() => {
    const mine = conversations.filter((c) => c.participants.includes(me));
    const lastTs = (c: Conversation) => {
      const msgs = messagesFor(c.id);
      return msgs.length ? msgs[msgs.length - 1].ts ?? 0 : 0;
    };
    return mine.sort((a, b) => lastTs(b) - lastTs(a));
  }, [conversations, me, messagesFor]);

  const selected = myConversations.find((c) => c.id === selectedId) || null;
  const threadMessages = selected ? messagesFor(selected.id) : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages.length, selectedId]);

  function nameFor(key: string) {
    const p = people.find((x) => x.key === key);
    return p ? displayPersonName(p.name) : key.split(":")[1] || key;
  }

  function titleFor(c: Conversation) {
    if (c.type === "group") return c.title || "Group Chat";
    const other = c.participants.find((p) => p !== me) || "";
    return nameFor(other);
  }

  function subtitleFor(c: Conversation) {
    const msgs = messagesFor(c.id);
    if (!msgs.length) {
      return c.type === "group" ? `${c.participants.length} people` : "No messages yet";
    }
    const last = msgs[msgs.length - 1];
    const who = last.from === me ? "You: " : c.type === "group" ? `${nameFor(last.from)}: ` : "";
    return `${who}${last.body}`;
  }

  function openDirect(personKey: string) {
    const convo = ensureDirect(me, personKey);
    setSelectedId(convo.id);
    setCompose(null);
  }

  function makeGroup() {
    if (groupPicks.length === 0) return;
    const convo = createGroup(me, groupPicks, groupName);
    setSelectedId(convo.id);
    setCompose(null);
    setGroupPicks([]);
    setGroupName("");
  }

  function send() {
    if (!selected || !secureMode || !draft.trim()) return;
    sendToConversation(selected, me, draft);
    setDraft("");
  }

  const others = people.filter((p) => p.key !== me);

  return (
    <div>
      <SectionHeader title="Messages" kicker="Private & group — your team's channel" icon={MessageSquareText} />

      {!current && (
        <div className="mb-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 px-4 py-3 text-sm text-mission-red">
          This login isn&apos;t matched to an employee profile yet, so messaging is disabled. Admin can fix the profile match.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* ── Conversation list ── */}
        <aside className={`${selected ? "hidden lg:block" : "block"} glass-card rounded-[14px] p-3`}>
          <div className="mb-3 flex items-center gap-2 px-1">
            <div className="font-display text-lg font-black text-white">Chats</div>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                onClick={() => { setCompose(compose === "direct" ? null : "direct"); setSelectedId(null); }}
                title="New message"
                className={`grid h-9 w-9 place-items-center rounded-full border transition ${compose === "direct" ? "border-mission-gold bg-mission-gold/15 text-mission-gold" : "border-white/12 text-white/65 hover:text-white"}`}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setCompose(compose === "group" ? null : "group"); setSelectedId(null); }}
                title="New group"
                className={`grid h-9 w-9 place-items-center rounded-full border transition ${compose === "group" ? "border-mission-gold bg-mission-gold/15 text-mission-gold" : "border-white/12 text-white/65 hover:text-white"}`}
              >
                <Users className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* New direct: pick a person */}
          {compose === "direct" && (
            <div className="mb-3 rounded-[12px] border border-white/10 bg-white/[0.03] p-2">
              <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Start a chat with</div>
              <div className="max-h-[240px] space-y-1 overflow-y-auto">
                {others.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => openDirect(p.key)}
                    className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition hover:bg-white/5"
                  >
                    <Avatar label={displayPersonName(p.name)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{displayPersonName(p.name)}</div>
                      <div className="text-[11px] text-white/45">{p.role}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New group: multi-select + name */}
          {compose === "group" && (
            <div className="mb-3 rounded-[12px] border border-white/10 bg-white/[0.03] p-2">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (e.g. Sales Floor)"
                className="mb-2 h-10 w-full rounded-[10px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none focus:border-mission-gold/60"
              />
              <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Add people</div>
              <div className="max-h-[200px] space-y-1 overflow-y-auto">
                {others.map((p) => {
                  const picked = groupPicks.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setGroupPicks((cur) => picked ? cur.filter((k) => k !== p.key) : [...cur, p.key])}
                      className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left transition ${picked ? "bg-mission-gold/10" : "hover:bg-white/5"}`}
                    >
                      <Avatar label={displayPersonName(p.name)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-white">{displayPersonName(p.name)}</div>
                        <div className="text-[11px] text-white/45">{p.role}</div>
                      </div>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border ${picked ? "border-mission-gold bg-mission-gold text-mission-navy" : "border-white/25"}`}>
                        {picked && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={makeGroup}
                disabled={groupPicks.length === 0}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110 disabled:opacity-45"
              >
                Create group ({groupPicks.length})
              </button>
            </div>
          )}

          {/* Existing conversations */}
          <div className="space-y-1">
            {myConversations.length === 0 && !compose && (
              <div className="rounded-[12px] border border-white/10 bg-white/[0.03] p-6 text-center text-sm leading-6 text-white/55">
                No chats yet. Tap the icons above to start a private message or a group.
              </div>
            )}
            {myConversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2.5 text-left transition ${selectedId === c.id ? "bg-mission-gold/12" : "hover:bg-white/5"}`}
              >
                <Avatar label={titleFor(c)} group={c.type === "group"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-white">{titleFor(c)}</div>
                  <div className="truncate text-[12px] text-white/48">{subtitleFor(c)}</div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Thread ── */}
        <main className={`${selected ? "block" : "hidden lg:block"} glass-card flex min-h-[60vh] flex-col rounded-[14px]`}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
              <MessageSquareText className="h-8 w-8 text-white/25" />
              <div className="text-sm text-white/50">Select a chat or start a new one.</div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                <button type="button" onClick={() => setSelectedId(null)} className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition hover:text-white lg:hidden">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Avatar label={titleFor(selected)} group={selected.type === "group"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-black text-white">{titleFor(selected)}</div>
                  <div className="truncate text-[11px] text-white/45">
                    {selected.type === "group"
                      ? selected.participants.map((p) => (p === me ? "You" : nameFor(p))).join(", ")
                      : "Private message"}
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
                {threadMessages.length === 0 ? (
                  <div className="py-10 text-center text-sm text-white/45">No messages yet — say hello.</div>
                ) : (
                  threadMessages.map((m) => {
                    const mine = m.from === me;
                    return (
                      <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                        <div className="max-w-[78%]">
                          {!mine && selected.type === "group" && (
                            <div className="mb-0.5 pl-1 text-[10px] font-bold uppercase tracking-[0.12em] text-mission-gold/70">{nameFor(m.from)}</div>
                          )}
                          <div
                            className={
                              mine
                                ? "rounded-[16px] rounded-br-sm bg-mission-gold px-3.5 py-2 text-sm font-medium text-mission-navy"
                                : "rounded-[16px] rounded-bl-sm border border-white/8 bg-white/[0.05] px-3.5 py-2 text-sm leading-6 text-white/88"
                            }
                          >
                            {m.body}
                          </div>
                          <div className={`mt-0.5 text-[10px] text-white/30 ${mine ? "text-right pr-1" : "pl-1"}`}>{m.createdAt}</div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="flex items-center gap-2 border-t border-white/8 p-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={secureMode ? "Message…" : "Sign in to send"}
                  disabled={!secureMode}
                  className="h-11 flex-1 rounded-full border border-white/10 bg-[#101218] px-4 text-sm text-white outline-none transition focus:border-mission-gold/60 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!secureMode || !draft.trim()}
                  className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-mission-gold text-mission-navy transition hover:brightness-110 disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Avatar({ label, group = false }: { label: string; group?: boolean }) {
  const initial = (label || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-mission-gold/12 text-mission-gold">
      {group ? <Users className="h-4 w-4" /> : <span className="text-sm font-black">{initial}</span>}
    </span>
  );
}
