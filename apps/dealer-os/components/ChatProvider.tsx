"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadStore, saveStore } from "@/lib/storeClient";

export type PrivateMessage = {
  id: string;
  conversationId?: string; // present on all new messages; absent on legacy 1:1
  from: string;
  to?: string; // kept on direct messages so the server's 1:1 auth filter still applies
  body: string;
  createdAt: string;
  ts?: number; // sort key (epoch ms)
};

export type Conversation = {
  id: string;
  type: "direct" | "group";
  participants: string[];
  title?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// Direct threads use a deterministic id so both people land in the same thread.
export function directIdFor(a: string, b: string) {
  return `dm:${[a, b].sort().join("|")}`;
}

type ChatContextValue = {
  messages: PrivateMessage[];
  conversations: Conversation[];
  loaded: boolean;
  ensureDirect: (me: string, other: string) => Conversation;
  createGroup: (me: string, participants: string[], title: string) => Conversation;
  sendToConversation: (conversation: Conversation, from: string, body: string) => void;
  messagesFor: (conversationId: string) => PrivateMessage[];
  // legacy single-shot send, kept for any old callers
  sendMessage: (message: { from: string; to: string; body: string }) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

function mergeById<T extends { id: string }>(local: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item); // server copy wins on conflict
  return Array.from(map.values());
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const messagesRef = useRef<PrivateMessage[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  messagesRef.current = messages;
  conversationsRef.current = conversations;

  // Initial load + a light poll so threads feel live (like iMessage).
  useEffect(() => {
    let active = true;
    async function refresh(first: boolean) {
      const [m, c] = await Promise.all([
        loadStore<PrivateMessage[]>("messages"),
        loadStore<Conversation[]>("conversations"),
      ]);
      if (!active) return;
      if (Array.isArray(m)) setMessages((prev) => mergeById(prev, m));
      if (Array.isArray(c)) setConversations((prev) => mergeById(prev, c));
      if (first) setLoaded(true);
    }
    void refresh(true);
    const id = setInterval(() => void refresh(false), 5000);
    // Fresh on open: the poll freezes while the phone sleeps — pull threads
    // the moment the app wakes.
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      void refresh(false);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  const persistMessages = useCallback((next: PrivateMessage[]) => {
    setMessages(next);
    void saveStore("messages", next);
  }, []);

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next);
    void saveStore("conversations", next);
  }, []);

  const ensureDirect = useCallback((me: string, other: string): Conversation => {
    const id = directIdFor(me, other);
    const existing = conversationsRef.current.find((c) => c.id === id);
    if (existing) return existing;
    const now = new Date();
    const convo: Conversation = {
      id,
      type: "direct",
      participants: [me, other],
      createdBy: me,
      createdAt: now.toLocaleString(),
      updatedAt: now.toLocaleString(),
    };
    persistConversations([...conversationsRef.current, convo]);
    return convo;
  }, [persistConversations]);

  const createGroup = useCallback((me: string, participants: string[], title: string): Conversation => {
    const all = Array.from(new Set([me, ...participants]));
    const now = new Date();
    const convo: Conversation = {
      id: `grp:${now.getTime()}`,
      type: "group",
      participants: all,
      title: title.trim() || "Group Chat",
      createdBy: me,
      createdAt: now.toLocaleString(),
      updatedAt: now.toLocaleString(),
    };
    persistConversations([...conversationsRef.current, convo]);
    return convo;
  }, [persistConversations]);

  const sendToConversation = useCallback((conversation: Conversation, from: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const now = new Date();
    const to = conversation.type === "direct"
      ? conversation.participants.find((p) => p !== from)
      : undefined;
    const message: PrivateMessage = {
      id: `MSG-${now.getTime()}-${Math.round(now.getTime() % 1000)}`,
      conversationId: conversation.id,
      from,
      ...(to ? { to } : {}),
      body: trimmed,
      createdAt: now.toLocaleString(),
      ts: now.getTime(),
    };
    persistMessages([...messagesRef.current, message]);
  }, [persistMessages]);

  // Effective conversations = stored ones + threads derived from legacy 1:1
  // messages that predate the conversation model, so nothing disappears.
  const effectiveConversations = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of conversations) map.set(c.id, c);
    for (const m of messages) {
      if (m.conversationId || !m.from || !m.to) continue;
      const id = directIdFor(m.from, m.to);
      if (!map.has(id)) {
        map.set(id, {
          id,
          type: "direct",
          participants: [m.from, m.to],
          createdBy: m.from,
          createdAt: m.createdAt,
          updatedAt: m.createdAt,
        });
      }
    }
    return Array.from(map.values());
  }, [conversations, messages]);

  const messagesFor = useCallback((conversationId: string) => {
    return messages
      .filter((m) => {
        if (m.conversationId) return m.conversationId === conversationId;
        if (m.from && m.to) return directIdFor(m.from, m.to) === conversationId;
        return false;
      })
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  }, [messages]);

  const sendMessage = useCallback((message: { from: string; to: string; body: string }) => {
    const convo = ensureDirect(message.from, message.to);
    sendToConversation(convo, message.from, message.body);
  }, [ensureDirect, sendToConversation]);

  const value = useMemo<ChatContextValue>(() => ({
    messages,
    conversations: effectiveConversations,
    loaded,
    ensureDirect,
    createGroup,
    sendToConversation,
    messagesFor,
    sendMessage,
  }), [messages, effectiveConversations, loaded, ensureDirect, createGroup, sendToConversation, messagesFor, sendMessage]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function usePrivateChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("usePrivateChat must be used inside ChatProvider");
  }
  return context;
}
