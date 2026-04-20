"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Integration } from "@/lib/api";
import { Icon } from "./Icon";

export function IntegrationManage({
  integration,
  onClose,
}: {
  integration: Integration;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Integration["status"]>(integration.status);
  const [detail, setDetail] = useState(integration.detail ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.integrations.patch(integration.id, {
        status: status as "connected" | "available" | "disconnected",
        detail,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
  });

  const disconnect = useMutation({
    mutationFn: () =>
      api.integrations.patch(integration.id, { status: "disconnected" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.integrations.remove(integration.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        style={{ width: 440, background: "var(--panel)" }}
      >
        <div className="panel-hd">
          <span className="title">
            <b>{providerLabel(integration.provider)}</b> · manage
          </span>
          <button className="btn ghost" onClick={onClose}>
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="panel-bd" style={{ display: "grid", gap: 12 }}>
          <Row label="Provider">
            <span className="mono">{integration.provider}</span>
          </Row>
          <Row label="Status">
            <div className="seg-mini">
              {(["connected", "available", "disconnected"] as const).map((s) => (
                <button
                  key={s}
                  data-active={status === s}
                  onClick={() => setStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Detail">
            <input
              className="mono"
              style={{
                border: "1px solid var(--hair-2)",
                padding: "6px 8px",
                background: "var(--bg)",
                fontSize: 12,
                width: 260,
              }}
              placeholder="2 calendars · last sync 3m ago"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </Row>
          <Row label="Last synced">
            <span className="mono muted" style={{ fontSize: 11 }}>
              {integration.lastSyncedAt
                ? new Date(integration.lastSyncedAt).toLocaleString()
                : "never"}
            </span>
          </Row>
          <div
            className="muted"
            style={{
              fontSize: 11,
              padding: "6px 0",
              borderTop: "1px solid var(--hair)",
              marginTop: 4,
            }}
          >
            OAuth sign-in lands in phase 2. For now you can record that an
            integration exists and toggle status.
          </div>
          <div
            className="row gap-2"
            style={{ justifyContent: "space-between", flexWrap: "wrap" }}
          >
            <div className="row gap-2">
              <button
                className="btn danger"
                style={{ fontSize: 11 }}
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                Remove
              </button>
              {integration.status === "connected" && (
                <button
                  className="btn"
                  style={{ fontSize: 11 }}
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </button>
              )}
            </div>
            <div className="row gap-2">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span className="caps">{label}</span>
      <div>{children}</div>
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
      return "Slack";
    default:
      return p;
  }
}
