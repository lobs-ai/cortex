// Main App

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", k: "1" },
  { id: "calendar",  label: "Calendar",  icon: "calendar",  k: "2" },
  { id: "tasks",     label: "Tasks",     icon: "tasks",     k: "3" },
  { id: "chat",      label: "Chat",      icon: "chat",      k: "4" },
  { id: "memory",    label: "Memory",    icon: "memory",    k: "5" },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "blue",
  "showProactive": true,
  "chatDensity": "comfortable"
}/*EDITMODE-END*/;

const ACCENTS = {
  blue:   "oklch(0.72 0.14 240)",
  green:  "oklch(0.72 0.14 150)",
  amber:  "oklch(0.78 0.14 75)",
  violet: "oklch(0.68 0.16 300)",
  red:    "oklch(0.68 0.19 25)",
};

const App = () => {
  const [tab, setTab] = React.useState(() => localStorage.getItem("cortex.tab") || "dashboard");
  const [theme, setTheme] = React.useState(TWEAK_DEFAULTS.theme);
  const [accent, setAccent] = React.useState(TWEAK_DEFAULTS.accent);
  const [showProactive, setShowProactive] = React.useState(TWEAK_DEFAULTS.showProactive);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);

  const [tasks, setTasks] = React.useState(window.TASKS);
  const [recurring, setRecurring] = React.useState(window.RECURRING);
  const [recurringSuggestions, setRecurringSuggestions] = React.useState(window.RECURRING_SUGGESTIONS);
  const [alerts, setAlerts] = React.useState(window.ALERTS);
  const [messages, setMessages] = React.useState([]);
  const [calView, setCalView] = React.useState("day");
  const [scheduledBlocks, setScheduledBlocks] = React.useState([]);

  React.useEffect(() => { localStorage.setItem("cortex.tab", tab); }, [tab]);
  React.useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  React.useEffect(() => { document.documentElement.style.setProperty("--accent", ACCENTS[accent]); }, [accent]);

  // Tweaks protocol
  React.useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    window.parent?.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const persistEdit = (edits) => {
    window.parent?.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
  };

  // Keyboard nav
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const t = TABS.find(x => x.k === e.key);
      if (t) setTab(t.id);
      if (e.key === "t" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const next = theme === "dark" ? "light" : "dark";
        setTheme(next); persistEdit({ theme: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theme]);

  const dismissAlert = (id) => setAlerts(alerts.filter(a => a.id !== id));

  const onDropTask = (taskId, dayIdx, hour) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const dayOffset = Math.floor(hour / 100);
    const actualHour = hour % 100;
    setScheduledBlocks([...scheduledBlocks, { task, dayOffset, hour: actualHour }]);
    setTasks(tasks.map(t => t.id === taskId ? { ...t, status: "today" } : t));
  };

  const showRightRail = (tab === "dashboard" || tab === "calendar") && showProactive;

  return (
    <div className="app" data-theme={theme}>
      {/* LEFT RAIL */}
      <div className="rail">
        <div className="rail-logo" title="Cortex"></div>
        {TABS.map(t => (
          <button key={t.id} className="rail-tab" data-active={tab === t.id} onClick={() => setTab(t.id)} title={`${t.label} · ⌘${t.k}`}>
            <Icon name={t.icon} size={18}/>
            <span className="kbd">{t.k}</span>
          </button>
        ))}
        <div className="rail-spacer"></div>
        <button className="rail-tab" title="Toggle theme" onClick={() => { const n = theme === "dark" ? "light" : "dark"; setTheme(n); persistEdit({ theme: n }); }}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16}/>
        </button>
        <button className="rail-tab" title="Settings"><Icon name="settings" size={16}/></button>
      </div>

      {/* MAIN */}
      <div className="main">
        <div className="topbar">
          <div className="left">
            <span><span className="dot"></span><b>online</b> · cortex v0.3</span>
            <span>synced <span className="mono">3m ago</span></span>
            <span>next run <span className="mono">in 27m</span></span>
          </div>
          <div className="center mono">
            {new Date().toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false })}
          </div>
          <div className="right">
            <span className="row gap-2"><Icon name="github" size={13}/><Icon name="discord" size={13}/> <span className="mono">3 integrations</span></span>
            <span>⌘K</span>
            <span className="caps" style={{ color: "var(--text)" }}>Rafe S.</span>
          </div>
        </div>

        <div className={`page ${!showRightRail ? "no-rail" : ""}`}>
          <div className="canvas">
            {tab === "dashboard" && <Dashboard onNav={setTab} />}
            {tab === "calendar"  && <Calendar view={calView} setView={setCalView} onDropTask={onDropTask} droppedTasks={scheduledBlocks} />}
            {tab === "tasks"     && <Tasks tasks={tasks} setTasks={setTasks} recurring={recurring} setRecurring={setRecurring} suggestions={recurringSuggestions} setSuggestions={setRecurringSuggestions} />}
            {tab === "chat"      && <Chat messages={messages} setMessages={setMessages} />}
            {tab === "memory"    && <Memory />}
          </div>
          {showRightRail && (
            <div className="right-rail">
              <RightRail alerts={alerts} onDismiss={dismissAlert} />
            </div>
          )}
        </div>
      </div>

      {tweaksOpen && (
        <div className="tweaks-panel">
          <div className="hd">
            <span className="caps"><b style={{ color: "var(--text)" }}>Tweaks</b></span>
            <button className="btn ghost" onClick={() => setTweaksOpen(false)}><Icon name="x" size={12}/></button>
          </div>
          <div className="bd">
            <div className="tweak-row">
              <span className="k">Theme</span>
              <div className="seg-mini">
                <button data-active={theme === "dark"}  onClick={() => { setTheme("dark"); persistEdit({ theme: "dark" }); }}>dark</button>
                <button data-active={theme === "light"} onClick={() => { setTheme("light"); persistEdit({ theme: "light" }); }}>light</button>
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Accent</span>
              <div className="swatch-row">
                {Object.keys(ACCENTS).map(a => (
                  <button key={a} className="swatch" data-active={accent === a}
                    style={{ background: ACCENTS[a] }}
                    onClick={() => { setAccent(a); persistEdit({ accent: a }); }}></button>
                ))}
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Proactive rail</span>
              <div className="seg-mini">
                <button data-active={showProactive}  onClick={() => { setShowProactive(true); persistEdit({ showProactive: true }); }}>on</button>
                <button data-active={!showProactive} onClick={() => { setShowProactive(false); persistEdit({ showProactive: false }); }}>off</button>
              </div>
            </div>
            <div className="tweak-row">
              <span className="k">Shortcuts</span>
              <span className="mono muted-2" style={{ fontSize: 10.5 }}>⌘1–5 nav · ⌘T theme</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
