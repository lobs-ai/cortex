// Kanban + task list

const COLUMNS = [
  { id: "inbox",  label: "Inbox" },
  { id: "today",  label: "Today" },
  { id: "doing",  label: "In progress" },
  { id: "done",   label: "Done" },
];

const Tasks = ({ tasks, setTasks, recurring, setRecurring, suggestions, setSuggestions }) => {
  const [dragId, setDragId] = React.useState(null);
  const [overCol, setOverCol] = React.useState(null);

  const moveTask = (id, status) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, status } : t));
  };

  return (
    <div className="col" style={{ minHeight: 0, height: "100%", overflow: "auto" }}>
      <div className="page-hd">
        <div>
          <h1>Tasks</h1>
          <div className="sub">{tasks.filter(t => t.status !== "done").length} open · {tasks.filter(t => t.status === "done").length} done · sort: priority + due</div>
        </div>
        <div className="row gap-2">
          <button className="btn ghost"><Icon name="sparkles" size={14}/> AI prioritize</button>
          <button className="btn primary"><Icon name="plus" size={14}/> New task</button>
        </div>
      </div>
      <Habits recurring={recurring} setRecurring={setRecurring} suggestions={suggestions} setSuggestions={setSuggestions} />
      <div className="kanban" style={{ minHeight: 480, height: 520 }}>
        {COLUMNS.map(col => {
          const items = tasks.filter(t => t.status === col.id);
          return (
            <div
              key={col.id}
              className="column"
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveTask(dragId, col.id);
                setDragId(null); setOverCol(null);
              }}
            >
              <div className="column-hd">
                <span className="caps"><b style={{ color: "var(--text)" }}>{col.label}</b> <span className="mono num" style={{ marginLeft: 6 }}>{items.length}</span></span>
                <button className="btn ghost" style={{ height: 20, padding: "0 6px" }}><Icon name="plus" size={12}/></button>
              </div>
              <div className="column-bd">
                {items.map(t => {
                  const p = projectById(t.project);
                  const isDone = t.status === "done";
                  return (
                    <div
                      key={t.id}
                      className={`card ${dragId === t.id ? "dragging" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.setData("text/task", t.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragId(null)}
                      style={{ opacity: isDone ? 0.55 : 1 }}
                    >
                      <div className="card-hd">
                        <PriorityChip p={t.priority} />
                        {p && <span className="row gap-2"><Dot color={p.color} /><span className="truncate" style={{ maxWidth: 120 }}>{p.name}</span></span>}
                        <span className="grow"></span>
                        <span className="mono">{t.estMin}m</span>
                      </div>
                      <div className="card-title" style={{ textDecoration: isDone ? "line-through" : "none" }}>{t.title}</div>
                      <div className="card-ft">
                        <span>due {fmtRelative(t.due)}</span>
                        <span>· {t.energy} energy</span>
                        {t.tags && t.tags.slice(0,1).map(tag => <span key={tag}>· #{tag}</span>)}
                      </div>
                    </div>
                  );
                })}
                {overCol === col.id && dragId && <div className="drop-hint"></div>}
                {items.length === 0 && <div className="muted-2" style={{ fontSize: 11, padding: 8, textAlign: "center" }}>empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

Object.assign(window, { Tasks });
