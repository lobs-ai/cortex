import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";

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
