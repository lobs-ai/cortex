"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Plan } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { Dot, PriorityChip, ProjectTag } from "@/components/Primitives";
import { NowCard } from "@/components/NowCard";
import { TriageCard } from "@/components/TriageCard";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list() });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
  const { data: plan } = useQuery({
    queryKey: ["plan-today"],
    queryFn: () => api.plans.today(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const { data: alerts = [] } = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications.list() });

  const [whyOpen, setWhyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const regen = useMutation({
    mutationFn: (body?: { guidance?: string }) => api.plans.generate(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-today"] });
      setEditOpen(false);
    },
  });

  const topTasks = tasks
    .filter((t) => t.status === "today" || t.status === "doing")
    .sort((a, b) => a.priority.localeCompare(b.priority));

  const openTasks = tasks.filter((t) => t.status !== "done");
  const isToday = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    const n = new Date();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  };
  const doneToday = tasks.filter((t) => t.status === "done" && isToday(t.completedAt)).length;
  const plannedToday =
    doneToday + tasks.filter((t) => t.status === "today" || t.status === "doing").length;
  const overdue = openTasks.filter((t) => t.due && new Date(t.due) < new Date()).length;
  const p0 = openTasks.filter((t) => t.priority === "P0").length;
  const p1 = openTasks.filter((t) => t.priority === "P1").length;
  const p2 = openTasks.filter((t) => t.priority === "P2").length;

  const now = new Date();
  const nMeetings = plan?.content.blocks.filter((b) => ["meeting", "class", "teach"].includes(b.kind)).length ?? 0;
  const nDeep = plan?.content.blocks.filter((b) => b.kind === "block" && b.hero).length ?? 0;

  return (
    <div className="col" style={{ minHeight: 0 }}>
      <div className="page-hd">
        <div>
          <h1>
            Today{" "}
            <span className="muted mono" style={{ fontSize: 14, marginLeft: 8 }}>
              {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </span>
          </h1>
          <div className="sub">
            {nMeetings} meetings · {nDeep} deep-work window{nDeep === 1 ? "" : "s"} · {alerts.length} proactive alerts
          </div>
        </div>
        <div className="row gap-2">
          <button className="btn ghost">
            <Icon name="plus" size={14} /> Quick add
          </button>
          <button
            className="btn primary"
            onClick={() => regen.mutate(undefined)}
            disabled={regen.isPending}
          >
            <Icon name="sparkles" size={14} /> {regen.isPending ? "Thinking…" : "Regenerate plan"}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Open tasks</div>
          <div className="v">{openTasks.length}</div>
          <div className="s">
            {overdue} overdue · P0:{p0} P1:{p1} P2:{p2}
          </div>
        </div>
        <div className="stat">
          <div className="k">Completed today</div>
          <div className="v">
            {doneToday}
            <span className="muted" style={{ fontSize: 14, marginLeft: 4 }}>
              / {plannedToday}
            </span>
          </div>
          <div className="s">
            {plannedToday === 0
              ? "no tasks planned"
              : `${plannedToday - doneToday} remaining`}
          </div>
        </div>
        <div className="stat">
          <div className="k">Focus block</div>
          <div className="v mono">
            {plan?.content.blocks.find((b) => b.hero)?.start ?? "—"}
          </div>
          <div className="s">
            {plan?.content.blocks.find((b) => b.hero)
              ? `${diffMinutes(
                  plan.content.blocks.find((b) => b.hero)!,
                )} min · ${plan.content.blocks.find((b) => b.hero)!.label.toLowerCase()}`
              : "no deep-work window"}
          </div>
        </div>
        <div className="stat">
          <div className="k">Deadline risk</div>
          <div className="v" style={{ color: "var(--red)" }}>
            {alerts.filter((a) => a.kind === "deadline_risk").length}
          </div>
          <div className="s">
            {alerts.find((a) => a.kind === "deadline_risk")?.title ?? "none"}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 18px 4px", display: "grid", gap: 10 }}>
        <NowCard />
        <TriageCard />
      </div>

      <div
        style={{
          padding: 18,
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr",
          gap: 18,
          minHeight: 0,
        }}
      >
        {/* Proposed plan */}
        <div className="panel">
          <div className="panel-hd">
            <span className="title">
              <b>Proposed plan</b> · generated {plan ? fmtRelative(plan.createdAt) : "—"} by Cortex
            </span>
            <div className="row gap-2">
              <button
                className="btn ghost"
                style={{ fontSize: 11 }}
                disabled={!plan}
                onClick={() => setWhyOpen(true)}
              >
                Why this?
              </button>
              <button
                className="btn"
                style={{ fontSize: 11 }}
                disabled={!plan}
                onClick={() => setEditOpen(true)}
              >
                Edit
              </button>
            </div>
          </div>
          <div>
            {(plan?.content.blocks ?? []).map((b, i) => (
              <div
                key={i}
                className="block-row"
                style={{ borderBottom: "1px solid var(--hair)" }}
              >
                <span className="mono num">
                  {b.start}–{b.end}
                </span>
                <span>
                  <div style={{ fontWeight: b.hero ? 500 : 400 }}>
                    {b.label}
                    {b.hero && (
                      <span
                        className="caps"
                        style={{ color: "var(--green)", marginLeft: 6 }}
                      >
                        PRIME FOCUS
                      </span>
                    )}
                  </div>
                  {b.sub && (
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {b.sub}
                    </div>
                  )}
                </span>
                <span
                  className="chip"
                  style={{ color: kindColor(b.kind) }}
                >
                  {b.kind}
                </span>
              </div>
            ))}
            {!plan && (
              <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
                No plan yet — hit <b>Regenerate plan</b> to have Cortex draft one.
              </div>
            )}
          </div>
        </div>

        {/* Top tasks & projects */}
        <div className="col gap-3">
          <div className="panel">
            <div className="panel-hd">
              <span className="title">
                <b>Top tasks</b> · ranked by Cortex
              </span>
              <Link href="/tasks" className="btn ghost" style={{ fontSize: 11, textDecoration: "none" }}>
                All tasks →
              </Link>
            </div>
            <div>
              {topTasks.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--hair)",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <PriorityChip p={t.priority} />
                  <div>
                    <div className="truncate" style={{ fontSize: 12.5 }}>{t.title}</div>
                    <div
                      className="row gap-2"
                      style={{ fontSize: 10.5, color: "var(--muted)" }}
                    >
                      <ProjectTag projectId={t.project} projects={projects} />
                      <span className="mono">· est {t.estMin ?? "?"}m</span>
                      <span className="mono">· due {fmtRelative(t.due)}</span>
                    </div>
                  </div>
                  <button className="btn ghost" style={{ fontSize: 11 }}>
                    <Icon name="plus" size={11} /> schedule
                  </button>
                </div>
              ))}
              {topTasks.length === 0 && (
                <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
                  Nothing queued for today.
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="title">
                <b>Projects</b> · health
              </span>
            </div>
            <div>
              {projects
                .filter((p) => p.status === "active")
                .slice(0, 5)
                .map((p) => (
                  <div
                    key={p.id}
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid var(--hair)",
                      display: "grid",
                      gridTemplateColumns: "1fr auto 70px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div className="row gap-2">
                      <Dot color={p.color} />
                      <span className="truncate" style={{ fontSize: 12.5 }}>{p.name}</span>
                    </div>
                    <span className="mono muted" style={{ fontSize: 10.5 }}>
                      {p.tasksOpen} open · {p.tasksDone} done
                    </span>
                    <div
                      className={`hbar ${p.health < 50 ? "low" : p.health < 75 ? "mid" : ""}`}
                    >
                      <span style={{ width: p.health + "%" }} />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {whyOpen && plan && (
        <WhyThisModal plan={plan} onClose={() => setWhyOpen(false)} />
      )}
      {editOpen && plan && (
        <EditPlanModal
          plan={plan}
          pending={regen.isPending}
          onClose={() => setEditOpen(false)}
          onSubmit={(guidance) => regen.mutate({ guidance })}
        />
      )}
    </div>
  );
}

function WhyThisModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const inputs = plan.content.inputs;
  const fmtHM = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 520, maxWidth: "92vw", maxHeight: "85vh", overflow: "auto", background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title"><b>Why this plan?</b></span>
          <button className="btn ghost" onClick={onClose}><Icon name="x" size={12} /></button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5 }}>{plan.content.summary}</div>
          <div className="muted mono" style={{ fontSize: 10.5 }}>
            {plan.generatedBy} · {plan.content.generatedAt ? fmtRelative(plan.content.generatedAt) : fmtRelative(plan.createdAt)}
          </div>
          {plan.content.fallbackReason && (
            <div
              style={{
                border: "1px solid var(--warn, #c58a00)",
                background: "var(--warn-bg, rgba(197,138,0,0.08))",
                padding: "8px 10px",
                fontSize: 11.5,
                lineHeight: 1.4,
              }}
            >
              <div className="caps" style={{ fontSize: 10, marginBottom: 4 }}>planner fell back to heuristic</div>
              <div>{plan.content.fallbackReason}</div>
            </div>
          )}
          {inputs?.guidance && (
            <div style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", fontSize: 12 }}>
              <div className="caps" style={{ fontSize: 10 }}>your guidance</div>
              <div>{inputs.guidance}</div>
            </div>
          )}
          <div>
            <div className="caps" style={{ fontSize: 10 }}>
              your events ({(inputs?.events ?? []).filter((e) => !e.subscribed).length})
            </div>
            {(inputs?.events ?? []).filter((e) => !e.subscribed).map((e, i) => (
              <div key={i} className="mono" style={{ fontSize: 11.5, padding: "2px 0" }}>
                {fmtHM(e.start)}–{fmtHM(e.end)} · {e.title}
              </div>
            ))}
            {!(inputs?.events ?? []).some((e) => !e.subscribed) && (
              <div className="muted" style={{ fontSize: 11.5 }}>none</div>
            )}
          </div>
          {(inputs?.events ?? []).some((e) => e.subscribed) && (
            <div>
              <div className="caps" style={{ fontSize: 10 }}>
                subscribed (FYI — not attending) ({(inputs?.events ?? []).filter((e) => e.subscribed).length})
              </div>
              {(inputs?.events ?? []).filter((e) => e.subscribed).map((e, i) => (
                <div key={i} className="mono muted" style={{ fontSize: 11.5, padding: "2px 0" }}>
                  {fmtHM(e.start)}–{fmtHM(e.end)} · {e.title}
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="caps" style={{ fontSize: 10 }}>free blocks ({inputs?.freeBlocks.length ?? 0})</div>
            {(inputs?.freeBlocks ?? []).map((b, i) => (
              <div key={i} className="mono" style={{ fontSize: 11.5, padding: "2px 0" }}>
                {fmtHM(b.start)}–{fmtHM(b.end)}
              </div>
            ))}
            {!inputs?.freeBlocks.length && <div className="muted" style={{ fontSize: 11.5 }}>none</div>}
          </div>
          <div>
            <div className="caps" style={{ fontSize: 10 }}>top tasks ({inputs?.tasks.length ?? 0})</div>
            {(inputs?.tasks ?? []).slice(0, 10).map((t) => (
              <div key={t.id} style={{ fontSize: 12, padding: "2px 0" }}>
                <span className="mono muted" style={{ marginRight: 6 }}>{t.priority}</span>
                {t.title}
              </div>
            ))}
            {!inputs?.tasks.length && <div className="muted" style={{ fontSize: 11.5 }}>none</div>}
          </div>
          {!inputs && (
            <div className="muted" style={{ fontSize: 11.5 }}>
              Inputs weren&apos;t captured for this plan. Hit <b>Regenerate plan</b> to produce one with full rationale.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditPlanModal({
  plan,
  pending,
  onClose,
  onSubmit,
}: {
  plan: Plan;
  pending: boolean;
  onClose: () => void;
  onSubmit: (guidance: string) => void;
}) {
  const [guidance, setGuidance] = useState(plan.content.inputs?.guidance ?? "");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 480, maxWidth: "92vw", background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title"><b>Edit plan</b></span>
          <button className="btn ghost" onClick={onClose} disabled={pending}><Icon name="x" size={12} /></button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Tell Cortex how to replan. It will keep confirmed events and rebuild the rest around your guidance.
          </div>
          <textarea
            placeholder="e.g. move deep work to the morning, leave 4-5pm open for a walk, don't schedule anything before 9"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={4}
            maxLength={500}
            className="mono"
            style={{ border: "1px solid var(--hair-2)", padding: "6px 8px", background: "var(--bg)", fontSize: 12, resize: "vertical" }}
            autoFocus
          />
          <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose} disabled={pending}>Cancel</button>
            <button
              className="btn primary"
              disabled={pending || !guidance.trim()}
              onClick={() => onSubmit(guidance.trim())}
            >
              {pending ? "Replanning…" : "Replan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function kindColor(kind: string) {
  switch (kind) {
    case "meeting":
      return "var(--blue)";
    case "class":
      return "var(--violet)";
    case "teach":
      return "var(--amber)";
    case "personal":
    case "block":
      return "var(--green)";
    case "deadline":
      return "var(--red)";
    default:
      return "var(--muted)";
  }
}

function diffMinutes(b: { start: string; end: string }) {
  const [sh, sm] = b.start.split(":").map(Number);
  const [eh, em] = b.end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
