import { findFreeBlocks } from "../services/scheduling.js";
import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { complete } from "./client.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";

export type PlanBlock = { start: string; end: string; label: string; sub?: string; kind: string; hero?: boolean };
export type PlanInputs = {
  events: { title: string; start: string; end: string; kind: string; location: string | null }[];
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
  const [events, tasks, free] = await Promise.all([
    listEvents(userId, { from: startOfDay(date), to: endOfDay(date) }),
    listTasks(userId),
    findFreeBlocks(userId, date, { minMinutes: 30 }),
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
    })),
    freeBlocks: free.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
    tasks: topTasks,
    ...(opts?.guidance ? { guidance: opts.guidance } : {}),
  };

  const cfg = await getRoleModel(userId, "planner");
  const entry = getProvider(cfg.provider);
  if (!entry) return { ...heuristicPlan(events, tasks, free), inputs };
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) return { ...heuristicPlan(events, tasks, free), inputs };
  }

  const context = {
    date: date.toISOString().slice(0, 10),
    events: events.map((e) => ({ title: e.title, start: e.start, end: e.end, kind: e.kind, location: e.location })),
    free_blocks: free.map((b) => ({ start: b.start, end: b.end })),
    tasks: topTasks,
  };

  const guidanceClause = opts?.guidance
    ? `\n- The user has added this guidance; honor it as long as it does not conflict with confirmed events: "${opts.guidance.replace(/"/g, "'")}"`
    : "";

  const system =
    "You are the Planner role of Cortex. Produce a realistic block-by-block plan for today as JSON:\n" +
    `{ "summary": string, "blocks": [{ "start": "HH:MM", "end": "HH:MM", "label": string, "sub": string, "kind": "meeting"|"class"|"teach"|"personal"|"deadline"|"block", "hero": boolean? }] }\n` +
    "- Include all confirmed events.\n" +
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

  return { ...heuristicPlan(events, tasks, free), inputs };
}

function heuristicPlan(
  events: Awaited<ReturnType<typeof listEvents>>,
  tasks: Awaited<ReturnType<typeof listTasks>>,
  free: { start: Date; end: Date }[],
): DailyPlan {
  const blocks: PlanBlock[] = [];
  const openTasks = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.priority > b.priority ? 1 : -1));
  const hero = openTasks[0];
  const heroSlot = free.find((b) => (+b.end - +b.start) / 60000 >= (hero?.estMin ?? 60));

  for (const e of events) {
    blocks.push({
      start: fmtHM(e.start),
      end: fmtHM(e.end),
      label: e.title,
      sub: e.location ?? "",
      kind: e.kind,
    });
  }
  if (hero && heroSlot) {
    blocks.push({
      start: fmtHM(heroSlot.start),
      end: fmtHM(new Date(+heroSlot.start + (hero.estMin ?? 90) * 60000)),
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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}
function fmtHM(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
