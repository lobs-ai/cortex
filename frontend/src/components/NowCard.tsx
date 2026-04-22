"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type Commitment,
  type CommitmentEvent,
  type CommitmentNow,
  type SkipCategory,
} from "@/lib/api";
import { Icon } from "./Icon";

// The dashboard's interactive commitment panel. One active row with a
// primary response (Doing / Done / Skip) plus a More menu (Reschedule,
// Waiting on, Add note). A timeline of every event on the commitment
// renders underneath so the card reads like a journal thread — updates
// you leave here feed tomorrow's plan.
export function NowCard() {
  const qc = useQueryClient();
  const { data } = useQuery<CommitmentNow>({
    queryKey: ["commitments-now"],
    queryFn: () => api.commitments.now(),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const current = data?.current ?? null;
  const upcoming = data?.upcoming ?? [];
  const today = data?.today ?? { done: 0, skipped: 0, missed: 0, total: 0 };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commitments-now"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (current) qc.invalidateQueries({ queryKey: ["commitment-events", current.id] });
  };

  const ack = useMutation({
    mutationFn: (id: string) => api.commitments.ack(id),
    onSuccess: invalidate,
  });
  const done = useMutation({
    mutationFn: ({ id, artifact }: { id: string; artifact?: string }) =>
      api.commitments.done(id, artifact),
    onSuccess: invalidate,
  });
  const skip = useMutation({
    mutationFn: ({
      id,
      reason,
      category,
    }: {
      id: string;
      reason: string;
      category: SkipCategory;
    }) => api.commitments.skip(id, reason, category),
    onSuccess: invalidate,
  });
  const note = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.commitments.note(id, text),
    onSuccess: invalidate,
  });
  const wait = useMutation({
    mutationFn: ({
      id,
      waitingOn,
      until,
    }: {
      id: string;
      waitingOn: string;
      until?: Date | null;
    }) => api.commitments.wait(id, waitingOn, until),
    onSuccess: invalidate,
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api.commitments.unblock(id),
    onSuccess: invalidate,
  });
  const reschedule = useMutation({
    mutationFn: ({
      id,
      startTime,
      durationMin,
    }: {
      id: string;
      startTime: Date;
      durationMin?: number;
    }) => api.commitments.reschedule(id, startTime, durationMin),
    onSuccess: invalidate,
  });

  const pending =
    ack.isPending ||
    done.isPending ||
    skip.isPending ||
    note.isPending ||
    wait.isPending ||
    unblock.isPending ||
    reschedule.isPending;

  if (!current && upcoming.length === 0) {
    return (
      <div className="panel">
        <div className="panel-hd">
          <span className="title">
            <b>Now</b> · commitment
          </span>
          <TodayChip today={today} />
        </div>
        <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
          No commitments queued. Regenerate the plan to get Cortex to slot some
          activation-sized chunks.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="title">
          <b>Now</b> · commitment
        </span>
        <TodayChip today={today} />
      </div>
      {current ? (
        <ActiveCommitment
          c={current}
          pending={pending}
          onAck={() => ack.mutate(current.id)}
          onDone={(artifact) => done.mutate({ id: current.id, artifact })}
          onSkip={(reason, category) => skip.mutate({ id: current.id, reason, category })}
          onNote={(text) => note.mutate({ id: current.id, text })}
          onWait={(waitingOn, until) => wait.mutate({ id: current.id, waitingOn, until })}
          onUnblock={() => unblock.mutate(current.id)}
          onReschedule={(startTime, durationMin) =>
            reschedule.mutate({ id: current.id, startTime, durationMin })
          }
        />
      ) : (
        <div style={{ padding: 14, fontSize: 12 }} className="muted">
          Nothing due right now. Next up:
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ borderTop: "1px solid var(--hair)" }}>
          <div
            className="caps"
            style={{ padding: "8px 14px 4px", fontSize: 10, color: "var(--muted)" }}
          >
            Upcoming today
          </div>
          {upcoming.map((c) => (
            <UpcomingRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

type Mode =
  | { kind: "idle" }
  | { kind: "done" }
  | { kind: "skip" }
  | { kind: "note" }
  | { kind: "wait" }
  | { kind: "reschedule" };

function ActiveCommitment({
  c,
  pending,
  onAck,
  onDone,
  onSkip,
  onNote,
  onWait,
  onUnblock,
  onReschedule,
}: {
  c: Commitment;
  pending: boolean;
  onAck: () => void;
  onDone: (artifact?: string) => void;
  onSkip: (reason: string, category: SkipCategory) => void;
  onNote: (text: string) => void;
  onWait: (waitingOn: string, until?: Date | null) => void;
  onUnblock: () => void;
  onReschedule: (startTime: Date, durationMin?: number) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  useEffect(() => {
    setMode({ kind: "idle" });
  }, [c.id]);

  const isWaiting = c.state === "waiting";

  return (
    <div style={{ padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div className="row gap-2" style={{ fontSize: 11 }}>
          <StateBadge state={c.state} />
          <span className="mono muted">
            {fmtTime(c.startTime)} · {c.durationMin}m
          </span>
          {c.escalationLevel > 0 && !isWaiting && (
            <span className="caps" style={{ color: "var(--red)" }}>
              NAGGING
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{c.title}</div>
        {c.verifyCriterion && (
          <div className="muted" style={{ fontSize: 12 }}>
            Done means: {c.verifyCriterion}
          </div>
        )}
        {isWaiting && (
          <div
            style={{
              border: "1px solid var(--hair-2)",
              padding: "6px 8px",
              fontSize: 12,
              background: "var(--bg)",
            }}
          >
            <div className="caps" style={{ fontSize: 10 }}>
              waiting on
            </div>
            <div>
              {c.waitingOn ?? "external"}
              {c.waitingUntil && (
                <span className="muted mono" style={{ marginLeft: 6, fontSize: 11 }}>
                  until {new Date(c.waitingUntil).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {mode.kind === "idle" && (
        <>
          {isWaiting ? (
            <div className="row gap-2">
              <button className="btn primary" disabled={pending} onClick={onUnblock}>
                <Icon name="bolt" size={12} /> Unblocked — resume
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "note" })}>
                <Icon name="send" size={12} /> Add note
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "reschedule" })}>
                <Icon name="clock" size={12} /> Reschedule
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "skip" })}>
                <Icon name="x" size={12} /> Abandon
              </button>
            </div>
          ) : (
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <button
                className="btn primary"
                disabled={pending || c.state === "doing"}
                onClick={onAck}
              >
                <Icon name="bolt" size={12} /> Doing it
              </button>
              <button className="btn" disabled={pending} onClick={() => setMode({ kind: "done" })}>
                <Icon name="check" size={12} /> Done
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "skip" })}>
                <Icon name="x" size={12} /> Skip
              </button>
              <span style={{ width: 1, background: "var(--hair)", alignSelf: "stretch" }} />
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "reschedule" })}>
                <Icon name="clock" size={12} /> Reschedule
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "wait" })}>
                <Icon name="clock" size={12} /> Waiting on…
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode({ kind: "note" })}>
                <Icon name="send" size={12} /> Add note
              </button>
            </div>
          )}
        </>
      )}

      {mode.kind === "done" && (
        <DoneForm pending={pending} onCancel={() => setMode({ kind: "idle" })} onSubmit={onDone} />
      )}
      {mode.kind === "skip" && (
        <SkipForm pending={pending} onCancel={() => setMode({ kind: "idle" })} onSubmit={onSkip} />
      )}
      {mode.kind === "note" && (
        <NoteForm pending={pending} onCancel={() => setMode({ kind: "idle" })} onSubmit={onNote} />
      )}
      {mode.kind === "wait" && (
        <WaitForm pending={pending} onCancel={() => setMode({ kind: "idle" })} onSubmit={onWait} />
      )}
      {mode.kind === "reschedule" && (
        <RescheduleForm
          c={c}
          pending={pending}
          onCancel={() => setMode({ kind: "idle" })}
          onSubmit={onReschedule}
        />
      )}

      <Timeline commitmentId={c.id} />
    </div>
  );
}

function DoneForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (artifact?: string) => void;
}) {
  const [artifact, setArtifact] = useState("");
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        One-line artifact (what did you actually produce?)
      </label>
      <input
        className="mono"
        value={artifact}
        onChange={(e) => setArtifact(e.target.value)}
        placeholder="e.g. 3 paragraphs saved to draft.md"
        style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
        autoFocus
      />
      <div className="row gap-2">
        <button
          className="btn primary"
          disabled={pending || !artifact.trim()}
          onClick={() => onSubmit(artifact.trim())}
        >
          Record done
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const SKIP_CHOICES: { cat: SkipCategory; label: string; hint: string }[] = [
  { cat: "wrong_time", label: "Wrong time", hint: "too busy right now" },
  { cat: "too_tired", label: "Too tired", hint: "low energy" },
  { cat: "blocked", label: "Blocked", hint: "waiting on external" },
  { cat: "unclear", label: "Task unclear", hint: "too fuzzy to start" },
  { cat: "not_priority", label: "Not priority", hint: "shouldn't have planned this" },
  { cat: "other", label: "Other", hint: "free text below" },
];

function SkipForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (reason: string, category: SkipCategory) => void;
}) {
  const [category, setCategory] = useState<SkipCategory>("wrong_time");
  const [reason, setReason] = useState("");
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        Why? (feeds tomorrow&apos;s plan)
      </label>
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {SKIP_CHOICES.map((c) => (
          <button
            key={c.cat}
            className={`btn ${category === c.cat ? "primary" : "ghost"}`}
            style={{ fontSize: 11 }}
            onClick={() => setCategory(c.cat)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          SKIP_CHOICES.find((c) => c.cat === category)?.hint ?? "more context (optional)"
        }
        style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
      />
      <div className="row gap-2">
        <button className="btn" disabled={pending} onClick={() => onSubmit(reason.trim(), category)}>
          Record skip
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NoteForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        Note (progress, context, anything Cortex should know — no state change)
      </label>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 20m in, going well. Sarah replied, moving on."
        style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
        autoFocus
      />
      <div className="row gap-2">
        <button
          className="btn primary"
          disabled={pending || !text.trim()}
          onClick={() => onSubmit(text.trim())}
        >
          Save note
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WaitForm({
  pending,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (waitingOn: string, until?: Date | null) => void;
}) {
  const [who, setWho] = useState("");
  const [untilStr, setUntilStr] = useState("");
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        Who / what are you waiting on? (pauses the nag — doesn&apos;t count as a skip)
      </label>
      <input
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder="e.g. Sarah's review, Ben to approve, API deployment"
        style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
        autoFocus
      />
      <label className="muted" style={{ fontSize: 11 }}>
        Check back by (optional)
      </label>
      <input
        type="datetime-local"
        value={untilStr}
        onChange={(e) => setUntilStr(e.target.value)}
        style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
      />
      <div className="row gap-2">
        <button
          className="btn primary"
          disabled={pending || !who.trim()}
          onClick={() => onSubmit(who.trim(), untilStr ? new Date(untilStr) : null)}
        >
          Pause & wait
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RescheduleForm({
  c,
  pending,
  onCancel,
  onSubmit,
}: {
  c: Commitment;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (startTime: Date, durationMin?: number) => void;
}) {
  const now = new Date();
  const quicks: { label: string; dt: Date }[] = [
    { label: "+30 min", dt: new Date(+now + 30 * 60_000) },
    { label: "+2h", dt: new Date(+now + 2 * 3600_000) },
    { label: "Tonight 19:00", dt: atLocal(now, 19, 0) },
    { label: "Tomorrow 09:00", dt: atLocal(addDays(now, 1), 9, 0) },
  ];
  const [custom, setCustom] = useState("");
  const [duration, setDuration] = useState(c.durationMin);
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        Move to (pick a quick slot or set a custom time)
      </label>
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {quicks.map((q) => (
          <button
            key={q.label}
            className="btn ghost"
            disabled={pending}
            onClick={() => onSubmit(q.dt, duration)}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className="row gap-2">
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
        />
        <input
          type="number"
          min={5}
          max={180}
          value={duration}
          onChange={(e) => setDuration(Math.max(5, Math.min(180, parseInt(e.target.value || "0", 10) || 0)))}
          style={{ width: 80, border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12 }}
        />
        <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
          min
        </span>
      </div>
      <div className="row gap-2">
        <button
          className="btn primary"
          disabled={pending || !custom}
          onClick={() => onSubmit(new Date(custom), duration)}
        >
          Move to custom time
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Timeline({ commitmentId }: { commitmentId: string }) {
  const { data } = useQuery<CommitmentEvent[]>({
    queryKey: ["commitment-events", commitmentId],
    queryFn: () => api.commitments.events(commitmentId),
    refetchInterval: 30_000,
  });
  const events = data ?? [];
  if (events.length === 0) return null;
  return (
    <div style={{ borderTop: "1px solid var(--hair)", paddingTop: 8, marginTop: 4 }}>
      <div className="caps" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
        Timeline
      </div>
      <div className="col" style={{ gap: 4 }}>
        {events.map((e) => (
          <div key={e.id} className="row gap-2" style={{ fontSize: 11.5 }}>
            <span className="mono muted" style={{ minWidth: 46 }}>
              {fmtTime(e.at)}
            </span>
            <span>{renderEvent(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderEvent(e: CommitmentEvent): string {
  const p = e.payload ?? {};
  switch (e.kind) {
    case "prompt_sent":
      return (p as { escalationLevel?: number }).escalationLevel
        ? "Nagged (second ping)"
        : "Prompted to start";
    case "ack":
      return "You started";
    case "done":
      return (p as { artifact?: string }).artifact
        ? `Done — ${(p as { artifact?: string }).artifact}`
        : "Marked done";
    case "skipped": {
      const payload = p as { reason?: string; category?: string };
      const cat = payload.category ? ` [${payload.category}]` : "";
      return `Skipped${cat}${payload.reason ? ` — ${payload.reason}` : ""}`;
    }
    case "missed":
      return "Missed (no response)";
    case "note":
      return `Note — ${(p as { text?: string }).text ?? ""}`;
    case "waiting": {
      const payload = p as { waitingOn?: string; until?: string };
      return `Waiting on ${payload.waitingOn ?? "external"}${
        payload.until ? ` (until ${new Date(payload.until).toLocaleString()})` : ""
      }`;
    }
    case "unblocked":
      return "Unblocked — resumed";
    case "rescheduled": {
      const payload = p as { to?: string; durationMin?: number };
      return `Rescheduled → ${payload.to ? new Date(payload.to).toLocaleString() : "later"}${
        payload.durationMin ? ` (${payload.durationMin}m)` : ""
      }`;
    }
    case "unblock_check_asked":
      return "Asked: still waiting?";
    case "verify_asked":
      return "Asked: did you finish?";
    default:
      return e.kind;
  }
}

function UpcomingRow({ c }: { c: Commitment }) {
  return (
    <div
      style={{
        padding: "8px 14px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        borderBottom: "1px solid var(--hair)",
      }}
    >
      <span className="mono muted" style={{ fontSize: 11 }}>
        {fmtTime(c.startTime)}
      </span>
      <div>
        <div style={{ fontSize: 12.5 }}>{c.title}</div>
        {c.verifyCriterion && (
          <div className="muted" style={{ fontSize: 10.5 }}>
            {c.verifyCriterion}
          </div>
        )}
      </div>
      <span className="mono muted" style={{ fontSize: 10.5 }}>
        {c.durationMin}m
      </span>
    </div>
  );
}

function TodayChip({
  today,
}: {
  today: { done: number; skipped: number; missed: number; total: number };
}) {
  return (
    <span className="mono muted" style={{ fontSize: 11 }}>
      {today.done}/{today.total} done · {today.skipped + today.missed} slipped
    </span>
  );
}

function StateBadge({ state }: { state: Commitment["state"] }) {
  const map: Record<Commitment["state"], { label: string; color: string }> = {
    pending: { label: "PENDING", color: "var(--muted)" },
    prompted: { label: "GO NOW", color: "var(--amber)" },
    doing: { label: "IN PROGRESS", color: "var(--green)" },
    waiting: { label: "WAITING", color: "var(--amber)" },
    done: { label: "DONE", color: "var(--green)" },
    skipped: { label: "SKIPPED", color: "var(--muted)" },
    missed: { label: "MISSED", color: "var(--red)" },
    rescheduled: { label: "MOVED", color: "var(--muted)" },
  };
  const { label, color } = map[state];
  return (
    <span className="caps" style={{ color, fontSize: 10 }}>
      {label}
    </span>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function atLocal(d: Date, h: number, m: number): Date {
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
