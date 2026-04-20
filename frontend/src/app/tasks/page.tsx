"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Task } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { Dot, PriorityChip } from "@/components/Primitives";
import { Habits } from "@/components/Habits";

const COLUMNS: { id: Task["status"]; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Today" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];

export default function TasksPage() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list() });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Task["status"] }) =>
      api.tasks.patch(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const previous = qc.getQueryData<Task[]>(["tasks"]) ?? [];
      qc.setQueryData<Task[]>(["tasks"], (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["tasks"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Task["status"] | null>(null);

  const open = tasks.filter((t) => t.status !== "done").length;
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="col" style={{ minHeight: 0, height: "100%", overflow: "auto" }}>
      <div className="page-hd">
        <div>
          <h1>Tasks</h1>
          <div className="sub">
            {open} open · {done} done · sort: priority + due
          </div>
        </div>
        <div className="row gap-2">
          <button className="btn ghost">
            <Icon name="sparkles" size={14} /> AI prioritize
          </button>
          <button className="btn primary">
            <Icon name="plus" size={14} /> New task
          </button>
        </div>
      </div>

      <Habits projects={projects} />

      <div className="kanban" style={{ minHeight: 480, height: 520 }}>
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="column"
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.id);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveMutation.mutate({ id: dragId, status: col.id });
                setDragId(null);
                setOverCol(null);
              }}
            >
              <div className="column-hd">
                <span className="caps">
                  <b style={{ color: "var(--text)" }}>{col.label}</b>{" "}
                  <span className="mono num" style={{ marginLeft: 6 }}>
                    {items.length}
                  </span>
                </span>
                <button className="btn ghost" style={{ height: 20, padding: "0 6px" }}>
                  <Icon name="plus" size={12} />
                </button>
              </div>
              <div className="column-bd">
                {items.map((t) => {
                  const p = projects.find((x) => x.id === t.project);
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
                        {p && (
                          <span className="row gap-2">
                            <Dot color={p.color} />
                            <span className="truncate" style={{ maxWidth: 120 }}>{p.name}</span>
                          </span>
                        )}
                        <span className="grow" />
                        <span className="mono">{t.estMin ?? "?"}m</span>
                      </div>
                      <div
                        className="card-title"
                        style={{ textDecoration: isDone ? "line-through" : "none" }}
                      >
                        {t.title}
                      </div>
                      <div className="card-ft">
                        <span>due {fmtRelative(t.due)}</span>
                        <span>· {t.energy} energy</span>
                        {t.tags && t.tags[0] && <span>· #{t.tags[0]}</span>}
                      </div>
                    </div>
                  );
                })}
                {overCol === col.id && dragId && <div className="drop-hint" />}
                {items.length === 0 && (
                  <div
                    className="muted-2"
                    style={{ fontSize: 11, padding: 8, textAlign: "center" }}
                  >
                    empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
