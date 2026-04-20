"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Icon } from "./Icon";

type Cfg = { provider: string; model: string };

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: registry } = useQuery({
    queryKey: ["settings-providers"],
    queryFn: () => api.settings.providers(),
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
  });

  const [drafts, setDrafts] = useState<Record<string, Cfg>>({});

  useEffect(() => {
    if (settings) setDrafts({ ...settings });
  }, [settings]);

  const save = useMutation({
    mutationFn: async (entries: [string, Cfg][]) => {
      for (const [role, cfg] of entries) {
        await api.settings.put(role, cfg);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      onClose();
    },
  });

  if (!registry || !settings) {
    return (
      <Overlay onClose={onClose}>
        <div className="panel-bd">Loading…</div>
      </Overlay>
    );
  }

  const setDraft = (role: string, cfg: Partial<Cfg>) =>
    setDrafts((prev) => ({ ...prev, [role]: { ...prev[role], ...cfg } as Cfg }));

  const dirty =
    Object.keys(drafts).length > 0 &&
    Object.keys(drafts).some(
      (r) =>
        drafts[r]?.provider !== settings[r]?.provider ||
        drafts[r]?.model !== settings[r]?.model,
    );

  return (
    <Overlay onClose={onClose}>
      <div className="panel-hd">
        <span className="title"><b>Settings</b> · AI provider &amp; model</span>
        <button className="btn ghost" onClick={onClose}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="panel-bd" style={{ display: "grid", gap: 14 }}>
        <div className="muted" style={{ fontSize: 11.5 }}>
          Each role runs on its own model so you can trade cost against quality.
          Models with a missing API key will fall back to canned responses.
        </div>

        {registry.roles.map((r) => {
          const cur: Cfg = drafts[r.id] ?? settings[r.id] ?? {
            provider: "anthropic",
            model: "",
          };
          const provider = registry.providers.find((p) => p.id === cur.provider);
          const keyMissing = provider?.requiresApiKey && !provider.keyPresent;
          return (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 1fr",
                gap: 10,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--hair)",
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.label}</div>
                <div className="muted mono" style={{ fontSize: 10.5 }}>{r.note}</div>
              </div>
              <select
                value={cur.provider}
                onChange={(e) => {
                  const pid = e.target.value;
                  const p = registry.providers.find((x) => x.id === pid);
                  const firstModel = p?.models[0]?.id ?? "";
                  setDraft(r.id, { provider: pid, model: firstModel });
                }}
                style={selectStyle}
              >
                {registry.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.requiresApiKey ? (p.keyPresent ? "" : " · no key") : ""}
                  </option>
                ))}
              </select>
              <select
                value={cur.model}
                onChange={(e) => setDraft(r.id, { model: e.target.value })}
                style={selectStyle}
              >
                {(provider?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.note ? ` — ${m.note}` : ""}
                  </option>
                ))}
              </select>
              {keyMissing && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--amber)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  Set <span className="mono">{provider?.keyEnvVar}</span> to enable this provider.
                </div>
              )}
            </div>
          );
        })}

        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                Object.entries(drafts).filter(
                  ([r, cfg]) =>
                    cfg.provider !== settings[r]?.provider ||
                    cfg.model !== settings[r]?.model,
                ),
              )
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

const selectStyle: React.CSSProperties = {
  border: "1px solid var(--hair-2)",
  padding: "6px 8px",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
};

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
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
        style={{ width: 560, background: "var(--panel)", maxHeight: "80vh", overflow: "auto" }}
      >
        {children}
      </div>
    </div>
  );
}
