"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Project, type Recurring } from "@/lib/api";
import { Icon } from "./Icon";
import { Dot } from "./Primitives";

export function Habits({ projects }: { projects: Project[] }) {
  const qc = useQueryClient();
  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api.recurring.list(),
  });
  const { data: suggestions = [] } = useQuery({
    queryKey: ["recurring-suggestions"],
    queryFn: () => api.recurring.suggestions(),
  });
  const [showNew, setShowNew] = useState(false);

  const toggle = useMutation({
    mutationFn: (id: string) => api.recurring.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const pause = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      api.recurring.patch(id, { paused }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.recurring.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.recurring.dismissSuggestion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-suggestions"] }),
  });

  const dailyActive = recurring.filter((r) => !r.paused && r.cadence.startsWith("daily"));
  const doneToday = recurring.filter((r) => r.completedToday).length;
  const active = recurring.filter((r) => !r.paused).length;

  return (
    <div className="panel" style={{ margin: "0 12px 12px" }}>
      <div className="panel-hd">
        <span className="title">
          <b>Habits & recurring</b> · {active} active ·{" "}
          <span style={{ color: "var(--green)" }}>
            {doneToday}/{dailyActive.length} done today
          </span>
        </span>
        <div className="row gap-2">
          <button className="btn" style={{ fontSize: 11 }} onClick={() => setShowNew(true)}>
            <Icon name="plus" size={11} /> New recurring
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div
          style={{
            borderBottom: "1px solid var(--hair)",
            background: "color-mix(in oklch, var(--accent), transparent 94%)",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name="sparkles" size={12} />
            <span className="caps" style={{ color: "var(--text)" }}>
              Cortex suggests · {suggestions.length}
            </span>
          </div>
          {suggestions.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "10px 12px",
                borderTop: "1px solid var(--hair)",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                alignItems: "start",
              }}
            >
              <div>
                <div className="row gap-2" style={{ marginBottom: 4 }}>
                  <span
                    className="chip"
                    style={{
                      color:
                        s.action === "create"
                          ? "var(--green)"
                          : s.action === "adjust"
                            ? "var(--amber)"
                            : "var(--muted)",
                    }}
                  >
                    {s.action}
                  </span>
                  {s.cadence && (
                    <span className="mono muted-2" style={{ fontSize: 10.5 }}>
                      {s.cadence}
                    </span>
                  )}
                  <span className="mono muted-2" style={{ fontSize: 10.5 }}>
                    · {Math.round(s.confidence * 100)}% · {s.evidence} obs
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>
                  {s.title}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{s.body}</div>
              </div>
              <div className="row gap-2" style={{ alignSelf: "center" }}>
                <button
                  className="btn ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => dismiss.mutate(s.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        {recurring.length === 0 && (
          <div className="muted" style={{ padding: 16, fontSize: 12, textAlign: "center" }}>
            No recurring tasks yet. Add one to track habits with a streak.
          </div>
        )}
        {recurring.map((r) => {
          const proj = projects.find((p) => p.id === r.project);
          return (
            <div
              key={r.id}
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--hair)",
                display: "grid",
                gridTemplateColumns: "22px 1fr 160px 100px 110px 80px",
                gap: 12,
                alignItems: "center",
                opacity: r.paused ? 0.5 : 1,
              }}
            >
              <button
                className={`check ${r.completedToday ? "on" : ""}`}
                onClick={() => toggle.mutate(r.id)}
                title={r.completedToday ? "Completed today" : "Mark done today"}
              >
                {r.completedToday && <Icon name="check" size={10} />}
              </button>
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ fontSize: 12.5 }}>
                  <span
                    className="truncate"
                    style={{ textDecoration: r.completedToday ? "line-through" : "none" }}
                  >
                    {r.title}
                  </span>
                  {r.managedByAi && (
                    <span
                      className="chip"
                      style={{
                        color: "var(--accent)",
                        fontSize: 9.5,
                        height: 15,
                        padding: "0 4px",
                      }}
                    >
                      <Icon name="sparkles" size={9} /> AI
                    </span>
                  )}
                  {r.paused && (
                    <span
                      className="chip"
                      style={{
                        color: "var(--muted)",
                        fontSize: 9.5,
                        height: 15,
                        padding: "0 4px",
                      }}
                    >
                      paused
                    </span>
                  )}
                </div>
                <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                  {proj && (
                    <span>
                      <Dot color={proj.color} /> {proj.name}
                      {r.note ? " · " : ""}
                    </span>
                  )}
                  {r.note}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {r.cadence}
                {r.cadenceDetail ? ` · ${r.cadenceDetail}` : ""}
              </span>
              <span className="mono num" style={{ fontSize: 11.5 }}>
                {r.time ?? "—"}
                {r.estMin ? ` · ${r.estMin}m` : ""}
              </span>
              <div>
                <div className="row gap-2" style={{ fontSize: 10.5 }}>
                  <span className="mono">🔥 {r.streak}d streak</span>
                </div>
                <div className="mini-bar" style={{ marginTop: 3, width: 90 }}>
                  <span
                    style={{
                      width: r.weeklyRate * 100 + "%",
                      background:
                        r.weeklyRate > 0.8
                          ? "var(--green)"
                          : r.weeklyRate > 0.5
                            ? "var(--amber)"
                            : "var(--red)",
                    }}
                  />
                </div>
                <div className="mono muted-2" style={{ fontSize: 10, marginTop: 1 }}>
                  {Math.round(r.weeklyRate * 100)}% 30d
                </div>
              </div>
              <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                <button
                  className="btn ghost"
                  style={{ padding: "0 6px", height: 22 }}
                  onClick={() => pause.mutate({ id: r.id, paused: !r.paused })}
                  title={r.paused ? "Resume" : "Pause"}
                >
                  {r.paused ? <Icon name="chevR" size={11} /> : <span style={{ fontSize: 11 }}>‖</span>}
                </button>
                <button
                  className="btn ghost"
                  style={{ padding: "0 6px", height: 22 }}
                  onClick={() => remove.mutate(r.id)}
                  title="Remove"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <NewRecurringModal projects={projects} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

function NewRecurringModal({
  projects,
  onClose,
}: {
  projects: Project[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<string>("daily");
  const [cadenceDetail, setCadenceDetail] = useState("");
  const [time, setTime] = useState("09:00");
  const [estMin, setEstMin] = useState<number>(30);
  const [projectId, setProjectId] = useState<string>("");

  const create = useMutation({
    mutationFn: () =>
      api.recurring.create({
        title,
        cadence,
        cadenceDetail: cadenceDetail || null,
        time,
        estMin,
        projectId: projectId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      onClose();
    },
  });

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
        style={{ width: 460, background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title"><b>New recurring task</b></span>
          <button className="btn ghost" onClick={onClose}><Icon name="x" size={12} /></button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <Input label="Title" value={title} onChange={setTitle} autoFocus />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Select
              label="Cadence"
              value={cadence}
              onChange={setCadence}
              options={[
                { value: "daily", label: "daily" },
                { value: "weekdays", label: "weekdays" },
                { value: "weekly", label: "weekly" },
                { value: "custom", label: "custom" },
              ]}
            />
            <Input
              label="Cadence detail"
              value={cadenceDetail}
              onChange={setCadenceDetail}
              placeholder="e.g. Mon/Wed/Fri"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Input label="Time" value={time} onChange={setTime} placeholder="HH:MM" />
            <Input
              label="Est. minutes"
              value={String(estMin)}
              onChange={(v) => setEstMin(Number(v) || 0)}
            />
            <Select
              label="Project"
              value={projectId}
              onChange={setProjectId}
              options={[{ value: "", label: "—" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>
          <div className="row gap-2" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="col" style={{ gap: 4 }}>
      <span className="caps">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="mono"
        style={{
          border: "1px solid var(--hair-2)",
          padding: "6px 8px",
          background: "var(--bg)",
          fontSize: 12,
        }}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="col" style={{ gap: 4 }}>
      <span className="caps">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: "1px solid var(--hair-2)",
          padding: "6px 8px",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: 12,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
