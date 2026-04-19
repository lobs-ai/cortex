// Memory / Preferences page

const Memory = () => {
  return (
    <div className="col" style={{ minHeight: 0, overflow: "auto" }}>
      <div className="page-hd">
        <div>
          <h1>Memory</h1>
          <div className="sub">what Cortex knows · {window.TENDENCIES.length} learned tendencies · {window.PREFERENCES.length} explicit preferences</div>
        </div>
        <button className="btn"><Icon name="plus" size={14}/> Add preference</button>
      </div>

      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="panel">
          <div className="panel-hd"><span className="title"><b>Learned tendencies</b> · inferred from behavior</span></div>
          <div>
            {window.TENDENCIES.map(t => (
              <div key={t.id} className="tend-row">
                <div>
                  <div>{t.text}</div>
                  <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                    {t.evidence} observations · last seen {fmtRelative(t.lastSeen)} · {t.status}
                  </div>
                </div>
                <div className="mini-bar"><span style={{ width: (t.confidence * 100) + "%" }}></span></div>
                <span className="mono num" style={{ fontSize: 11 }}>{Math.round(t.confidence * 100)}%</span>
                <button className="btn ghost" style={{ fontSize: 11 }}><Icon name="x" size={11}/></button>
              </div>
            ))}
          </div>
        </div>

        <div className="col gap-3">
          <div className="panel">
            <div className="panel-hd"><span className="title"><b>Explicit preferences</b></span></div>
            <div>
              {window.PREFERENCES.map(p => (
                <div key={p.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, fontSize: 12.5 }}>
                  <span className="caps">{p.key}</span>
                  <span className="mono">{p.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><span className="title"><b>Integrations</b></span></div>
            <div>
              {window.INTEGRATIONS.map(it => (
                <div key={it.id} style={{ padding: "10px 12px", borderBottom: "1px solid var(--hair)", display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", fontSize: 12.5 }}>
                  <div>
                    <div>{it.name}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{it.detail}</div>
                  </div>
                  <span className={`chip ${it.status === "connected" ? "" : "p2"}`} style={{ color: it.status === "connected" ? "var(--green)" : "var(--muted)", borderColor: it.status === "connected" ? "color-mix(in oklch, var(--green), transparent 70%)" : "var(--hair-2)" }}>
                    <span className="sw"></span>{it.status}
                  </span>
                  <button className="btn ghost" style={{ fontSize: 11 }}>manage</button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><span className="title"><b>Action safety</b> · what Cortex can do without asking</span></div>
            <div style={{ padding: 12, display: "grid", gap: 8, fontSize: 12.5 }}>
              {[
                { k: "Read calendar & tasks", v: "auto", c: "green" },
                { k: "Propose schedule changes", v: "auto", c: "green" },
                { k: "Send daily Discord summary", v: "auto", c: "green" },
                { k: "Move events with attendees", v: "ask first", c: "amber" },
                { k: "Delete tasks or projects", v: "ask first", c: "amber" },
                { k: "Email on your behalf", v: "off", c: "red" },
              ].map(r => (
                <div key={r.k} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                  <span>{r.k}</span>
                  <span className="chip" style={{ color: `var(--${r.c})`, borderColor: `color-mix(in oklch, var(--${r.c}), transparent 70%)` }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { Memory });
