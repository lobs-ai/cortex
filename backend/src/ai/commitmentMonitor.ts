import { createNotification, clearRequiresAck } from "../services/notifications.js";
import {
  listLiveCommitments,
  markMissed,
  markPrompted,
  logEvent,
  type CommitmentRow,
} from "../services/commitments.js";
import { pushNotification } from "../services/push.js";
import { db, schema } from "../db/client.js";
import { and, eq } from "drizzle-orm";

// How long we wait after the ping before calling a commitment "missed."
// First ping at startTime → second ping at +5min → missed at +12min.
// A user who ignored ten minutes of buzzing is not about to start.
const ACK_GRACE_MS = 12 * 60 * 1000;
const ESCALATE_AT_MS = 5 * 60 * 1000;
// After a commitment's duration window ends without a done/skip, we assume
// it lapsed. Short linger so an honest "done" a couple minutes late still
// records cleanly.
const WRAP_GRACE_MS = 3 * 60 * 1000;

export type CommitmentTickResult = {
  prompted: number;
  escalated: number;
  missed: number;
  verifyAsked: number;
};

export async function runCommitmentMonitor(userId: string): Promise<CommitmentTickResult> {
  const now = new Date();
  const live = await listLiveCommitments(userId);
  let prompted = 0;
  let escalated = 0;
  let missed = 0;
  let verifyAsked = 0;

  for (const c of live) {
    const startMs = +c.startTime;
    const endMs = startMs + c.durationMin * 60 * 1000;
    const nowMs = +now;

    if (c.state === "pending" && nowMs >= startMs) {
      await sendPromptNotification(userId, c, 0);
      prompted++;
      continue;
    }

    if (c.state === "prompted" && c.promptedAt) {
      const sincePrompt = nowMs - +c.promptedAt;
      if (sincePrompt >= ACK_GRACE_MS) {
        // Final escalation exhausted — treat as missed and clear the nag.
        await sendMissedNotification(userId, c);
        await markMissed(userId, c.id);
        missed++;
      } else if (sincePrompt >= ESCALATE_AT_MS && c.escalationLevel < 1) {
        await sendPromptNotification(userId, c, 1);
        escalated++;
      }
      continue;
    }

    if (c.state === "doing") {
      if (nowMs >= endMs + WRAP_GRACE_MS) {
        // Window closed without a done/skip — offer one last verification,
        // then fall through to missed if still silent on the next tick.
        const alreadyAsked = await hasOpenVerifyNotification(userId, c.id);
        if (!alreadyAsked) {
          await sendVerifyNotification(userId, c);
          verifyAsked++;
        } else {
          const firstAsk = await verifyNotificationAge(userId, c.id);
          if (firstAsk !== null && nowMs - firstAsk >= ACK_GRACE_MS) {
            await markMissed(userId, c.id);
            missed++;
          }
        }
      }
    }
  }

  return { prompted, escalated, missed, verifyAsked };
}

async function sendPromptNotification(
  userId: string,
  c: CommitmentRow,
  level: number,
): Promise<void> {
  const loud = level >= 1;
  const title = loud
    ? `Still there? ${c.title}`
    : `Start now: ${c.title}`;
  const endLocal = new Date(+c.startTime + c.durationMin * 60_000);
  const bodyLines = [
    `${c.durationMin}m — until ${hm(endLocal)}.`,
  ];
  if (c.verifyCriterion) bodyLines.push(`Done means: ${c.verifyCriterion}`);
  if (loud) bodyLines.unshift("You didn't respond to the first ping.");

  // Clear any earlier prompt ack-lock so this latest ping is the one the
  // user answers.
  if (c.notificationId) {
    try {
      await clearRequiresAck(userId, c.notificationId);
    } catch {
      // row may have been deleted — not fatal
    }
  }

  const nid = await createNotification(userId, {
    severity: loud ? "high" : "med",
    kind: "commitment.prompt",
    title,
    body: bodyLines.join(" "),
    actions: [
      { label: "Doing it", op: "commit.ack" },
      { label: "Done", op: "commit.done" },
      { label: "Skip", op: "commit.skip" },
    ],
    requiresAck: true,
    relatedObjectType: "commitment",
    relatedObjectId: c.id,
  });
  await markPrompted(userId, c.id, nid, level);
  // Fan out to any configured push channels. Failure is logged, not fatal —
  // the in-app card is the canonical delivery.
  await pushNotification(userId, {
    severity: loud ? "high" : "med",
    kind: "commitment.prompt",
    title,
    body: bodyLines.join(" "),
    actionsHint: "Open Cortex to mark Doing / Done / Skip",
    requiresAck: true,
    notificationId: nid,
    commitmentId: c.id,
  }).catch((err) => console.warn("push dispatch failed:", err));
}

async function sendVerifyNotification(userId: string, c: CommitmentRow): Promise<void> {
  await createNotification(userId, {
    severity: "med",
    kind: "commitment.verify",
    title: `Window closed: ${c.title}`,
    body: c.verifyCriterion
      ? `Did you finish? "${c.verifyCriterion}"`
      : "Did you finish? Mark done with a one-line artifact, or skip with a reason.",
    actions: [
      { label: "Done", op: "commit.done" },
      { label: "Skip", op: "commit.skip" },
    ],
    requiresAck: true,
    relatedObjectType: "commitment",
    relatedObjectId: c.id,
  });
  await logEvent(userId, c.id, "verify_asked");
}

async function sendMissedNotification(userId: string, c: CommitmentRow): Promise<void> {
  // Clear the old nag so the dashboard doesn't show a stale "requires ack"
  // row for a commitment that's now closed.
  if (c.notificationId) {
    try {
      await clearRequiresAck(userId, c.notificationId);
    } catch {
      // row may have been deleted — not fatal
    }
  }
  await createNotification(userId, {
    severity: "med",
    kind: "commitment.missed",
    title: `Missed: ${c.title}`,
    body: "Didn't hear back. Recorded as missed — you'll see this in the evening review.",
    actions: [{ label: "Dismiss", op: "dismiss" }],
    relatedObjectType: "commitment",
    relatedObjectId: c.id,
  });
}

async function hasOpenVerifyNotification(userId: string, commitmentId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.kind, "commitment.verify"),
        eq(schema.notifications.relatedObjectId, commitmentId),
      ),
    );
  return rows.length > 0;
}

async function verifyNotificationAge(userId: string, commitmentId: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.kind, "commitment.verify"),
        eq(schema.notifications.relatedObjectId, commitmentId),
      ),
    );
  if (rows.length === 0) return null;
  return +rows[0].createdAt;
}

function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
