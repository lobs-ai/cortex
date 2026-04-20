// Empty base → same-origin. Fastify + Next share one port now.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type Task = {
  id: string;
  title: string;
  description: string | null;
  due: string | null;
  priority: "P0" | "P1" | "P2";
  status: "inbox" | "today" | "doing" | "done";
  estMin: number | null;
  actualMin: number | null;
  project: string | null;
  energy: "low" | "med" | "high";
  tags: string[];
  completedAt: string | null;
};

export type Event = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  kind: "meeting" | "class" | "teach" | "personal" | "deadline" | "block";
  project: string | null;
  attendees: number | null;
  important: boolean;
  status: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  targetDate: string | null;
  health: number;
  tasksOpen: number;
  tasksDone: number;
  lastActivity: string | null;
};

export type Alert = {
  id: string;
  severity: "high" | "med" | "low";
  kind: string;
  title: string;
  body: string;
  actions: string[];
  relatedType: string | null;
  relatedId: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

export type PlanBlock = {
  start: string;
  end: string;
  label: string;
  sub?: string;
  kind: string;
  hero?: boolean;
};

export type Plan = {
  id: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  content: { summary: string; blocks: PlanBlock[]; generatedAt?: string };
  generatedBy: string;
  createdAt: string;
};

export type Tendency = {
  id: string;
  text: string;
  evidence: number;
  confidence: number;
  status: string;
  lastSeen: string;
  type: string;
};

export type Preference = {
  id: string;
  key: string;
  value: unknown;
  source: string;
  confidence: number;
};

export type Recurring = {
  id: string;
  title: string;
  project: string | null;
  cadence: string;
  cadenceDetail: string | null;
  time: string | null;
  estMin: number | null;
  priority: "P0" | "P1" | "P2";
  energy: "low" | "med" | "high";
  streak: number;
  weeklyRate: number;
  completedToday: boolean;
  lastCompletedAt: string | null;
  paused: boolean;
  managedByAi: boolean;
  suggestedBy: string | null;
  note: string | null;
};

export type RecurringSuggestion = {
  id: string;
  action: "create" | "adjust" | "pause" | string;
  title: string;
  body: string;
  cadence: string | null;
  confidence: number;
  evidence: number;
  relatedRecurringId: string | null;
};

export type Integration = {
  id: string;
  provider: string;
  status: string;
  detail: string | null;
  lastSyncedAt: string | null;
};

export type ChatCard =
  | { kind: "plan"; title: string; blocks: { start: string; end: string; label: string }[] }
  | { kind: "items"; title: string; blocks: { label: string; sub: string }[] };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: ChatCard[];
  createdAt?: string;
};

export const api = {
  tasks: {
    list: () => req<Task[]>("/api/tasks"),
    create: (body: Partial<Task> & { title: string }) =>
      req<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
    patch: (id: string, body: Partial<Task>) =>
      req<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
  },
  events: {
    list: (from?: Date, to?: Date) => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from.toISOString());
      if (to) qs.set("to", to.toISOString());
      return req<Event[]>(`/api/events?${qs.toString()}`);
    },
    create: (body: {
      title: string;
      description?: string;
      location?: string;
      startTime: Date;
      endTime: Date;
      kind: Event["kind"];
      projectId?: string | null;
      important?: boolean;
    }) =>
      req<Event>("/api/events", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          startTime: body.startTime.toISOString(),
          endTime: body.endTime.toISOString(),
        }),
      }),
    patch: (id: string, body: Partial<Event>) =>
      req<Event>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean }>(`/api/events/${id}`, { method: "DELETE" }),
  },
  projects: { list: () => req<Project[]>("/api/projects") },
  plans: {
    today: () => req<Plan | null>("/api/plans/today"),
    generate: () => req<Plan>("/api/plans/generate", { method: "POST", body: "{}" }),
  },
  notifications: {
    list: () => req<Alert[]>("/api/notifications"),
    dismiss: (id: string) =>
      req<{ ok: boolean }>(`/api/notifications/${id}/dismiss`, { method: "POST" }),
    scan: () => req<{ created: number }>("/api/notifications/scan", { method: "POST" }),
  },
  memory: {
    preferences: () => req<Preference[]>("/api/memory/preferences"),
    tendencies: () => req<Tendency[]>("/api/memory/tendencies"),
    patchTendency: (id: string, body: Partial<Tendency>) =>
      req<{ ok: boolean }>(`/api/memory/tendencies/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },
  recurring: {
    list: () => req<Recurring[]>("/api/recurring"),
    create: (body: {
      title: string;
      cadence: string;
      cadenceDetail?: string | null;
      time?: string | null;
      estMin?: number | null;
      projectId?: string | null;
      priority?: "P0" | "P1" | "P2";
      energy?: "low" | "med" | "high";
      note?: string | null;
    }) => req<Recurring>("/api/recurring", { method: "POST", body: JSON.stringify(body) }),
    patch: (
      id: string,
      body: Partial<{
        title: string;
        cadence: string;
        cadenceDetail: string | null;
        time: string | null;
        estMin: number | null;
        paused: boolean;
        priority: "P0" | "P1" | "P2";
        energy: "low" | "med" | "high";
        note: string | null;
      }>,
    ) =>
      req<Recurring>(`/api/recurring/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    toggle: (id: string) =>
      req<Recurring>(`/api/recurring/${id}/toggle`, { method: "POST" }),
    remove: (id: string) =>
      req<{ ok: boolean }>(`/api/recurring/${id}`, { method: "DELETE" }),
    suggestions: () => req<RecurringSuggestion[]>("/api/recurring/suggestions"),
    dismissSuggestion: (id: string) =>
      req<{ ok: boolean }>(`/api/recurring/suggestions/${id}/dismiss`, {
        method: "POST",
      }),
  },
  integrations: {
    list: () => req<Integration[]>("/api/integrations"),
    create: (body: { provider: string; status?: string; detail?: string | null }) =>
      req<{ id: string }>("/api/integrations", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patch: (
      id: string,
      body: Partial<{
        status: "connected" | "available" | "disconnected";
        detail: string | null;
      }>,
    ) =>
      req<Integration>(`/api/integrations/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      req<{ ok: boolean }>(`/api/integrations/${id}`, { method: "DELETE" }),
    disconnect: (id: string) =>
      req<{ ok: boolean }>(`/api/integrations/${id}/disconnect`, { method: "POST" }),
    googleStatus: () =>
      req<{ configured: boolean }>("/api/integrations/google/status"),
    // Opens Google OAuth in a popup. Resolves when the callback page posts
    // back, rejects on timeout or user-close.
    connectGoogle: (): Promise<{ ok: boolean; message?: string }> =>
      new Promise((resolve, reject) => {
        const url = `${BASE}/api/integrations/google/connect`;
        const popup = window.open(url, "cortex-google-oauth", "width=720,height=720");
        if (!popup) {
          reject(new Error("Popup blocked — allow popups for this site"));
          return;
        }
        const TIMEOUT_MS = 5 * 60 * 1000;
        let finished = false;
        const cleanup = () => {
          finished = true;
          window.removeEventListener("message", onMessage);
          clearInterval(closedPoll);
          clearTimeout(timeout);
        };
        const onMessage = (ev: MessageEvent) => {
          const data = ev.data as { type?: string; ok?: boolean; message?: string } | undefined;
          if (!data || data.type !== "google-oauth") return;
          cleanup();
          if (data.ok) resolve({ ok: true, message: data.message });
          else reject(new Error(data.message || "connection failed"));
        };
        const closedPoll = setInterval(() => {
          if (popup.closed && !finished) {
            cleanup();
            reject(new Error("window_closed"));
          }
        }, 500);
        const timeout = setTimeout(() => {
          cleanup();
          try { popup.close(); } catch {}
          reject(new Error("timeout"));
        }, TIMEOUT_MS);
        window.addEventListener("message", onMessage);
      }),
    syncCalendar: () =>
      req<{ synced: number; inserted: number; updated: number; cancelled: number }>(
        "/api/calendar/sync",
        { method: "POST" },
      ),
  },
  chat: {
    send: (text: string, conversationId?: string) =>
      req<{
        conversationId: string;
        message: { id: string; role: "assistant"; content: string; cards: ChatCard[] };
      }>("/api/chat", { method: "POST", body: JSON.stringify({ text, conversationId }) }),
  },
  me: () => req<{ id: string; email: string; name: string; timezone: string }>("/api/me"),
  settings: {
    get: () => req<Record<string, { provider: string; model: string }>>("/api/settings"),
    providers: () =>
      req<{
        providers: {
          id: string;
          label: string;
          requiresApiKey: boolean;
          keyEnvVar: string;
          keyPresent: boolean;
          storedKeyCount: number;
          models: { id: string; label: string; note?: string }[];
        }[];
        roles: { id: string; label: string; note: string }[];
      }>("/api/settings/providers"),
    put: (role: string, body: { provider: string; model: string }) =>
      req<{ ok: boolean }>(`/api/settings/${role}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    discoverModels: (provider: string) =>
      req<{ provider: string; models: { id: string; label: string; note?: string }[] }>(
        `/api/settings/providers/${encodeURIComponent(provider)}/models`,
      ),
    keys: {
      list: () =>
        req<StoredKey[]>("/api/settings/keys"),
      add: (body: { provider: string; label: string; key: string }) =>
        req<StoredKey>("/api/settings/keys", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      remove: (id: string) =>
        req<{ ok: boolean }>(`/api/settings/keys/${id}`, { method: "DELETE" }),
      activate: (id: string) =>
        req<{ ok: boolean }>(`/api/settings/keys/${id}/activate`, { method: "POST" }),
    },
  },
};

export type StoredKey = {
  id: string;
  provider: string;
  label: string;
  masked: string;
  isActive: boolean;
  createdAt: string;
};
