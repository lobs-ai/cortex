import { listEvents } from "../services/events.js";
import { listTasks } from "../services/tasks.js";
import { createNotification, listActiveNotifications } from "../services/notifications.js";
import { getLatestPlan } from "../services/plans.js";
import type { PlanBlock } from "./planner.js";

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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const [tasks, events, existing, plan, todaysEvents] = await Promise.all([
    listTasks(userId),
    listEvents(userId, { from: now, to: addHours(now, 48) }),
    listActiveNotifications(userId),
    getLatestPlan(userId, "daily"),
    listEvents(userId, { from: todayStart, to: todayEnd }),
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

  // plan-aware: block_conflict — a today event overlaps a plan block that isn't that event
  if (plan && Array.isArray(plan.content?.blocks)) {
    const blocks = plan.content.blocks as PlanBlock[];
    for (const ev of todaysEvents) {
      if (+ev.end <= +now) continue; // already past
      const evStart = minutesInto(todayStart, ev.start);
      const evEnd = minutesInto(todayStart, ev.end);
      for (const b of blocks) {
        // Only flag "planned work" blocks, not the meeting echoes of real events.
        if (b.kind !== "block") continue;
        const bStart = hmToMinutes(b.start);
        const bEnd = hmToMinutes(b.end);
        if (bEnd <= bStart) continue;
        if (overlaps(evStart, evEnd, bStart, bEnd)) {
          proposals.push({
            severity: b.hero ? "high" : "med",
            kind: "block_conflict",
            title: `"${ev.title}" conflicts with ${b.hero ? "your focus block" : b.label}`,
            body: `${b.start}–${b.end} was reserved for ${b.label}. ${ev.title} now overlaps.`,
            actions: ["Reschedule block", "Regenerate plan"],
            relatedType: "event",
            relatedId: ev.id,
          });
          break;
        }
      }
    }

    // plan-aware: hero_shrunk — hero block ends before now or has <25m remaining usable
    const hero = blocks.find((b) => b.hero);
    if (hero) {
      const heroStart = hmToMinutes(hero.start);
      const heroEnd = hmToMinutes(hero.end);
      const nowMin = minutesInto(todayStart, now);
      let usable = Math.max(0, heroEnd - Math.max(heroStart, nowMin));
      for (const ev of todaysEvents) {
        const evStart = Math.max(heroStart, minutesInto(todayStart, ev.start));
        const evEnd = Math.min(heroEnd, minutesInto(todayStart, ev.end));
        if (evEnd > evStart && evStart < heroEnd && evEnd > Math.max(heroStart, nowMin)) {
          usable -= Math.min(evEnd, heroEnd) - Math.max(evStart, Math.max(heroStart, nowMin));
        }
      }
      const planned = Math.max(1, heroEnd - heroStart);
      if (usable > 0 && usable < 25 && planned >= 45) {
        proposals.push({
          severity: "med",
          kind: "hero_shrunk",
          title: `Focus window down to ${Math.max(0, Math.round(usable))}m`,
          body: `Planned ${planned}m for "${hero.label}". Want Cortex to find a fresh block?`,
          actions: ["Regenerate plan"],
          relatedType: null,
          relatedId: null,
        });
      }
    }
  }

  // dedup against existing active notifications (same kind + relatedId)
  const seen = new Set(existing.map((n) => `${n.kind}:${n.relatedId ?? ""}`));
  const fresh = proposals.filter((p) => !seen.has(`${p.kind}:${p.relatedId ?? ""}`));

  for (const p of fresh) {
    await createNotification(userId, {
      severity: p.severity,
      kind: p.kind,
      title: p.title,
      body: p.body,
      actions: p.actions,
      relatedObjectType: p.relatedType,
      relatedObjectId: p.relatedId,
    });
  }

  return fresh;
}

function addHours(d: Date, h: number) {
  return new Date(+d + h * 3_600_000);
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function minutesInto(dayStart: Date, d: Date): number {
  return Math.round((+d - +dayStart) / 60000);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
