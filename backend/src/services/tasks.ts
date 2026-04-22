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
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w))
    .sort() // order-independent match: "email sarah" == "sarah email"
    .join(" ")
    .trim();
}

// Returns the canonical duplicate if there's a confident match among the
// user's non-terminal rows, else null. Ignores done/abandoned/merged rows
// since those are closed — the user may legitimately want to do "email
// Sarah" again a month later.
export async function findSemanticDuplicate(
  userId: string,
  title: string,
  opts: { ignoreId?: string } = {},
): Promise<{ id: string; title: string; status: string } | null> {
  const key = normalizeTitle(title);
  if (!key) return null;
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
  for (const r of rows) {
    if (opts.ignoreId && r.id === opts.ignoreId) continue;
    if (normalizeTitle(r.title) === key) {
      return { id: r.id, title: r.title, status: r.status };
    }
  }
  return null;
}

// Pairs of likely duplicates across the current playable/held set. Returns
// the younger row as the "candidate to merge into older." Used by the
// gardener to propose merges.
export async function findDuplicatePairs(userId: string) {
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
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = normalizeTitle(r.title);
    if (!k) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  const pairs: Array<{ canonical: (typeof rows)[number]; duplicate: (typeof rows)[number] }> = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    // First row (oldest by createdAt order) is canonical; every subsequent
    // row is a duplicate candidate.
    const [canonical, ...dups] = arr;
    for (const dup of dups) pairs.push({ canonical, duplicate: dup });
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
