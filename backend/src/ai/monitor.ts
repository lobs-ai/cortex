import { eq } from "drizzle-orm";
import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import {
  createNotification,
  listRecentNotifications,
  type NotificationAction,
} from "../services/notifications.js";
import { getLatestPlan } from "../services/plans.js";
import type { PlanBlock } from "./planner.js";
import { generateInsights } from "./insights.js";
import { proposeTasks } from "./proposer.js";
import { db, schema } from "../db/client.js";
import { startOfDayInTz, endOfDayInTz, hmInTz } from "../lib/time.js";

type Proposal = {
  severity: "high" | "med" | "low";
  kind: string;
  title: string;
  body: string;
  actions?: NotificationAction[];
  relatedType?: string | null;
  relatedId?: string | null;
};

// How long to wait before re-firing the same (kind, relatedId) after the
// user last saw it. Dismissed/acted signals always cost at least this long
// — the rule condition may still be true, but the user already heard about
// it and hiding-then-refiring is the bug we're fixing.
const RULE_COOLDOWN_MS: Record<string, number> = {
  deadline_risk: 12 * 60 * 60 * 1000, // 12h
  prep: 6 * 60 * 60 * 1000, // 6h
  backlog: 24 * 60 * 60 * 1000, // daily
  block_conflict: 4 * 60 * 60 * 1000,
  hero_shrunk: 4 * 60 * 60 * 1000,
  agent_created_tasks: 24 * 60 * 60 * 1000,
  insight: 7 * 24 * 60 * 60 * 1000, // a week — insights are the noisiest repeat offenders
};
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// How far back to scan when computing "did we already surface this?".
const SUPPRESSION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type MonitorResult = {
  notifications: Proposal[];
  tasksCreated: { id: string; title: string; reason: string }[];
};

// Deterministic rule-first monitor per design §12.4. LLM upgrade goes here later.
export async function runMonitor(userId: string): Promise<MonitorResult> {
  const now = new Date();
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";
  const todayStart = startOfDayInTz(now, tz);
  const todayEnd = endOfDayInTz(now, tz);
  const suppressionCutoff = new Date(+now - SUPPRESSION_WINDOW_MS);
  const [openTasks, events, recentHistory, plan, todaysEvents] = await Promise.all([
    listTasks(userId, { openOnly: true }),
    listEvents(userId, { from: now, to: addHours(now, 48) }),
    listRecentNotifications(userId, suppressionCutoff),
    getLatestPlan(userId, "daily"),
    listEvents(userId, { from: todayStart, to: todayEnd }),
  ]);

  const open = openTasks;
  const proposals: Proposal[] = [];

  // Build a suppression map: (kind, relatedId) → most recent "we already
  // told the user about this" timestamp. Active notifications count too —
  // we still want to avoid duplicating a card that's already on screen.
  const lastSeen = new Map<string, number>();
  for (const n of recentHistory) {
    const key = `${n.kind}:${n.relatedId ?? ""}`;
    const stamp = Math.max(
      +n.createdAt,
      n.dismissedAt ? +n.dismissedAt : 0,
      n.actedAt ? +n.actedAt : 0,
    );
    const prev = lastSeen.get(key) ?? 0;
    if (stamp > prev) lastSeen.set(key, stamp);
  }
  const suppressed = (kind: string, relatedId: string | null | undefined) => {
    const last = lastSeen.get(`${kind}:${relatedId ?? ""}`);
    if (!last) return false;
    const cooldown = RULE_COOLDOWN_MS[kind] ?? DEFAULT_COOLDOWN_MS;
    return +now - last < cooldown;
  };

  // deadline_risk — any task due within 24h with P0/P1
  for (const t of open) {
    if (!t.due) continue;
    const hoursLeft = (+t.due - +now) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft < 48 && (t.priority === "P0" || t.priority === "P1")) {
      proposals.push({
        severity: t.priority === "P0" ? "high" : "med",
        kind: "deadline_risk",
        title: `${t.title} due in ${Math.round(hoursLeft)}h`,
        body: `Priority ${t.priority}. Estimated ${t.estMin ?? "?"}m of work remaining.`,
        actions: [
          { label: "Schedule block", op: "schedule_block" },
          { label: "Show plan", op: "show_plan" },
          { label: "Dismiss", op: "dismiss" },
        ],
        relatedType: "task",
        relatedId: t.id,
      });
    }
  }

  // prep — important meeting within 2h with no prep block
  for (const e of events) {
    if (!e.important) continue;
    const hoursUntil = (+e.start - +now) / 3_600_000;
    if (hoursUntil > 0 && hoursUntil < 2) {
      proposals.push({
        severity: "med",
        kind: "prep",
        title: `${e.title} in ${Math.round(hoursUntil * 60)}m — no prep block`,
        body: "You usually prep for 30m. Want me to reserve time?",
        actions: [
          { label: "Reserve prep", op: "reserve_prep" },
          { label: "Skip this time", op: "dismiss" },
        ],
        relatedType: "event",
        relatedId: e.id,
      });
    }
  }

  // overdue backlog
  const overdue = open.filter((t) => t.due && +t.due < +now);
  if (overdue.length >= 3) {
    proposals.push({
      severity: "med",
      kind: "backlog",
      title: `${overdue.length} overdue tasks`,
      body: `Oldest: "${overdue[0].title}". Want to triage them now?`,
      actions: [
        { label: "Triage", op: "triage_overdue" },
        { label: "Snooze 1h", op: "snooze_1h" },
      ],
      relatedType: null,
      relatedId: null,
    });
  }

  // plan-aware: block_conflict — a today event overlaps a plan block that isn't that event
  if (plan && Array.isArray(plan.content?.blocks)) {
    const blocks = plan.content.blocks as PlanBlock[];
    const ownEvents = todaysEvents.filter((e) => !e.subscribed);
    for (const ev of ownEvents) {
      if (+ev.end <= +now) continue; // already past
      const evStart = hmToMinutes(hmInTz(ev.start, tz));
      const evEnd = hmToMinutes(hmInTz(ev.end, tz));
      for (const b of blocks) {
        // Only flag "planned work" blocks, not the meeting echoes of real events.
        if (b.kind !== "block") continue;
        // Skip when the block was planned for the same activity as the event (e.g.
        // a task titled "CSE 590 Project Work" scheduled alongside a calendar event of
        // the same name — they represent the same work, not a conflict).
        if (sameActivity(ev.title, b.label)) continue;
        const bStart = hmToMinutes(b.start);
        const bEnd = hmToMinutes(b.end);
        if (bEnd <= bStart) continue;
        if (overlaps(evStart, evEnd, bStart, bEnd)) {
          proposals.push({
            severity: b.hero ? "high" : "med",
            kind: "block_conflict",
            title: `"${ev.title}" conflicts with ${b.hero ? "your focus block" : b.label}`,
            body: `${b.start}–${b.end} was reserved for ${b.label}. ${ev.title} now overlaps.`,
            actions: [
              { label: "Reschedule block", op: "reschedule_block" },
              { label: "Regenerate plan", op: "regenerate_plan" },
            ],
            relatedType: "event",
            relatedId: ev.id,
          });
          break;
        }
      }
    }

    // plan-aware: hero_shrunk — hero block ends before now or has <25m remaining usable
    const hero = blocks.find((b) => b.hero);
    if (hero) {
      const heroStart = hmToMinutes(hero.start);
      const heroEnd = hmToMinutes(hero.end);
      const nowMin = hmToMinutes(hmInTz(now, tz));
      let usable = Math.max(0, heroEnd - Math.max(heroStart, nowMin));
      for (const ev of ownEvents) {
        const evStart = Math.max(heroStart, hmToMinutes(hmInTz(ev.start, tz)));
        const evEnd = Math.min(heroEnd, hmToMinutes(hmInTz(ev.end, tz)));
        if (evEnd > evStart && evStart < heroEnd && evEnd > Math.max(heroStart, nowMin)) {
          usable -= Math.min(evEnd, heroEnd) - Math.max(evStart, Math.max(heroStart, nowMin));
        }
      }
      const planned = Math.max(1, heroEnd - heroStart);
      if (usable > 0 && usable < 25 && planned >= 45) {
        proposals.push({
          severity: "med",
          kind: "hero_shrunk",
          title: `Focus window down to ${Math.max(0, Math.round(usable))}m`,
          body: `Planned ${planned}m for "${hero.label}". Want Cortex to find a fresh block?`,
          actions: [
            { label: "Regenerate plan", op: "regenerate_plan" },
            { label: "Dismiss", op: "dismiss" },
          ],
          relatedType: null,
          relatedId: null,
        });
      }
    }
  }

  // Suppress anything we already showed the user inside the per-kind cooldown
  // window (active, dismissed, acted on, or snoozed — all count).
  const fresh = proposals.filter((p) => !suppressed(p.kind, p.relatedId));

  for (const p of fresh) {
    await createNotification(userId, {
      severity: p.severity,
      kind: p.kind,
      title: p.title,
      body: p.body,
      actions: p.actions,
      relatedObjectType: p.relatedType,
      relatedObjectId: p.relatedId,
    });
  }

  // Proactive task proposer. Looks at upcoming events + projects + journal
  // and creates concrete tasks the user hasn't captured yet. Dedupped across
  // a 14-day window via agent_proposals so tasks don't get re-created after
  // completion/deletion.
  let createdTasks: { id: string; title: string; reason: string }[] = [];
  try {
    const r = await proposeTasks(userId);
    createdTasks = r.created;
    if (createdTasks.length > 0) {
      const summaryLines = createdTasks.map((t) => `• ${t.title}`).join("\n");
      await createNotification(userId, {
        severity: "low",
        kind: "agent_created_tasks",
        title: `Cortex added ${createdTasks.length} task${createdTasks.length === 1 ? "" : "s"}`,
        body: summaryLines.slice(0, 400),
        actions: [
          { label: "View tasks", op: "view_tasks" },
          { label: "Dismiss", op: "dismiss" },
        ],
        relatedObjectType: null,
        relatedObjectId: null,
      });
    }
  } catch (err) {
    console.error("task proposer failed:", err);
  }

  // LLM-backed insights layer (journal + preferences + tendencies + plan).
  // Stored with kind="insight" and insightKey in relatedObjectId. Suppressed
  // by the same cooldown map — if the user saw "evening_study_low_ratings"
  // in the past week (dismissed or not), don't refire it.
  const insights: Proposal[] = [];
  try {
    const raw = await generateInsights(userId);
    for (const i of raw) {
      if (suppressed("insight", i.key)) continue;
      await createNotification(userId, {
        severity: i.severity,
        kind: "insight",
        title: i.title,
        body: i.body,
        actions: i.actions,
        relatedObjectType: "insight",
        relatedObjectId: i.key,
      });
      insights.push({
        severity: i.severity,
        kind: "insight",
        title: i.title,
        body: i.body,
        actions: i.actions,
        relatedType: "insight",
        relatedId: i.key,
      });
    }
  } catch (err) {
    console.error("insight layer failed:", err);
  }

  return { notifications: [...fresh, ...insights], tasksCreated: createdTasks };
}

function addHours(d: Date, h: number) {
  return new Date(+d + h * 3_600_000);
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function sameActivity(eventTitle: string, blockLabel: string): boolean {
  const a = normalizeActivity(eventTitle);
  const b = normalizeActivity(blockLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function normalizeActivity(s: string): string {
  // Strip planner suffixes like " — deep work", " - prep", "(draft)" so we compare the underlying activity.
  return s
    .toLowerCase()
    .replace(/\s*[—–-]\s*(deep work|focus|prep|study|work)\b.*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
