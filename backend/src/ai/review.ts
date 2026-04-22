import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { startOfDayInTz, endOfDayInTz, hmInTz } from "../lib/time.js";
import { dailyRollup, listCommitmentsInRange } from "../services/commitments.js";
import { createNotification, listRecentNotifications } from "../services/notifications.js";

// Minimum local hour to build the review. Skipping before this means the
// day is still in progress.
const REVIEW_HOUR = 20;

export type DailyReviewResult = {
  ran: boolean;
  reason?: string;
  done: number;
  skipped: number;
  missed: number;
};

// Runs at most once per day, after REVIEW_HOUR local. Replays the day's
// commitments, produces a short summary + one pattern line, and posts a
// daily_review notification. The body is plain text so it renders in the
// existing notification card.
export async function runDailyReview(userId: string): Promise<DailyReviewResult> {
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";
  const now = new Date();
  const hour = parseInt(hmInTz(now, tz).slice(0, 2), 10);
  if (hour < REVIEW_HOUR) {
    return { ran: false, reason: "too_early", done: 0, skipped: 0, missed: 0 };
  }
  const dayStart = startOfDayInTz(now, tz);
  const dayEnd = endOfDayInTz(now, tz);

  // Has today's review already fired?
  const since = new Date(+now - 24 * 60 * 60 * 1000);
  const recent = await listRecentNotifications(userId, since);
  if (recent.some((n) => n.kind === "daily_review" && +n.createdAt >= +dayStart)) {
    return { ran: false, reason: "already_ran", done: 0, skipped: 0, missed: 0 };
  }

  const rollup = await dailyRollup(userId, dayStart, dayEnd);
  if (rollup.total === 0) {
    return { ran: false, reason: "no_commitments", ...rollup };
  }

  const commits = await listCommitmentsInRange(userId, dayStart, dayEnd);
  const missedOrSkipped = commits.filter((c) => c.state === "missed" || c.state === "skipped");

  // Simple pattern line: if >=2 misses clustered after 18:00, call that out.
  // If >=2 misses share a task, call that out instead. Otherwise, nothing
  // — don't fabricate a pattern.
  const patternLine = derivePattern(commits, tz);

  const hitRate = rollup.total > 0 ? Math.round((rollup.done / rollup.total) * 100) : 0;
  const title = `Today: ${rollup.done}/${rollup.total} done (${hitRate}%)`;
  const bodyParts = [
    `${rollup.done} done · ${rollup.skipped} skipped · ${rollup.missed} missed.`,
  ];
  if (patternLine) bodyParts.push(patternLine);
  if (missedOrSkipped.length > 0) {
    const example = missedOrSkipped[0];
    const reason = example.skipReason?.trim() || "no reason given";
    bodyParts.push(`First miss: "${example.title}" — ${reason}.`);
  }

  await createNotification(userId, {
    severity: rollup.missed >= 2 ? "med" : "low",
    kind: "daily_review",
    title,
    body: bodyParts.join(" "),
    actions: [
      { label: "Adjust tomorrow", op: "regenerate_plan" },
      { label: "Dismiss", op: "dismiss" },
    ],
    category: "review",
    relatedObjectType: "review",
    relatedObjectId: new Date(dayStart).toISOString().slice(0, 10),
  });

  // Stash the review itself as a plan row so the /why and history surfaces
  // can show it later.
  await db.insert(schema.plans).values({
    id: newId("plan"),
    userId,
    planType: "daily_review",
    periodStart: dayStart,
    periodEnd: dayEnd,
    contentJson: JSON.stringify({
      rollup,
      pattern: patternLine,
      commitments: commits.map((c) => ({
        id: c.id,
        title: c.title,
        start: c.startTime.toISOString(),
        durationMin: c.durationMin,
        state: c.state,
        artifact: c.artifact,
        skipReason: c.skipReason,
      })),
    }),
    generatedBy: "review:deterministic",
    createdAt: now,
  });

  return { ran: true, ...rollup };
}

function derivePattern(
  commits: Awaited<ReturnType<typeof listCommitmentsInRange>>,
  tz: string,
): string | null {
  const missed = commits.filter((c) => c.state === "missed" || c.state === "skipped");
  if (missed.length < 2) return null;

  // Time-of-day clustering: if >=2 misses are all after 18:00, flag that.
  const lateMiss = missed.filter((c) => {
    const hh = parseInt(hmInTz(c.startTime, tz).slice(0, 2), 10);
    return hh >= 18;
  });
  if (lateMiss.length >= 2 && lateMiss.length === missed.length) {
    return `Pattern: all ${missed.length} slips were after 18:00 — consider moving tomorrow's deep work earlier.`;
  }

  // Same-task clustering: if >=2 misses share a taskId, flag that.
  const byTask = new Map<string, number>();
  for (const c of missed) {
    if (!c.taskId) continue;
    byTask.set(c.taskId, (byTask.get(c.taskId) ?? 0) + 1);
  }
  const worst = [...byTask.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 2) {
    return `Pattern: ${worst[1]} slips on the same task — it may be too big. Try a smaller first action tomorrow.`;
  }
  return null;
}

export async function latestReview(userId: string) {
  const rows = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.userId, userId), eq(schema.plans.planType, "daily_review")))
    .orderBy(desc(schema.plans.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    content: JSON.parse(row.contentJson),
    createdAt: row.createdAt,
  };
}
