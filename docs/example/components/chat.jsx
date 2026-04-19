// Chat page with streaming-feel

const CANNED = {
  "default": "Let me take a look... based on what's on your plate, I'd tackle the NeurIPS rebuttal next — it's the only P0 with a hard deadline inside 48h.",
  "rebuttal": "Yeah, the rebuttal is the blocker. You've got ~5h of writing left based on your outline, and your writing tasks historically run 35% over — so call it 6.5h. I'd split it: 4h today (11:00–12:30 + 16:00–18:00), 2.5h tomorrow morning.",
  "plan": "Okay — here's what I'd run. Your deep-work window is 11:00–12:30, which is your strongest. Everything else slots around your meetings.",
  "behind": "Three things: (1) rebuttal §3, (2) the eval leak in trainer.py — due in 2 days and you haven't touched it, (3) the replay-debugger project has been dark for 8 days. Want me to handle any of these?",
  "move": "Done. I moved the 3pm reading group to Thursday 10am — your advisor said that slot works. Everyone else is auto-confirmed.",
  "tomorrow": "Tomorrow is lighter — lab meeting at 11, EECS 598 at 13:00, and your usual 7:30 gym block. I'd reserve 14:30–16:30 for ablation re-runs. Want me to schedule that?",
  "time": "Looking at your calendar — you've got a clean 9:00–10:45 block Thursday and Friday 14:30–18:00. Either works for 2h focus. Thursday is better because you do deep work best in mornings.",
};

const pickCanned = (text) => {
  const t = text.toLowerCase();
  if (t.includes("rebuttal")) return CANNED.rebuttal;
  if (t.includes("plan") || t.includes("today")) return CANNED.plan;
  if (t.includes("behind") || t.includes("overdue")) return CANNED.behind;
  if (t.includes("move") || t.includes("reschedule")) return CANNED.move;
  if (t.includes("tomorrow")) return CANNED.tomorrow;
  if (t.includes("when") || t.includes("fit") || t.includes("block")) return CANNED.time;
  return CANNED.default;
};

const SUGGESTIONS = [
  "What should I focus on today?",
  "When can I fit a 2-hour focus block?",
  "What am I behind on?",
  "Move the 3pm reading group",
  "Plan my tomorrow",
];

const Chat = ({ messages, setMessages }) => {
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(null);
  const streamRef = React.useRef(null);

  React.useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [messages, streaming]);

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { role: "user", text };
    setMessages([...messages, userMsg]);
    setInput("");
    const reply = pickCanned(text);
    const cards = (text.toLowerCase().includes("plan") || text.toLowerCase().includes("today")) ? [{
      kind: "plan", title: "Proposed plan for today",
      blocks: [
        { start: "09:15", end: "09:45", label: "Prep for advisor 1:1" },
        { start: "10:00", end: "10:45", label: "Advisor 1:1" },
        { start: "11:00", end: "12:30", label: "Rebuttal §3 — deep work" },
        { start: "13:00", end: "14:30", label: "EECS 598 lecture" },
        { start: "15:30", end: "16:30", label: "Reading group" },
        { start: "17:00", end: "18:30", label: "Office hours" },
      ]
    }] : text.toLowerCase().includes("behind") ? [{
      kind: "items", title: "Flagged",
      blocks: [
        { label: "Rebuttal §3", sub: "P0 · due in 48h · 3h scheduled of ~6.5h est" },
        { label: "Eval leak in trainer.py", sub: "P1 · due in 2 days · untouched" },
        { label: "replay-debugger project", sub: "dark for 8 days" },
      ]
    }] : null;

    // stream
    setStreaming({ role: "assistant", text: "", full: reply, cards });
    let i = 0;
    const iv = setInterval(() => {
      i += Math.max(2, Math.floor(reply.length / 40));
      if (i >= reply.length) {
        clearInterval(iv);
        setMessages(m => [...m, { role: "assistant", text: reply, cards }]);
        setStreaming(null);
      } else {
        setStreaming(s => s ? { ...s, text: reply.slice(0, i) } : null);
      }
    }, 28);
  };

  return (
    <div className="chat-layout">
      <div className="chat-stream" ref={streamRef}>
        <div className="msg">
          <div className="role">cortex</div>
          <div className="body">
            <p>Morning. I reviewed your state overnight — you're on track overall, but the NeurIPS rebuttal is getting tight. I reserved an 11:00–12:30 deep-work block. Everything else is slotted around your 4 meetings.</p>
            <div className="caps" style={{ color: "var(--muted-2)", marginTop: 10, fontSize: 10 }}>TRY</div>
            <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} className="btn" style={{ fontSize: 11.5 }} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "user" : ""}`}>
            <div className="role">{m.role === "user" ? "you" : "cortex"}</div>
            <div className="body">
              <p>{m.text}</p>
              {m.cards && m.cards.map((c, j) => <ChatCard key={j} card={c} />)}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="msg">
            <div className="role">cortex</div>
            <div className="body">
              <p>{streaming.text}<span className="cursor"></span></p>
            </div>
          </div>
        )}
      </div>

      <div className="chat-inp">
        <input
          placeholder="Ask Cortex — try 'what should i do today?' or '/add task'"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
        />
        <div className="row gap-2">
          <span className="mono muted-2" style={{ fontSize: 10.5 }}>⌘K for commands</span>
          <button className="btn primary" onClick={() => send(input)}><Icon name="send" size={13}/></button>
        </div>
      </div>
    </div>
  );
};

const ChatCard = ({ card }) => {
  if (card.kind === "plan") {
    return (
      <div className="chat-card">
        <div className="hd">
          <span className="caps"><b style={{ color: "var(--text)" }}>{card.title}</b></span>
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
        <div className="hd"><span className="caps"><b style={{ color: "var(--text)" }}>{card.title}</b></span></div>
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
};

Object.assign(window, { Chat });
