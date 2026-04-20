import { completeWithTools, type ToolDef, type ToolHandler } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { listTasks, createTask, patchTask, deleteTask } from "../services/tasks.js";
import { listEvents, createEvent, patchEvent, deleteEvent, rsvpEvent } from "../services/events.js";
import { listProjects } from "../services/projects.js";
import { listTendencies, listPreferences } from "../services/memory.js";
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
  {
    name: "rsvp_event",
    description: "Accept, decline, or tentatively accept a calendar invitation. Optionally propose a new time instead.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event ID from context" },
        response: { type: "string", enum: ["accepted", "declined", "tentative"], description: "Your response to the invitation" },
        proposedStart: { type: "string", description: "ISO-8601 datetime — only when proposing a new time" },
        proposedEnd: { type: "string", description: "ISO-8601 datetime — only when proposing a new time" },
      },
      required: ["id", "response"],
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

  const [tasks, pastEvents, upcomingEvents, projects, tendencies, preferences] = await Promise.all([
    listTasks(userId),
    listEvents(userId, { from: inDays(-14), to: startOfToday() }),
    listEvents(userId, { from: startOfToday(), to: inDays(21) }),
    listProjects(userId),
    listTendencies(userId),
    listPreferences(userId),
  ]);

  const now = new Date();
  const endOfToday = inDays(1);
  const endOfWeek = inDays(7);

  const todayEvents = upcomingEvents.filter((e) => e.start < endOfToday);
  const thisWeekEvents = upcomingEvents.filter((e) => e.start >= endOfToday && e.start < endOfWeek);
  const laterEvents = upcomingEvents.filter((e) => e.start >= endOfWeek);

  const openTasks = tasks.filter((t) => t.status !== "done");
  const recentlyDoneTasks = tasks
    .filter((t) => t.status === "done" && t.updatedAt && new Date(t.updatedAt) >= inDays(-7))
    .slice(0, 10);

  const context = {
    now: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    recentEvents: pastEvents.slice(-20),
    todayEvents,
    thisWeekEvents: thisWeekEvents.slice(0, 40),
    laterEvents: laterEvents.slice(0, 40),
    openTasks: openTasks.slice(0, 30),
    recentlyDoneTasks,
    projects: projects.filter((p) => p.status === "active"),
    tendencies: tendencies.slice(0, 12),
    preferences: preferences.slice(0, 20),
  };

  const system = [
    "You are Cortex, a personal AI executive assistant. Your job is to help the user get things done — not just advise, but actually act.",
    "",
    "## What you can do",
    "You have tools to create, update, and delete tasks and calendar events. Use them whenever the user asks you to add, change, or remove something. Don't ask for permission — just do it and confirm concisely.",
    "",
    "## Core behavior",
    "- Be an executor. When the user asks for something to be done, do it with your tools, then confirm what you did in one sentence.",
    "- Before asking ANY clarifying question, search the CONTEXT for the answer. The context is split into: recentEvents (past 14 days), todayEvents, thisWeekEvents (next 7 days), laterEvents (up to 21 days out), openTasks, recentlyDoneTasks, projects, tendencies, preferences. The user's calendar, course schedule, and habits are right there — use them. Asking for something the context already contains is a failure.",
    "- Use recentEvents + recentlyDoneTasks to understand momentum (what the user has been working on, which classes meet when). Use todayEvents/thisWeekEvents/laterEvents to find free slots and upcoming commitments like exams, deadlines, and meetings.",
    "- Assume the user is competent and knows what they mean. Trust their intent rather than second-guessing it.",
    "- When you find a matching item in context, commit to it silently. Only ask which item they meant if there are 2+ candidates that are genuinely indistinguishable by date, title, or topic.",
    "- Prefer a specific, opinionated action over an open-ended question. Act first, then offer to adjust in the same reply ('scheduled 2×90min; want more/less?').",
    "- Never list the user's own courses/projects back to them as a multiple-choice menu. If exactly one matches the request, use it. If none matches, pick the most likely based on timing and say which one you picked.",
    "",
    "## Scheduling and time",
    "- When the user wants to block time, look at their existing events in context to find an open slot, pick one, and create it. Use kind='block' for focused work sessions.",
    "- When scheduling work blocks, prefer mornings for deep work and choose a duration that fits the task.",
    "- For exam/deadline prep: find the exam or due-date event in context first. Infer the subject from its title or the closest class event. Default study load: ~2–4 hours per exam, split into 60–90 minute blocks across the days before it, scheduled in free slots. Just do it — don't ask the subject or hours unless the context is truly empty.",
    "",
    "## Handling pending invites (rsvpStatus: 'needsAction')",
    "- At the start of every conversation, scan the context for events with rsvpStatus='needsAction'.",
    "- For each pending invite, check whether it conflicts with an existing event (same or overlapping time window).",
    "- If no conflict: accept it automatically using rsvp_event (response='accepted') and mention what you accepted in one line.",
    "- If there IS a conflict: do NOT auto-accept. Surface the conflict to the user — state what overlaps and ask whether to decline or propose a new time.",
    "- Use the user's tendencies and preferences from context when assessing fit (e.g. energy level, known constraints).",
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
    rsvp_event: async (input) => {
      const { id, response, proposedStart, proposedEnd } = input as {
        id: string;
        response: "accepted" | "declined" | "tentative";
        proposedStart?: string;
        proposedEnd?: string;
      };
      const proposedTime =
        proposedStart && proposedEnd
          ? { start: new Date(proposedStart), end: new Date(proposedEnd) }
          : undefined;
      return rsvpEvent(userId, id, response, proposedTime);
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
