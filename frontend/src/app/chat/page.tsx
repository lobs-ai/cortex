"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ChatCard, type ChatMessage } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";

const SUGGESTIONS = [
  "What should I focus on today?",
  "When can I fit a 2-hour focus block?",
  "What am I behind on?",
  "Move the 3pm reading group",
  "Plan my tomorrow",
];

type ConvSummary = { id: string; lastAt: string; lastText: string; count: number };

export default function ChatPage() {
  const qc = useQueryClient();
  const [activeConvId, setActiveConvId] = useState<string | undefined>(undefined);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<{ text: string; cards: ChatCard[] } | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useQuery<ConvSummary[]>({
    queryKey: ["chat", "conversations"],
    queryFn: api.chat.conversations,
  });

  // On first load open most recent conversation
  useEffect(() => {
    if (bootstrapped || !conversations) return;
    setBootstrapped(true);
    if (conversations.length > 0) loadConversation(conversations[0].id);
  }, [conversations, bootstrapped]);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, streaming]);

  const loadConversation = async (id: string) => {
    setActiveConvId(id);
    setStreaming(null);
    const msgs = await api.chat.conversation(id);
    setMessages(msgs);
  };

  const newChat = () => {
    setActiveConvId(undefined);
    setMessages([]);
    setStreaming(null);
  };

  const send = useMutation({
    mutationFn: (text: string) => api.chat.send(text, activeConvId),
    onSuccess: (res) => {
      setActiveConvId(res.conversationId);
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      const full = res.message.content;
      const isError = res.message.error === true;
      if (isError) {
        setMessages((prev) => [
          ...prev,
          { id: res.message.id, role: "assistant", content: full, cards: res.message.cards, error: true },
        ]);
        return;
      }
      let i = 0;
      setStreaming({ text: "", cards: res.message.cards });
      const iv = setInterval(() => {
        i += Math.max(2, Math.floor(full.length / 40));
        if (i >= full.length) {
          clearInterval(iv);
          setMessages((prev) => [
            ...prev,
            { id: res.message.id, role: "assistant", content: full, cards: res.message.cards },
          ]);
          setStreaming(null);
        } else {
          setStreaming((s) => (s ? { ...s, text: full.slice(0, i) } : null));
        }
      }, 28);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: err instanceof Error ? err.message : "Chat request failed.",
          cards: [],
          error: true,
        },
      ]);
    },
  });

  const onSend = (text: string) => {
    if (!text.trim()) return;
    setInput("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text, cards: [] }]);
    send.mutate(text);
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div className="chat-sidebar">
        <div className="chat-sidebar-hd">
          <button className="btn primary" style={{ width: "100%", fontSize: 12 }} onClick={newChat}>
            + New chat
          </button>
        </div>
        <div className="chat-sidebar-list">
          {conversations?.map((c) => (
            <button
              key={c.id}
              className={`chat-sidebar-item${c.id === activeConvId ? " active" : ""}`}
              onClick={() => loadConversation(c.id)}
            >
              <div className="chat-sidebar-item-text">{c.lastText || "Chat"}</div>
              <div className="chat-sidebar-item-date">
                {new Date(c.lastAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </button>
          ))}
          {conversations?.length === 0 && (
            <div className="muted" style={{ padding: 12, fontSize: 11 }}>No past chats</div>
          )}
        </div>
      </div>

      <div className="chat-layout" style={{ flex: 1, overflow: "hidden" }}>
        <div className="chat-stream" ref={streamRef}>
          {messages.length === 0 && (
            <div className="msg">
              <div className="role">cortex</div>
              <div className="body">
                <p>
                  Hi. I&rsquo;m Cortex — your tasks, calendar, and projects are loaded. Ask me what
                  to focus on, where to fit a block of work, or what&rsquo;s slipping.
                </p>
                <div className="caps" style={{ color: "var(--muted-2)", marginTop: 10, fontSize: 10 }}>TRY</div>
                <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn" style={{ fontSize: 11.5 }} onClick={() => onSend(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === "user" ? "user" : ""}`}>
              <div className="role">{m.role === "user" ? "you" : "cortex"}</div>
              <div className="body">
                {m.error ? (
                  <div style={{ color: "var(--danger, #c2410c)", border: "1px solid var(--danger, #c2410c)", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>
                    <b>Chat error.</b> <Markdown inline>{m.content}</Markdown>
                  </div>
                ) : (
                  <Markdown>{m.content}</Markdown>
                )}
                {m.cards?.map((c, j) => <ChatCardView key={j} card={c} />)}
              </div>
            </div>
          ))}

          {streaming && (
            <div className="msg">
              <div className="role">cortex</div>
              <div className="body">
                <Markdown>{streaming.text}</Markdown>
                <span className="cursor" />
              </div>
            </div>
          )}
        </div>

        <div className="chat-inp">
          <input
            placeholder="Ask Cortex — try 'what should i do today?' or '/add task'"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend(input)}
          />
          <div className="row gap-2">
            <span className="mono muted-2" style={{ fontSize: 10.5 }}>⌘K for commands</span>
            <button className="btn primary" onClick={() => onSend(input)}>
              <Icon name="send" size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatCardView({ card }: { card: ChatCard }) {
  if (card.kind === "plan") {
    return (
      <div className="chat-card">
        <div className="hd">
          <span className="caps">
            <b style={{ color: "var(--text)" }}>{card.title}</b>
          </span>
          <div className="row gap-2">
            <button className="btn ghost" style={{ fontSize: 11 }}>Modify</button>
            <button className="btn primary" style={{ fontSize: 11 }}>Accept plan</button>
          </div>
        </div>
        <div className="bd">
          {card.blocks.map((b, i) => (
            <div key={i} className="block-row">
              <span className="mono num">{b.start}–{b.end}</span>
              <span>{b.label}</span>
              <button className="btn ghost" style={{ fontSize: 10.5, height: 20 }}>adjust</button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (card.kind === "items") {
    return (
      <div className="chat-card">
        <div className="hd">
          <span className="caps">
            <b style={{ color: "var(--text)" }}>{card.title}</b>
          </span>
        </div>
        <div className="bd">
          {card.blocks.map((b, i) => (
            <div key={i} className="block-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>
                <div>{b.label}</div>
                <div className="muted mono" style={{ fontSize: 10.5 }}>{b.sub}</div>
              </span>
              <button className="btn ghost" style={{ fontSize: 11 }}>schedule</button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
