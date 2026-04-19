// Calendar page — Today / Week / Month

const hours = Array.from({length: 14}, (_, i) => i + 7); // 7..20

const eventStyle = (e, baseDate) => {
  const base = new Date(baseDate); base.setHours(0,0,0,0);
  const startMin = (e.start - base) / 60000;
  const endMin = (e.end - base) / 60000;
  const top = ((startMin - 7*60) / 60) * 56;
  const height = Math.max(20, ((endMin - startMin) / 60) * 56);
  return { top, height };
};

const Calendar = ({ view, setView, onDropTask, droppedTasks }) => {
  const base = window.today;
  const [weekOffset, setWeekOffset] = React.useState(0);
  const [dragOverDay, setDragOverDay] = React.useState(null);

  const now = new Date();
  const nowMin = (now.getHours() - 7) * 60 + now.getMinutes();
  const nowTop = (nowMin / 60) * 56;

  const handleDragOver = (e, dayIdx) => { e.preventDefault(); setDragOverDay(dayIdx); };
  const handleDrop = (e, dayIdx, hour) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/task");
    if (taskId) onDropTask(taskId, dayIdx, hour);
    setDragOverDay(null);
  };

  const renderDay = (dayOffset, dayIdx) => {
    const dayBase = new Date(base); dayBase.setDate(dayBase.getDate() + dayOffset); dayBase.setHours(0,0,0,0);
    const dayEvents = (window.EVENTS || []).filter(ev => {
      const s = new Date(ev.start); s.setHours(0,0,0,0);
      return +s === +dayBase;
    });
    const dropped = (droppedTasks || []).filter(b => b.dayOffset === dayOffset);
    const isToday = dayOffset === 0;

    return (
      <div
        key={dayIdx}
        className={`day-col ${dragOverDay === dayIdx ? "drop-ready" : ""}`}
        style={{ position: "relative", height: hours.length * 56 }}
        onDragOver={(e) => handleDragOver(e, dayIdx)}
        onDragLeave={() => setDragOverDay(null)}
        onDrop={(e) => {
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          const hour = Math.floor(y / 56) + 7;
          handleDrop(e, dayIdx, hour + dayOffset * 100);
        }}
      >
        {dayEvents.map(ev => {
          const { top, height } = eventStyle(ev, dayBase);
          return (
            <div key={ev.id} className={`evt ${ev.kind}`} style={{ top, height }}>
              <div className="t truncate">{ev.title}</div>
              <div className="m">{fmtHM(ev.start)}–{fmtHM(ev.end)} {ev.location ? "· " + ev.location : ""}</div>
            </div>
          );
        })}
        {dropped.map((d, i) => {
          const topBlock = ((d.hour - 7) / 1) * 56;
          return (
            <div key={i} className="evt block" style={{ top: topBlock, height: 56 * (d.task.estMin / 60) }}>
              <div className="t truncate"><Icon name="sparkles" size={11}/> {d.task.title}</div>
              <div className="m">{String(d.hour).padStart(2,"0")}:00 · scheduled by you</div>
            </div>
          );
        })}
        {isToday && nowTop > 0 && nowTop < hours.length * 56 && (
          <div className="evt now-line" style={{ top: nowTop }}></div>
        )}
      </div>
    );
  };

  const weekDays = [-3, -2, -1, 0, 1, 2, 3].map(d => d + weekOffset * 7);

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="row gap-2">
          <button className="btn ghost" onClick={() => setWeekOffset(weekOffset - 1)}><Icon name="chevL" size={14}/></button>
          <button className="btn ghost" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="btn ghost" onClick={() => setWeekOffset(weekOffset + 1)}><Icon name="chevR" size={14}/></button>
          <div className="mono" style={{ fontSize: 12, marginLeft: 8 }}>
            {view === "month"
              ? new Date().toLocaleDateString([], { month: "long", year: "numeric" })
              : `${fmtDateShort(new Date(new Date().getTime() + weekOffset * 7 * 86400000))} — week`}
          </div>
        </div>
        <div className="grow"></div>
        <div className="seg">
          <button data-active={view === "day"} onClick={() => setView("day")}>Day</button>
          <button data-active={view === "week"} onClick={() => setView("week")}>Week</button>
          <button data-active={view === "month"} onClick={() => setView("month")}>Month</button>
        </div>
        <button className="btn"><Icon name="plus" size={14}/> New event</button>
      </div>

      {view === "day" && (
        <div className="day-grid">
          <div className="hours">
            {hours.map(h => <div key={h} className="hour">{String(h).padStart(2,"0")}:00</div>)}
          </div>
          {renderDay(0, 0)}
        </div>
      )}

      {view === "week" && (
        <div className="col" style={{ minHeight: 0, overflow: "hidden" }}>
          <div className="week-hd">
            <div></div>
            {weekDays.map((d, i) => {
              const date = new Date(base); date.setDate(date.getDate() + d);
              const isToday = d === 0;
              return (
                <div key={i} className={isToday ? "today" : ""}>
                  <div className="caps">{fmtWeekday(date)}</div>
                  <div className="num">{date.getDate()}</div>
                </div>
              );
            })}
          </div>
          <div className="week-grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
            <div className="hours">
              {hours.map(h => <div key={h} className="hour">{String(h).padStart(2,"0")}:00</div>)}
            </div>
            {weekDays.map((d, i) => renderDay(d, i))}
          </div>
        </div>
      )}

      {view === "month" && <MonthView />}
    </div>
  );
};

const MonthView = () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOffset = first.getDay();
  const dom = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(first); day.setDate(1 - startOffset + i);
    cells.push(day);
  }

  return (
    <div className="col" style={{ minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--hair)", background: "var(--bg)" }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} className="caps" style={{ padding: "6px 8px", borderRight: "1px solid var(--hair)" }}>{d}</div>
        ))}
      </div>
      <div className="month">
        {cells.map((cell, i) => {
          const isToday = +cell === +today;
          const isOther = cell.getMonth() !== today.getMonth();
          const cellEvents = (window.EVENTS || []).filter(ev => {
            const s = new Date(ev.start); s.setHours(0,0,0,0);
            return +s === +cell;
          });
          return (
            <div key={i} className={`month-cell ${isToday ? "today" : ""} ${isOther ? "other" : ""}`}>
              <div className="n">{cell.getDate()}</div>
              {cellEvents.slice(0, 3).map(ev => (
                <div key={ev.id} className="month-evt" style={{ borderColor: `var(--${ev.kind === "class" ? "violet" : ev.kind === "meeting" ? "blue" : ev.kind === "teach" ? "amber" : ev.kind === "deadline" ? "red" : "muted"})` }}>
                  {fmtHM(ev.start)} {ev.title}
                </div>
              ))}
              {cellEvents.length > 3 && <div className="muted-2" style={{ fontSize: 10 }}>+{cellEvents.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

Object.assign(window, { Calendar });
