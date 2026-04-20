"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Chip } from "./Primitives";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

export function RightRail() {
  const qc = useQueryClient();
  const { data: alerts = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications.list(),
    refetchInterval: 60_000,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.notifications.dismiss(id),
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
              onClick={() => dismiss.mutate(a.id)}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
          <div className="alert-title">{a.title}</div>
          <div className="alert-body"><Markdown>{a.body}</Markdown></div>
          <div className="alert-actions">
            {a.actions.map((act, i) => (
              <button
                key={i}
                className={`btn ${i === 0 ? "primary" : "ghost"}`}
                style={{ fontSize: 11 }}
                onClick={() => dismiss.mutate(a.id)}
              >
                {act}
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
          <button className="btn" style={{ fontSize: 11 }}>1h</button>
          <button className="btn" style={{ fontSize: 11 }}>rest of day</button>
          <button className="btn" style={{ fontSize: 11 }}>until tmr</button>
        </div>
      </div>
    </div>
  );
}
