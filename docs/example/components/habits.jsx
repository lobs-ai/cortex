// Recurring tasks / habits — managed by Cortex

const cadenceIcon = (c) => {
  if (c.startsWith("daily")) return "daily";
  if (c.startsWith("weekly")) return "weekly";
  if (c.includes("weekdays")) return "wkdy";
  return "custom";
};

const Habits = ({ recurring, setRecurring, suggestions, setSuggestions }) => {
  const toggleComplete = (id) => {
    setRecurring(recurring.map(r => r.id === id ? { ...r, completedToday: !r.completedToday, streak: r.completedToday ? Math.max(0, r.streak - 1) : r.streak + 1 } : r));
  };
  const togglePause = (id) => {
    setRecurring(recurring.map(r => r.id === id ? { ...r, paused: !r.paused } : r));
  };
  const removeRecurring = (id) => setRecurring(recurring.filter(r => r.id !== id));
  const dismissSuggestion = (id) => setSuggestions(suggestions.filter(s => s.id !== id));
  const acceptSuggestion = (s) => {
    if (s.action === "create") {
      setRecurring([...recurring, {
        id: "r" + Date.now(), title: s.title.replace("Make '", "").replace("' a weekly recurring task?", "").replace(/^'/, "").replace(/'\?$/, ""),
        project: null, cadence: s.cadence, time: s.cadence.split("·")[1]?.trim() || "09:00",
        estMin: 30, priority: "P2", streak: 0, completedToday: false, weeklyRate: 0,
        managedByAI: true, suggestedBy: "accepted suggestion " + s.id, note: "Just added by Cortex.",
      }]);
    }
    dismissSuggestion(s.id);
  };

  return (
    <div className="panel" style={{ margin: "0 12px 12px" }}>
      <div className="panel-hd">
        <span className="title"><b>Habits & recurring</b> · {recurring.filter(r => !r.paused).length} active · <span style={{ color: "var(--green)" }}>{recurring.filter(r => r.completedToday).length}/{recurring.filter(r => !r.paused && r.cadence.startsWith("daily")).length} done today</span></span>
        <div className="row gap-2">
          <button className="btn ghost" style={{ fontSize: 11 }}><Icon name="sparkles" size={11}/> AI tune</button>
          <button className="btn" style={{ fontSize: 11 }}><Icon name="plus" size={11}/> New recurring</button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--hair)", background: "color-mix(in oklch, var(--accent), transparent 94%)" }}>
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="sparkles" size={12}/>
            <span className="caps" style={{ color: "var(--text)" }}>Cortex suggests · {suggestions.length}</span>
          </div>
          {suggestions.map(s => (
            <div key={s.id} style={{ padding: "10px 12px", borderTop: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
              <div>
                <div className="row gap-2" style={{ marginBottom: 4 }}>
                  <span className="chip" style={{ color: s.action === "create" ? "var(--green)" : s.action === "adjust" ? "var(--amber)" : "var(--muted)" }}>{s.action}</span>
                  <span className="mono muted-2" style={{ fontSize: 10.5 }}>{s.cadence}</span>
                  <span className="mono muted-2" style={{ fontSize: 10.5 }}>· {Math.round(s.confidence * 100)}% · {s.evidence} obs</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>{s.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{s.body}</div>
              </div>
              <div className="row gap-2" style={{ alignSelf: "center" }}>
                <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => dismissSuggestion(s.id)}>Dismiss</button>
                <button className="btn primary" style={{ fontSize: 11 }} onClick={() => acceptSuggestion(s)}>Accept</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        {recurring.map(r => {
          const proj = projectById(r.project);
          return (
            <div key={r.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "22px 1fr 160px 100px 110px 80px", gap: 12, alignItems: "center", opacity: r.paused ? 0.5 : 1 }}>
              <button
                className={`check ${r.completedToday ? "on" : ""}`}
                onClick={() => toggleComplete(r.id)}
                title={r.completedToday ? "Completed today" : "Mark done today"}
              >
                {r.completedToday && <Icon name="check" size={10}/>}
              </button>
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ fontSize: 12.5 }}>
                  <span className="truncate" style={{ textDecoration: r.completedToday ? "line-through" : "none" }}>{r.title}</span>
                  {r.managedByAI && <span className="chip" style={{ color: "var(--accent)", fontSize: 9.5, height: 15, padding: "0 4px" }}><Icon name="sparkles" size={9}/> AI</span>}
                  {r.paused && <span className="chip" style={{ color: "var(--muted)", fontSize: 9.5, height: 15, padding: "0 4px" }}>paused</span>}
                </div>
                <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                  {proj && <span><Dot color={proj.color}/> {proj.name} · </span>}
                  {r.note}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 11.5 }}>{r.cadence}</span>
              <span className="mono num" style={{ fontSize: 11.5 }}>{r.time} · {r.estMin}m</span>
              <div>
                <div className="row gap-2" style={{ fontSize: 10.5 }}>
                  <span className="mono">🔥 {r.streak}d streak</span>
                </div>
                <div className="mini-bar" style={{ marginTop: 3, width: 90 }}>
                  <span style={{ width: (r.weeklyRate * 100) + "%", background: r.weeklyRate > 0.8 ? "var(--green)" : r.weeklyRate > 0.5 ? "var(--amber)" : "var(--red)" }}></span>
                </div>
                <div className="mono muted-2" style={{ fontSize: 10, marginTop: 1 }}>{Math.round(r.weeklyRate * 100)}% 30d</div>
              </div>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <button className="btn ghost" style={{ padding: "0 6px", height: 22 }} onClick={() => togglePause(r.id)} title={r.paused ? "Resume" : "Pause"}>
                  {r.paused ? <Icon name="chevR" size={11}/> : <span style={{ fontSize: 11 }}>‖</span>}
                </button>
                <button className="btn ghost" style={{ padding: "0 6px", height: 22 }} onClick={() => removeRecurring(r.id)} title="Remove"><Icon name="x" size={11}/></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

Object.assign(window, { Habits });
