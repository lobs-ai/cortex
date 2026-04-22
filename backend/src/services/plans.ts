import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { generateDailyPlan, type DailyPlan, type PlanCommitment } from "../ai/planner.js";
import { createNotification, listActiveNotifications } from "./notifications.js";
import { createCommitment } from "./commitments.js";
import { startOfDayInTz, endOfDayInTz } from "../lib/time.js";

export async function persistPlan(userId: string, type: "daily" | "weekly", fresh: DailyPlan) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const id = newId("plan");
  await db.insert(schema.plans).values({
    id,
    userId,
    planType: type,
    periodStart: today,
    periodEnd: end,
    contentJson: JSON.stringify({ ...fresh, generatedAt: now.toISOString() }),
    generatedBy: fresh.generatedBy,
    createdAt: now,
  });
  return {
    id,
    type,
    periodStart: today,
    periodEnd: end,
    content: { ...fresh, generatedAt: now.toISOString() },
    generatedBy: fresh.generatedBy,
    createdAt: now,
  };
}

export async function regenerateDailyPlan(
  userId: string,
  date: Date = new Date(),
  opts?: { guidance?: string },
) {
  const fresh = await generateDailyPlan(userId, date, opts);
  if (fresh.fallbackReason) {
    // Surface planner failures so they aren't invisible. Dedup so the user
    // isn't spammed every worker tick while the underlying issue persists.
    const active = await listActiveNotifications(userId);
    const already = active.find(
      (n) => n.kind === "planner_fallback" && n.body === fresh.fallbackReason,
    );
    if (!already) {
      await createNotification(userId, {
        severity: "med",
        kind: "planner_fallback",
        title: "Planner fell back to heuristic",
        body: fresh.fallbackReason,
        actions: ["Open settings"],
        category: "system",
      });
    }
  }
  const persisted = await persistPlan(userId, "daily", fresh);
  // Write the planner's commitments into the commitments table so the
  // monitor and Now card can see them. Only touch today's planner-sourced
  // rows that haven't been prompted yet — we don't want to overwrite a
  // commitment the user is already in the middle of.
  await syncPlannerCommitments(userId, date, fresh.commitments ?? []);
  return persisted;
}

async function syncPlannerCommitments(
  userId: string,
  date: Date,
  commitments: PlanCommitment[],
): Promise<void> {
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";
  const dayStart = startOfDayInTz(date, tz);
  const dayEnd = endOfDayInTz(date, tz);

  // Drop today's still-pending, planner-sourced rows — the new plan replaces
  // them. Anything already prompted/doing/done/skipped/missed stays, because
  // the user has already engaged with it.
  await db
    .delete(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        gte(schema.commitments.startTime, dayStart),
        lte(schema.commitments.startTime, dayEnd),
        inArray(schema.commitments.source, ["planner", "replan"]),
        eq(schema.commitments.state, "pending"),
      ),
    );

  for (const c of commitments) {
    const start = parseHM(dayStart, c.start, tz);
    if (!start) continue;
    // Ignore anything already past — a fresh plan created after the fact
    // shouldn't schedule commitments into the past.
    if (+start < Date.now() - 2 * 60_000) continue;
    await createCommitment(userId, {
      title: c.title.slice(0, 200),
      verifyCriterion: c.verifyCriterion?.slice(0, 300) ?? null,
      startTime: start,
      durationMin: c.durationMin,
      taskId: c.taskId ?? null,
      source: "planner",
    });
  }
}

// Naive local-time HH:MM → Date using the date's wall-clock position.
// dayStart is already in the user's tz; we add H*60+M minutes to it.
function parseHM(dayStart: Date, hm: string, _tz: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) return null;
  return new Date(+dayStart + (hh * 60 + mm) * 60_000);
}

export async function getLatestPlan(userId: string, type: "daily" | "weekly") {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const rows = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.userId, userId),
        eq(schema.plans.planType, type),
        gte(schema.plans.periodStart, today),
        lte(schema.plans.periodStart, tomorrow),
      ),
    )
    .orderBy(desc(schema.plans.createdAt));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.planType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    content: JSON.parse(row.contentJson),
    generatedBy: row.generatedBy,
    createdAt: row.createdAt,
  };
}
