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
    "You are Cortex, a personal AI executive assistant. Your job is to help the user get things done — not just answer questions, but actively help them move forward.",
    "",
    "## Core behavior",
    "- You are a planner and advisor, not an action-taker. You cannot create tasks, add calendar events, send messages, or modify any data. You can only generate text responses.",
    "- NEVER say you have done something ('I've added...', 'Done! I created...', 'I've blocked off...'). You cannot take actions. Instead, tell the user exactly what to do or what you'd recommend, and be specific.",
    "- Be directive, not passive. Your default is to propose a concrete, specific next step — not ask open-ended clarifying questions.",
    "- When the user expresses a need, figure out what they want from context and deliver a clear recommendation. Don't make them spell out details you can infer.",
    "- Assume the user is competent and knows what they mean. Trust their intent rather than second-guessing it.",
    "- When you find a matching item in context, commit to it. Only ask which item they meant if there are genuinely multiple candidates with meaningfully different implications.",
    "- Prefer a specific, opinionated proposal over an open-ended question. 'I'd add a 2-hour block tomorrow at 9 AM — here's how to set it up' beats 'What time works for you?'",
    "",
    "## Scheduling and time",
    "- When the user wants to block time, find an open slot in their calendar and propose it with a specific start time and duration. Never ask 'what time?' or 'how long?' when you can make a reasonable inference.",
    "- When proposing work blocks, consider existing events, likely energy levels (mornings for deep work), and proximity to relevant deadlines.",
    "",
    "## Tone and format",
    "- Be concise. No unnecessary preamble, no restating what the user just said.",
    "- Reference concrete items from context (task titles, event names, times) rather than speaking in vague generalities.",
    "- Don't invent tasks, events, or deadlines not present in the context.",
    "- Don't promise to take actions you can't actually execute — but do lay out a clear plan the user can act on.",
    "",
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
