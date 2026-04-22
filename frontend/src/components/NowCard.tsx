"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Commitment, type CommitmentNow } from "@/lib/api";
import { Icon } from "./Icon";

// The dashboard's "commit → nag → verify" card. Shows exactly one active
// commitment with three responses: Doing, Done (+ artifact), Skip (+ reason).
// Below it, the next few upcoming slots and today's hit/miss rollup.
export function NowCard() {
  const qc = useQueryClient();
  const { data } = useQuery<CommitmentNow>({
    queryKey: ["commitments-now"],
    queryFn: () => api.commitments.now(),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.commitments.ack(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commitments-now"] }),
  });
  const done = useMutation({
    mutationFn: ({ id, artifact }: { id: string; artifact?: string }) =>
      api.commitments.done(id, artifact),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commitments-now"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const skip = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.commitments.skip(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commitments-now"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const [artifact, setArtifact] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"idle" | "done" | "skip">("idle");

  const current = data?.current ?? null;
  const upcoming = data?.upcoming ?? [];
  const today = data?.today ?? { done: 0, skipped: 0, missed: 0, total: 0 };

  // Reset the entry forms whenever the active commitment changes.
  useEffect(() => {
    setMode("idle");
    setArtifact("");
    setReason("");
  }, [current?.id]);

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
          activation-sized chunks, or add one manually.
        </div>
      </div>
    );
  }

  const pending = ack.isPending || done.isPending || skip.isPending;

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="title">
          <b>Now</b> · commitment
        </span>
        <TodayChip today={today} />
      </div>
      {current ? (
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div className="row gap-2" style={{ fontSize: 11 }}>
              <StateBadge state={current.state} />
              <span className="mono muted">
                {fmtTime(current.startTime)} · {current.durationMin}m
              </span>
              {current.escalationLevel > 0 && (
                <span className="caps" style={{ color: "var(--red)" }}>
                  NAGGING
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{current.title}</div>
            {current.verifyCriterion && (
              <div className="muted" style={{ fontSize: 12 }}>
                Done means: {current.verifyCriterion}
              </div>
            )}
          </div>

          {mode === "idle" && (
            <div className="row gap-2">
              <button
                className="btn primary"
                disabled={pending || current.state === "doing"}
                onClick={() => ack.mutate(current.id)}
              >
                <Icon name="bolt" size={12} /> Doing it
              </button>
              <button className="btn" disabled={pending} onClick={() => setMode("done")}>
                <Icon name="check" size={12} /> Done
              </button>
              <button className="btn ghost" disabled={pending} onClick={() => setMode("skip")}>
                <Icon name="x" size={12} /> Skip
              </button>
            </div>
          )}

          {mode === "done" && (
            <div className="col gap-2">
              <label className="muted" style={{ fontSize: 11 }}>
                One-line artifact (what did you actually produce?)
              </label>
              <input
                className="mono"
                value={artifact}
                onChange={(e) => setArtifact(e.target.value)}
                placeholder="e.g. 3 paragraphs saved to draft.md"
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
                  className="btn primary"
                  disabled={pending || !artifact.trim()}
                  onClick={() =>
                    done.mutate({ id: current.id, artifact: artifact.trim() })
                  }
                >
                  Record done
                </button>
                <button className="btn ghost" onClick={() => setMode("idle")}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === "skip" && (
            <div className="col gap-2">
              <label className="muted" style={{ fontSize: 11 }}>
                Why are you skipping? (feeds tomorrow&apos;s plan)
              </label>
              <input
                className="mono"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. meeting ran long; too tired; wrong time"
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
                  disabled={pending}
                  onClick={() => skip.mutate({ id: current.id, reason: reason.trim() })}
                >
                  Record skip
                </button>
                <button className="btn ghost" onClick={() => setMode("idle")}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
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
    done: { label: "DONE", color: "var(--green)" },
    skipped: { label: "SKIPPED", color: "var(--muted)" },
    missed: { label: "MISSED", color: "var(--red)" },
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
