"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Integration, type StoredKey } from "@/lib/api";
import { Icon } from "./Icon";

type Cfg = { provider: string; model: string };
type Tab = "models" | "keys" | "integrations";

type ProviderRegistry = NonNullable<Awaited<ReturnType<typeof api.settings.providers>>>;

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("models");
  const { data: registry } = useQuery({
    queryKey: ["settings-providers"],
    queryFn: () => api.settings.providers(),
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
  });

  return (
    <Overlay onClose={onClose}>
      <div className="panel-hd">
        <span className="title">
          <b>Settings</b> · AI provider, models, keys &amp; integrations
        </span>
        <button className="btn ghost" onClick={onClose}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--hair)",
          padding: "0 12px",
          gap: 4,
        }}
      >
        <TabButton active={tab === "models"} onClick={() => setTab("models")}>
          Roles &amp; models
        </TabButton>
        <TabButton active={tab === "keys"} onClick={() => setTab("keys")}>
          API keys
        </TabButton>
        <TabButton active={tab === "integrations"} onClick={() => setTab("integrations")}>
          Integrations
        </TabButton>
      </div>
      {tab === "integrations" ? (
        <IntegrationsPane />
      ) : !registry || !settings ? (
        <div className="panel-bd">Loading…</div>
      ) : tab === "models" ? (
        <ModelsPane registry={registry} settings={settings} onClose={onClose} />
      ) : (
        <KeysPane registry={registry} />
      )}
    </Overlay>
  );
}

type ModelOpt = { id: string; label: string; note?: string };

function ModelsPane({
  registry,
  settings,
  onClose,
}: {
  registry: ProviderRegistry;
  settings: Record<string, Cfg>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Cfg>>(() => ({ ...settings }));
  const [error, setError] = useState<string | null>(null);
  // provider id → discovered models (only populated once the user clicks refresh)
  const [discovered, setDiscovered] = useState<Record<string, ModelOpt[]>>({});
  const [discoverError, setDiscoverError] = useState<Record<string, string>>({});
  const [discovering, setDiscovering] = useState<Record<string, boolean>>({});

  const refreshModels = async (providerId: string) => {
    setDiscovering((p) => ({ ...p, [providerId]: true }));
    setDiscoverError((p) => {
      const n = { ...p };
      delete n[providerId];
      return n;
    });
    try {
      const res = await api.settings.discoverModels(providerId);
      setDiscovered((p) => ({ ...p, [providerId]: res.models }));
    } catch (err) {
      setDiscoverError((p) => ({
        ...p,
        [providerId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setDiscovering((p) => ({ ...p, [providerId]: false }));
    }
  };

  // Re-seed drafts only when settings identity changes AND there's no
  // in-flight edit. Prior code reset drafts on every settings reference
  // change, which could clobber unsaved edits during a refetch.
  useEffect(() => {
    setDrafts((prev) => {
      if (Object.keys(prev).length === 0) return { ...settings };
      return prev;
    });
  }, [settings]);

  const save = useMutation({
    mutationFn: async (entries: [string, Cfg][]) => {
      if (entries.length === 0) return;
      for (const [role, cfg] of entries) await api.settings.put(role, cfg);
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const setDraft = (role: string, cfg: Partial<Cfg>) =>
    setDrafts((prev) => ({ ...prev, [role]: { ...prev[role], ...cfg } as Cfg }));

  const changedEntries: [string, Cfg][] = Object.entries(drafts).filter(
    ([r, cfg]) =>
      cfg.provider !== settings[r]?.provider || cfg.model !== settings[r]?.model,
  );
  const dirty = changedEntries.length > 0;

  return (
    <div className="panel-bd" style={{ display: "grid", gap: 14 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>
        Each role runs on its own model so you can trade cost against quality.
        Providers without a saved key fall back to canned responses.
      </div>

      {registry.roles.map((r) => {
        const cur: Cfg = drafts[r.id] ?? settings[r.id] ?? {
          provider: "anthropic",
          model: "",
        };
        const provider = registry.providers.find((p) => p.id === cur.provider);
        const keyMissing = provider?.requiresApiKey && !provider.keyPresent;
        const live = discovered[cur.provider];
        const curatedOpts = provider?.models ?? [];
        const seen = new Set<string>();
        const modelOpts: (ModelOpt & { live?: boolean })[] = [];
        for (const m of live ?? []) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          modelOpts.push({ ...m, live: true });
        }
        for (const m of curatedOpts) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          modelOpts.push(m);
        }
        // ensure the currently selected model still appears, even if unknown
        if (cur.model && !seen.has(cur.model)) {
          modelOpts.push({ id: cur.model, label: cur.model });
        }
        return (
          <div
            key={r.id}
            style={{
              display: "grid",
              gridTemplateColumns: "160px 1fr 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid var(--hair)",
            }}
          >
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.label}</div>
              <div className="muted mono" style={{ fontSize: 10.5 }}>
                {r.note}
              </div>
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
            <input
              list={`models-${r.id}`}
              value={cur.model}
              onChange={(e) => setDraft(r.id, { model: e.target.value })}
              placeholder="model id (pick or type)"
              style={{
                ...selectStyle,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <datalist id={`models-${r.id}`}>
              {modelOpts.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.note ? ` — ${m.note}` : ""}
                  {m.live ? " · live" : ""}
                </option>
              ))}
            </datalist>
            <button
              type="button"
              className="btn ghost"
              onClick={() => refreshModels(cur.provider)}
              disabled={discovering[cur.provider] || keyMissing}
              title={
                keyMissing
                  ? `Add an API key for ${provider?.label} to fetch live models`
                  : `Fetch latest models from ${provider?.label}`
              }
              style={{ fontSize: 11 }}
            >
              {discovering[cur.provider] ? "…" : "↻"}
            </button>
            {live && (
              <div
                className="muted mono"
                style={{ gridColumn: "2 / -1", fontSize: 10.5, marginTop: 2 }}
              >
                {live.length} live models from {provider?.label}
              </div>
            )}
            {discoverError[cur.provider] && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  color: "var(--amber)",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                Couldn&rsquo;t fetch models: {discoverError[cur.provider]}
              </div>
            )}
            {keyMissing && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  color: "var(--amber)",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                No key saved for {provider?.label}. Add one in the{" "}
                <span className="mono">API keys</span> tab.
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div style={{ color: "var(--red, #ef4444)", fontSize: 11.5 }}>
          Save failed: {error}
        </div>
      )}

      <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate(changedEntries);
          }}
        >
          {save.isPending ? "Saving…" : dirty ? "Save" : "No changes"}
        </button>
      </div>
    </div>
  );
}

function KeysPane({ registry }: { registry: ProviderRegistry }) {
  const qc = useQueryClient();
  const { data: keys } = useQuery({
    queryKey: ["settings-keys"],
    queryFn: () => api.settings.keys.list(),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["settings-keys"] });
    qc.invalidateQueries({ queryKey: ["settings-providers"] });
  };
  const add = useMutation({
    mutationFn: (body: { provider: string; label: string; key: string }) =>
      api.settings.keys.add(body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.settings.keys.remove(id),
    onSuccess: invalidate,
  });
  const activate = useMutation({
    mutationFn: (id: string) => api.settings.keys.activate(id),
    onSuccess: invalidate,
  });

  const keyProviders = registry.providers.filter((p) => p.requiresApiKey);
  const byProvider: Record<string, StoredKey[]> = {};
  for (const k of keys ?? []) {
    (byProvider[k.provider] ??= []).push(k);
  }

  return (
    <div className="panel-bd" style={{ display: "grid", gap: 16 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>
        Save API keys here once — no more juggling env vars. One key per provider
        is marked active and used for all roles on that provider.
        {keyProviders.some((p) => p.keyEnvVar && !p.storedKeyCount) && (
          <> Env-var fallback still works for providers without a saved key.</>
        )}
      </div>

      {keyProviders.map((p) => (
        <ProviderKeyBlock
          key={p.id}
          provider={p}
          keys={byProvider[p.id] ?? []}
          onAdd={(label, key) => add.mutate({ provider: p.id, label, key })}
          onRemove={(id) => remove.mutate(id)}
          onActivate={(id) => activate.mutate(id)}
          busy={add.isPending || remove.isPending || activate.isPending}
        />
      ))}
    </div>
  );
}

function ProviderKeyBlock({
  provider,
  keys,
  onAdd,
  onRemove,
  onActivate,
  busy,
}: {
  provider: ProviderRegistry["providers"][number];
  keys: StoredKey[];
  onAdd: (label: string, key: string) => void;
  onRemove: (id: string) => void;
  onActivate: (id: string) => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [adding, setAdding] = useState(false);
  const canSubmit = label.trim().length > 0 && key.trim().length >= 4;

  const submit = () => {
    if (!canSubmit) return;
    onAdd(label.trim(), key.trim());
    setLabel("");
    setKey("");
    setAdding(false);
  };

  return (
    <div style={{ border: "1px solid var(--hair)", background: "var(--bg)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--hair)",
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{provider.label}</div>
          <div className="muted mono" style={{ fontSize: 10.5 }}>
            {keys.length} stored · env {provider.keyEnvVar || "—"}
          </div>
        </div>
        {!adding && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add key
          </button>
        )}
      </div>

      {adding && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "160px 1fr auto auto",
            gap: 8,
            padding: 10,
            borderBottom: "1px solid var(--hair)",
            alignItems: "center",
          }}
        >
          <input
            placeholder="label (e.g. personal)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle}
            autoFocus
          />
          <input
            type="password"
            placeholder="sk-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace" }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!canSubmit || busy}
            onClick={submit}
          >
            Save
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setAdding(false);
              setLabel("");
              setKey("");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {keys.length === 0 && !adding && (
        <div
          className="muted"
          style={{ padding: "10px 12px", fontSize: 11.5 }}
        >
          No keys saved.
          {provider.keyEnvVar && (
            <>
              {" "}Falls back to <span className="mono">{provider.keyEnvVar}</span>{" "}
              if set in the environment.
            </>
          )}
        </div>
      )}

      {keys.map((k) => (
        <div
          key={k.id}
          style={{
            display: "grid",
            gridTemplateColumns: "20px 1fr 180px auto",
            gap: 10,
            padding: "8px 12px",
            borderBottom: "1px solid var(--hair)",
            alignItems: "center",
          }}
        >
          <input
            type="radio"
            checked={k.isActive}
            onChange={() => onActivate(k.id)}
            disabled={busy}
            title="Use this key"
          />
          <div style={{ fontSize: 12.5 }}>
            {k.label}
            {k.isActive && (
              <span
                className="mono"
                style={{
                  marginLeft: 8,
                  color: "var(--green)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                }}
              >
                active
              </span>
            )}
          </div>
          <div className="mono muted" style={{ fontSize: 11 }}>{k.masked}</div>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => onRemove(k.id)}
            title="Remove"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Integrations ────────────────────────────────────────────────────────────

const INTEGRATION_OPTIONS = [
  { id: "google_calendar", label: "Google Calendar" },
  { id: "gmail", label: "Gmail" },
  { id: "google_drive", label: "Google Drive" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
  { id: "notion", label: "Notion" },
  { id: "linear", label: "Linear" },
];

function integrationLabel(p: string): string {
  return INTEGRATION_OPTIONS.find((o) => o.id === p)?.label ?? p;
}

function IntegrationsPane() {
  const qc = useQueryClient();
  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.integrations.list(),
  });
  const [editing, setEditing] = useState<Integration | null>(null);
  const [adding, setAdding] = useState(false);

  const refetch = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  const present = new Set(integrations.map((i) => i.provider));
  const missing = INTEGRATION_OPTIONS.filter((o) => !present.has(o.id));

  return (
    <div className="panel-bd" style={{ display: "grid", gap: 14 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>
        Wire external systems (calendar, chat, code hosting) Cortex is allowed
        to read or post to. OAuth sign-in lands in phase 2; for now you can
        record that an integration exists and toggle its status.
      </div>

      <div style={{ border: "1px solid var(--hair)", background: "var(--bg)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>Connected</div>
          <button
            type="button"
            className="btn"
            onClick={() => setAdding(true)}
            disabled={missing.length === 0}
            title={missing.length === 0 ? "All known integrations are already added" : undefined}
          >
            + Add
          </button>
        </div>
        {integrations.length === 0 ? (
          <div className="muted" style={{ padding: "12px", fontSize: 11.5 }}>
            No integrations yet. Click <b>Add</b> to record one.
          </div>
        ) : (
          integrations.map((it) => (
            <IntegrationRow
              key={it.id}
              integration={it}
              onEdit={() => setEditing(it)}
              onChanged={refetch}
            />
          ))
        )}
      </div>

      {editing && (
        <EditIntegrationInline
          integration={editing}
          onDone={() => {
            setEditing(null);
            refetch();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {adding && (
        <AddIntegrationInline
          options={missing}
          onDone={() => {
            setAdding(false);
            refetch();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function IntegrationRow({
  integration,
  onEdit,
  onChanged,
}: {
  integration: Integration;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toggle = useMutation({
    mutationFn: () =>
      api.integrations.patch(integration.id, {
        status: integration.status === "connected" ? "disconnected" : "connected",
      }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.integrations.remove(integration.id),
    onSuccess: onChanged,
  });

  const connected = integration.status === "connected";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid var(--hair)",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 12.5 }}>{integrationLabel(integration.provider)}</div>
        <div className="muted mono" style={{ fontSize: 10.5 }}>
          {integration.detail || "no detail"}
          {integration.lastSyncedAt
            ? ` · synced ${new Date(integration.lastSyncedAt).toLocaleDateString()}`
            : ""}
        </div>
      </div>
      <span
        className="chip"
        style={{
          color: connected ? "var(--green)" : "var(--muted)",
          borderColor: connected
            ? "color-mix(in oklch, var(--green), transparent 70%)"
            : "var(--hair-2)",
        }}
      >
        {integration.status}
      </span>
      <button
        type="button"
        className="btn ghost"
        style={{ fontSize: 11 }}
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
      >
        {connected ? "Disconnect" : "Reconnect"}
      </button>
      <button
        type="button"
        className="btn ghost"
        style={{ fontSize: 11 }}
        onClick={onEdit}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn ghost"
        style={{ fontSize: 11, color: "var(--red, #ef4444)", gridColumn: "4 / 5" }}
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
        title="Remove"
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

function AddIntegrationInline({
  options,
  onDone,
  onCancel,
}: {
  options: { id: string; label: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState(options[0]?.id ?? "");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api.integrations.create({
        provider,
        status: "connected",
        detail: detail || null,
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div
      style={{
        border: "1px solid var(--hair)",
        background: "var(--bg)",
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>New integration</div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <span className="caps">Provider</span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={selectStyle}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="caps">Detail</span>
        <input
          value={detail}
          placeholder="primary calendar · @rafe"
          onChange={(e) => setDetail(e.target.value)}
          style={inputStyle}
        />
      </div>
      {error && (
        <div style={{ color: "var(--red, #ef4444)", fontSize: 11.5 }}>{error}</div>
      )}
      <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setError(null);
            add.mutate();
          }}
          disabled={add.isPending || !provider}
        >
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

function EditIntegrationInline({
  integration,
  onDone,
  onCancel,
}: {
  integration: Integration;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<Integration["status"]>(integration.status);
  const [detail, setDetail] = useState(integration.detail ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.integrations.patch(integration.id, {
        status: status as "connected" | "available" | "disconnected",
        detail,
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div
      style={{
        border: "1px solid var(--hair)",
        background: "var(--bg)",
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>
        Edit {integrationLabel(integration.provider)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
        <span className="caps">Status</span>
        <div className="seg-mini">
          {(["connected", "available", "disconnected"] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-active={status === s}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="caps">Detail</span>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="2 calendars · last sync 3m ago"
          style={inputStyle}
        />
      </div>
      {error && (
        <div style={{ color: "var(--red, #ef4444)", fontSize: 11.5 }}>{error}</div>
      )}
      <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "9px 12px",
        fontSize: 11.5,
        color: active ? "var(--text)" : "var(--muted)",
        borderBottom: active ? "2px solid var(--text)" : "2px solid transparent",
        marginBottom: -1,
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: "uppercase",
        letterSpacing: ".08em",
      }}
    >
      {children}
    </button>
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

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--hair-2)",
  padding: "6px 8px",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
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
        style={{ width: 720, background: "var(--panel)", maxHeight: "85vh", overflow: "auto" }}
      >
        {children}
      </div>
    </div>
  );
}
