import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { TaskCreateInput, TaskPatchInput } from "../schemas/tasks.js";
import { PLAYABLE_STATUSES } from "../schemas/tasks.js";

type Row = typeof schema.tasks.$inferSelect;

const hydrate = (r: Row) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  due: r.dueDate,
  priority: r.priority,
  status: r.status,
  estMin: r.estimatedMinutes,
  actualMin: r.actualMinutes,
  project: r.projectId,
  energy: r.energyLevel,
  tags: r.tagsJson ? (JSON.parse(r.tagsJson) as string[]) : [],
  completedAt: r.completedAt,
  skipCount: r.skipCount,
  lastMissedAt: r.lastMissedAt,
  canonicalTaskId: r.canonicalTaskId,
  parentTaskId: r.parentTaskId,
  outcome: r.outcome,
  abandonReason: r.abandonReason,
  blockedOn: r.blockedOn,
  blockedUntil: r.blockedUntil,
  snoozeUntil: r.snoozeUntil,
  staleAt: r.staleAt,
  triagedAt: r.triagedAt,
  lastActivityAt: r.lastActivityAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Default: return everything, since the /api/tasks route and the UI still
// expect the full dataset. AI callers (proposer, insights, planner, chat)
// should prefer the narrower helpers below instead of pulling all rows.
export async function listTasks(userId: string, opts?: ListTasksOptions) {
  const conds = [eq(schema.tasks.userId, userId)];
  if (opts?.playable) {
    // Planner-style filter — only rows the user should actually be working
    // on. Explicit allow-list so gardener states (snoozed, blocked,
    // abandoned, merged, stale) never sneak back in.
    conds.push(inArray(schema.tasks.status, [...PLAYABLE_STATUSES]));
  } else if (opts?.openOnly) {
    // Legacy: everything except 'done'. Kept for back-compat with UI.
    conds.push(ne(schema.tasks.status, "done"));
  }
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(asc(schema.tasks.dueDate));
  const all = rows.map(hydrate);
  if (opts?.includeDoneSince && !opts.openOnly && !opts.playable) {
    return all.filter(
      (t) =>
        t.status !== "done" ||
        (t.completedAt && +t.completedAt >= +opts.includeDoneSince!),
    );
  }
  return all;
}

export type ListTasksOptions = {
  // Legacy: exclude done tasks entirely. Still includes non-playable states
  // (snoozed, stale, etc.) for UI that wants the whole list.
  openOnly?: boolean;
  // Planner/scheduling filter: only inbox/today/doing.
  playable?: boolean;
  // Keep open tasks plus done tasks completed on/after this timestamp.
  includeDoneSince?: Date;
};

// Compressed view of the user's task list for LLM contexts. Returns counts
// by project/priority and capped recent titles, so we don't ship hundreds of
// rows to the model when all it needs is "what's open and what was just
// completed". Callers should prefer this over `listTasks()` when the LLM is
// the consumer.
export async function summarizeTasks(
  userId: string,
  opts?: { openLimit?: number; recentDoneDays?: number; recentDoneLimit?: number },
) {
  const openLimit = opts?.openLimit ?? 25;
  const recentDoneDays = opts?.recentDoneDays ?? 14;
  const recentDoneLimit = opts?.recentDoneLimit ?? 10;
  const cutoff = new Date(Date.now() - recentDoneDays * 24 * 60 * 60 * 1000);

  const all = await listTasks(userId, { includeDoneSince: cutoff });
  // "Open" here = playable (inbox/today/doing). Gardener states are alive
  // but not actionable, so the LLM shouldn't see them as workload.
  const open = all.filter((t) => (PLAYABLE_STATUSES as readonly string[]).includes(t.status));
  const recentDone = all
    .filter((t) => t.status === "done" && t.completedAt && +t.completedAt >= +cutoff)
    .sort((a, b) => (+(b.completedAt ?? 0)) - (+(a.completedAt ?? 0)));

  const byProject: Record<string, number> = {};
  const byPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  let overdue = 0;
  let dueToday = 0;
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  for (const t of open) {
    const pid = t.project ?? "(none)";
    byProject[pid] = (byProject[pid] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    if (t.due) {
      const d = +t.due;
      if (d < now) overdue++;
      else if (d < in24h) dueToday++;
    }
  }

  return {
    totals: {
      open: open.length,
      recentlyDone: recentDone.length,
      overdue,
      dueWithin24h: dueToday,
    },
    openByProject: byProject,
    openByPriority: byPriority,
    topOpen: open.slice(0, openLimit).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due: t.due ? t.due.toISOString() : null,
      estMin: t.estMin,
      projectId: t.project,
      status: t.status,
    })),
    recentlyCompleted: recentDone.slice(0, recentDoneLimit).map((t) => ({
      title: t.title,
      completedAt: t.completedAt ? (t.completedAt as Date).toISOString() : null,
    })),
  };
}

export async function getTask(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
  return row ? hydrate(row) : null;
}

export async function createTask(userId: string, input: TaskCreateInput) {
  const now = new Date();
  const id = newId("t");
  await db.insert(schema.tasks).values({
    id,
    userId,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.dueDate ?? null,
    priority: input.priority,
    status: input.status,
    estimatedMinutes: input.estimatedMinutes ?? null,
    projectId: input.projectId ?? null,
    energyLevel: input.energyLevel,
    tagsJson: JSON.stringify(input.tags ?? []),
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  await logTaskEvent(userId, id, "created", {
    title: input.title,
    priority: input.priority,
    status: input.status,
  });
  return (await getTask(userId, id))!;
}

export async function patchTask(userId: string, id: string, input: TaskPatchInput) {
  const existing = await getTask(userId, id);
  if (!existing) return null;
  const now = new Date();
  const updates: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now, lastActivityAt: now };
  const changed: Record<string, unknown> = {};
  if (input.title !== undefined && input.title !== existing.title) {
    updates.title = input.title;
    changed.title = { from: existing.title, to: input.title };
  }
  if (input.description !== undefined) {
    updates.description = input.description;
    if (input.description !== existing.description) changed.description = true;
  }
  if (input.dueDate !== undefined) {
    updates.dueDate = input.dueDate ?? null;
    changed.dueDate = input.dueDate ? input.dueDate.toISOString() : null;
  }
  if (input.priority !== undefined && input.priority !== existing.priority) {
    updates.priority = input.priority;
    changed.priority = { from: existing.priority, to: input.priority };
  }
  if (input.status !== undefined && input.status !== existing.status) {
    updates.status = input.status;
    if (input.status === "done" && !existing.completedAt) updates.completedAt = now;
    if (input.status !== "done") updates.completedAt = null;
    if (input.status === "today" || input.status === "doing") updates.triagedAt = now;
    changed.status = { from: existing.status, to: input.status };
  }
  if (input.estimatedMinutes !== undefined) updates.estimatedMinutes = input.estimatedMinutes ?? null;
  if (input.projectId !== undefined) updates.projectId = input.projectId ?? null;
  if (input.energyLevel !== undefined) updates.energyLevel = input.energyLevel;
  if (input.tags !== undefined) updates.tagsJson = JSON.stringify(input.tags);

  await db
    .update(schema.tasks)
    .set(updates)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));

  if (Object.keys(changed).length > 0) {
    await logTaskEvent(userId, id, "updated", changed);
  }

  return getTask(userId, id);
}

export async function deleteTask(userId: string, id: string) {
  await logTaskEvent(userId, id, "updated", { deleted: true });
  await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
}

// ------------------------- State machine -----------------------------
// Every transition below emits a task_events row so the timeline + daily
// gardener have a full audit trail. Transitions are idempotent: calling
// the same helper on a task already in the target state is a no-op that
// returns the current row.

async function transitionStatus(
  userId: string,
  id: string,
  next:
    | "inbox"
    | "today"
    | "doing"
    | "done"
    | "snoozed"
    | "blocked"
    | "abandoned"
    | "merged"
    | "stale",
  extra: Partial<typeof schema.tasks.$inferInsert> = {},
  event?: { kind: string; payload?: Record<string, unknown> },
) {
  const existing = await getTask(userId, id);
  if (!existing) return null;
  const now = new Date();
  await db
    .update(schema.tasks)
    .set({
      status: next,
      updatedAt: now,
      lastActivityAt: now,
      ...extra,
    })
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
  if (event) {
    await logTaskEvent(userId, id, event.kind, {
      from: existing.status,
      to: next,
      ...(event.payload ?? {}),
    });
  }
  return getTask(userId, id);
}

// Move a captured task to a playable state (today/doing) or into a holding
// state (snoozed/blocked). Records the triage moment so the gardener can
// tell untriaged rows from consciously-held ones.
export async function triageTask(
  userId: string,
  id: string,
  toStatus: "today" | "doing" | "inbox",
) {
  const now = new Date();
  return transitionStatus(
    userId,
    id,
    toStatus,
    { triagedAt: now, staleAt: null },
    { kind: "triaged", payload: { to: toStatus } },
  );
}

export async function snoozeTask(userId: string, id: string, until: Date) {
  return transitionStatus(
    userId,
    id,
    "snoozed",
    { snoozeUntil: until, staleAt: null },
    { kind: "snoozed", payload: { until: until.toISOString() } },
  );
}

export async function awakenSnoozed(userId: string, id: string) {
  return transitionStatus(
    userId,
    id,
    "inbox",
    { snoozeUntil: null },
    { kind: "awoken" },
  );
}

export async function blockTask(
  userId: string,
  id: string,
  reason: string,
  until?: Date | null,
) {
  return transitionStatus(
    userId,
    id,
    "blocked",
    { blockedOn: reason.slice(0, 300), blockedUntil: until ?? null },
    { kind: "blocked", payload: { reason, until: until ? until.toISOString() : null } },
  );
}

export async function unblockTask(userId: string, id: string) {
  return transitionStatus(
    userId,
    id,
    "inbox",
    { blockedOn: null, blockedUntil: null },
    { kind: "unblocked" },
  );
}

// Terminal: user decided they will not do this. Requires a reason because
// "abandoned with no context" is the thing we're trying to avoid.
export async function abandonTask(userId: string, id: string, reason: string) {
  return transitionStatus(
    userId,
    id,
    "abandoned",
    { abandonReason: reason.slice(0, 300), completedAt: new Date() },
    { kind: "abandoned", payload: { reason } },
  );
}

// Terminal: finished with an outcome line. Mirrors commitment artifacts —
// the user says what they delivered, the agent learns what "done" means
// for that kind of task.
export async function completeTask(userId: string, id: string, outcome?: string) {
  return transitionStatus(
    userId,
    id,
    "done",
    {
      outcome: outcome ? outcome.slice(0, 500) : null,
      completedAt: new Date(),
    },
    { kind: "done", payload: outcome ? { outcome } : undefined },
  );
}

// Dedup: point this row at the canonical duplicate. Planner/proposer
// ignore merged rows. The canonical row inherits the loser's context.
export async function mergeTask(userId: string, id: string, canonicalId: string) {
  if (id === canonicalId) return null;
  const canonical = await getTask(userId, canonicalId);
  if (!canonical) return null;
  const row = await transitionStatus(
    userId,
    id,
    "merged",
    { canonicalTaskId: canonicalId },
    { kind: "merged", payload: { canonicalId, canonicalTitle: canonical.title } },
  );
  // Log on the canonical too so its timeline shows the absorption.
  await logTaskEvent(userId, canonicalId, "merged", {
    absorbedId: id,
    absorbedTitle: row?.title ?? null,
  });
  return row;
}

export async function markTaskStale(userId: string, id: string, reason: string) {
  return transitionStatus(
    userId,
    id,
    "stale",
    { staleAt: new Date() },
    { kind: "marked_stale", payload: { reason } },
  );
}

// Pull a stale/abandoned task back into the playable set. Clears the
// stale/abandon metadata so the gardener doesn't immediately re-mark it.
export async function reviveTask(userId: string, id: string) {
  return transitionStatus(
    userId,
    id,
    "inbox",
    { staleAt: null, abandonReason: null, triagedAt: null },
    { kind: "revived" },
  );
}

export async function addTaskNote(userId: string, id: string, text: string) {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return getTask(userId, id);
  await logTaskEvent(userId, id, "note", { text: trimmed });
  await db
    .update(schema.tasks)
    .set({ updatedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
  return getTask(userId, id);
}

export async function logTaskEvent(
  userId: string,
  taskId: string,
  kind: string,
  payload?: Record<string, unknown>,
) {
  await db.insert(schema.taskEvents).values({
    id: newId("te"),
    userId,
    taskId,
    kind,
    at: new Date(),
    payloadJson: payload ? JSON.stringify(payload) : null,
  });
}

export async function listTaskEvents(userId: string, taskId: string) {
  return db
    .select()
    .from(schema.taskEvents)
    .where(
      and(eq(schema.taskEvents.userId, userId), eq(schema.taskEvents.taskId, taskId)),
    )
    .orderBy(asc(schema.taskEvents.at));
}

// ------------------------- Dedup -----------------------------
// Normalize a title to a stable key for near-duplicate matching. We lower-
// case, strip punctuation, collapse whitespace, and drop common filler
// words. Deliberately simple — an LLM-backed semantic match can layer on
// top later; this catches the "email Sarah" / "Email sarah" / "email
// Sarah!" cluster that makes up the bulk of dup pain.
const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "on",
  "in",
  "with",
  "and",
  "or",
  "at",
  "by",
  "is",
  "be",
  "my",
  "i",
  "re",
  "about",
]);

export function normalizeTitle(title: string): string {
  return normalizeTokens(title).join(" ");
}

// Stemmed, filler-free, sorted token list. Lets callers do set operations
// (intersection / union / Jaccard) for fuzzy matching without re-running
// the normalizer in multiple callers.
export function normalizeTokens(title: string): string[] {
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !FILLER_WORDS.has(w))
        .map(stem),
    ),
  ).sort();
}

// Cheap Porter-lite stemmer. "writing" → "write", "reviews" → "review",
// "planning" → "plan". Prevents "write intro" / "writing intro" false
// negatives without pulling a stemming library. Good enough for English
// task titles.
function stem(w: string): string {
  if (w.length <= 3) return w;
  const stripIng = w.replace(/(ing|ings)$/, "");
  if (stripIng !== w && stripIng.length >= 3) return collapseDouble(stripIng);
  const stripEd = w.replace(/(ed|edly)$/, "");
  if (stripEd !== w && stripEd.length >= 3) return collapseDouble(stripEd);
  const stripS = w.replace(/(ies|s)$/, (m) => (m === "ies" ? "y" : ""));
  if (stripS !== w && stripS.length >= 3) return stripS;
  return w;
}
function collapseDouble(w: string): string {
  // "planning" → "plann" → "plan"
  if (w.length >= 3 && w[w.length - 1] === w[w.length - 2]) return w.slice(0, -1);
  return w;
}

// Jaccard-style containment score: |A∩B| / min(|A|,|B|). Asymmetric ratio
// handles the "email sarah" ⊂ "email sarah about the review" case better
// than classic Jaccard. 1.0 = one set fully contained in the other.
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

// Threshold at which two titles are considered the same task. Empirical —
// 0.7 catches "finish the thesis intro" / "work on thesis introduction"
// while rejecting "email Sarah" / "email Ben".
const DUP_THRESHOLD = 0.7;

// Returns the best-scoring live duplicate if one crosses DUP_THRESHOLD,
// else null. Ignores done/abandoned/merged — those are closed (the user
// may legitimately want to do "email Sarah" again a month later) — but
// catches inbox, today, doing, snoozed, blocked, and stale, because a
// dupe against a snoozed row is just as real as against an active one.
export async function findSemanticDuplicate(
  userId: string,
  title: string,
  opts: { ignoreId?: string; threshold?: number } = {},
): Promise<{ id: string; title: string; status: string; score: number } | null> {
  const tokens = normalizeTokens(title);
  if (tokens.length === 0) return null;
  const threshold = opts.threshold ?? DUP_THRESHOLD;
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
  let best: { id: string; title: string; status: string; score: number } | null = null;
  for (const r of rows) {
    if (opts.ignoreId && r.id === opts.ignoreId) continue;
    const score = titleSimilarity(title, r.title);
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: r.id, title: r.title, status: r.status, score };
    }
  }
  return best;
}

// Full pairwise scan returning every cluster of likely-same rows. Older
// row is canonical; everything else merges into it. Used by the gardener
// to emit merge proposals. Unlike the strict-equality pass that used to
// live here, this catches "write intro" + "draft introduction" + "intro
// paragraph" as one cluster.
export async function findDuplicateClusters(userId: string) {
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
    )
    .orderBy(asc(schema.tasks.createdAt));

  const used = new Set<string>();
  const clusters: Array<{
    canonical: (typeof rows)[number];
    duplicates: Array<{ row: (typeof rows)[number]; score: number }>;
  }> = [];
  for (let i = 0; i < rows.length; i++) {
    if (used.has(rows[i].id)) continue;
    const canonical = rows[i];
    const dups: Array<{ row: (typeof rows)[number]; score: number }> = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(rows[j].id)) continue;
      const score = titleSimilarity(canonical.title, rows[j].title);
      if (score >= DUP_THRESHOLD) {
        dups.push({ row: rows[j], score });
        used.add(rows[j].id);
      }
    }
    if (dups.length > 0) {
      used.add(canonical.id);
      clusters.push({ canonical, duplicates: dups });
    }
  }
  return clusters;
}

// Flattened pair list from findDuplicateClusters. Kept for backward
// compat with the gardener notification path.
export async function findDuplicatePairs(userId: string) {
  const clusters = await findDuplicateClusters(userId);
  const pairs: Array<{
    canonical: (typeof clusters)[number]["canonical"];
    duplicate: (typeof clusters)[number]["duplicates"][number]["row"];
    score: number;
  }> = [];
  for (const c of clusters) {
    for (const d of c.duplicates) {
      pairs.push({ canonical: c.canonical, duplicate: d.row, score: d.score });
    }
  }
  return pairs;
}

// Helper for the gardener: rows that look abandoned-in-place. A "captured"
// (inbox, untriaged) row older than 48h, or an active (today/doing) row
// with no lastActivity touch for 14 days.
export async function findStaleCandidates(userId: string, now: Date = new Date()) {
  const h48 = 48 * 3600 * 1000;
  const d14 = 14 * 86400 * 1000;
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        inArray(schema.tasks.status, ["inbox", "today", "doing"]),
      ),
    );
  const candidates: Array<{
    id: string;
    title: string;
    status: string;
    reason: "captured_aged_out" | "idle_14d";
  }> = [];
  for (const r of rows) {
    const activity = +(r.lastActivityAt ?? r.updatedAt ?? r.createdAt);
    if (r.status === "inbox" && !r.triagedAt && +now - +r.createdAt >= h48) {
      candidates.push({
        id: r.id,
        title: r.title,
        status: r.status,
        reason: "captured_aged_out",
      });
    } else if (+now - activity >= d14) {
      candidates.push({ id: r.id, title: r.title, status: r.status, reason: "idle_14d" });
    }
  }
  return candidates;
}

// Helper for the gardener: snoozed rows whose wake time has arrived.
export async function findWakeableSnoozes(userId: string, now: Date = new Date()) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, "snoozed"),
        lte(schema.tasks.snoozeUntil, now),
      ),
    );
  return rows.map(hydrate);
}

// Helper for the gardener: blocked rows whose unblock-by time has arrived.
export async function findExpiredBlocks(userId: string, now: Date = new Date()) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.status, "blocked"),
        lte(schema.tasks.blockedUntil, now),
      ),
    );
  return rows.map(hydrate);
}

// Hook for the commitments loop: any task activity (commitment done/note
// etc.) should refresh lastActivityAt so the gardener doesn't stale it.
export async function touchTaskActivity(userId: string, id: string) {
  await db
    .update(schema.tasks)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id)));
}

// Recent task titles for proposer context — includes open + recently done
// + recently abandoned so the LLM sees "we tried this, dropped it" and
// doesn't re-propose.
export async function recentTaskTitles(userId: string, since: Date, limit = 50) {
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.userId, userId), gte(schema.tasks.updatedAt, since)),
    )
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    normalized: normalizeTitle(r.title),
  }));
}
