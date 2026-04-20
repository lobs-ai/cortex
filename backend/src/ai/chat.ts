import { completeWithTools, type ToolDef, type ToolHandler } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { listTasks, createTask, patchTask, deleteTask } from "../services/tasks.js";
import { listEvents, createEvent, patchEvent, deleteEvent, rsvpEvent } from "../services/events.js";
import { listProjects } from "../services/projects.js";
import { listTendencies, listPreferences, recordPreference } from "../services/memory.js";
import {
  createEntry as createJournalEntry,
  findNearestEvent as findNearestJournalEvent,
  listEntries as listJournalEntries,
  listEventsAwaitingReflection,
} from "../services/journal.js";
import { getRoleModel } from "../services/settings.js";
import { TaskCreate, TaskPatch } from "../schemas/tasks.js";
import { EventCreate, EventPatch } from "../schemas/events.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

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
    name: "record_preference",
    description:
      "Save or update a durable preference you've learned about the user (e.g. working hours, deep-work times, meeting cadence, reminder lead time, preferred block length, tone). Call this whenever the user states a preference directly OR you infer one with reasonable confidence from how they work. Use a stable, lowercase dotted key so future calls update the same preference instead of duplicating it.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Stable, lowercase dotted identifier, e.g. 'schedule.deep_work_window', 'calendar.default_block_minutes', 'comms.tone'. Reuse the exact key from context.preferences when updating an existing one.",
        },
        value: {
          description:
            "The preference value. Any JSON-serializable shape — string, number, boolean, or object. Prefer structured objects for ranges/times (e.g. { start: '09:00', end: '11:30' }).",
        },
        confidence: {
          type: "number",
          description:
            "0–1. Use ~1.0 when the user stated it explicitly, ~0.7 when strongly implied, ~0.5 when inferred from a single observation.",
        },
        source: {
          type: "string",
          enum: ["user", "agent"],
          description: "'user' when the user stated it explicitly in this turn; 'agent' when you inferred it.",
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "record_reflection",
    description:
      "Log a post-event reflection — the user's rating and/or note about how an event/block went. Use this when the user describes how something went ('that meeting was great', 'study block was a slog', 'class was a 3/5'). Attach to the eventId from context when one clearly matches by title/time. One reflection per event — calling again replaces the prior one.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID from context the reflection is about" },
        rating: { type: "number", description: "1–5 score: 1=bad, 3=fine, 5=great. Omit if user didn't imply a score." },
        note: { type: "string", description: "Short free-text reflection in the user's voice. Keep it brief." },
      },
      required: ["eventId"],
    },
  },
  {
    name: "quick_log",
    description:
      "Save a freeform brain-dump / progress note not tied to a specific event (e.g. 'finished the intro section', 'stuck on the proof'). If the user's note is clearly about an ongoing or just-finished event, prefer record_reflection instead. You may optionally attach to an eventId if one is obviously relevant.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The log content, in the user's voice." },
        eventId: { type: "string", description: "Optional — attach to an event if the note is about one." },
      },
      required: ["note"],
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

  const [[userRow], tasks, pastEvents, upcomingEvents, projects, tendencies, preferences, recentJournal, awaitingReflection] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)),
    listTasks(userId),
    listEvents(userId, { from: inDays(-14), to: startOfToday() }),
    listEvents(userId, { from: startOfToday(), to: inDays(21) }),
    listProjects(userId),
    listTendencies(userId),
    listPreferences(userId),
    listJournalEntries(userId, { from: inDays(-14), limit: 25 }),
    listEventsAwaitingReflection(userId, inDays(-3)),
  ]);

  const userTimezone = userRow?.timezone ?? "America/Detroit";
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
    now: localTimeString(now, userTimezone),
    timezone: userTimezone,
    recentEvents: pastEvents.slice(-20),
    todayEvents,
    thisWeekEvents: thisWeekEvents.slice(0, 40),
    laterEvents: laterEvents.slice(0, 40),
    openTasks: openTasks.slice(0, 30),
    recentlyDoneTasks,
    projects: projects.filter((p) => p.status === "active"),
    tendencies: tendencies.slice(0, 12),
    preferences: preferences.slice(0, 20),
    recentJournal: recentJournal.slice(0, 20),
    awaitingReflection: awaitingReflection.slice(0, 10),
  };

  const system = [
    "You are Cortex, a personal AI executive assistant. Your job is to help the user get things done — not just advise, but actually act.",
    "",
    "## What you can do",
    "You have tools to create, update, and delete tasks and calendar events. Use them whenever the user asks you to add, change, or remove something. Don't ask for permission — just do it and confirm concisely.",
    "",
    "## Core behavior",
    "- Be an executor. When the user asks for something to be done, do it with your tools, then confirm what you did in one sentence.",
    "- Before asking ANY clarifying question, search the CONTEXT for the answer. The context is split into: recentEvents (past 14 days), todayEvents, thisWeekEvents (next 7 days), laterEvents (up to 21 days out), openTasks, recentlyDoneTasks, projects, tendencies, preferences, recentJournal (user's recent reflections and brain-dumps), awaitingReflection (past events with no reflection yet). The user's calendar, course schedule, and habits are right there — use them. Asking for something the context already contains is a failure.",
    "- Every event has `subscribed: boolean`. `subscribed: true` means the event comes from a shared/read-only calendar the user doesn't own (e.g. class-wide office-hours calendars). The user is NOT attending these — treat them as informational only. Never count them as busy time, never propose to decline/reschedule them, and never use them when looking for conflicts or free slots. `subscribed: false` events are the user's real commitments.",
    "- Use recentEvents + recentlyDoneTasks to understand momentum (what the user has been working on, which classes meet when). Use todayEvents/thisWeekEvents/laterEvents to find free slots and upcoming commitments like exams, deadlines, and meetings.",
    "- Assume the user is competent and knows what they mean. Trust their intent rather than second-guessing it.",
    "- When you find a matching item in context, commit to it silently. Only ask which item they meant if there are 2+ candidates that are genuinely indistinguishable by date, title, or topic.",
    "- Prefer a specific, opinionated action over an open-ended question. Act first, then offer to adjust in the same reply ('scheduled 2×90min; want more/less?').",
    "- **Never present a menu of options.** Pick the best fix, execute it, and offer one concrete alternative at the end — not a list of possibilities. BAD: 'Want to move one to a different day, split them with a break, or consolidate into a single session?' GOOD: 'Those back-to-back blocks make 4 straight hours — I added a 30-min break at 6pm. Want me to move the second block to another day instead?' You made a call, you acted, you offer one escape hatch.",
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
    "## Learning preferences",
    "- You are expected to get better over time by noticing how the user likes to work and saving that as preferences.",
    "- Call record_preference whenever the user (a) states a preference directly ('I hate morning meetings', 'default blocks to 90min'), or (b) you can infer one with reasonable confidence from what they just said or from patterns in context.tendencies/recentlyDoneTasks.",
    "- Reuse the exact `key` already in context.preferences when updating — don't create 'study.time' and 'study_time' as separate entries. Pick stable, lowercase dotted keys like 'schedule.deep_work_window', 'calendar.default_block_minutes', 'comms.tone', 'study.session_length_minutes'.",
    "- Set source='user' and confidence ~1.0 when they said it explicitly; source='agent' and confidence 0.5–0.8 when you inferred it.",
    "- Do not narrate that you recorded a preference unless the user asked you to remember it. Just save it silently and act on it.",
    "- Never write keys under the reserved `llm.role.*` namespace — those are model settings, not user preferences.",
    "",
    "## Journaling — reflections and quick logs",
    "- The user can tell you how something went or brain-dump what they're doing. Capture it silently with tools; don't narrate the save unless asked.",
    "- If the message describes how a past or current event went ('that lecture was great', 'study block was rough, 2/5'), call record_reflection with the matching eventId and an inferred rating (1–5). Pick the event from context by title + time match. If uncertain between two candidates, ask which one.",
    "- If the message is freeform progress ('wrapped the intro', 'stuck on the proof'), call quick_log. Attach eventId only if one is clearly what they're working on right now (check todayEvents for a currently-happening block).",
    "- Use recentJournal to spot patterns ('you've rated evening deep-work blocks 2–3 the last three times'). Reference concrete prior reflections when planning: if the user is about to schedule something similar to a recent low-rated event, mention it and propose an adjustment.",
    "- When awaitingReflection is non-empty and the user has a free moment (e.g. a casual 'hey' or planning-the-day turn), you may ask about one event — pick the most recent or most important one. Don't spam them with all of them.",
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
    record_preference: async (input) => {
      const { key, value, confidence, source } = input as {
        key: string;
        value: unknown;
        confidence?: number;
        source?: string;
      };
      return recordPreference(userId, { key, value, confidence, source });
    },
    record_reflection: async (input) => {
      const { eventId, rating, note } = input as { eventId: string; rating?: number; note?: string };
      return createJournalEntry(userId, {
        kind: "reflection",
        eventId,
        rating: rating ?? null,
        note: note ?? "",
      });
    },
    quick_log: async (input) => {
      const { note, eventId } = input as { note: string; eventId?: string };
      let attachedEventId: string | null = eventId ?? null;
      if (!attachedEventId) {
        const nearest = await findNearestJournalEvent(userId, new Date(), 60);
        if (nearest && nearest.match === "happening") attachedEventId = nearest.id;
      }
      return createJournalEntry(userId, {
        kind: "quick_log",
        eventId: attachedEventId,
        note,
      });
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

  const callArgs = {
    system,
    maxTokens: 1500,
    messages: [
      ...history.slice(-8).map((h) => ({
        role: h.role === "user" ? ("user" as const) : ("assistant" as const),
        content: h.content,
      })),
      { role: "user" as const, content: userText },
    ],
  };

  const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000];
  let result: Awaited<ReturnType<typeof completeWithTools>> | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      result = await completeWithTools(userId, cfg.provider, cfg.model, callArgs, CHAT_TOOLS, toolHandlers);
      if (result?.text.trim()) break;
      lastErr = new Error(`Chat model (${cfg.provider}/${cfg.model}) returned no response.`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < RETRY_DELAYS_MS.length) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }

  if (!result?.text.trim()) {
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new ChatError(detail.includes(cfg.provider) ? detail : `Chat model (${cfg.provider}/${cfg.model}) failed: ${detail}`);
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

function localTimeString(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
