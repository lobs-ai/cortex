"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, type NotificationActResult } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Chip } from "./Primitives";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

export function RightRail() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: alerts = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications.list(),
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ id, op }: { id: string; op: string }) => api.notifications.act(id, op),
    onSuccess: (result: NotificationActResult) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // The backend tells us what happened so the UI can follow through —
      // navigate, refresh plan, etc. Keeps the mapping server-driven.
      if (result.effect?.kind === "navigate" && result.effect.to) {
        router.push(result.effect.to);
      }
      if (result.effect?.kind === "plan_regenerated" || result.effect?.kind === "task_queued_for_today") {
        qc.invalidateQueries({ queryKey: ["plan"] });
        qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });

  const snoozeAll = useMutation({
    mutationFn: async ({ op }: { op: string }) => {
      await Promise.all(alerts.map((a) => api.notifications.act(a.id, op)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div>
      <div
        className="panel-hd"
        style={{ borderBottom: "1px solid var(--hair)", padding: "10px 12px" }}
      >
        <span className="title">
          <b>Proactive</b> · {alerts.length} active
        </span>
        <div className="row gap-2">
          <span className="mono muted-2" style={{ fontSize: 10.5 }}>auto-scan 30m</span>
        </div>
      </div>

      {alerts.map((a) => (
        <div key={a.id} className={`alert alert-rail ${a.severity}`}>
          <div className="alert-hd">
            <Chip kind={a.severity}>
              <span className="sw" />
              {a.kind.replace("_", " ")}
            </Chip>
            <span className="grow" />
            <span className="mono muted-2" style={{ fontSize: 10 }}>
              {fmtRelative(a.createdAt)}
            </span>
            <button
              className="btn ghost"
              style={{ padding: "0 4px", height: 18 }}
              onClick={() => act.mutate({ id: a.id, op: "dismiss" })}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
          <div className="alert-title">{a.title}</div>
          <div className="alert-body"><Markdown>{a.body}</Markdown></div>
          <div className="alert-actions">
            {a.actions.map((action, i) => (
              <button
                key={i}
                className={`btn ${i === 0 ? "primary" : "ghost"}`}
                style={{ fontSize: 11 }}
                onClick={() => act.mutate({ id: a.id, op: action.op })}
                disabled={act.isPending}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {alerts.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          <div className="caps" style={{ marginBottom: 6 }}>all clear</div>
          <div style={{ fontSize: 12 }}>Nothing needs your attention right now.</div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{ borderTop: "1px solid var(--hair)", padding: 12, display: "grid", gap: 6 }}
      >
        <div className="caps">Snooze proactive</div>
        <div className="row gap-2">
          <button
            className="btn"
            style={{ fontSize: 11 }}
            disabled={alerts.length === 0 || snoozeAll.isPending}
            onClick={() => snoozeAll.mutate({ op: "snooze_1h" })}
          >
            1h
          </button>
          <button
            className="btn"
            style={{ fontSize: 11 }}
            disabled={alerts.length === 0 || snoozeAll.isPending}
            onClick={() => snoozeAll.mutate({ op: "snooze_rest_of_day" })}
          >
            rest of day
          </button>
          <button
            className="btn"
            style={{ fontSize: 11 }}
            disabled={alerts.length === 0 || snoozeAll.isPending}
            onClick={() => snoozeAll.mutate({ op: "snooze_tomorrow" })}
          >
            until tmr
          </button>
        </div>
      </div>
    </div>
  );
}
