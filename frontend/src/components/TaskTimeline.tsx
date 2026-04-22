"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Task, type TaskEvent } from "@/lib/api";
import { Icon } from "./Icon";

// Drawer-style panel for inspecting and acting on a single task. Shows the
// full task_events timeline plus every state-machine action the task
// supports given its current state. Mirrors the commitment timeline idea
// — every touch is journaled, and the journal is fuel for the agent.
export function TaskTimeline({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: events = [] } = useQuery<TaskEvent[]>({
    queryKey: ["task-events", task.id],
    queryFn: () => api.tasks.events(task.id),
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task-events", task.id] });
  };

  const triage = useMutation({
    mutationFn: (to: "today" | "doing" | "inbox") => api.tasks.triage(task.id, to),
    onSuccess: invalidate,
  });
  const snooze = useMutation({
    mutationFn: (until: Date) => api.tasks.snooze(task.id, until),
    onSuccess: invalidate,
  });
  const block = useMutation({
    mutationFn: ({ reason, until }: { reason: string; until?: Date | null }) =>
      api.tasks.block(task.id, reason, until),
    onSuccess: invalidate,
  });
  const unblock = useMutation({
    mutationFn: () => api.tasks.unblock(task.id),
    onSuccess: invalidate,
  });
  const abandon = useMutation({
    mutationFn: (reason: string) => api.tasks.abandon(task.id, reason),
    onSuccess: invalidate,
  });
  const complete = useMutation({
    mutationFn: (outcome?: string) => api.tasks.complete(task.id, outcome),
    onSuccess: invalidate,
  });
  const revive = useMutation({
    mutationFn: () => api.tasks.revive(task.id),
    onSuccess: invalidate,
  });
  const note = useMutation({
    mutationFn: (text: string) => api.tasks.note(task.id, text),
    onSuccess: invalidate,
  });

  const [mode, setMode] = useState<
    "idle" | "snooze" | "block" | "abandon" | "complete" | "note"
  >("idle");
  const [textInput, setTextInput] = useState("");
  const [secondInput, setSecondInput] = useState("");

  useEffect(() => {
    setMode("idle");
    setTextInput("");
    setSecondInput("");
  }, [task.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pending =
    triage.isPending ||
    snooze.isPending ||
    block.isPending ||
    unblock.isPending ||
    abandon.isPending ||
    complete.isPending ||
    revive.isPending ||
    note.isPending;

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
        style={{
          width: 560,
          maxWidth: "92vw",
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--panel)",
        }}
      >
        <div className="panel-hd">
          <span className="title">
            <b>Task</b> · {task.title}
          </span>
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div className="row gap-2" style={{ fontSize: 11 }}>
              <StatusBadge status={task.status} />
              <span className="mono muted">{task.priority}</span>
              {task.due && (
                <span className="mono muted">
                  due {new Date(task.due).toLocaleDateString()}
                </span>
              )}
              {task.estMin && <span className="mono muted">est {task.estMin}m</span>}
              {typeof task.skipCount === "number" && task.skipCount > 0 && (
                <span className="mono" style={{ color: "var(--red)" }}>
                  skips: {task.skipCount}
                </span>
              )}
            </div>
            {task.description && (
              <div className="muted" style={{ fontSize: 12 }}>
                {task.description}
              </div>
            )}
            {task.status === "blocked" && (
              <div
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  fontSize: 12,
                  background: "var(--bg)",
                }}
              >
                <div className="caps" style={{ fontSize: 10 }}>
                  blocked on
                </div>
                <div>
                  {task.blockedOn ?? "external"}
                  {task.blockedUntil && (
                    <span className="muted mono" style={{ marginLeft: 6, fontSize: 11 }}>
                      until {new Date(task.blockedUntil).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            )}
            {task.status === "snoozed" && task.snoozeUntil && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Wakes {new Date(task.snoozeUntil).toLocaleString()}
              </div>
            )}
            {task.status === "abandoned" && task.abandonReason && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Abandoned: {task.abandonReason}
              </div>
            )}
            {task.status === "done" && task.outcome && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Outcome: {task.outcome}
              </div>
            )}
            {task.status === "merged" && task.canonicalTaskId && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Merged into {task.canonicalTaskId}
              </div>
            )}
          </div>

          {mode === "idle" && (
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {/* Playable → terminal */}
              {(task.status === "inbox" ||
                task.status === "today" ||
                task.status === "doing") && (
                <>
                  {task.status !== "today" && (
                    <button
                      className="btn primary"
                      disabled={pending}
                      onClick={() => triage.mutate("today")}
                    >
                      <Icon name="bolt" size={11} /> Plan today
                    </button>
                  )}
                  {task.status !== "doing" && (
                    <button
                      className="btn"
                      disabled={pending}
                      onClick={() => triage.mutate("doing")}
                    >
                      In progress
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={pending}
                    onClick={() => setMode("complete")}
                  >
                    <Icon name="check" size={11} /> Mark done
                  </button>
                  <button className="btn ghost" disabled={pending} onClick={() => setMode("snooze")}>
                    <Icon name="clock" size={11} /> Snooze
                  </button>
                  <button className="btn ghost" disabled={pending} onClick={() => setMode("block")}>
                    Block
                  </button>
                  <button className="btn ghost" disabled={pending} onClick={() => setMode("abandon")}>
                    <Icon name="x" size={11} /> Abandon
                  </button>
                </>
              )}
              {task.status === "blocked" && (
                <>
                  <button
                    className="btn primary"
                    disabled={pending}
                    onClick={() => unblock.mutate()}
                  >
                    <Icon name="bolt" size={11} /> Unblock
                  </button>
                  <button
                    className="btn ghost"
                    disabled={pending}
                    onClick={() => setMode("abandon")}
                  >
                    Abandon
                  </button>
                </>
              )}
              {task.status === "snoozed" && (
                <>
                  <button
                    className="btn primary"
                    disabled={pending}
                    onClick={() => triage.mutate("inbox")}
                  >
                    Wake now
                  </button>
                  <button
                    className="btn ghost"
                    disabled={pending}
                    onClick={() => setMode("abandon")}
                  >
                    Abandon
                  </button>
                </>
              )}
              {task.status === "stale" && (
                <>
                  <button className="btn primary" disabled={pending} onClick={() => revive.mutate()}>
                    Revive
                  </button>
                  <button
                    className="btn ghost"
                    disabled={pending}
                    onClick={() => setMode("abandon")}
                  >
                    Abandon
                  </button>
                </>
              )}
              {(task.status === "abandoned" || task.status === "merged") && (
                <button className="btn primary" disabled={pending} onClick={() => revive.mutate()}>
                  Revive
                </button>
              )}
              <button className="btn ghost" disabled={pending} onClick={() => setMode("note")}>
                <Icon name="send" size={11} /> Add note
              </button>
            </div>
          )}

          {mode === "snooze" && (
            <FormInputRow
              label="Snooze until (datetime)"
              type="datetime-local"
              value={textInput}
              onChange={setTextInput}
              primary="Snooze"
              onSubmit={() => {
                snooze.mutate(new Date(textInput));
                setMode("idle");
                setTextInput("");
              }}
              onCancel={() => setMode("idle")}
              disabled={pending || !textInput}
            />
          )}
          {mode === "block" && (
            <div className="col gap-2">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Blocked on (who / what)"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                }}
                autoFocus
              />
              <input
                type="datetime-local"
                value={secondInput}
                onChange={(e) => setSecondInput(e.target.value)}
                placeholder="Check back by (optional)"
                style={{
                  border: "1px solid var(--hair-2)",
                  padding: "6px 8px",
                  background: "var(--bg)",
                  fontSize: 12,
                }}
              />
              <div className="row gap-2">
                <button
                  className="btn primary"
                  disabled={pending || !textInput.trim()}
                  onClick={() => {
                    block.mutate({
                      reason: textInput.trim(),
                      until: secondInput ? new Date(secondInput) : null,
                    });
                    setMode("idle");
                    setTextInput("");
                    setSecondInput("");
                  }}
                >
                  Mark blocked
                </button>
                <button className="btn ghost" onClick={() => setMode("idle")}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {mode === "abandon" && (
            <FormInputRow
              label="Reason for abandoning"
              placeholder="e.g. no longer relevant, covered by other work"
              value={textInput}
              onChange={setTextInput}
              primary="Confirm abandon"
              onSubmit={() => {
                abandon.mutate(textInput.trim());
                setMode("idle");
                setTextInput("");
              }}
              onCancel={() => setMode("idle")}
              disabled={pending || !textInput.trim()}
            />
          )}
          {mode === "complete" && (
            <FormInputRow
              label="Outcome (what did you deliver?)"
              placeholder="e.g. shipped the draft, sent reply to Sarah"
              value={textInput}
              onChange={setTextInput}
              primary="Mark done"
              onSubmit={() => {
                complete.mutate(textInput.trim() || undefined);
                setMode("idle");
                setTextInput("");
              }}
              onCancel={() => setMode("idle")}
              disabled={pending}
            />
          )}
          {mode === "note" && (
            <FormInputRow
              label="Note (context, progress, anything — no state change)"
              placeholder="e.g. waiting on Sarah, tried approach X, failed"
              value={textInput}
              onChange={setTextInput}
              primary="Save note"
              onSubmit={() => {
                note.mutate(textInput.trim());
                setMode("idle");
                setTextInput("");
              }}
              onCancel={() => setMode("idle")}
              disabled={pending || !textInput.trim()}
            />
          )}

          <div style={{ borderTop: "1px solid var(--hair)", paddingTop: 8 }}>
            <div
              className="caps"
              style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}
            >
              Timeline ({events.length})
            </div>
            <div className="col" style={{ gap: 4 }}>
              {events.length === 0 && (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  No events yet.
                </div>
              )}
              {events.map((e) => (
                <div key={e.id} className="row gap-2" style={{ fontSize: 11.5 }}>
                  <span className="mono muted" style={{ minWidth: 100 }}>
                    {new Date(e.at).toLocaleString()}
                  </span>
                  <span>{renderEvent(e)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormInputRow({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  primary,
  disabled,
  type = "text",
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  primary: string;
  disabled: boolean;
  type?: string;
}) {
  return (
    <div className="col gap-2">
      <label className="muted" style={{ fontSize: 11 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          border: "1px solid var(--hair-2)",
          padding: "6px 8px",
          background: "var(--bg)",
          fontSize: 12,
        }}
        autoFocus
      />
      <div className="row gap-2">
        <button className="btn primary" disabled={disabled} onClick={onSubmit}>
          {primary}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const map: Record<Task["status"], { label: string; color: string }> = {
    inbox: { label: "INBOX", color: "var(--muted)" },
    today: { label: "TODAY", color: "var(--green)" },
    doing: { label: "DOING", color: "var(--green)" },
    done: { label: "DONE", color: "var(--muted)" },
    snoozed: { label: "SNOOZED", color: "var(--amber)" },
    blocked: { label: "BLOCKED", color: "var(--amber)" },
    abandoned: { label: "ABANDONED", color: "var(--red)" },
    merged: { label: "MERGED", color: "var(--muted)" },
    stale: { label: "STALE", color: "var(--red)" },
  };
  const { label, color } = map[status];
  return (
    <span className="caps" style={{ color, fontSize: 10 }}>
      {label}
    </span>
  );
}

function renderEvent(e: TaskEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "created":
      return `Created (status: ${String(p.status ?? "inbox")})`;
    case "triaged":
      return `Triaged → ${String(p.to ?? "?")}`;
    case "snoozed":
      return `Snoozed until ${p.until ? new Date(String(p.until)).toLocaleString() : "—"}`;
    case "awoken":
      return "Snooze expired — back in inbox";
    case "blocked":
      return `Blocked on ${String(p.reason ?? "external")}${
        p.until ? ` (until ${new Date(String(p.until)).toLocaleString()})` : ""
      }`;
    case "unblocked":
      return "Unblocked — back in inbox";
    case "abandoned":
      return `Abandoned — ${String(p.reason ?? "")}`;
    case "merged":
      return p.canonicalId
        ? `Merged into ${String(p.canonicalTitle ?? p.canonicalId)}`
        : `Absorbed duplicate ${String(p.absorbedTitle ?? p.absorbedId ?? "")}`;
    case "marked_stale":
      return `Marked stale (${String(p.reason ?? "")})`;
    case "revived":
      return "Revived";
    case "done":
      return p.outcome ? `Done — ${String(p.outcome)}` : "Done";
    case "note":
      return `Note — ${String(p.text ?? p.via ?? "")}`;
    case "updated": {
      const s = p.status as { from?: string; to?: string } | undefined;
      if (s?.from && s?.to) return `Status ${s.from} → ${s.to}`;
      const keys = Object.keys(p);
      return `Updated ${keys.join(", ")}`;
    }
    default:
      return e.kind;
  }
}
