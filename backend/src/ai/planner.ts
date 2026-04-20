import { eq } from "drizzle-orm";
import { findFreeBlocks } from "../services/scheduling.js";
import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { complete } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";
import { db, schema } from "../db/client.js";
import { hmInTz, startOfDayInTz, endOfDayInTz } from "../lib/time.js";

export type PlanBlock = { start: string; end: string; label: string; sub?: string; kind: string; hero?: boolean };
export type PlanInputs = {
  events: {
    title: string;
    start: string;
    end: string;
    kind: string;
    location: string | null;
    subscribed: boolean;
  }[];
  freeBlocks: { start: string; end: string }[];
  tasks: { id: string; title: string; priority: string; due: string | null; estMin: number | null; status: string }[];
  guidance?: string;
};
export type DailyPlan = {
  summary: string;
  blocks: PlanBlock[];
  generatedBy: string;
  inputs?: PlanInputs;
};

export async function generateDailyPlan(
  userId: string,
  date: Date,
  opts?: { guidance?: string },
): Promise<DailyPlan> {
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";

  const [events, tasks, free] = await Promise.all([
    listEvents(userId, { from: startOfDayInTz(date, tz), to: endOfDayInTz(date, tz) }),
    listTasks(userId),
    findFreeBlocks(userId, date, { minMinutes: 30, tz }),
  ]);

  const topTasks = tasks
    .filter((t) => t.status !== "done")
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.due ? t.due.toISOString() : null,
      estMin: t.estMin,
      status: t.status,
    }));

  const inputs: PlanInputs = {
    events: events.map((e) => ({
      title: e.title,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      kind: e.kind,
      location: e.location,
      subscribed: !!e.subscribed,
    })),
    freeBlocks: free.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
    tasks: topTasks,
    ...(opts?.guidance ? { guidance: opts.guidance } : {}),
  };

  const cfg = await getRoleModel(userId, "planner");
  const entry = getProvider(cfg.provider);
  if (!entry) return { ...heuristicPlan(events, tasks, free, tz), inputs };
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) return { ...heuristicPlan(events, tasks, free, tz), inputs };
  }

  const myEvents = events.filter((e) => !e.subscribed);
  const subscribedEvents = events.filter((e) => e.subscribed);
  const context = {
    date: date.toISOString().slice(0, 10),
    timezone: tz,
    my_events: myEvents.map((e) => ({
      title: e.title,
      start: hmInTz(e.start, tz),
      end: hmInTz(e.end, tz),
      kind: e.kind,
      location: e.location,
    })),
    subscribed_events: subscribedEvents.map((e) => ({
      title: e.title,
      start: hmInTz(e.start, tz),
      end: hmInTz(e.end, tz),
      kind: e.kind,
      location: e.location,
    })),
    free_blocks: free.map((b) => ({ start: hmInTz(b.start, tz), end: hmInTz(b.end, tz) })),
    tasks: topTasks,
  };

  const guidanceClause = opts?.guidance
    ? `\n- The user has added this guidance; honor it as long as it does not conflict with confirmed events: "${opts.guidance.replace(/"/g, "'")}"`
    : "";

  const system =
    "You are the Planner role of Cortex. Produce a realistic block-by-block plan for today as JSON:\n" +
    `{ "summary": string, "blocks": [{ "start": "HH:MM", "end": "HH:MM", "label": string, "sub": string, "kind": "meeting"|"class"|"teach"|"personal"|"deadline"|"block", "hero": boolean? }] }\n` +
    `- All times in CONTEXT and in your output are local wall-clock HH:MM in ${tz}. Do not convert to UTC.\n` +
    "- Include every my_events entry as a block — these are the user's real commitments.\n" +
    "- subscribed_events are from calendars the user is subscribed to but does NOT own (e.g. class calendars listing all staff office hours). The user is not attending these. Do NOT add them as blocks. Do NOT treat them as conflicts. You may reference one in a sub line only if clearly useful (e.g. \"prof's office hours open\").\n" +
    "- Add at most one 'hero' block for the day's highest-priority deep work, marked hero: true.\n" +
    "- Respect the user's free blocks for any new 'block' entries.\n" +
    "- Keep summary under 160 chars. Return JSON only." +
    guidanceClause;

  try {
    const result = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 800,
      messages: [
        { role: "user", content: `CONTEXT:\n${JSON.stringify(context, null, 2)}` },
      ],
    });
    const text = result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      return {
        summary: parsed.summary,
        blocks: parsed.blocks ?? [],
        generatedBy: `planner:${cfg.provider}/${cfg.model}`,
        inputs,
      };
    }
  } catch (err) {
    console.error("planner LLM failure; using heuristic:", err);
  }

  return { ...heuristicPlan(events, tasks, free, tz), inputs };
}

function heuristicPlan(
  events: Awaited<ReturnType<typeof listEvents>>,
  tasks: Awaited<ReturnType<typeof listTasks>>,
  free: { start: Date; end: Date }[],
  tz: string,
): DailyPlan {
  const blocks: PlanBlock[] = [];
  const openTasks = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.priority > b.priority ? 1 : -1));
  const hero = openTasks[0];
  const heroSlot = free.find((b) => (+b.end - +b.start) / 60000 >= (hero?.estMin ?? 60));

  for (const e of events) {
    if (e.subscribed) continue; // class-wide / FYI calendars aren't the user's commitments
    blocks.push({
      start: hmInTz(e.start, tz),
      end: hmInTz(e.end, tz),
      label: e.title,
      sub: e.location ?? "",
      kind: e.kind,
    });
  }
  if (hero && heroSlot) {
    blocks.push({
      start: hmInTz(heroSlot.start, tz),
      end: hmInTz(new Date(+heroSlot.start + (hero.estMin ?? 90) * 60000), tz),
      label: `${hero.title} — deep work`,
      sub: "your best focus window",
      kind: "block",
      hero: true,
    });
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return {
    summary: "Meeting-heavy day — one deep-work window reserved for the highest-priority task.",
    blocks,
    generatedBy: "planner:heuristic",
  };
}
