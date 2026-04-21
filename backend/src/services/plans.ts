import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { generateDailyPlan, type DailyPlan } from "../ai/planner.js";
import { createNotification, listActiveNotifications } from "./notifications.js";

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
  return persistPlan(userId, "daily", fresh);
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
