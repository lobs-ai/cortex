import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { complete } from "./client.js";
import { extractJson } from "./jsonExtract.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";
import { listEvents } from "../services/events.js";
import { createTask, listTasks, summarizeTasks } from "../services/tasks.js";
import { listProjects } from "../services/projects.js";
import { listEntries } from "../services/journal.js";
import { listPreferences, listTendencies } from "../services/memory.js";
import { listRecentNotifications } from "../services/notifications.js";
import { TaskCreate } from "../schemas/tasks.js";

export type ProposedTask = {
  title: string;
  description?: string;
  priority: "P0" | "P1" | "P2";
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  projectId?: string | null;
  reason: string; // why the agent thinks this task belongs — one short line
  sourceKey: string; // stable dedup key per source, e.g. "exam_eecs545_midterm"
};

// How long we remember that we proposed a given sourceKey even after the task
// is deleted or completed. Prevents the agent from re-creating the same task.
export const PROPOSAL_MEMORY_MS = 14 * 24 * 60 * 60 * 1000;

export type ProposerResult = {
  created: { id: string; title: string; reason: string }[];
  skipped: number;
};

// LLM-backed task proposer. Pulls upcoming events, projects, open tasks,
// journal, and preferences, then asks the monitor model to propose concrete
// actionable tasks that aren't already captured.
export async function proposeTasks(userId: string): Promise<ProposerResult> {
  const cfg = await getRoleModel(userId, "monitor");
  const entry = getProvider(cfg.provider);
  if (!entry) return { created: [], skipped: 0 };
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) return { created: [], skipped: 0 };
  }

  const now = new Date();
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";

  const last14 = new Date(+now - 14 * 24 * 60 * 60 * 1000);
  const in21d = new Date(+now + 21 * 24 * 60 * 60 * 1000);

  const [taskDigest, openTasksRaw, events, projects, journal, preferences, tendencies, recentKeys, recentNotifications] =
    await Promise.all([
      summarizeTasks(userId, { openLimit: 30, recentDoneDays: 14, recentDoneLimit: 20 }),
      listTasks(userId, { openOnly: true }),
      listEvents(userId, { from: now, to: in21d }),
      listProjects(userId),
      listEntries(userId, { from: last14, limit: 30 }),
      listPreferences(userId),
      listTendencies(userId),
      recentProposalKeys(userId),
      listRecentNotifications(userId, last14),
    ]);

  // Titles the user has already seen in the proactive rail recently. We
  // include both dismissed and acted-on ones because either way the user
  // knows about it and doesn't need a reworded repeat.
  const recentlyShownNotificationTitles = recentNotifications
    .slice(0, 30)
    .map((n) => n.title);

  const ctx = {
    nowIso: now.toISOString(),
    timezone: tz,
    upcomingEvents: events
      .filter((e) => !e.subscribed)
      .slice(0, 40)
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        kind: e.kind,
        important: !!e.important,
        description: e.description ?? null,
      })),
    activeProjects: projects
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, name: p.name, description: p.description, targetDate: p.targetDate })),
    tasks: taskDigest,
    recentJournal: journal.slice(0, 20).map((j) => ({
      kind: j.kind,
      note: j.note,
      rating: j.rating,
      at: j.createdAt instanceof Date ? j.createdAt.toISOString() : j.createdAt,
    })),
    preferences: preferences
      .filter((p) => !p.key.startsWith("llm.role."))
      .slice(0, 20)
      .map((p) => ({ key: p.key, value: p.value })),
    tendencies: tendencies.slice(0, 10).map((t) => ({ text: t.text, confidence: t.confidence })),
    alreadyProposedSourceKeys: recentKeys,
    recentlyShownNotificationTitles,
  };

  const system = [
    "You are the task-proposer inside Cortex's Monitor role. Your job: look at the user's upcoming schedule, active projects, journal, and existing tasks, and create the tasks they haven't thought to add yet.",
    "",
    "## What to propose",
    "- Prep/study tasks for upcoming exams, deadlines, or important meetings (check event titles for 'midterm', 'final', 'exam', 'deadline', 'due', 'presentation', 'interview', 'review', 'defense'). Break large efforts into 2–4 concrete sub-tasks (e.g. 'Outline for 545 midterm', 'Practice problems ch.4–6', 'Cheat sheet').",
    "- Missing follow-ups: if a recent event just ended (check journal + recentlyCompletedTitles) and likely has action items (meetings, reviews), propose the follow-up.",
    "- Project tasks: active projects with no open tasks probably need a next action. Propose the obvious next step based on project name/description.",
    "- Recurring themes from the journal: if the user keeps mentioning something they need to do in quick_logs, surface it as a task.",
    "",
    "## What NOT to propose",
    "- Anything whose sourceKey appears in alreadyProposedSourceKeys — that was already handled.",
    "- Anything whose title is a near-duplicate of a task in tasks.topOpen or tasks.recentlyCompleted. Normalize casing/punctuation before comparing.",
    "- Anything whose intent duplicates a title in recentlyShownNotificationTitles — the user already saw a proactive card about that and doesn't need the same thing reworded as a task.",
    "- Tasks for subscribed (FYI) events — those are already filtered out of upcomingEvents.",
    "- Vague tasks like 'work on project' or 'study more'. Every task must be concrete enough that the user could start it in the next 30 minutes.",
    "- Tasks with no clear due date AND no clear project. If you can't place it in time or in a project, it's probably not ready to be a task.",
    "",
    "## Output",
    "Return JSON only, shape:",
    `{"tasks": [{"title": string (<80 chars, imperative), "description"?: string, "priority": "P0"|"P1"|"P2", "dueDate"?: ISO-date (YYYY-MM-DD), "estimatedMinutes"?: integer 15–240, "projectId"?: string (must match an activeProjects.id), "reason": string (<120 chars, name the evidence), "sourceKey": string (stable lowercase_snake, <48 chars, e.g. 'exam_eecs545_midterm_prep_1')}]}`,
    "Cap at 5 tasks per run. If nothing needs proposing, return {\"tasks\": []}. Silence is better than noise.",
  ].join("\n");

  let proposals: ProposedTask[] = [];
  try {
    const result = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 1200,
      messages: [{ role: "user", content: `CONTEXT:\n${JSON.stringify(ctx, null, 2)}` }],
    });
    const text = result?.text ?? "";
    const extracted = extractJson<{ tasks?: ProposedTask[] }>(text);
    if (!extracted.ok) {
      console.error("task proposer JSON parse failed:", extracted.error);
      return { created: [], skipped: 0 };
    }
    proposals = Array.isArray(extracted.value.tasks) ? extracted.value.tasks : [];
  } catch (err) {
    console.error("task proposer failed:", err);
    return { created: [], skipped: 0 };
  }

  const normalizedExisting = new Set<string>([
    ...openTasksRaw.map((t) => normalizeTitle(t.title)),
    ...taskDigest.recentlyCompleted.map((t) => normalizeTitle(t.title)),
  ]);
  const recentKeySet = new Set(recentKeys);
  const projectIds = new Set(projects.map((p) => p.id));

  const created: ProposerResult["created"] = [];
  let skipped = 0;

  for (const p of proposals.slice(0, 5)) {
    if (!p?.title || !p?.sourceKey) {
      skipped++;
      continue;
    }
    const key = p.sourceKey.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 48);
    if (recentKeySet.has(key)) {
      skipped++;
      continue;
    }
    if (normalizedExisting.has(normalizeTitle(p.title))) {
      skipped++;
      continue;
    }

    const input = TaskCreate.safeParse({
      title: p.title,
      description: p.description,
      priority: p.priority,
      status: "inbox",
      dueDate: p.dueDate ? new Date(p.dueDate) : undefined,
      estimatedMinutes:
        typeof p.estimatedMinutes === "number" && p.estimatedMinutes > 0
          ? Math.min(240, Math.round(p.estimatedMinutes))
          : undefined,
      projectId: p.projectId && projectIds.has(p.projectId) ? p.projectId : undefined,
      tags: ["agent-proposed"],
    });
    if (!input.success) {
      skipped++;
      continue;
    }

    try {
      const row = await createTask(userId, input.data);
      await db.insert(schema.agentProposals).values({
        id: row.id,
        userId,
        sourceKey: key,
        taskId: row.id,
        reason: p.reason.slice(0, 240),
        createdAt: new Date(),
      });
      created.push({ id: row.id, title: row.title, reason: p.reason });
      normalizedExisting.add(normalizeTitle(row.title));
      recentKeySet.add(key);
    } catch (err) {
      console.error("task proposer insert failed:", err);
      skipped++;
    }
  }

  return { created, skipped };
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function recentProposalKeys(userId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - PROPOSAL_MEMORY_MS);
  const rows = await db
    .select()
    .from(schema.agentProposals)
    .where(
      and(
        eq(schema.agentProposals.userId, userId),
        gte(schema.agentProposals.createdAt, cutoff),
      ),
    )
    .orderBy(desc(schema.agentProposals.createdAt));
  return rows.map((r) => r.sourceKey);
}
