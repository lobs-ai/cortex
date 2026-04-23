import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { complete } from "./client.js";
import { extractJson } from "./jsonExtract.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";
import { listEvents } from "../services/events.js";
import { summarizeTasks } from "../services/tasks.js";
import { listEntries, listEventsAwaitingReflection } from "../services/journal.js";
import { listPreferences, listTendencies } from "../services/memory.js";
import { getLatestPlan } from "../services/plans.js";
import { hmInTz, localIsoInTz } from "../lib/time.js";
import type { NotificationAction } from "../services/notifications.js";

export type Insight = {
  severity: "high" | "med" | "low";
  title: string;
  body: string;
  key: string; // stable dedup key, e.g. "evening_study_low_ratings"
  actions?: NotificationAction[];
};

// Cooldown window — don't refire the same insight key inside this window even
// if the prior notification was dismissed. Extended from 24h to 7d because
// the old value let "repeated low evening study" re-fire every day.
export const INSIGHT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// LLM-backed proactive insight layer. Reads reflections, preferences, learned
// tendencies, the current plan, and recent activity, then proposes 0–2 concrete
// observations the user would want surfaced. Pure rules (deadline_risk, prep,
// backlog, block_conflict) still live in monitor.ts — this complements them.
export async function generateInsights(userId: string): Promise<Insight[]> {
  const cfg = await getRoleModel(userId, "monitor");
  const entry = getProvider(cfg.provider);
  if (!entry) return [];
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) return [];
  }

  const now = new Date();
  const [userRow] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const tz = userRow?.timezone ?? "America/Detroit";
  const last14 = new Date(+now - 14 * 24 * 60 * 60 * 1000);
  const last3 = new Date(+now - 3 * 24 * 60 * 60 * 1000);
  const in72h = new Date(+now + 72 * 60 * 60 * 1000);

  const [journal, preferences, tendencies, plan, upcoming, taskDigest, awaitingReflection, recentInsights] =
    await Promise.all([
      listEntries(userId, { from: last14, limit: 40 }),
      listPreferences(userId),
      listTendencies(userId),
      getLatestPlan(userId, "daily"),
      listEvents(userId, { from: now, to: in72h }),
      summarizeTasks(userId),
      listEventsAwaitingReflection(userId, last3),
      recentInsightKeys(userId),
    ]);

  // Nothing meaningful to reason over — skip the LLM call.
  if (journal.length === 0 && preferences.length === 0 && tendencies.length === 0) return [];

  const ctx = {
    now: hmInTz(now, tz),
    timezone: tz,
    plan: plan
      ? {
          summary: plan.content?.summary,
          blocks: (plan.content?.blocks ?? []).map((b: { start: string; end: string; label: string; kind: string; hero?: boolean }) => ({
            start: b.start,
            end: b.end,
            label: b.label,
            kind: b.kind,
            hero: !!b.hero,
          })),
        }
      : null,
    upcoming: upcoming
      .filter((e) => !e.subscribed)
      .slice(0, 20)
      .map((e) => ({ title: e.title, start: localIsoInTz(e.start, tz), kind: e.kind, important: !!e.important })),
    tasks: taskDigest,
    journal: journal.map((j) => ({
      kind: j.kind,
      rating: j.rating,
      note: j.note,
      eventId: j.eventId,
      at: j.createdAt instanceof Date ? localIsoInTz(j.createdAt, tz) : j.createdAt,
    })),
    preferences: preferences.slice(0, 25).map((p) => ({ key: p.key, value: p.value, confidence: p.confidence })),
    tendencies: tendencies.slice(0, 15).map((t) => ({ text: t.text, confidence: t.confidence, evidence: t.evidence })),
    awaitingReflection: awaitingReflection.slice(0, 6).map((e) => ({ id: e.id, title: e.title, end: localIsoInTz(e.end, tz) })),
    recentInsightKeys: recentInsights,
  };

  const system = [
    "You are the Monitor role of Cortex. Your job is to notice patterns in the user's reflections, preferences, tendencies, plan, and upcoming schedule, and surface at most TWO concrete proactive insights the user would want to know NOW.",
    "",
    "## What makes a good insight",
    "- Cross-references two or more signals (e.g. repeated low-rated reflections + an upcoming event scheduled the same way).",
    "- Names the specific evidence: titles of events, ratings, preference keys. Not vague generalities.",
    "- Offers one concrete next action the user can take. Not a menu.",
    "- Non-obvious — don't restate a task's due date or that a meeting is soon. Those are covered by rule-based alerts.",
    "",
    "## Suppression",
    "- NEVER emit an insight whose `key` appears in recentInsightKeys — the user saw that insight in the past 7 days (whether they acted on it or dismissed it). Repeating it is worse than silence.",
    "- If you can only come up with a near-rewording of a recent key, return nothing. The user would see through it.",
    "- If you have no strong observation, return an empty array. Silence is better than noise.",
    "",
    "## Output",
    "Return JSON only, shape:",
    `{"insights": [{"severity": "high"|"med"|"low", "title": string (<80 chars), "body": string (<240 chars, include evidence), "key": string (stable lowercase_snake identifier for dedup, <48 chars), "actions": string[] (0–2 short button labels)}]}`,
    "If you have nothing to say, return {\"insights\": []}.",
  ].join("\n");

  try {
    const result = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 600,
      messages: [{ role: "user", content: `CONTEXT:\n${JSON.stringify(ctx, null, 2)}` }],
    });
    const text = result?.text ?? "";
    const extracted = extractJson<{ insights?: Insight[] }>(text);
    if (!extracted.ok) {
      console.error("insights JSON parse failed:", extracted.error);
      return [];
    }
    const raw = Array.isArray(extracted.value.insights) ? extracted.value.insights : [];
    const suppressed = new Set(recentInsights);
    return raw
      .filter((i) => i && typeof i.key === "string" && i.key && !suppressed.has(i.key))
      .slice(0, 2)
      .map((i) => ({
        severity: i.severity === "high" || i.severity === "med" ? i.severity : "low",
        title: String(i.title ?? "").slice(0, 120),
        body: String(i.body ?? "").slice(0, 280),
        key: i.key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 48),
        actions: Array.isArray(i.actions)
          ? i.actions
              .slice(0, 2)
              .map((a): NotificationAction | null => {
                if (typeof a === "string") return { label: a, op: "dismiss" };
                if (a && typeof a === "object" && typeof a.label === "string") {
                  return { label: a.label, op: typeof a.op === "string" ? a.op : "dismiss" };
                }
                return null;
              })
              .filter((a): a is NotificationAction => a !== null)
          : undefined,
      }));
  } catch (err) {
    console.error("insights generation failed:", err);
    return [];
  }
}

// Insight keys we've surfaced within the cooldown window — regardless of
// whether the user dismissed, acted on, or snoozed the notification. Passed
// to the LLM as recentInsightKeys so it knows not to re-derive them in new
// words, and also used as a server-side belt-and-braces filter.
async function recentInsightKeys(userId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - INSIGHT_COOLDOWN_MS);
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.kind, "insight"),
        gte(schema.notifications.createdAt, cutoff),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt));
  return rows
    .map((r) => r.relatedObjectId)
    .filter((x): x is string => !!x);
}
