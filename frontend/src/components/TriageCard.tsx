"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Task } from "@/lib/api";
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

  if (captured.length === 0 && stale.length === 0) {
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
        </span>
      </div>
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
