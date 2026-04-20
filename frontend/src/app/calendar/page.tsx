"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Event, type JournalEntry } from "@/lib/api";
import { fmtHM, fmtDateShort, fmtWeekday } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";

type View = "day" | "week" | "month";

// Full 24-hour day, 48 px per row. The grid scrolls.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_PX = 48;
const GRID_HEIGHT = HOURS.length * HOUR_PX;

export default function CalendarPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("cal-view");
      if (saved === "day" || saved === "week" || saved === "month") return saved;
    }
    return "day";
  });
  const [offset, setOffset] = useState(0); // days from today
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);

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

  const { data: journal = [] } = useQuery({
    queryKey: ["journal", "reflection", rangeFrom.toISOString(), rangeTo.toISOString()],
    queryFn: () => api.journal.list({ kind: "reflection", from: rangeFrom, to: rangeTo, limit: 200 }),
  });

  const reflectionsByEvent = useMemo(() => {
    const m = new Map<string, JournalEntry>();
    for (const j of journal) {
      if (j.eventId && j.kind === "reflection") m.set(j.eventId, j);
    }
    return m;
  }, [journal]);

  const rsvp = useMutation({
    mutationFn: ({ id, response }: { id: string; response: "accepted" | "declined" | "tentative" }) =>
      api.events.rsvp(id, response),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });

  const pendingInvites = events.filter((e) => e.rsvpStatus === "needsAction");

  const createEvent = useMutation({
    mutationFn: (body: { title: string; startTime: Date; endTime: Date; kind: Event["kind"]; location?: string }) =>
      api.events.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setShowCreate(false);
    },
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.events.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setSelected(null);
    },
  });

  const rescheduleEvent = useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: Date; end: Date }) =>
      api.events.patch(id, { startTime: start, endTime: end }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setSelected(updated);
    },
  });

  const eventsByDay = useMemo(() => {
    const m = new Map<number, Event[]>();
    for (const e of events) {
      if (isAllDay(e)) {
        const startKey = allDayLocalKey(new Date(e.start));
        let endKey = allDayLocalKey(new Date(e.end));
        // A 0-duration "date marker" still occupies one day on the calendar.
        if (endKey <= startKey) {
          const d = new Date(startKey);
          d.setDate(d.getDate() + 1);
          endKey = +d;
        }
        for (const d = new Date(startKey); +d < endKey; d.setDate(d.getDate() + 1)) {
          const key = +d;
          const arr = m.get(key) ?? [];
          arr.push(e);
          m.set(key, arr);
        }
      } else {
        const s = new Date(e.start);
        s.setHours(0, 0, 0, 0);
        const key = +s;
        const arr = m.get(key) ?? [];
        arr.push(e);
        m.set(key, arr);
      }
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
            <button key={v} data-active={view === v} onClick={() => { setView(v); localStorage.setItem("cal-view", v); }}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={14} /> New event
        </button>
      </div>

      {pendingInvites.length > 0 && (
        <PendingInvitesStrip
          invites={pendingInvites}
          onRsvp={(id, response) => rsvp.mutate({ id, response })}
          busy={rsvp.isPending}
        />
      )}

      {view === "day" && (
        <DayGrid today={today} eventsByDay={eventsByDay} offset={offset} onSelect={setSelected} reflections={reflectionsByEvent} />
      )}
      {view === "week" && (
        <WeekGrid today={today} eventsByDay={eventsByDay} offset={offset} onSelect={setSelected} reflections={reflectionsByEvent} />
      )}
      {view === "month" && (
        <MonthView today={today} eventsByDay={eventsByDay} offset={offset} onSelect={setSelected} reflections={reflectionsByEvent} />
      )}

      {showCreate && (
        <NewEventModal
          defaultDate={today}
          onClose={() => setShowCreate(false)}
          onSubmit={(v) => createEvent.mutate(v)}
          pending={createEvent.isPending}
        />
      )}

      {selected && (
        <EventActionsModal
          event={selected}
          reflection={reflectionsByEvent.get(selected.id) ?? null}
          onClose={() => setSelected(null)}
          onDelete={() => deleteEvent.mutate(selected.id)}
          onReschedule={(start, end) => rescheduleEvent.mutate({ id: selected.id, start, end })}
          rescheduling={rescheduleEvent.isPending}
          rescheduleError={rescheduleEvent.error instanceof Error ? rescheduleEvent.error.message : null}
          busy={deleteEvent.isPending}
        />
      )}
    </div>
  );
}

function PendingInvitesStrip({
  invites,
  onRsvp,
  busy,
}: {
  invites: Event[];
  onRsvp: (id: string, response: "accepted" | "declined" | "tentative") => void;
  busy: boolean;
}) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--hair)",
        background: "color-mix(in oklch, var(--amber, #f59e0b), transparent 92%)",
        padding: "6px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div className="caps muted" style={{ fontSize: 10, marginBottom: 2 }}>
        {invites.length} invite{invites.length > 1 ? "s" : ""} — Cortex will auto-accept if no conflicts
      </div>
      {invites.map((ev) => (
        <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ flex: 1, fontWeight: 500 }} className="truncate">
            {ev.title}
          </span>
          <span className="muted mono" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>
            {fmtDateShort(new Date(ev.start))} {fmtHM(new Date(ev.start))}
          </span>
          <button
            className="btn"
            style={{ fontSize: 10.5, padding: "2px 8px" }}
            disabled={busy}
            onClick={() => onRsvp(ev.id, "declined")}
          >
            Decline
          </button>
          <button
            className="btn"
            style={{ fontSize: 10.5, padding: "2px 8px" }}
            disabled={busy}
            onClick={() => onRsvp(ev.id, "tentative")}
            title="Mark as tentative — or ask Cortex to propose a new time"
          >
            Propose time
          </button>
          <button
            className="btn ghost"
            style={{ fontSize: 10.5, padding: "2px 8px", opacity: 0.6 }}
            disabled={busy}
            onClick={() => onRsvp(ev.id, "accepted")}
          >
            Accept now
          </button>
        </div>
      ))}
    </div>
  );
}

function eventStyle(e: Event, base: Date) {
  const s = new Date(e.start);
  const t = new Date(e.end);
  const startMin = Math.max(0, (+s - +base) / 60000);
  const endMin = Math.min(24 * 60, (+t - +base) / 60000);
  const top = (startMin / 60) * HOUR_PX;
  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_PX);
  return { top, height };
}

// Pick the local-midnight day key for an all-day boundary timestamp. When the
// server and client share a timezone the event is stored at local midnight. When
// the server is UTC the event arrives as UTC-midnight and we should key by the
// UTC date (the nominal calendar date the event was created for), not the local
// date of the moment which may fall on the previous day.
function allDayLocalKey(d: Date): number {
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return +new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const local = new Date(d);
  local.setHours(0, 0, 0, 0);
  return +local;
}

function isAllDay(ev: Event): boolean {
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  const duration = +e - +s;
  if (duration < 0) return false;
  // Whole-day events land on midnight boundaries. Check both local and UTC so
  // we catch events serialized by a backend whose timezone differs from the
  // browser (e.g. backend in UTC, client in Detroit — events arrive at
  // "HH:00" where HH = the tz offset).
  const atLocalMidnight =
    s.getHours() === 0 &&
    s.getMinutes() === 0 &&
    s.getSeconds() === 0 &&
    e.getHours() === 0 &&
    e.getMinutes() === 0 &&
    e.getSeconds() === 0;
  const atUtcMidnight =
    s.getUTCHours() === 0 &&
    s.getUTCMinutes() === 0 &&
    s.getUTCSeconds() === 0 &&
    e.getUTCHours() === 0 &&
    e.getUTCMinutes() === 0 &&
    e.getUTCSeconds() === 0;
  // Duration of 0 covers Google "date-only" markers (e.g. "Classes end")
  // where the sync collapsed start and end to the same midnight instant.
  const wholeDays = duration === 0 || duration % 86_400_000 === 0;
  return wholeDays && (atLocalMidnight || atUtcMidnight);
}

type Positioned = { ev: Event; col: number; cols: number };

// Greedy column packing for overlapping events. Groups transitively-overlapping
// events, assigns each to the lowest-index column whose last event has ended,
// and gives every event in the group the same total column count so widths align.
function layoutColumns(events: Event[]): Positioned[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => {
    const as = +new Date(a.start);
    const bs = +new Date(b.start);
    if (as !== bs) return as - bs;
    return +new Date(a.end) - +new Date(b.end);
  });

  type Item = { ev: Event; col: number; end: number };
  const groups: Item[][] = [];
  let cur: Item[] = [];
  let curMaxEnd = 0;

  for (const ev of sorted) {
    const s = +new Date(ev.start);
    const e = +new Date(ev.end);
    if (cur.length > 0 && s < curMaxEnd) {
      let col = 0;
      while (cur.some((x) => x.col === col && x.end > s)) col++;
      cur.push({ ev, col, end: e });
      if (e > curMaxEnd) curMaxEnd = e;
    } else {
      if (cur.length) groups.push(cur);
      cur = [{ ev, col: 0, end: e }];
      curMaxEnd = e;
    }
  }
  if (cur.length) groups.push(cur);

  const out: Positioned[] = [];
  for (const g of groups) {
    const cols = Math.max(...g.map((x) => x.col)) + 1;
    for (const item of g) out.push({ ev: item.ev, col: item.col, cols });
  }
  return out;
}

function DayColumn({
  date,
  events,
  isToday,
  onSelect,
  reflections,
}: {
  date: Date;
  events: Event[];
  isToday: boolean;
  onSelect?: (ev: Event) => void;
  reflections?: Map<string, JournalEntry>;
}) {
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMin / 60) * HOUR_PX;

  const positioned = useMemo(
    () => layoutColumns(events.filter((e) => !isAllDay(e))),
    [events],
  );

  return (
    <div className="day-col" style={{ position: "relative", height: GRID_HEIGHT }}>
      {positioned.map(({ ev, col, cols }) => {
        const { top, height } = eventStyle(ev, date);
        const pending = ev.rsvpStatus === "needsAction";
        const ended = new Date(ev.end) < now;
        const reflection = reflections?.get(ev.id);
        const widthPct = 100 / cols;
        const positionStyle: React.CSSProperties =
          cols === 1
            ? {}
            : {
                left: `calc(${col * widthPct}% + 2px)`,
                right: "auto",
                width: `calc(${widthPct}% - 4px)`,
              };
        return (
          <button
            key={ev.id}
            type="button"
            onClick={() => onSelect?.(ev)}
            className={`evt clickable ${ev.kind}`}
            style={{
              top,
              height,
              ...positionStyle,
              ...(pending ? { borderStyle: "dashed", opacity: 0.8 } : {}),
            }}
          >
            <div className="t truncate">
              {ev.title}
              {reflection && <ReflectionBadge rating={reflection.rating} />}
              {!reflection && ended && !pending && <ReflectUnratedBadge />}
            </div>
            <div className="m">
              {fmtHM(new Date(ev.start))}–{fmtHM(new Date(ev.end))}
              {ev.location ? " · " + ev.location : ""}
              {pending ? " · pending" : ""}
            </div>
          </button>
        );
      })}
      {isToday && nowTop > 0 && nowTop < GRID_HEIGHT && (
        <div className="evt now-line" style={{ top: nowTop }} />
      )}
    </div>
  );
}

function AllDayStrip({
  days,
  eventsByDay,
  onSelect,
}: {
  days: Date[];
  eventsByDay: Map<number, Event[]>;
  onSelect?: (ev: Event) => void;
}) {
  const perDay = days.map((d) => (eventsByDay.get(+d) ?? []).filter(isAllDay));
  if (perDay.every((list) => list.length === 0)) return null;
  return (
    <div
      className="all-day-row"
      style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}
    >
      <div className="all-day-label caps muted">all day</div>
      {days.map((d, i) => (
        <div key={+d} className="all-day-col">
          {perDay[i].map((ev) => {
            const pending = ev.rsvpStatus === "needsAction";
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onSelect?.(ev)}
                className={`all-day-evt clickable ${ev.kind}`}
                style={pending ? { borderStyle: "dashed", opacity: 0.8 } : undefined}
                title={ev.title}
              >
                {ev.title}
              </button>
            );
          })}
        </div>
      ))}
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

// Re-render every minute so the now-line and "ended" checks stay fresh without
// requiring a page refresh. Aligns the tick to the next minute boundary.
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const msToNextMinute = 60000 - (Date.now() % 60000);
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
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
  onSelect,
  reflections,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
  onSelect?: (ev: Event) => void;
  reflections?: Map<string, JournalEntry>;
}) {
  const date = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d;
  }, [today, offset]);
  const events = eventsByDay.get(+date) ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScrollToNow(scrollRef);

  const isToday = +date === +today;
  return (
    <div className="col" style={{ minHeight: 0, overflow: "hidden" }}>
      <div
        className="week-hd"
        style={{ gridTemplateColumns: "48px 1fr" }}
      >
        <div />
        <div className={isToday ? "today" : ""}>
          <div className="caps">{fmtWeekday(date)}</div>
          <div className="num">{date.getDate()}</div>
        </div>
      </div>
      <AllDayStrip days={[date]} eventsByDay={eventsByDay} onSelect={onSelect} />
      <div className="day-grid" ref={scrollRef}>
        <HourColumn />
        <DayColumn date={date} events={events} isToday={isToday} onSelect={onSelect} reflections={reflections} />
      </div>
    </div>
  );
}

function WeekGrid({
  today,
  eventsByDay,
  offset,
  onSelect,
  reflections,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
  onSelect?: (ev: Event) => void;
  reflections?: Map<string, JournalEntry>;
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
  }, [today, offset]);
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
      <AllDayStrip days={days} eventsByDay={eventsByDay} onSelect={onSelect} />
      <div className="week-grid" ref={scrollRef}>
        <HourColumn />
        {days.map((d, i) => (
          <DayColumn
            key={i}
            date={d}
            events={eventsByDay.get(+d) ?? []}
            isToday={+d === +today}
            onSelect={onSelect}
            reflections={reflections}
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
  onSelect,
  reflections,
}: {
  today: Date;
  eventsByDay: Map<number, Event[]>;
  offset: number;
  onSelect?: (ev: Event) => void;
  reflections?: Map<string, JournalEntry>;
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
              {cellEvents.slice(0, 3).map((ev) => {
                const reflection = reflections?.get(ev.id);
                const allDay = isAllDay(ev);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onSelect?.(ev)}
                    className="month-evt clickable"
                    style={{ borderColor: kindToCss(ev.kind) }}
                  >
                    {allDay ? ev.title : `${fmtHM(new Date(ev.start))} ${ev.title}`}
                    {reflection && <ReflectionBadge rating={reflection.rating} />}
                  </button>
                );
              })}
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

function ReflectionBadge({ rating }: { rating: number | null }) {
  const label = rating == null ? "note" : `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
  const tone =
    rating == null
      ? "var(--muted)"
      : rating >= 4
        ? "var(--green)"
        : rating >= 3
          ? "var(--amber)"
          : "var(--red)";
  return (
    <span
      className="reflection-badge"
      title={rating == null ? "Reflection note" : `Rated ${rating}/5`}
      style={{ color: tone, borderColor: tone }}
    >
      {label}
    </span>
  );
}

function ReflectUnratedBadge() {
  return (
    <span
      className="reflection-badge prompt"
      title="Tap to reflect on how this went"
      style={{ color: "var(--muted)", borderColor: "var(--hair-2)" }}
    >
      how&apos;d it go?
    </span>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

function EventActionsModal({
  event,
  reflection,
  onClose,
  onDelete,
  onReschedule,
  rescheduling,
  rescheduleError,
  busy,
}: {
  event: Event;
  reflection: JournalEntry | null;
  onClose: () => void;
  onDelete: () => void;
  onReschedule: (start: Date, end: Date) => void;
  rescheduling: boolean;
  rescheduleError: string | null;
  busy: boolean;
}) {
  const qc = useQueryClient();
  const ended = new Date(event.end) < new Date();
  const [mode, setMode] = useState<"menu" | "reschedule" | "ask" | "confirmDelete" | "reflect">(
    () => (ended && !reflection ? "reflect" : "menu"),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [reflectRating, setReflectRating] = useState<number | null>(reflection?.rating ?? null);
  const [reflectNote, setReflectNote] = useState(reflection?.note ?? "");
  const saveReflection = useMutation({
    mutationFn: async () => {
      if (reflection) {
        return api.journal.patch(reflection.id, { rating: reflectRating, note: reflectNote });
      }
      return api.journal.create({
        kind: "reflection",
        eventId: event.id,
        rating: reflectRating,
        note: reflectNote,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal"] });
      setMode("menu");
    },
  });
  const removeReflection = useMutation({
    mutationFn: async () => {
      if (!reflection) return;
      await api.journal.remove(reflection.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal"] });
      setReflectRating(null);
      setReflectNote("");
      setMode("menu");
    },
  });
  const [start, setStart] = useState(() => toLocalInputValue(new Date(event.start)));
  const [end, setEnd] = useState(() => toLocalInputValue(new Date(event.end)));
  const [askReply, setAskReply] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // Keep the datetime inputs in sync with the event after a successful reschedule.
  useEffect(() => {
    setStart(toLocalInputValue(new Date(event.start)));
    setEnd(toLocalInputValue(new Date(event.end)));
  }, [event.start, event.end]);

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--hair-2)",
    padding: "6px 8px",
    background: "var(--bg)",
    fontSize: 12,
  };

  const askAgent = async () => {
    setMode("ask");
    setAskReply(null);
    setAskError(null);
    setAsking(true);
    const when = `${fmtDateShort(new Date(event.start))} ${fmtHM(new Date(event.start))}–${fmtHM(new Date(event.end))}`;
    const prompt = `Suggest a better time for my event "${event.title}" (currently ${when}). Consider my existing commitments. Reply with 1–3 specific time options, each on its own line in the format "YYYY-MM-DD HH:MM–HH:MM — rationale". Do not modify anything.`;
    try {
      const res = await api.chat.send(prompt);
      setAskReply(res.message.content);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  };

  const disabled = busy || rescheduling || asking;

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
        style={{ width: 460, maxWidth: "92vw", background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title truncate" style={{ minWidth: 0 }}>
            <b>{event.title}</b>
          </span>
          <button className="btn ghost" onClick={onClose} disabled={disabled}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <div className="mono muted" style={{ fontSize: 11.5 }}>
            {fmtDateShort(new Date(event.start))} · {fmtHM(new Date(event.start))}–
            {fmtHM(new Date(event.end))}
            {event.location ? ` · ${event.location}` : ""}
          </div>

          {mode === "menu" && (
            <div className="col" style={{ gap: 6 }}>
              {ended && (
                <button className="btn" onClick={() => setMode("reflect")} disabled={disabled}>
                  {reflection ? "Edit reflection" : "How'd it go?"}
                </button>
              )}
              <button className="btn" onClick={askAgent} disabled={disabled}>
                Ask Cortex to suggest a new time
              </button>
              <button className="btn" onClick={() => setMode("reschedule")} disabled={disabled}>
                Reschedule…
              </button>
              <button
                className="btn"
                style={{ color: "var(--red)", borderColor: "var(--red)" }}
                onClick={() => setMode("confirmDelete")}
                disabled={disabled}
              >
                Delete event
              </button>
            </div>
          )}

          {mode === "reflect" && (
            <>
              <div className="caps" style={{ fontSize: 10 }}>How&apos;d it go?</div>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="btn"
                    data-active={reflectRating === n}
                    onClick={() => setReflectRating(reflectRating === n ? null : n)}
                    style={{
                      width: 32,
                      justifyContent: "center",
                      padding: 0,
                      fontSize: 14,
                      ...(reflectRating === n
                        ? {
                            background: "var(--text)",
                            color: "var(--bg)",
                            borderColor: "var(--text)",
                          }
                        : {}),
                    }}
                    title={`${n}/5`}
                  >
                    {n}
                  </button>
                ))}
                <span className="muted mono" style={{ fontSize: 10.5, marginLeft: 6 }}>
                  {reflectRating == null
                    ? "no rating"
                    : reflectRating <= 2
                      ? "rough"
                      : reflectRating === 3
                        ? "fine"
                        : "great"}
                </span>
              </div>
              <textarea
                placeholder="What happened, how did it feel, what next?"
                value={reflectNote}
                onChange={(e) => setReflectNote(e.target.value)}
                rows={4}
                className="mono"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                  resize: "vertical",
                }}
              />
              {saveReflection.error instanceof Error && (
                <div style={{ color: "var(--red)", fontSize: 11.5 }}>{saveReflection.error.message}</div>
              )}
              <div className="row gap-2" style={{ justifyContent: "space-between" }}>
                <div className="row gap-2">
                  {reflection && (
                    <button
                      className="btn"
                      style={{ color: "var(--red)", borderColor: "color-mix(in oklch, var(--red), transparent 70%)" }}
                      disabled={disabled || removeReflection.isPending}
                      onClick={() => removeReflection.mutate()}
                    >
                      {removeReflection.isPending ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
                <div className="row gap-2">
                  <button className="btn ghost" onClick={() => setMode("menu")} disabled={disabled}>
                    Back
                  </button>
                  <button
                    className="btn primary"
                    disabled={disabled || saveReflection.isPending || (reflectRating == null && !reflectNote.trim())}
                    onClick={() => saveReflection.mutate()}
                  >
                    {saveReflection.isPending ? "Saving…" : reflection ? "Save" : "Log reflection"}
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === "reschedule" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label className="col" style={{ gap: 4 }}>
                  <span className="caps">Start</span>
                  <input
                    type="datetime-local"
                    className="mono"
                    style={inputStyle}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label className="col" style={{ gap: 4 }}>
                  <span className="caps">End</span>
                  <input
                    type="datetime-local"
                    className="mono"
                    style={inputStyle}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </div>
              {rescheduleError && (
                <div style={{ color: "var(--red)", fontSize: 11.5 }}>{rescheduleError}</div>
              )}
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setMode("menu")} disabled={disabled}>
                  Back
                </button>
                <button
                  className="btn primary"
                  disabled={disabled || !start || !end || new Date(end) <= new Date(start)}
                  onClick={() => onReschedule(new Date(start), new Date(end))}
                >
                  {rescheduling ? "Moving…" : "Move event"}
                </button>
              </div>
            </>
          )}

          {mode === "ask" && (
            <>
              <div
                style={{
                  border: "1px solid var(--hair)",
                  background: "var(--bg)",
                  padding: "8px 10px",
                  fontSize: 12,
                  minHeight: 80,
                  maxHeight: 260,
                  overflow: "auto",
                }}
              >
                {asking && <span className="muted">Cortex is thinking…</span>}
                {!asking && askError && (
                  <span style={{ color: "var(--red)" }}>{askError}</span>
                )}
                {!asking && !askError && askReply && <Markdown>{askReply}</Markdown>}
              </div>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setMode("menu")} disabled={disabled}>
                  Back
                </button>
                <button
                  className="btn"
                  disabled={disabled || !askReply}
                  onClick={() => setMode("reschedule")}
                >
                  Reschedule…
                </button>
              </div>
            </>
          )}

          {mode === "confirmDelete" && (
            <>
              <div style={{ fontSize: 12 }}>
                Delete this event? This cannot be undone.
              </div>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setMode("menu")} disabled={disabled}>
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{ color: "var(--red)", borderColor: "var(--red)" }}
                  disabled={disabled}
                  onClick={onDelete}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
