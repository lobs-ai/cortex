"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Alert, type Task } from "@/lib/api";
import { Icon } from "./Icon";

// Forces a decision on rows the gardener has flagged — captured-but-
// untriaged, or gone stale from inactivity. For each row: Plan (→ today),
// Snooze, or Abandon. Dismissing is not an option — the card stays until
// the row is decided on. This is the "inbox zero" pressure the old task
// list was missing.
export function TriageCard() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.tasks.list(),
    refetchInterval: 30_000,
  });
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["notifications"],
    queryFn: () => api.notifications.list(),
    refetchInterval: 30_000,
  });
  const dupAlerts = useMemo(
    () => alerts.filter((a) => a.kind === "task.dup"),
    [alerts],
  );

  const captured = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "inbox" && !t.triagedAt)
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")),
    [tasks],
  );
  const stale = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "stale")
        .sort((a, b) => (a.staleAt ?? "").localeCompare(b.staleAt ?? "")),
    [tasks],
  );

  const triage = useMutation({
    mutationFn: ({ id, to }: { id: string; to: "today" | "doing" | "inbox" }) =>
      api.tasks.triage(id, to),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: Date }) => api.tasks.snooze(id, until),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const abandon = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.tasks.abandon(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const revive = useMutation({
    mutationFn: (id: string) => api.tasks.revive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const actOnAlert = useMutation({
    mutationFn: ({ id, op }: { id: string; op: string }) => api.notifications.act(id, op),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (captured.length === 0 && stale.length === 0 && dupAlerts.length === 0) {
    return null;
  }

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="title">
          <b>Triage</b> · decide or lose it
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {captured.length} captured · {stale.length} stale
          {dupAlerts.length > 0 ? ` · ${dupAlerts.length} dupes` : ""}
        </span>
      </div>
      {dupAlerts.length > 0 && (
        <div style={{ borderBottom: "1px solid var(--hair)" }}>
          <div
            className="caps"
            style={{ padding: "8px 14px 4px", fontSize: 10, color: "var(--muted)" }}
          >
            Possible duplicates ({dupAlerts.length})
          </div>
          {dupAlerts.map((a) => (
            <div
              key={a.id}
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--hair)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5 }}>{a.title.replace(/^Possible duplicate: /, "")}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {a.body}
              </div>
              <div className="row gap-2">
                <button
                  className="btn primary"
                  disabled={actOnAlert.isPending}
                  onClick={() => actOnAlert.mutate({ id: a.id, op: "task.merge_into_canonical" })}
                >
                  Merge
                </button>
                <button
                  className="btn"
                  disabled={actOnAlert.isPending}
                  onClick={() => actOnAlert.mutate({ id: a.id, op: "task.keep" })}
                >
                  Keep both
                </button>
                <button
                  className="btn ghost"
                  disabled={actOnAlert.isPending}
                  onClick={() => actOnAlert.mutate({ id: a.id, op: "task.abandon_open" })}
                >
                  Abandon this one
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        {captured.map((t) => (
          <TriageRow
            key={t.id}
            t={t}
            label="CAPTURED"
            onPlan={() => triage.mutate({ id: t.id, to: "today" })}
            onSnooze={(until) => snooze.mutate({ id: t.id, until })}
            onAbandon={(reason) => abandon.mutate({ id: t.id, reason })}
          />
        ))}
        {stale.map((t) => (
          <TriageRow
            key={t.id}
            t={t}
            label="STALE"
            onPlan={() => revive.mutate(t.id)}
            onSnooze={(until) => snooze.mutate({ id: t.id, until })}
            onAbandon={(reason) => abandon.mutate({ id: t.id, reason })}
          />
        ))}
      </div>
    </div>
  );
}

function TriageRow({
  t,
  label,
  onPlan,
  onSnooze,
  onAbandon,
}: {
  t: Task;
  label: string;
  onPlan: () => void;
  onSnooze: (until: Date) => void;
  onAbandon: (reason: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "snooze" | "abandon">("idle");
  const [abandonReason, setAbandonReason] = useState("");
  const [snoozeStr, setSnoozeStr] = useState("");

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--hair)",
        display: "grid",
        gap: 6,
      }}
    >
      <div className="row gap-2" style={{ alignItems: "baseline" }}>
        <span className="caps" style={{ fontSize: 10, color: "var(--muted)" }}>
          {label}
        </span>
        <span style={{ fontSize: 13 }}>{t.title}</span>
        <span className="mono muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
          {t.priority}
          {t.due ? ` · due ${new Date(t.due).toLocaleDateString()}` : ""}
        </span>
      </div>
      {mode === "idle" && (
        <div className="row gap-2">
          <button className="btn primary" onClick={onPlan}>
            <Icon name="bolt" size={11} /> Plan for today
          </button>
          <button className="btn" onClick={() => setMode("snooze")}>
            <Icon name="clock" size={11} /> Snooze
          </button>
          <button className="btn ghost" onClick={() => setMode("abandon")}>
            <Icon name="x" size={11} /> Abandon
          </button>
        </div>
      )}
      {mode === "snooze" && (
        <SnoozeControls
          onCancel={() => setMode("idle")}
          onSubmit={(d) => {
            onSnooze(d);
            setMode("idle");
          }}
          customValue={snoozeStr}
          setCustomValue={setSnoozeStr}
        />
      )}
      {mode === "abandon" && (
        <div className="col gap-2">
          <input
            value={abandonReason}
            onChange={(e) => setAbandonReason(e.target.value)}
            placeholder="Why abandon? (feeds the agent — e.g. 'no longer relevant', 'duplicated effort')"
            style={{
              border: "1px solid var(--hair-2)",
              padding: "6px 8px",
              background: "var(--bg)",
              fontSize: 12,
            }}
            autoFocus
          />
          <div className="row gap-2">
            <button
              className="btn"
              disabled={!abandonReason.trim()}
              onClick={() => {
                onAbandon(abandonReason.trim());
                setMode("idle");
                setAbandonReason("");
              }}
            >
              Confirm abandon
            </button>
            <button className="btn ghost" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SnoozeControls({
  onCancel,
  onSubmit,
  customValue,
  setCustomValue,
}: {
  onCancel: () => void;
  onSubmit: (d: Date) => void;
  customValue: string;
  setCustomValue: (v: string) => void;
}) {
  const now = new Date();
  const quicks: { label: string; dt: Date }[] = [
    { label: "Tomorrow", dt: atLocal(addDays(now, 1), 9, 0) },
    { label: "In 3 days", dt: atLocal(addDays(now, 3), 9, 0) },
    { label: "Next week", dt: atLocal(addDays(now, 7), 9, 0) },
    { label: "In a month", dt: atLocal(addDays(now, 30), 9, 0) },
  ];
  return (
    <div className="col gap-2">
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        {quicks.map((q) => (
          <button key={q.label} className="btn ghost" onClick={() => onSubmit(q.dt)}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="row gap-2">
        <input
          type="datetime-local"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          style={{
            border: "1px solid var(--hair-2)",
            padding: "6px 8px",
            background: "var(--bg)",
            fontSize: 12,
          }}
        />
        <button
          className="btn primary"
          disabled={!customValue}
          onClick={() => onSubmit(new Date(customValue))}
        >
          Snooze
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
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
