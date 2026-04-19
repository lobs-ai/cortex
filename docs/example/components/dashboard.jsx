// Dashboard (Today) page

const Dashboard = ({ onNav }) => {
  const now = new Date();
  const todayEvents = (window.EVENTS || []).filter(e => {
    const s = new Date(e.start); s.setHours(0,0,0,0);
    const t = new Date(window.today); t.setHours(0,0,0,0);
    return +s === +t;
  }).sort((a,b)=>a.start-b.start);

  const topTasks = (window.TASKS || []).filter(t => t.status === "today" || t.status === "doing")
    .sort((a,b) => (a.priority > b.priority ? 1 : -1));

  const doneToday = (window.TASKS || []).filter(t => t.status === "done").length;
  const openCount = (window.TASKS || []).filter(t => t.status !== "done").length;
  const overdue = (window.TASKS || []).filter(t => t.status !== "done" && t.due < new Date()).length;

  return (
    <div className="col" style={{ minHeight: 0 }}>
      <div className="page-hd">
        <div>
          <h1>Today <span className="muted mono" style={{ fontSize: 14, marginLeft: 8 }}>
            {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </span></h1>
          <div className="sub">4 meetings · 1 deep-work window · 3 proactive alerts</div>
        </div>
        <div className="row gap-2">
          <button className="btn ghost"><Icon name="plus" size={14}/> Quick add</button>
          <button className="btn primary"><Icon name="sparkles" size={14}/> Regenerate plan</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="k">Open tasks</div><div className="v">{openCount}</div><div className="s">{overdue} overdue · P0:1 P1:4 P2:4</div></div>
        <div className="stat"><div className="k">Completed today</div><div className="v">{doneToday}<span className="muted" style={{ fontSize: 14, marginLeft: 4 }}>/ 8</span></div><div className="s">on pace for 9 · est</div></div>
        <div className="stat"><div className="k">Focus block</div><div className="v mono">11:00</div><div className="s">90 min · rebuttal §3</div></div>
        <div className="stat"><div className="k">Deadline risk</div><div className="v" style={{ color: "var(--red)" }}>1</div><div className="s">NeurIPS rebuttal — 48h</div></div>
      </div>

      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 18, minHeight: 0 }}>
        {/* Proposed plan */}
        <div className="panel">
          <div className="panel-hd">
            <span className="title"><b>Proposed plan</b> · generated 06:48 by Cortex</span>
            <div className="row gap-2">
              <button className="btn ghost" style={{ fontSize: 11 }}>Why this?</button>
              <button className="btn" style={{ fontSize: 11 }}>Edit</button>
            </div>
          </div>
          <div>
            {[
              { t: "09:15–09:45", l: "Prep for advisor 1:1", s: "pulled last week's notes", k: "block" },
              { t: "10:00–10:45", l: "Advisor 1:1 — Prof. Chen", s: "BBB 4816", k: "meeting" },
              { t: "11:00–12:30", l: "Rebuttal §3 — deep work", s: "your best focus window", k: "block", hero: true },
              { t: "12:30–13:00", l: "Lunch", s: "", k: "personal" },
              { t: "13:00–14:30", l: "EECS 598 lecture", s: "DOW 1017", k: "class" },
              { t: "14:45–15:15", l: "Process Alex's PR", s: "code review", k: "block" },
              { t: "15:30–16:30", l: "Reading group — RAG", s: "Zoom", k: "meeting" },
              { t: "17:00–18:30", l: "Office hours (EECS 484)", s: "BBB 1690", k: "teach" },
            ].map((b, i) => (
              <div key={i} className="block-row" style={{ borderBottom: "1px solid var(--hair)" }}>
                <span className="mono num">{b.t}</span>
                <span>
                  <div style={{ fontWeight: b.hero ? 500 : 400 }}>{b.l} {b.hero && <span className="caps" style={{ color: "var(--green)", marginLeft: 6 }}>PRIME FOCUS</span>}</div>
                  {b.s && <div className="muted" style={{ fontSize: 11.5 }}>{b.s}</div>}
                </span>
                <span className={`chip ${b.k === "block" ? "" : ""}`} style={{ color: `var(--${b.k === "meeting" ? "blue" : b.k === "class" ? "violet" : b.k === "teach" ? "amber" : b.k === "personal" ? "green" : "green"})` }}>{b.k}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top tasks */}
        <div className="col gap-3">
          <div className="panel">
            <div className="panel-hd">
              <span className="title"><b>Top tasks</b> · ranked by Cortex</span>
              <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => onNav("tasks")}>All tasks →</button>
            </div>
            <div>
              {topTasks.slice(0, 6).map(t => (
                <div key={t.id} style={{ padding: "8px 12px", borderBottom: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
                  <PriorityChip p={t.priority} />
                  <div>
                    <div className="truncate" style={{ fontSize: 12.5 }}>{t.title}</div>
                    <div className="row gap-2" style={{ fontSize: 10.5, color: "var(--muted)" }}>
                      <ProjectTag id={t.project} />
                      <span className="mono">· est {t.estMin}m</span>
                      <span className="mono">· due {fmtRelative(t.due)}</span>
                    </div>
                  </div>
                  <button className="btn ghost" style={{ fontSize: 11 }}><Icon name="plus" size={11}/> schedule</button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><span className="title"><b>Projects</b> · health</span></div>
            <div>
              {(window.PROJECTS || []).filter(p => p.status === "active").slice(0, 5).map(p => (
                <div key={p.id} style={{ padding: "8px 12px", borderBottom: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "1fr auto 70px", gap: 10, alignItems: "center" }}>
                  <div className="row gap-2"><Dot color={p.color} /><span className="truncate" style={{ fontSize: 12.5 }}>{p.name}</span></div>
                  <span className="mono muted" style={{ fontSize: 10.5 }}>{p.tasksOpen} open · {p.tasksDone} done</span>
                  <div className={`hbar ${p.health < 50 ? "low" : p.health < 75 ? "mid" : ""}`}>
                    <span style={{ width: p.health + "%" }}></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { Dashboard });
