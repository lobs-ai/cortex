import {
  awakenSnoozed,
  findDuplicatePairs,
  findExpiredBlocks,
  findStaleCandidates,
  findWakeableSnoozes,
  listTaskEvents,
  markTaskStale,
} from "../services/tasks.js";
import {
  createNotification,
  listRecentNotifications,
} from "../services/notifications.js";

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

  // 4. Propose merges for normalized-title duplicates. Canonical = older
  //    row; the duplicate is the one we'd merge into it. One notification
  //    per pair, dedup'd by the duplicate id.
  const dupes = await findDuplicatePairs(userId);
  const recentMergeKeys = new Set(
    recent.filter((n) => n.kind === "task.dup").map((n) => n.relatedId ?? ""),
  );
  for (const { canonical, duplicate } of dupes) {
    if (recentMergeKeys.has(duplicate.id)) continue;
    await createNotification(userId, {
      severity: "low",
      kind: "task.dup",
      title: `Possible duplicate: "${duplicate.title}"`,
      body: `Looks like "${canonical.title}" (older). Merge into the older one, keep both, or abandon the new one?`,
      actions: [
        { label: "Merge into older", op: "task.merge_into_canonical" },
        { label: "Keep both", op: "task.keep" },
        { label: "Abandon this one", op: "task.abandon_open" },
      ],
      relatedObjectType: "task",
      relatedObjectId: duplicate.id,
      // Pass the canonical id through via a secondary channel — we encode
      // it in the body above and also in a structured way by piggybacking
      // on relatedObjectType. For the action handler, we'll look it up
      // again from findSemanticDuplicate to avoid state drift.
    });
    dupeProposals++;
  }

  return { awoken, blockedSurfaced, staled, dupeProposals, killProposals };
}

// Used by the timeline drawer on the task detail page: returns the event
// log ordered by time. (Thin wrapper so the route doesn't import service
// and a UI helper separately.)
export { listTaskEvents };
