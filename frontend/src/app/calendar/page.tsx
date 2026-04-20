"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Event } from "@/lib/api";
import { fmtHM, fmtDateShort, fmtWeekday } from "@/lib/format";
import { Icon } from "@/components/Icon";

type View = "day" | "week" | "month";
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7..20

export default function CalendarPage() {
  const [view, setView] = useState<View>("day");
  const [weekOffset, setWeekOffset] = useState(0);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const rangeFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return d;
  }, [today]);
  const rangeTo = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 35);
    return d;
  }, [today]);

  const { data: events = [] } = useQuery({
    queryKey: ["events", rangeFrom.toISOString(), rangeTo.toISOString()],
    queryFn: () => api.events.list(rangeFrom, rangeTo),
  });

  const eventsByDay = useMemo(() => {
    const m = new Map<number, Event[]>();
    for (const e of events) {
      const s = new Date(e.start);
      s.setHours(0, 0, 0, 0);
      const key = +s;
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [events]);

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="row gap-2">
          <button className="btn ghost" onClick={() => setWeekOffset(weekOffset - 1)}>
            <Icon name="chevL" size={14} />
          </button>
          <button className="btn ghost" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="btn ghost" onClick={() => setWeekOffset(weekOffset + 1)}>
            <Icon name="chevR" size={14} />
          </button>
          <div className="mono" style={{ fontSize: 12, marginLeft: 8 }}>
            {view === "month"
              ? new Date().toLocaleDateString([], { month: "long", year: "numeric" })
              : `${fmtDateShort(new Date(+today + weekOffset * 7 * 86400000))} — week`}
          </div>
        </div>
        <div className="grow" />
        <div className="seg">
          {(["day", "week", "month"] as const).map((v) => (
            <button key={v} data-active={view === v} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn">
          <Icon name="plus" size={14} /> New event
        </button>
      </div>

      {view === "day" && <DayGrid today={today} eventsByDay={eventsByDay} />}
      {view === "week" && (
        <WeekGrid today={today} eventsByDay={eventsByDay} weekOffset={weekOffset} />
      )}
      {view === "month" && <MonthView today={today} eventsByDay={eventsByDay} />}
    </div>
  );
}

function eventStyle(e: Event, base: Date) {
  const s = new Date(e.start);
  const t = new Date(e.end);
  const startMin = (+s - +base) / 60000;
  const endMin = (+t - +base) / 60000;
  const top = ((startMin - 7 * 60) / 60) * 56;
  const height = Math.max(20, ((endMin - startMin) / 60) * 56);
  return { top, height };
}

function DayColumn({
  date,
  events,
  isToday,
}: {
  date: Date;
  events: Event[];
  isToday: boolean;
}) {
  const now = new Date();
  const nowMin = (now.getHours() - 7) * 60 + now.getMinutes();
  const nowTop = (nowMin / 60) * 56;

  return (
    <div className="day-col" style={{ position: "relative", height: HOURS.length * 56 }}>
      {events.map((ev) => {
        const { top, height } = eventStyle(ev, date);
        return (
          <div key={ev.id} className={`evt ${ev.kind}`} style={{ top, height }}>
            <div className="t truncate">{ev.title}</div>
            <div className="m">
              {fmtHM(new Date(ev.start))}–{fmtHM(new Date(ev.end))}
              {ev.location ? " · " + ev.location : ""}
            </div>
          </div>
        );
      })}
      {isToday && nowTop > 0 && nowTop < HOURS.length * 56 && (
        <div className="evt now-line" style={{ top: nowTop }} />
      )}
    </div>
  );
}

function DayGrid({
  today,
  eventsByDay,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
}) {
  const events = eventsByDay.get(+today) ?? [];
  return (
    <div className="day-grid">
      <div className="hours">
        {HOURS.map((h) => (
          <div key={h} className="hour">{String(h).padStart(2, "0")}:00</div>
        ))}
      </div>
      <DayColumn date={today} events={events} isToday={true} />
    </div>
  );
}

function WeekGrid({
  today,
  eventsByDay,
  weekOffset,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  weekOffset: number;
}) {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((d) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d + weekOffset * 7);
    dt.setHours(0, 0, 0, 0);
    return dt;
  });

  return (
    <div className="col" style={{ minHeight: 0, overflow: "hidden" }}>
      <div className="week-hd">
        <div />
        {days.map((d, i) => {
          const isToday = +d === +today;
          return (
            <div key={i} className={isToday ? "today" : ""}>
              <div className="caps">{fmtWeekday(d)}</div>
              <div className="num">{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="week-grid">
        <div className="hours">
          {HOURS.map((h) => (
            <div key={h} className="hour">{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>
        {days.map((d, i) => (
          <DayColumn
            key={i}
            date={d}
            events={eventsByDay.get(+d) ?? []}
            isToday={+d === +today}
          />
        ))}
      </div>
    </div>
  );
}

function MonthView({
  today,
  eventsByDay,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
}) {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOffset = first.getDay();

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(1 - startOffset + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  return (
    <div className="col" style={{ minHeight: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--hair)",
          background: "var(--bg)",
        }}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="caps"
            style={{ padding: "6px 8px", borderRight: "1px solid var(--hair)" }}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="month">
        {cells.map((cell, i) => {
          const isToday = +cell === +today;
          const isOther = cell.getMonth() !== today.getMonth();
          const cellEvents = eventsByDay.get(+cell) ?? [];
          return (
            <div
              key={i}
              className={`month-cell ${isToday ? "today" : ""} ${isOther ? "other" : ""}`}
            >
              <div className="n">{cell.getDate()}</div>
              {cellEvents.slice(0, 3).map((ev) => (
                <div
                  key={ev.id}
                  className="month-evt"
                  style={{ borderColor: kindToCss(ev.kind) }}
                >
                  {fmtHM(new Date(ev.start))} {ev.title}
                </div>
              ))}
              {cellEvents.length > 3 && (
                <div className="muted-2" style={{ fontSize: 10 }}>
                  +{cellEvents.length - 3} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kindToCss(kind: string) {
  return `var(--${
    kind === "class"
      ? "violet"
      : kind === "meeting"
        ? "blue"
        : kind === "teach"
          ? "amber"
          : kind === "deadline"
            ? "red"
            : "muted"
  })`;
}
