"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Integration, type StoredKey } from "@/lib/api";
import {
  INTEGRATION_SPECS,
  type ConfigField,
  type IntegrationSpec,
} from "@/lib/integrationSpecs";
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

function IntegrationsPane() {
  const qc = useQueryClient();
  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.integrations.list(),
  });
  const refetch = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const [expandedId, setExpandedId] = useState<string | null>("google");

  return (
    <div className="panel-bd" style={{ display: "grid", gap: 10 }}>
      <div className="muted" style={{ fontSize: 11.5, paddingBottom: 4 }}>
        Everything you need to connect external systems is right here. Follow the
        steps, paste your credentials, and Cortex takes it from there. Live =
        sync is running. Saved-only = credentials stored; sync lands in a later
        release.
      </div>

      {INTEGRATION_SPECS.map((spec) => (
        <IntegrationCard
          key={spec.id}
          spec={spec}
          integrations={integrations}
          expanded={expandedId === spec.id}
          onToggleExpand={() =>
            setExpandedId((cur) => (cur === spec.id ? null : spec.id))
          }
          onChanged={refetch}
        />
      ))}
    </div>
  );
}

function IntegrationCard({
  spec,
  integrations,
  expanded,
  onToggleExpand,
  onChanged,
}: {
  spec: IntegrationSpec;
  integrations: Integration[];
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void;
}) {
  const rows = integrations.filter((i) =>
    spec.features.some((f) => f.id === i.provider),
  );
  const anyConnected = rows.some((r) => r.status === "connected");

  // Summary status text shown collapsed
  let statusText: string;
  let statusColor: "green" | "yellow" | "muted";
  if (spec.oauth) {
    const masterRow = integrations.find((i) => i.provider === spec.configProvider);
    if (masterRow?.status === "connected") {
      statusText = masterRow.detail ? `connected · ${masterRow.detail}` : "connected";
      statusColor = "green";
    } else {
      statusText = "not connected";
      statusColor = "muted";
    }
  } else if (anyConnected) {
    statusText = "credentials saved";
    statusColor = "yellow";
  } else {
    statusText = "not configured";
    statusColor = "muted";
  }

  return (
    <div style={{ border: "1px solid var(--hair)", background: "var(--bg)" }}>
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          gap: 10,
          alignItems: "center",
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          color: "var(--text)",
        }}
      >
        <Icon name={expanded ? "chevD" : "chevR"} size={11} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{spec.label}</div>
          <div className="muted" style={{ fontSize: 11 }}>{spec.summary}</div>
        </div>
        <span
          className="chip"
          style={{
            color:
              statusColor === "green"
                ? "var(--green)"
                : statusColor === "yellow"
                  ? "var(--yellow, #eab308)"
                  : "var(--muted)",
            borderColor:
              statusColor === "green"
                ? "color-mix(in oklch, var(--green), transparent 70%)"
                : statusColor === "yellow"
                  ? "color-mix(in oklch, var(--yellow, #eab308), transparent 70%)"
                  : "var(--hair-2)",
          }}
        >
          {statusText}
        </span>
        <span className="caps muted" style={{ fontSize: 10 }}>
          {expanded ? "hide" : "setup"}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--hair)",
            padding: "14px 12px 16px",
            display: "grid",
            gap: 16,
          }}
        >
          <SetupStepsBlock spec={spec} />
          <ConfigFieldsBlock spec={spec} onChanged={onChanged} />
          <ActionBlock
            spec={spec}
            integrations={integrations}
            onChanged={onChanged}
          />
          {spec.features.length > 1 && (
            <FeatureTogglesBlock
              spec={spec}
              integrations={integrations}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SetupStepsBlock({ spec }: { spec: IntegrationSpec }) {
  return (
    <div>
      <div className="caps muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
        1. Set up on {spec.label}'s side
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
        {spec.steps.map((step, i) => (
          <li key={i} style={{ fontSize: 11.5, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 500 }}>{step.title}</div>
            <div className="muted" style={{ whiteSpace: "pre-line" }}>
              {step.body}
            </div>
            {step.link && (
              <a
                href={step.link.href}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: 11,
                  color: "var(--accent, #4f7cff)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  marginTop: 2,
                  display: "inline-block",
                }}
              >
                {step.link.label} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ConfigFieldsBlock({
  spec,
  onChanged,
}: {
  spec: IntegrationSpec;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data, refetch: refetchCfg } = useQuery({
    queryKey: ["integration-config", spec.configProvider],
    queryFn: () => api.integrations.getConfig(spec.configProvider),
  });
  const saved = data?.fields ?? {};

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const fields: Record<string, string | null> = {};
      for (const f of spec.fields) {
        // Empty string = clear. Undefined = don't touch.
        if (drafts[f.key] !== undefined) fields[f.key] = drafts[f.key];
      }
      if (Object.keys(fields).length === 0) return;
      await api.integrations.putConfig(spec.configProvider, fields);
    },
    onSuccess: () => {
      setError(null);
      setDrafts({});
      setSavedAt(Date.now());
      refetchCfg();
      qc.invalidateQueries({ queryKey: ["integrations-google-status"] });
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const clear = useMutation({
    mutationFn: () => api.integrations.clearConfig(spec.configProvider),
    onSuccess: () => {
      setError(null);
      setDrafts({});
      refetchCfg();
      qc.invalidateQueries({ queryKey: ["integrations-google-status"] });
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const hasDrafts = Object.values(drafts).some((v) => v !== undefined);
  const hasAnySaved = Object.keys(saved).length > 0;

  return (
    <div>
      <div
        className="caps muted"
        style={{ fontSize: 10.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}
      >
        <span>2. Paste your credentials</span>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span style={{ color: "var(--green)", textTransform: "none" }}>
            ✓ saved
          </span>
        )}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {spec.fields.map((f) => (
          <ConfigFieldRow
            key={f.key}
            field={f}
            present={saved[f.key]?.present === true}
            masked={saved[f.key]?.masked ?? ""}
            value={drafts[f.key]}
            revealed={!!revealed[f.key]}
            onChange={(val) => setDrafts((d) => ({ ...d, [f.key]: val }))}
            onReveal={() => setRevealed((r) => ({ ...r, [f.key]: !r[f.key] }))}
          />
        ))}
      </div>
      {error && (
        <div style={{ color: "var(--red, #ef4444)", fontSize: 11.5, marginTop: 8 }}>
          {error}
        </div>
      )}
      <div className="row gap-2" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        {hasAnySaved && (
          <button
            type="button"
            className="btn ghost"
            style={{ color: "var(--red, #ef4444)" }}
            onClick={() => {
              if (confirm(`Clear all ${spec.label} credentials?`)) clear.mutate();
            }}
            disabled={clear.isPending}
          >
            Clear credentials
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          onClick={() => save.mutate()}
          disabled={!hasDrafts || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save credentials"}
        </button>
      </div>
    </div>
  );
}

function ConfigFieldRow({
  field,
  present,
  masked,
  value,
  revealed,
  onChange,
  onReveal,
}: {
  field: ConfigField;
  present: boolean;
  masked: string;
  value: string | undefined;
  revealed: boolean;
  onChange: (v: string) => void;
  onReveal: () => void;
}) {
  const isSecret = field.type === "secret";
  const placeholder = present ? masked : field.placeholder ?? "";
  const displayValue = value !== undefined ? value : "";
  const common: React.CSSProperties = { ...inputStyle, width: "100%" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 11.5 }}>
          {field.label}
          {field.required && <span style={{ color: "var(--red, #ef4444)" }}> *</span>}
        </div>
        {field.help && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            {field.help}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {field.type === "textarea" ? (
          <textarea
            value={displayValue}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            style={{ ...common, fontFamily: "'JetBrains Mono', monospace", resize: "vertical" }}
          />
        ) : (
          <input
            type={isSecret && !revealed && value === undefined ? "password" : "text"}
            value={displayValue}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{
              ...common,
              fontFamily: isSecret ? "'JetBrains Mono', monospace" : undefined,
            }}
            autoComplete="off"
            spellCheck={false}
          />
        )}
        {isSecret && (
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 11 }}
            onClick={onReveal}
            title={revealed ? "Hide" : "Show"}
          >
            <Icon name={revealed ? "x" : "check"} size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function ActionBlock({
  spec,
  integrations,
  onChanged,
}: {
  spec: IntegrationSpec;
  integrations: Integration[];
  onChanged: () => void;
}) {
  const { data: googleStatus } = useQuery({
    queryKey: ["integrations-google-status"],
    queryFn: () => api.integrations.googleStatus(),
    enabled: spec.oauth,
  });
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (!spec.oauth) {
    // Non-OAuth providers: the "Save credentials" button in ConfigFieldsBlock
    // is the action. Nothing to show here.
    return null;
  }

  const master = integrations.find((i) => i.provider === spec.configProvider);
  const connected = master?.status === "connected";
  const configured = googleStatus?.configured ?? false;

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      await api.integrations.connectGoogle();
      onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "window_closed") setError(msg);
    } finally {
      setConnecting(false);
    }
  };

  const sync = useMutation({
    mutationFn: () => api.integrations.syncCalendar(),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const disconnect = useMutation({
    mutationFn: () => api.integrations.disconnectGoogle(),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div>
      <div className="caps muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
        3. Connect
      </div>
      {!configured ? (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text)",
            background: "color-mix(in oklch, var(--yellow, #eab308), transparent 88%)",
            border: "1px solid color-mix(in oklch, var(--yellow, #eab308), transparent 70%)",
            padding: "8px 10px",
            borderRadius: 4,
          }}
        >
          Save your OAuth client ID and secret above first, then come back here
          to connect.
        </div>
      ) : connected ? (
        <div>
          <div className="muted mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
            Connected as {master?.detail ?? "unknown"} ·{" "}
            {master?.lastSyncedAt
              ? `last synced ${new Date(master.lastSyncedAt).toLocaleString()}`
              : "never synced"}
          </div>
          <div className="row gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? "Syncing…" : "Sync calendar now"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (confirm("Disconnect Google? This revokes tokens and turns off all three features."))
                  disconnect.mutate();
              }}
              disabled={disconnect.isPending}
            >
              Disconnect Google
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn primary"
          onClick={connect}
          disabled={connecting}
        >
          {connecting ? "Opening Google…" : `Connect ${spec.label}`}
        </button>
      )}
      {error && (
        <div style={{ color: "var(--red, #ef4444)", fontSize: 11.5, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function FeatureTogglesBlock({
  spec,
  integrations,
  onChanged,
}: {
  spec: IntegrationSpec;
  integrations: Integration[];
  onChanged: () => void;
}) {
  const master = integrations.find((i) => i.provider === spec.configProvider);
  const masterConnected = master?.status === "connected";

  return (
    <div>
      <div className="caps muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
        4. Products (toggle each on/off)
      </div>
      <div
        style={{
          border: "1px solid var(--hair-2)",
          borderRadius: 4,
        }}
      >
        {spec.features.map((feat, idx) => {
          const row = integrations.find((i) => i.provider === feat.id);
          return (
            <FeatureToggleRow
              key={feat.id}
              feature={feat}
              row={row ?? null}
              disabled={!masterConnected}
              isLast={idx === spec.features.length - 1}
              onChanged={onChanged}
            />
          );
        })}
      </div>
      {!masterConnected && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          Connect {spec.label} first to enable these toggles.
        </div>
      )}
    </div>
  );
}

function FeatureToggleRow({
  feature,
  row,
  disabled,
  isLast,
  onChanged,
}: {
  feature: IntegrationSpec["features"][number];
  row: Integration | null;
  disabled: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
  const enabled = row?.status === "connected";
  const toggle = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("feature row missing — reconnect required");
      return api.integrations.patch(row.id, {
        status: enabled ? "disconnected" : "connected",
      });
    },
    onSuccess: onChanged,
  });

  const implChipColor =
    feature.implementation === "live"
      ? "var(--green)"
      : feature.implementation === "saved-only"
        ? "var(--yellow, #eab308)"
        : "var(--muted)";
  const implChipBorder =
    feature.implementation === "live"
      ? "color-mix(in oklch, var(--green), transparent 70%)"
      : feature.implementation === "saved-only"
        ? "color-mix(in oklch, var(--yellow, #eab308), transparent 70%)"
        : "var(--hair-2)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        borderBottom: isLast ? undefined : "1px solid var(--hair-2)",
      }}
    >
      <div>
        <div style={{ fontSize: 12 }}>{feature.label}</div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {feature.description}
          {feature.implementationNote ? ` · ${feature.implementationNote}` : ""}
        </div>
      </div>
      <span
        className="chip"
        style={{ color: implChipColor, borderColor: implChipBorder }}
      >
        {feature.implementation === "live"
          ? "live"
          : feature.implementation === "saved-only"
            ? "saved-only"
            : "planned"}
      </span>
      <button
        type="button"
        className="btn ghost"
        style={{ fontSize: 11 }}
        onClick={() => toggle.mutate()}
        disabled={disabled || toggle.isPending || !row}
        title={disabled ? "Connect first" : enabled ? "Disable this feature" : "Enable this feature"}
      >
        {enabled ? "On" : "Off"}
      </button>
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
