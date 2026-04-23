import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import {
  awakenSnoozed,
  findDuplicatePairs,
  findExpiredBlocks,
  findStaleCandidates,
  findWakeableSnoozes,
  listTaskEvents,
  markTaskStale,
  titleSimilarity,
} from "../services/tasks.js";
import {
  createNotification,
  listRecentNotifications,
} from "../services/notifications.js";
import { complete } from "./client.js";
import { extractJson } from "./jsonExtract.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider } from "./registry.js";
import { getRoleModel } from "../services/settings.js";

// The gardener keeps the task list alive: wakes snoozed rows, nudges
// timed-out blocks, ages captured rows out to "stale," and proposes merges
// for obvious duplicates. Deterministic first — an LLM "do you actually
// want this?" layer can sit on top later. The loop that matters is:
//   worker → runGardener → notifications → user acts → state updates.

// Suppression window for gardener-emitted notifications. Proposing the
// same merge every 10 minutes would be worse than no proposal.
const PROPOSAL_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export type GardenerResult = {
  awoken: number;
  blockedSurfaced: number;
  staled: number;
  dupeProposals: number;
  killProposals: number;
};

export async function runGardener(userId: string): Promise<GardenerResult> {
  const now = new Date();
  let awoken = 0;
  let blockedSurfaced = 0;
  let staled = 0;
  let dupeProposals = 0;
  let killProposals = 0;

  // Run the LLM semantic dedup first. It emits its own notifications with
  // the same `task.dup` kind, so the cooldown window already in place
  // prevents the heuristic pass below from double-flagging the same pair.
  try {
    const llmPairs = await llmDedupPass(userId);
    dupeProposals += await emitMergeProposals(userId, llmPairs, "llm");
  } catch (err) {
    console.warn("gardener llm dedup failed:", err);
  }

  // 1. Wake snoozes whose time has come. Moves them back to inbox and logs
  //    'awoken' — the TriageCard will pick them up.
  const wakeable = await findWakeableSnoozes(userId, now);
  for (const t of wakeable) {
    await awakenSnoozed(userId, t.id);
    awoken++;
  }

  // 2. Surface timed-out blocks. We don't auto-unblock (the user might
  //    still be blocked and want to extend) — we surface a notification
  //    that asks. Cooldown prevents daily nagging.
  const expiredBlocks = await findExpiredBlocks(userId, now);
  const since = new Date(+now - PROPOSAL_COOLDOWN_MS);
  const recent = await listRecentNotifications(userId, since);
  const recentBlockKeys = new Set(
    recent
      .filter((n) => n.kind === "task.block_expired")
      .map((n) => n.relatedId ?? ""),
  );
  for (const t of expiredBlocks) {
    if (recentBlockKeys.has(t.id)) continue;
    await createNotification(userId, {
      severity: "low",
      kind: "task.block_expired",
      title: `Still blocked on ${t.blockedOn ?? "something"}?`,
      body: `"${t.title}" was blocked until ${
        t.blockedUntil ? new Date(t.blockedUntil).toLocaleString() : "now"
      }. Unblock it, extend, or abandon?`,
      actions: [
        { label: "Unblock", op: "task.unblock" },
        { label: "Still waiting", op: "dismiss" },
        { label: "Abandon", op: "task.abandon_open" },
      ],
      relatedObjectType: "task",
      relatedObjectId: t.id,
    });
    blockedSurfaced++;
  }

  // 3. Age out. Captured >48h without triage → stale; active with no
  //    activity in 14d → stale. A separate notification offers "keep /
  //    kill" so the user can bulk-decide in one pass.
  const staleCandidates = await findStaleCandidates(userId, now);
  const recentStaleKeys = new Set(
    recent
      .filter((n) => n.kind === "task.stale")
      .map((n) => n.relatedId ?? ""),
  );
  for (const s of staleCandidates) {
    await markTaskStale(userId, s.id, s.reason);
    staled++;
    if (recentStaleKeys.has(s.id)) continue;
    await createNotification(userId, {
      severity: "low",
      kind: "task.stale",
      title:
        s.reason === "captured_aged_out"
          ? `Untouched inbox item: "${s.title}"`
          : `No activity for 14d: "${s.title}"`,
      body:
        s.reason === "captured_aged_out"
          ? "Captured 2+ days ago and never triaged. Plan it, snooze it, or drop it?"
          : "No commitments or notes in the past two weeks. Still yours?",
      actions: [
        { label: "Keep it", op: "task.keep" },
        { label: "Snooze 1w", op: "task.snooze_1w" },
        { label: "Abandon", op: "task.abandon_open" },
      ],
      relatedObjectType: "task",
      relatedObjectId: s.id,
    });
    killProposals++;
  }

  // 4. Heuristic fuzzy-match pairs. Catches whatever the LLM pass didn't
  //    find (or everything, if no LLM key is configured).
  const heuristicPairs = (await findDuplicatePairs(userId)).map((p) => ({
    canonicalId: p.canonical.id,
    canonicalTitle: p.canonical.title,
    duplicateId: p.duplicate.id,
    duplicateTitle: p.duplicate.title,
    score: p.score,
  }));
  dupeProposals += await emitMergeProposals(userId, heuristicPairs, "heuristic");

  return { awoken, blockedSurfaced, staled, dupeProposals, killProposals };
}

type MergePair = {
  canonicalId: string;
  canonicalTitle: string;
  duplicateId: string;
  duplicateTitle: string;
  score: number;
};

// Emit one notification per pair, deduped against existing open `task.dup`
// cards for the same duplicate id so the user isn't re-nagged.
async function emitMergeProposals(
  userId: string,
  pairs: MergePair[],
  origin: "llm" | "heuristic",
): Promise<number> {
  if (pairs.length === 0) return 0;
  const since = new Date(Date.now() - PROPOSAL_COOLDOWN_MS);
  const recent = await listRecentNotifications(userId, since);
  const recentDupIds = new Set(
    recent.filter((n) => n.kind === "task.dup").map((n) => n.relatedId ?? ""),
  );
  let emitted = 0;
  for (const p of pairs) {
    if (recentDupIds.has(p.duplicateId)) continue;
    await createNotification(userId, {
      severity: "low",
      kind: "task.dup",
      title: `Possible duplicate: "${p.duplicateTitle}"`,
      body:
        origin === "llm"
          ? `AI thinks this is the same as "${p.canonicalTitle}". Merge, keep both, or abandon?`
          : `Looks like "${p.canonicalTitle}" (${Math.round(p.score * 100)}% match). Merge, keep both, or abandon?`,
      actions: [
        { label: "Merge into older", op: "task.merge_into_canonical" },
        { label: "Keep both", op: "task.keep" },
        { label: "Abandon this one", op: "task.abandon_open" },
      ],
      relatedObjectType: "task",
      relatedObjectId: p.duplicateId,
    });
    emitted++;
  }
  return emitted;
}

// Ask the monitor-role LLM to find semantic duplicates in the current live
// task set. Only runs when a provider + key are configured. The prompt
// gives the LLM the full non-terminal task list with status and asks for
// clusters it is at least 80% confident are the same work. Lower than that
// and the heuristic pass catches it anyway.
async function llmDedupPass(userId: string): Promise<MergePair[]> {
  const cfg = await getRoleModel(userId, "monitor");
  const entry = getProvider(cfg.provider);
  if (!entry) return [];
  if (entry.requiresApiKey) {
    const key = await getActiveKey(userId, cfg.provider);
    if (!key) return [];
  }

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        inArray(schema.tasks.status, [
          "inbox",
          "today",
          "doing",
          "snoozed",
          "blocked",
          "stale",
        ]),
      ),
    );
  if (rows.length < 2) return [];

  const tasks = rows.slice(0, 120).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    description: r.description?.slice(0, 200) ?? null,
  }));

  const system = [
    "You are Cortex's deduplicator. Given a list of the user's active tasks, identify clusters that represent the SAME intended work even if worded differently.",
    "Rules:",
    "- 'Write thesis intro' and 'Draft the introduction for my thesis' ARE duplicates.",
    "- 'Email Sarah about review' and 'Follow up with Sarah on the review' ARE duplicates.",
    "- 'Fix login bug' and 'Fix signup bug' are NOT duplicates (different feature).",
    "- 'Study chapter 4' and 'Study chapter 5' are NOT duplicates (different scope).",
    "- Don't propose a merge unless you are at least 80% confident.",
    "- Within a cluster, pick the ONE canonical task. Prefer the one with clearer wording; if unclear, pick the shorter one.",
    "- Skip clusters that are just different sub-steps of a larger effort (those belong under the same project, not merged).",
    "Return JSON only:",
    `{"clusters": [{"canonicalId": string, "duplicateIds": string[], "reason": string (<120 chars)}]}`,
    "If no duplicates found, return {\"clusters\": []}. Silence is better than wrong merges.",
  ].join("\n");

  let result: { clusters?: Array<{ canonicalId?: string; duplicateIds?: string[]; reason?: string }> } = {};
  try {
    const out = await complete(userId, cfg.provider, cfg.model, {
      system,
      maxTokens: 800,
      messages: [{ role: "user", content: `TASKS:\n${JSON.stringify(tasks, null, 2)}` }],
    });
    const parsed = extractJson<typeof result>(out?.text ?? "");
    if (!parsed.ok) return [];
    result = parsed.value;
  } catch (err) {
    console.warn("llm dedup call failed:", err);
    return [];
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const pairs: MergePair[] = [];
  for (const c of result.clusters ?? []) {
    const canonical = c.canonicalId ? byId.get(c.canonicalId) : null;
    if (!canonical) continue;
    for (const dupId of c.duplicateIds ?? []) {
      if (dupId === canonical.id) continue;
      const dup = byId.get(dupId);
      if (!dup) continue;
      // Sanity check — don't emit a "merge" that the normalized score
      // says is obviously unrelated (<0.3). Stops LLM hallucinations
      // from polluting the triage card.
      const score = titleSimilarity(canonical.title, dup.title);
      if (score < 0.3) continue;
      pairs.push({
        canonicalId: canonical.id,
        canonicalTitle: canonical.title,
        duplicateId: dup.id,
        duplicateTitle: dup.title,
        score: Math.max(score, 0.8), // LLM said ≥80%, trust it
      });
    }
  }
  return pairs;
}

// Used by the timeline drawer on the task detail page: returns the event
// log ordered by time. (Thin wrapper so the route doesn't import service
// and a UI helper separately.)
export { listTaskEvents };
