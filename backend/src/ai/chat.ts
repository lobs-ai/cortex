import { complete } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { listTasks } from "../services/tasks.js";
import { listEvents } from "../services/events.js";
import { listProjects } from "../services/projects.js";
import { listTendencies } from "../services/memory.js";
import { getRoleModel } from "../services/settings.js";

export type ChatCard =
  | { kind: "plan"; title: string; blocks: { start: string; end: string; label: string; task?: string; event?: string }[] }
  | { kind: "items"; title: string; blocks: { label: string; sub: string }[] };

export type ChatReply = { text: string; cards: ChatCard[]; usage?: { in: number; out: number } };

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

export async function chatReply(userId: string, userText: string, history: { role: string; content: string }[]): Promise<ChatReply> {
  const cfg = await getRoleModel(userId, "chat");
  const entry = getProvider(cfg.provider);
  if (!entry) {
    throw new ChatError(
      `No chat model is configured (provider "${cfg.provider}" not found). Pick a chat model in Settings.`,
    );
  }
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) {
      throw new ChatError(
        `No API key on file for ${entry.label ?? cfg.provider}. Add one in Settings → Integrations and try again.`,
      );
    }
  }

  const [tasks, events, projects, tendencies] = await Promise.all([
    listTasks(userId),
    listEvents(userId, { from: startOfToday(), to: inDays(7) }),
    listProjects(userId),
    listTendencies(userId),
  ]);

  const context = {
    now: new Date().toISOString(),
    tasks: tasks.filter((t) => t.status !== "done").slice(0, 20),
    events: events.slice(0, 20),
    projects: projects.filter((p) => p.status === "active"),
    tendencies: tendencies.slice(0, 6),
  };

  const system = [
    "You are Cortex, a personal AI executive assistant. You reason over the user's structured schedule, tasks, projects, and learned tendencies.",
    "Respond conversationally but concisely. Reference concrete items (task titles, times) from the context when relevant.",
    "Do not invent tasks or events that aren't in the context. Do not promise to take actions unless the user asked.",
    "Context is delivered as JSON below. Times are ISO-8601 in the user's timezone.",
    "",
    `CONTEXT:\n${JSON.stringify(context, null, 2)}`,
  ].join("\n");

  let result: Awaited<ReturnType<typeof complete>>;
  try {
    result = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 600,
      messages: [
        ...history.slice(-8).map((h) => ({
          role: h.role === "user" ? ("user" as const) : ("assistant" as const),
          content: h.content,
        })),
        { role: "user" as const, content: userText },
      ],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ChatError(`Chat model (${cfg.provider}/${cfg.model}) failed: ${detail}`);
  }

  if (!result || !result.text.trim()) {
    throw new ChatError(`Chat model (${cfg.provider}/${cfg.model}) returned no response.`);
  }

  return {
    text: result.text,
    cards: [],
    usage: result.usage,
  };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function inDays(n: number) {
  const d = startOfToday();
  d.setDate(d.getDate() + n);
  return d;
}
