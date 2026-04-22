import { eq } from "drizzle-orm";
import { findFreeBlocks } from "../services/scheduling.js";
import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { listEntries } from "../services/journal.js";
import { listPreferences, listTendencies } from "../services/memory.js";
import { complete } from "./client.js";
import { extractJson } from "./jsonExtract.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";
import { db, schema } from "../db/client.js";
import { hmInTz, startOfDayInTz, endOfDayInTz } from "../lib/time.js";

export type PlanBlock = { start: string; end: string; label: string; sub?: string; kind: string; hero?: boolean };
// An activation-sized chunk emitted alongside the plan. Unlike blocks (which
// can be wide meetings or deep-work windows), commitments are <=25min and
// must be startable: each has a concrete first action and a verify criterion.
export type PlanCommitment = {
  title: string;
  verifyCriterion?: string;
  start: string; // HH:MM local
  durationMin: number;
  taskId?: string | null;
};
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
  tasks: { id: string; title: string; priority: string; due: string | null; estMin: number | null; status: string; skipCount: number }[];
  guidance?: string;
};
export type DailyPlan = {
  summary: string;
  blocks: PlanBlock[];
  commitments?: PlanCommitment[];
  generatedBy: string;
  inputs?: PlanInputs;
  fallbackReason?: string;
};

export async function generateDailyPlan(
  userId: string,
  date: Date,
  opts?: { guidance?: string },
): Promise<DailyPlan> {
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";

  const last14 = new Date(+date - 14 * 24 * 60 * 60 * 1000);
  const [events, tasks, free, journal, preferences, tendencies] = await Promise.all([
    listEvents(userId, { from: startOfDayInTz(date, tz), to: endOfDayInTz(date, tz) }),
    listTasks(userId, { openOnly: true }),
    findFreeBlocks(userId, date, { minMinutes: 30, tz }),
    listEntries(userId, { from: last14, limit: 25 }),
    listPreferences(userId),
    listTendencies(userId),
  ]);

  const topTasks = tasks
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.due ? t.due.toISOString() : null,
      estMin: t.estMin,
      status: t.status,
      skipCount: (t as { skipCount?: number }).skipCount ?? 0,
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
  if (!entry) {
    return {
      ...heuristicPlan(events, tasks, free, tz),
      generatedBy: `planner:heuristic:unknown_provider:${cfg.provider}`,
      fallbackReason: `Planner provider "${cfg.provider}" is not in the registry. Pick a different provider in Settings → AI Models.`,
      inputs,
    };
  }
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) {
      return {
        ...heuristicPlan(events, tasks, free, tz),
        generatedBy: `planner:heuristic:no_api_key:${cfg.provider}`,
        fallbackReason: `No API key on file for ${entry.label}. Add one in Settings → Integrations (or set ${entry.keyEnvVar}) and regenerate the plan.`,
        inputs,
      };
    }
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
    preferences: preferences
      .filter((p) => !p.key.startsWith("llm.role."))
      .slice(0, 25)
      .map((p) => ({ key: p.key, value: p.value, confidence: p.confidence })),
    tendencies: tendencies.slice(0, 12).map((t) => ({ text: t.text, confidence: t.confidence })),
    recent_journal: journal.slice(0, 20).map((j) => ({
      kind: j.kind,
      rating: j.rating,
      note: j.note,
      eventId: j.eventId,
      at: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
    })),
  };

  const guidanceClause = opts?.guidance
    ? `\n- The user has added this guidance; honor it as long as it does not conflict with confirmed events: "${opts.guidance.replace(/"/g, "'")}"`
    : "";

  const system =
    "You are the Planner role of Cortex. Produce a realistic block-by-block plan for today AND a short queue of commitments as JSON:\n" +
    `{ "summary": string, "blocks": [{ "start": "HH:MM", "end": "HH:MM", "label": string, "sub": string, "kind": "meeting"|"class"|"teach"|"personal"|"deadline"|"block", "hero": boolean? }], "commitments": [{ "start": "HH:MM", "durationMin": number, "title": string, "verifyCriterion": string, "taskId": string? }] }\n` +
    `- All times in CONTEXT and in your output are local wall-clock HH:MM in ${tz}. Do not convert to UTC.\n` +
    "- Include every my_events entry as a block — these are the user's real commitments.\n" +
    "- subscribed_events are from calendars the user is subscribed to but does NOT own (e.g. class calendars listing all staff office hours). The user is not attending these. Do NOT add them as blocks. Do NOT treat them as conflicts. You may reference one in a sub line only if clearly useful (e.g. \"prof's office hours open\").\n" +
    "- Add at most one 'hero' block for the day's highest-priority deep work, marked hero: true.\n" +
    "- Respect the user's free blocks for any new 'block' entries.\n" +
    "- Honor `preferences` as hard guidance (e.g. schedule.deep_work_window, calendar.default_block_minutes, study.session_length_minutes). High-confidence preferences override defaults.\n" +
    "- Use `tendencies` as soft signals about when the user works best.\n" +
    "- Read `recent_journal` for patterns in past reflections: if a block type has been rated ≤2 multiple times (e.g. late-evening deep work), avoid scheduling the same shape today. Reflect the adjustment in the block's `sub` line when it's load-bearing (e.g. \"moved from evening — prior sessions rated 2/5\").\n" +
    "- COMMITMENTS: emit 3 to 6 commitments for the day, each tied to a real open task. Each commitment is an activation-sized first action the user can start in <=25 minutes. " +
    "Reject abstract titles like \"work on thesis\" or \"study\"; require a concrete startable verb + object, e.g. \"open draft doc and write the intro paragraph\" or \"skim the first 3 pages of the dataset paper\". " +
    "durationMin must be between 10 and 25 for activation chunks; use 45 only for a single hero deep-work commitment if it maps to the hero block. " +
    "verifyCriterion is the one-line artifact the user will produce — something they can state in a sentence (e.g. \"a 3-paragraph intro saved to the draft doc\"). " +
    "Commitments must start inside free_blocks (never during my_events). Tasks with a high skipCount should be given SHORTER, more-concrete commitments and placed earlier in the day when possible. taskId must be an id from the tasks list or null if purely fresh.\n" +
    "- Keep summary under 160 chars. Return JSON only." +
    guidanceClause;

  let fallbackReason: string | undefined;
  try {
    const result = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 800,
      messages: [
        { role: "user", content: `CONTEXT:\n${JSON.stringify(context, null, 2)}` },
      ],
    });
    const text = result?.text ?? "";
    const extracted = extractJson<{
      summary: string;
      blocks: PlanBlock[];
      commitments?: PlanCommitment[];
    }>(text);
    if (extracted.ok) {
      return {
        summary: extracted.value.summary,
        blocks: extracted.value.blocks ?? [],
        commitments: extracted.value.commitments ?? [],
        generatedBy: `planner:${cfg.provider}/${cfg.model}${extracted.repaired ? " (repaired-json)" : ""}`,
        inputs,
      };
    }
    fallbackReason = `${entry.label} (${cfg.model}) returned unparseable JSON: ${extracted.error}`;
    console.error("planner LLM JSON parse failed:", extracted.error, "\nraw:", text.slice(0, 500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fallbackReason = `${entry.label} (${cfg.model}) call failed: ${msg.slice(0, 200)}`;
    console.error("planner LLM failure; using heuristic:", err);
  }

  return {
    ...heuristicPlan(events, tasks, free, tz),
    generatedBy: `planner:heuristic:llm_error:${cfg.provider}`,
    fallbackReason,
    inputs,
  };
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
