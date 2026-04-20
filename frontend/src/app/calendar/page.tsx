"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Event } from "@/lib/api";
import { fmtHM, fmtDateShort, fmtWeekday } from "@/lib/format";
import { Icon } from "@/components/Icon";

type View = "day" | "week" | "month";

// Full 24-hour day, 48 px per row. The grid scrolls.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_PX = 48;
const GRID_HEIGHT = HOURS.length * HOUR_PX;

export default function CalendarPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("day");
  const [offset, setOffset] = useState(0); // days from today
  const [showCreate, setShowCreate] = useState(false);

  const navigate = (dir: 1 | -1) => {
    if (view === "day") {
      setOffset((o) => o + dir);
    } else if (view === "week") {
      setOffset((o) => o + dir * 7);
    } else {
      setOffset((o) => {
        const current = new Date(today);
        current.setDate(current.getDate() + o);
        const next = new Date(current.getFullYear(), current.getMonth() + dir, 1);
        return Math.round((+next - +today) / 86400000);
      });
    }
  };

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

  const createEvent = useMutation({
    mutationFn: (body: { title: string; startTime: Date; endTime: Date; kind: Event["kind"]; location?: string }) =>
      api.events.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setShowCreate(false);
    },
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
          <button className="btn ghost" onClick={() => navigate(-1)}>
            <Icon name="chevL" size={14} />
          </button>
          <button className="btn ghost" onClick={() => setOffset(0)}>Today</button>
          <button className="btn ghost" onClick={() => navigate(1)}>
            <Icon name="chevR" size={14} />
          </button>
          <div className="mono" style={{ fontSize: 12, marginLeft: 8 }}>
            {view === "month"
              ? new Date(+today + offset * 86400000).toLocaleDateString([], { month: "long", year: "numeric" })
              : view === "day"
              ? fmtDateShort(new Date(+today + offset * 86400000))
              : `${fmtDateShort(new Date(+today + offset * 86400000))} — week`}
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
        <button className="btn" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={14} /> New event
        </button>
      </div>

      {view === "day" && <DayGrid today={today} eventsByDay={eventsByDay} offset={offset} />}
      {view === "week" && (
        <WeekGrid today={today} eventsByDay={eventsByDay} offset={offset} />
      )}
      {view === "month" && <MonthView today={today} eventsByDay={eventsByDay} offset={offset} />}

      {showCreate && (
        <NewEventModal
          defaultDate={today}
          onClose={() => setShowCreate(false)}
          onSubmit={(v) => createEvent.mutate(v)}
          pending={createEvent.isPending}
        />
      )}
    </div>
  );
}

function eventStyle(e: Event, base: Date) {
  const s = new Date(e.start);
  const t = new Date(e.end);
  const startMin = (+s - +base) / 60000;
  const endMin = (+t - +base) / 60000;
  const top = (startMin / 60) * HOUR_PX;
  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_PX);
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
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMin / 60) * HOUR_PX;

  return (
    <div className="day-col" style={{ position: "relative", height: GRID_HEIGHT }}>
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
      {isToday && nowTop > 0 && nowTop < GRID_HEIGHT && (
        <div className="evt now-line" style={{ top: nowTop }} />
      )}
    </div>
  );
}

function HourColumn() {
  return (
    <div className="hours">
      {HOURS.map((h) => (
        <div key={h} className="hour" style={{ height: HOUR_PX }}>
          {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
        </div>
      ))}
    </div>
  );
}

// Scroll the grid so that current hour is ~25% from the top on first paint.
function useAutoScrollToNow(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!ref.current) return;
    const now = new Date();
    const targetTop = Math.max(0, (now.getHours() - 2) * HOUR_PX);
    ref.current.scrollTop = targetTop;
  }, [ref]);
}

function DayGrid({
  today,
  eventsByDay,
  offset,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
}) {
  const date = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  }, [today, offset]);
  const events = eventsByDay.get(+date) ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollToNow(scrollRef);

  return (
    <div className="day-grid" ref={scrollRef}>
      <HourColumn />
      <DayColumn date={date} events={events} isToday={offset === 0} />
    </div>
  );
}

function WeekGrid({
  today,
  eventsByDay,
  offset,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
}) {
  const days = useMemo(() => {
    const ref = new Date(today);
    ref.setDate(ref.getDate() + offset);
    const sunday = new Date(ref);
    sunday.setDate(ref.getDate() - ref.getDay());
    sunday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  }, [today, weekOffset]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollToNow(scrollRef);

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
      <div className="week-grid" ref={scrollRef}>
        <HourColumn />
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
  offset,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
}) {
  const displayDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  }, [today, offset]);

  const first = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
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
          const isOther = cell.getMonth() !== displayDate.getMonth();
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

function NewEventModal({
  defaultDate,
  onClose,
  onSubmit,
  pending,
}: {
  defaultDate: Date;
  onClose: () => void;
  onSubmit: (v: {
    title: string;
    startTime: Date;
    endTime: Date;
    kind: Event["kind"];
    location?: string;
  }) => void;
  pending: boolean;
}) {
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toLocalInputValue(d);
  }, []);
  const defaultEnd = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return toLocalInputValue(d);
  }, []);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<Event["kind"]>("meeting");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  void defaultDate;

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 420, background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title">
            <b>New event</b>
          </span>
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="caps">Title</span>
            <input
              className="mono"
              style={{
                border: "1px solid var(--hair-2)",
                padding: "6px 8px",
                background: "var(--bg)",
                fontSize: 13,
              }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="caps">Start</span>
              <input
                type="datetime-local"
                className="mono"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                }}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="caps">End</span>
              <input
                type="datetime-local"
                className="mono"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                }}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="caps">Kind</span>
              <select
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: 12,
                }}
                value={kind}
                onChange={(e) => setKind(e.target.value as Event["kind"])}
              >
                <option value="meeting">meeting</option>
                <option value="class">class</option>
                <option value="teach">teach</option>
                <option value="personal">personal</option>
                <option value="deadline">deadline</option>
                <option value="block">block</option>
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="caps">Location</span>
              <input
                className="mono"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                }}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
          </div>
          <div className="row gap-2" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!title.trim() || pending}
              onClick={() =>
                onSubmit({
                  title: title.trim(),
                  startTime: new Date(start),
                  endTime: new Date(end),
                  kind,
                  location: location.trim() || undefined,
                })
              }
            >
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
