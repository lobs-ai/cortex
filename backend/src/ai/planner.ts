import { findFreeBlocks } from "../services/scheduling.js";
import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { llmClient } from "./client.js";
import { getRoleModel } from "../services/settings.js";

export type PlanBlock = { start: string; end: string; label: string; sub?: string; kind: string; hero?: boolean };
export type DailyPlan = { summary: string; blocks: PlanBlock[]; generatedBy: string };

export async function generateDailyPlan(userId: string, date: Date): Promise<DailyPlan> {
  const [events, tasks, free] = await Promise.all([
    listEvents(userId, { from: startOfDay(date), to: endOfDay(date) }),
    listTasks(userId),
    findFreeBlocks(userId, date, { minMinutes: 30 }),
  ]);

  const client = llmClient();
  if (!client) return heuristicPlan(events, tasks, free);

  const cfg = await getRoleModel(userId, "planner");

  const context = {
    date: date.toISOString().slice(0, 10),
    events: events.map((e) => ({ title: e.title, start: e.start, end: e.end, kind: e.kind, location: e.location })),
    free_blocks: free.map((b) => ({ start: b.start, end: b.end })),
    tasks: tasks
      .filter((t) => t.status !== "done")
      .slice(0, 25)
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.due, estMin: t.estMin, status: t.status })),
  };

  const system =
    "You are the Planner role of Cortex. Produce a realistic block-by-block plan for today as JSON:\n" +
    `{ "summary": string, "blocks": [{ "start": "HH:MM", "end": "HH:MM", "label": string, "sub": string, "kind": "meeting"|"class"|"teach"|"personal"|"deadline"|"block", "hero": boolean? }] }\n` +
    "- Include all confirmed events.\n" +
    "- Add at most one 'hero' block for the day's highest-priority deep work, marked hero: true.\n" +
    "- Respect the user's free blocks for any new 'block' entries.\n" +
    "- Keep summary under 160 chars. Return JSON only.";

  try {
    const resp = await client.messages.create({
      model: cfg.model,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: `CONTEXT:\n${JSON.stringify(context, null, 2)}` }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      return { summary: parsed.summary, blocks: parsed.blocks ?? [], generatedBy: `planner:${cfg.model}` };
    }
  } catch (err) {
    console.error("planner LLM failure; using heuristic:", err);
  }

  return heuristicPlan(events, tasks, free);
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
