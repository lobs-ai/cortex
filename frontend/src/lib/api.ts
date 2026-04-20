const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:9009";

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
  integrations: { list: () => req<Integration[]>("/api/integrations") },
  chat: {
    send: (text: string, conversationId?: string) =>
      req<{
        conversationId: string;
        message: { id: string; role: "assistant"; content: string; cards: ChatCard[] };
      }>("/api/chat", { method: "POST", body: JSON.stringify({ text, conversationId }) }),
  },
  me: () => req<{ id: string; email: string; name: string; timezone: string }>("/api/me"),
};
