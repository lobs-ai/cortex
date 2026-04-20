import { completeWithTools, type ToolDef, type ToolHandler } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { listTasks, createTask, patchTask, deleteTask } from "../services/tasks.js";
import { listEvents, createEvent, patchEvent, deleteEvent } from "../services/events.js";
import { listProjects } from "../services/projects.js";
import { listTendencies } from "../services/memory.js";
import { getRoleModel } from "../services/settings.js";
import { TaskCreate, TaskPatch } from "../schemas/tasks.js";
import { EventCreate, EventPatch } from "../schemas/events.js";

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

const CHAT_TOOLS: ToolDef[] = [
  {
    name: "create_task",
    description: "Create a new task for the user.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Optional notes" },
        dueDate: { type: "string", description: "ISO-8601 date, e.g. 2026-04-21" },
        priority: { type: "string", enum: ["P0", "P1", "P2"], description: "P0=urgent, P1=high, P2=normal" },
        status: { type: "string", enum: ["inbox", "today", "doing", "done"] },
        estimatedMinutes: { type: "number", description: "Estimated duration in minutes" },
        projectId: { type: "string", description: "Project ID from context" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update fields on an existing task.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID from context" },
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "ISO-8601 date or null to clear" },
        priority: { type: "string", enum: ["P0", "P1", "P2"] },
        status: { type: "string", enum: ["inbox", "today", "doing", "done"] },
        estimatedMinutes: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description: "Delete a task by ID.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Task ID from context" } },
      required: ["id"],
    },
  },
  {
    name: "create_event",
    description: "Create a calendar event or time block.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        startTime: { type: "string", description: "ISO-8601 datetime" },
        endTime: { type: "string", description: "ISO-8601 datetime" },
        description: { type: "string" },
        kind: { type: "string", enum: ["meeting", "class", "teach", "personal", "deadline", "block"] },
        important: { type: "boolean" },
      },
      required: ["title", "startTime", "endTime"],
    },
  },
  {
    name: "update_event",
    description: "Update an existing calendar event.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event ID from context" },
        title: { type: "string" },
        startTime: { type: "string", description: "ISO-8601 datetime" },
        endTime: { type: "string", description: "ISO-8601 datetime" },
        description: { type: "string" },
        kind: { type: "string", enum: ["meeting", "class", "teach", "personal", "deadline", "block"] },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_event",
    description: "Delete a calendar event by ID.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Event ID from context" } },
      required: ["id"],
    },
  },
];

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
    "You are Cortex, a personal AI executive assistant. Your job is to help the user get things done — not just advise, but actually act.",
    "",
    "## What you can do",
    "You have tools to create, update, and delete tasks and calendar events. Use them whenever the user asks you to add, change, or remove something. Don't ask for permission — just do it and confirm concisely.",
    "",
    "## Core behavior",
    "- Be an executor. When the user asks for something to be done, do it with your tools, then confirm what you did in one sentence.",
    "- When the user expresses a need, figure out the details from context and act. Don't make them spell out information you can infer.",
    "- Assume the user is competent and knows what they mean. Trust their intent rather than second-guessing it.",
    "- When you find a matching item in context, commit to it. Only ask which item they meant if there are genuinely multiple candidates with meaningfully different implications.",
    "- Prefer a specific, opinionated action over an open-ended question. Act first, then offer to adjust.",
    "",
    "## Scheduling and time",
    "- When the user wants to block time, look at their existing events in context to find an open slot, pick one, and create it. Use kind='block' for focused work sessions.",
    "- When scheduling work blocks, prefer mornings for deep work and choose a duration that fits the task.",
    "",
    "## Tone and format",
    "- After using a tool, confirm what you did concisely. Don't be verbose.",
    "- Reference concrete items from context (task titles, event names, times) rather than speaking in generalities.",
    "- Don't invent tasks or events not in the context.",
    "",
    "Context is delivered as JSON below. Times are ISO-8601 in the user's timezone.",
    "",
    `CONTEXT:\n${JSON.stringify(context, null, 2)}`,
  ].join("\n");

  const toolHandlers: Record<string, ToolHandler> = {
    create_task: async (input) => {
      const parsed = TaskCreate.parse(input);
      return createTask(userId, parsed);
    },
    update_task: async (input) => {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      const parsed = TaskPatch.parse(rest);
      return patchTask(userId, id, parsed);
    },
    delete_task: async (input) => {
      const { id } = input as { id: string };
      await deleteTask(userId, id);
      return { success: true };
    },
    create_event: async (input) => {
      const parsed = EventCreate.parse(input);
      return createEvent(userId, parsed);
    },
    update_event: async (input) => {
      const { id, ...rest } = input as { id: string } & Record<string, unknown>;
      const parsed = EventPatch.parse(rest);
      return patchEvent(userId, id, parsed);
    },
    delete_event: async (input) => {
      const { id } = input as { id: string };
      await deleteEvent(userId, id);
      return { success: true };
    },
  };

  let result: Awaited<ReturnType<typeof completeWithTools>>;
  try {
    result = await completeWithTools(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 1500,
      messages: [
        ...history.slice(-8).map((h) => ({
          role: h.role === "user" ? ("user" as const) : ("assistant" as const),
          content: h.content,
        })),
        { role: "user" as const, content: userText },
      ],
    }, CHAT_TOOLS, toolHandlers);
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
