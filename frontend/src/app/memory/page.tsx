"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Integration } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { IntegrationManage } from "@/components/IntegrationManage";
import { Markdown } from "@/components/Markdown";

const PROVIDER_OPTIONS = [
  { id: "google_calendar", label: "Google Calendar" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
];

export default function MemoryPage() {
  const qc = useQueryClient();
  const [manage, setManage] = useState<Integration | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { data: tendencies = [] } = useQuery({
    queryKey: ["tendencies"],
    queryFn: () => api.memory.tendencies(),
  });
  const { data: preferences = [] } = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.memory.preferences(),
  });
  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.integrations.list(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.memory.patchTendency(id, { status: "archived" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tendencies"] }),
  });

  return (
    <div className="col" style={{ minHeight: 0, overflow: "auto" }}>
      <div className="page-hd">
        <div>
          <h1>Memory</h1>
          <div className="sub">
            what Cortex knows · {tendencies.length} learned tendencies ·{" "}
            {preferences.length} explicit preferences
          </div>
        </div>
        <button className="btn">
          <Icon name="plus" size={14} /> Add preference
        </button>
      </div>

      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="panel">
          <div className="panel-hd">
            <span className="title">
              <b>Learned tendencies</b> · inferred from behavior
            </span>
          </div>
          <div>
            {tendencies.map((t) => (
              <div key={t.id} className="tend-row">
                <div>
                  <Markdown inline>{t.text}</Markdown>
                  <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                    {t.evidence} observations · last seen {fmtRelative(t.lastSeen)} · {t.status}
                  </div>
                </div>
                <div className="mini-bar">
                  <span style={{ width: t.confidence * 100 + "%" }} />
                </div>
                <span className="mono num" style={{ fontSize: 11 }}>
                  {Math.round(t.confidence * 100)}%
                </span>
                <button
                  className="btn ghost"
                  style={{ fontSize: 11 }}
                  onClick={() => archive.mutate(t.id)}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
            {tendencies.length === 0 && (
              <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 12 }}>
                Cortex hasn&rsquo;t learned anything yet.
              </div>
            )}
          </div>
        </div>

        <div className="col gap-3">
          <div className="panel">
            <div className="panel-hd">
              <span className="title">
                <b>Explicit preferences</b>
              </span>
            </div>
            <div>
              {preferences.map((p) => {
                const val = typeof p.value === "string" ? p.value : p.value;
                const isObj = val !== null && typeof val === "object";
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--hair)",
                      display: "grid",
                      gridTemplateColumns: "160px 1fr",
                      gap: 12,
                      fontSize: 12.5,
                      alignItems: "start",
                    }}
                  >
                    <span className="caps" style={{ color: "var(--fg-muted)", paddingTop: 2 }}>{p.key}</span>
                    {isObj ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
                          <span
                            key={k}
                            style={{
                              background: "var(--surface-raised, var(--bg-alt))",
                              border: "1px solid var(--hair)",
                              borderRadius: 4,
                              padding: "1px 7px",
                              fontSize: 12,
                              fontFamily: "inherit",
                            }}
                          >
                            <span style={{ color: "var(--fg-muted)" }}>{k}</span>
                            <span style={{ margin: "0 3px", color: "var(--fg-faint, var(--hair))" }}>·</span>
                            <span className="mono">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="mono">{String(val)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="title">
                <b>Integrations</b>
              </span>
              <button
                className="btn ghost"
                style={{ fontSize: 11 }}
                onClick={() => setShowAdd(true)}
              >
                <Icon name="plus" size={12} /> Add
              </button>
            </div>
            <div>
              {integrations.map((it) => (
                <div
                  key={it.id}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--hair)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    fontSize: 12.5,
                  }}
                >
                  <div>
                    <div>{providerLabel(it.provider)}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{it.detail}</div>
                  </div>
                  <span
                    className={`chip ${it.status === "connected" ? "" : "p2"}`}
                    style={{
                      color:
                        it.status === "connected" ? "var(--green)" : "var(--muted)",
                      borderColor:
                        it.status === "connected"
                          ? "color-mix(in oklch, var(--green), transparent 70%)"
                          : "var(--hair-2)",
                    }}
                  >
                    <span className="sw" />
                    {it.status}
                  </span>
                  <button
                    className="btn ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => setManage(it)}
                  >
                    manage
                  </button>
                </div>
              ))}
              {integrations.length === 0 && (
                <div
                  className="muted"
                  style={{ padding: 16, fontSize: 12, textAlign: "center" }}
                >
                  No integrations yet. Click <b>Add</b> to connect one.
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <span className="title">
                <b>Action safety</b> · what Cortex can do without asking
              </span>
            </div>
            <div style={{ padding: 12, display: "grid", gap: 8, fontSize: 12.5 }}>
              {[
                { k: "Read calendar & tasks", v: "auto", c: "green" },
                { k: "Propose schedule changes", v: "auto", c: "green" },
                { k: "Send daily Discord summary", v: "auto", c: "green" },
                { k: "Move events with attendees", v: "ask first", c: "amber" },
                { k: "Delete tasks or projects", v: "ask first", c: "amber" },
                { k: "Email on your behalf", v: "off", c: "red" },
              ].map((r) => (
                <div
                  key={r.k}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center" }}
                >
                  <span>{r.k}</span>
                  <span
                    className="chip"
                    style={{
                      color: `var(--${r.c})`,
                      borderColor: `color-mix(in oklch, var(--${r.c}), transparent 70%)`,
                    }}
                  >
                    {r.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {manage && <IntegrationManage integration={manage} onClose={() => setManage(null)} />}
      {showAdd && (
        <AddIntegrationModal onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}

function AddIntegrationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState("google_calendar");
  const [detail, setDetail] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.integrations.create({
        provider,
        status: "connected",
        detail: detail || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
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
        style={{ width: 420, background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title"><b>Add integration</b></span>
          <button className="btn ghost" onClick={onClose}><Icon name="x" size={12} /></button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="caps">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{
                border: "1px solid var(--hair-2)",
                padding: "6px 8px",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: 12,
              }}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="caps">Detail</span>
            <input
              value={detail}
              placeholder="e.g. primary calendar · @rafe"
              onChange={(e) => setDetail(e.target.value)}
              className="mono"
              style={{
                border: "1px solid var(--hair-2)",
                padding: "6px 8px",
                background: "var(--bg)",
                fontSize: 12,
              }}
            />
          </label>
          <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function providerLabel(p: string) {
  switch (p) {
    case "google_calendar":
      return "Google Calendar";
    case "discord":
      return "Discord";
    case "github":
      return "GitHub";
    case "slack":
      return "Slack (lab)";
    default:
      return p;
  }
}
