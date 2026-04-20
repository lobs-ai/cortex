import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { createNotification, listActiveNotifications } from "../services/notifications.js";

type Proposal = {
  severity: "high" | "med" | "low";
  kind: string;
  title: string;
  body: string;
  actions?: string[];
  relatedType?: string | null;
  relatedId?: string | null;
};

// Deterministic rule-first monitor per design §12.4. LLM upgrade goes here later.
export async function runMonitor(userId: string): Promise<Proposal[]> {
  const now = new Date();
  const [tasks, events, existing] = await Promise.all([
    listTasks(userId),
    listEvents(userId, { from: now, to: addHours(now, 48) }),
    listActiveNotifications(userId),
  ]);

  const open = tasks.filter((t) => t.status !== "done");
  const proposals: Proposal[] = [];

  // deadline_risk — any task due within 24h with P0/P1
  for (const t of open) {
    if (!t.due) continue;
    const hoursLeft = (+t.due - +now) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft < 48 && (t.priority === "P0" || t.priority === "P1")) {
      proposals.push({
        severity: t.priority === "P0" ? "high" : "med",
        kind: "deadline_risk",
        title: `${t.title} due in ${Math.round(hoursLeft)}h`,
        body: `Priority ${t.priority}. Estimated ${t.estMin ?? "?"}m of work remaining.`,
        actions: ["Schedule block", "Show plan", "Dismiss"],
        relatedType: "task",
        relatedId: t.id,
      });
    }
  }

  // prep — important meeting within 2h with no prep block
  for (const e of events) {
    if (!e.important) continue;
    const hoursUntil = (+e.start - +now) / 3_600_000;
    if (hoursUntil > 0 && hoursUntil < 2) {
      proposals.push({
        severity: "med",
        kind: "prep",
        title: `${e.title} in ${Math.round(hoursUntil * 60)}m — no prep block`,
        body: "You usually prep for 30m. Want me to reserve time?",
        actions: ["Reserve prep", "Skip this time"],
        relatedType: "event",
        relatedId: e.id,
      });
    }
  }

  // overdue backlog
  const overdue = open.filter((t) => t.due && +t.due < +now);
  if (overdue.length >= 3) {
    proposals.push({
      severity: "med",
      kind: "backlog",
      title: `${overdue.length} overdue tasks`,
      body: `Oldest: "${overdue[0].title}". Want to triage them now?`,
      actions: ["Triage", "Snooze"],
      relatedType: null,
      relatedId: null,
    });
  }

  // dedup against existing active notifications (same kind + relatedId)
  const seen = new Set(existing.map((n) => `${n.kind}:${n.relatedId ?? ""}`));
  const fresh = proposals.filter((p) => !seen.has(`${p.kind}:${p.relatedId ?? ""}`));

  for (const p of fresh) {
    await createNotification(userId, p);
  }

  return fresh;
}

function addHours(d: Date, h: number) {
  return new Date(+d + h * 3_600_000);
}
