"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ChatCard, type ChatMessage } from "@/lib/api";
import { Icon } from "@/components/Icon";

const SUGGESTIONS = [
  "What should I focus on today?",
  "When can I fit a 2-hour focus block?",
  "What am I behind on?",
  "Move the 3pm reading group",
  "Plan my tomorrow",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<{ text: string; cards: ChatCard[] } | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, streaming]);

  const send = useMutation({
    mutationFn: (text: string) => api.chat.send(text, convId),
    onSuccess: (res, text) => {
      setConvId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: text, cards: [] },
      ]);
      // Stream characters for feel.
      const full = res.message.content;
      let i = 0;
      setStreaming({ text: "", cards: res.message.cards });
      const iv = setInterval(() => {
        i += Math.max(2, Math.floor(full.length / 40));
        if (i >= full.length) {
          clearInterval(iv);
          setMessages((prev) => [
            ...prev,
            {
              id: res.message.id,
              role: "assistant",
              content: full,
              cards: res.message.cards,
            },
          ]);
          setStreaming(null);
        } else {
          setStreaming((s) => (s ? { ...s, text: full.slice(0, i) } : null));
        }
      }, 28);
    },
  });

  const onSend = (text: string) => {
    if (!text.trim()) return;
    setInput("");
    send.mutate(text);
  };

  return (
    <div className="chat-layout">
      <div className="chat-stream" ref={streamRef}>
        <div className="msg">
          <div className="role">cortex</div>
          <div className="body">
            <p>
              Morning. I reviewed your state overnight — you&rsquo;re on track overall, but the
              NeurIPS rebuttal is getting tight. I reserved an 11:00–12:30 deep-work block.
              Everything else is slotted around your 4 meetings.
            </p>
            <div
              className="caps"
              style={{ color: "var(--muted-2)", marginTop: 10, fontSize: 10 }}
            >
              TRY
            </div>
            <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="btn"
                  style={{ fontSize: 11.5 }}
                  onClick={() => onSend(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role === "user" ? "user" : ""}`}>
            <div className="role">{m.role === "user" ? "you" : "cortex"}</div>
            <div className="body">
              <p>{m.content}</p>
              {m.cards?.map((c, j) => <ChatCardView key={j} card={c} />)}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="msg">
            <div className="role">cortex</div>
            <div className="body">
              <p>
                {streaming.text}
                <span className="cursor" />
              </p>
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
              <span className="mono num">
                {b.start}–{b.end}
              </span>
              <span>{b.label}</span>
              <button className="btn ghost" style={{ fontSize: 10.5, height: 20 }}>
                adjust
              </button>
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
