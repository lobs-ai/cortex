import { nanoid } from "nanoid";
import { db, rawDb, schema } from "./client.js";

// Reuse push so seed is self-contained
await import("./push.js");

const now = new Date();
const today = new Date(now);
today.setHours(0, 0, 0, 0);

const d = (dayOffset: number, h = 0, m = 0) => {
  const t = new Date(today);
  t.setDate(t.getDate() + dayOffset);
  t.setHours(h, m, 0, 0);
  return t;
};

// Clean slate
rawDb.exec(`
  DELETE FROM users;
  DELETE FROM integrations;
  DELETE FROM projects;
  DELETE FROM events;
  DELETE FROM tasks;
  DELETE FROM reminders;
  DELETE FROM notifications;
  DELETE FROM preferences_explicit;
  DELETE FROM tendencies_learned;
  DELETE FROM memory_items;
  DELETE FROM plans;
  DELETE FROM assistant_runs;
  DELETE FROM assistant_messages;
  DELETE FROM scheduled_blocks;
`);

const USER_ID = "u_demo";

await db.insert(schema.users).values({
  id: USER_ID,
  email: "rafe@example.com",
  name: "Rafe S.",
  timezone: "America/Detroit",
  createdAt: now,
  updatedAt: now,
});

const PROJECTS = [
  { id: "p1", name: "Thesis: Hybrid Memory Retrieval", color: "amber", status: "active", health: 82, tasksOpen: 7, tasksDone: 34, lastActivity: d(0, 9, 12) },
  { id: "p2", name: "EECS 598 — Final Project",      color: "blue",  status: "active", health: 64, tasksOpen: 4, tasksDone: 11, lastActivity: d(-1, 16, 30) },
  { id: "p3", name: "NeurIPS Rebuttal",               color: "red",   status: "active", health: 41, tasksOpen: 5, tasksDone: 2,  lastActivity: d(-2, 22, 10) },
  { id: "p4", name: "EECS 484 Grading (GSI)",         color: "gray",  status: "active", health: 90, tasksOpen: 2, tasksDone: 48, lastActivity: d(-1, 11, 0) },
  { id: "p5", name: "Advisor Reading Group",          color: "green", status: "active", health: 70, tasksOpen: 1, tasksDone: 9,  lastActivity: d(-3, 14, 0) },
  { id: "p6", name: "Side: replay-debugger",          color: "violet",status: "paused", health: 30, tasksOpen: 3, tasksDone: 6,  lastActivity: d(-8, 23, 0) },
];

for (const p of PROJECTS) {
  await db.insert(schema.projects).values({
    id: p.id,
    userId: USER_ID,
    name: p.name,
    color: p.color,
    status: p.status,
    health: p.health,
    tasksOpen: p.tasksOpen,
    tasksDone: p.tasksDone,
    lastActivity: p.lastActivity,
    createdAt: now,
    updatedAt: now,
  });
}

const EVENTS = [
  { id: "e1", title: "Advisor 1:1 — Prof. Chen",  project: "p1", start: d(0, 10, 0),  end: d(0, 10, 45), kind: "meeting",  location: "BBB 4816", attendees: 2, important: true },
  { id: "e2", title: "EECS 598 Lecture",           project: "p2", start: d(0, 13, 0),  end: d(0, 14, 30), kind: "class",    location: "DOW 1017", attendees: 40 },
  { id: "e3", title: "Reading Group — RAG survey", project: "p5", start: d(0, 15, 30), end: d(0, 16, 30), kind: "meeting",  location: "Zoom",      attendees: 8 },
  { id: "e4", title: "Office Hours (EECS 484)",    project: "p4", start: d(0, 17, 0),  end: d(0, 18, 30), kind: "teach",    location: "BBB 1690", attendees: 6 },
  { id: "e5", title: "EECS 598 Lecture",           project: "p2", start: d(1, 13, 0),  end: d(1, 14, 30), kind: "class" },
  { id: "e6", title: "Lab meeting",                project: "p1", start: d(1, 11, 0),  end: d(1, 12, 0),  kind: "meeting",  important: true },
  { id: "e7", title: "Gym",                        project: null, start: d(1, 7, 30),  end: d(1, 8, 30),  kind: "personal" },
  { id: "e8", title: "NeurIPS rebuttal DUE",       project: "p3", start: d(2, 23, 59), end: d(2, 23, 59), kind: "deadline", important: true },
  { id: "e9", title: "EECS 598 Lecture",           project: "p2", start: d(3, 13, 0),  end: d(3, 14, 30), kind: "class" },
  { id: "e10",title: "Committee check-in",         project: "p1", start: d(4, 14, 0),  end: d(4, 15, 0),  kind: "meeting",  important: true },
  { id: "e11",title: "Seminar: Interpretability",  project: null, start: d(4, 16, 0),  end: d(4, 17, 0),  kind: "meeting" },
];

for (const e of EVENTS) {
  await db.insert(schema.events).values({
    id: e.id,
    userId: USER_ID,
    title: e.title,
    projectId: e.project,
    startTime: e.start,
    endTime: e.end,
    kind: e.kind,
    location: e.location,
    attendeesJson: e.attendees ? JSON.stringify({ count: e.attendees }) : null,
    important: !!e.important,
    createdAt: now,
    updatedAt: now,
  });
}

const TASKS = [
  { id: "t1",  title: "Write NeurIPS rebuttal section 3 (results)", project: "p3", due: d(2, 23, 59), priority: "P0", status: "doing",  estMin: 180, energy: "high", tags: ["writing"] },
  { id: "t2",  title: "Re-run ablation on mem-index-v4",            project: "p1", due: d(1, 18, 0),  priority: "P1", status: "today",  estMin: 90,  energy: "med",  tags: ["exp"] },
  { id: "t3",  title: "Prep slides for advisor 1:1",                project: "p1", due: d(0, 9, 45),  priority: "P0", status: "today",  estMin: 30,  energy: "low",  tags: ["meeting"] },
  { id: "t4",  title: "Grade project 3 submissions (batch 2)",      project: "p4", due: d(1, 23, 59), priority: "P2", status: "today",  estMin: 120, energy: "low",  tags: ["grading"] },
  { id: "t5",  title: "Review Alex's PR on retrieval branch",       project: "p1", due: d(0, 17, 0),  priority: "P1", status: "today",  estMin: 45,  energy: "med",  tags: ["review"] },
  { id: "t6",  title: 'Read: "Retrieval-Augmented Generation v2"',  project: "p5", due: d(0, 15, 0),  priority: "P2", status: "today",  estMin: 60,  energy: "med",  tags: ["reading"] },
  { id: "t7",  title: "Book flights for CVPR",                     project: null, due: d(7, 17, 0),  priority: "P2", status: "inbox",  estMin: 30,  energy: "low",  tags: ["admin"] },
  { id: "t8",  title: "Draft 598 project proposal",                project: "p2", due: d(5, 23, 59), priority: "P1", status: "inbox",  estMin: 150, energy: "high", tags: ["writing"] },
  { id: "t9",  title: "Renew GSRA paperwork",                      project: null, due: d(3, 17, 0),  priority: "P2", status: "inbox",  estMin: 20,  energy: "low",  tags: ["admin"] },
  { id: "t10", title: "Fix eval leak in trainer.py",               project: "p1", due: d(2, 12, 0),  priority: "P1", status: "inbox",  estMin: 60,  energy: "high", tags: ["code"] },
  { id: "t11", title: "Reply to reviewer #3 email",                project: "p3", due: d(1, 9, 0),   priority: "P1", status: "inbox",  estMin: 20,  energy: "low",  tags: ["writing"] },
  { id: "t12", title: "Submit rebuttal outline",                   project: "p3", due: d(-1, 17, 0), priority: "P0", status: "done",   estMin: 60,  energy: "high", tags: ["writing"], completedAt: d(-1, 16, 42) },
  { id: "t13", title: "Index refactor PR",                         project: "p1", due: d(-1, 17, 0), priority: "P1", status: "done",   estMin: 120, energy: "med",  tags: ["code"],    completedAt: d(-1, 14, 10) },
  { id: "t14", title: "Send availability to committee",            project: "p1", due: d(-2, 17, 0), priority: "P2", status: "done",   estMin: 10,  energy: "low",  tags: ["admin"],   completedAt: d(-2, 9, 30) },
];

for (const t of TASKS) {
  await db.insert(schema.tasks).values({
    id: t.id,
    userId: USER_ID,
    title: t.title,
    projectId: t.project,
    dueDate: t.due,
    priority: t.priority,
    status: t.status,
    estimatedMinutes: t.estMin,
    energyLevel: t.energy,
    tagsJson: JSON.stringify(t.tags),
    completedAt: (t as any).completedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

const ALERTS = [
  { id: "a1", severity: "high", kind: "deadline_risk", title: "NeurIPS rebuttal due in 48h",            body: "You've scheduled 3h of work. Your last 5 writing tasks ran 35% over estimate — suggesting you block 4h today + 2h tomorrow.", actions: ["Reserve 4h today", "Show plan", "Dismiss"], createdAt: d(0, 8, 12), related: "t1", relatedType: "task" },
  { id: "a2", severity: "med",  kind: "prep",          title: "Advisor 1:1 in 1h 14m — no prep block",  body: "You usually prep for 30m. I can reserve 9:15–9:45 and pull your notes from last week.",                                    actions: ["Reserve prep", "Skip this time"],          createdAt: d(0, 8, 46), related: "e1", relatedType: "event" },
  { id: "a3", severity: "low",  kind: "neglected",     title: "replay-debugger untouched for 8 days",   body: "Last active Apr 11. Want to archive or schedule a 90m block this weekend?",                                                 actions: ["Archive", "Schedule block", "Dismiss"],   createdAt: d(0, 7, 30), related: "p6", relatedType: "project" },
  { id: "a4", severity: "low",  kind: "pattern",       title: "Noticed: you do best at 10–12:30",       body: "Over the past 3 weeks, you've completed 68% of deep-work tasks in this window. I'm biasing future plans toward it.",        actions: ["Got it", "Adjust"],                       createdAt: d(-1, 22, 0), related: null, relatedType: null },
];

for (const a of ALERTS) {
  await db.insert(schema.notifications).values({
    id: a.id,
    userId: USER_ID,
    category: "proactive",
    severity: a.severity,
    kind: a.kind,
    title: a.title,
    body: a.body,
    actionsJson: JSON.stringify(a.actions),
    deliveryChannel: "web",
    relatedObjectType: a.relatedType,
    relatedObjectId: a.related,
    createdAt: a.createdAt,
  });
}

const TENDENCIES = [
  { id: "td1", text: "Prefers deep work 10:00–12:30",                 evidence: 14, confidence: 0.88, lastSeen: d(0, 12, 0),  status: "active" },
  { id: "td2", text: "Underestimates writing tasks by ~35%",          evidence: 9,  confidence: 0.79, lastSeen: d(-1, 18, 0), status: "active" },
  { id: "td3", text: "Skips low-priority admin on Fridays",           evidence: 6,  confidence: 0.71, lastSeen: d(-4, 17, 0), status: "active" },
  { id: "td4", text: "Works best with 90-min blocks (not 60)",        evidence: 11, confidence: 0.83, lastSeen: d(-1, 11, 0), status: "active" },
  { id: "td5", text: "Reschedules Wed afternoons onto Thu mornings",  evidence: 4,  confidence: 0.62, lastSeen: d(-6, 13, 0), status: "watching" },
  { id: "td6", text: "Ignores reminders after 22:00",                 evidence: 8,  confidence: 0.91, lastSeen: d(-1, 23, 10), status: "active" },
];

for (const t of TENDENCIES) {
  await db.insert(schema.tendenciesLearned).values({
    id: t.id,
    userId: USER_ID,
    tendencyType: "behavior",
    text: t.text,
    evidenceCount: t.evidence,
    confidence: t.confidence,
    status: t.status,
    lastObservedAt: t.lastSeen,
    createdAt: now,
    updatedAt: now,
  });
}

const PREFERENCES = [
  { id: "pr1", key: "Work hours",         value: "09:00 – 19:00 (Mon–Fri), 12:00 – 17:00 (Sat)" },
  { id: "pr2", key: "Focus block length", value: "90 min (learned, adjustable)" },
  { id: "pr3", key: "Quiet hours",        value: "22:00 – 08:00 (no Discord pings)" },
  { id: "pr4", key: "Daily plan time",    value: "08:00 — delivered via Discord DM" },
  { id: "pr5", key: "Weekly review",      value: "Sunday 18:00" },
  { id: "pr6", key: "Timezone",           value: "America/Detroit" },
];

for (const p of PREFERENCES) {
  await db.insert(schema.preferencesExplicit).values({
    id: p.id,
    userId: USER_ID,
    key: p.key,
    valueJson: JSON.stringify(p.value),
    source: "user",
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  });
}

const INTEGRATIONS = [
  { id: "in1", name: "Google Calendar", status: "connected", detail: "2 calendars · last sync 3 min ago", provider: "google_calendar" },
  { id: "in2", name: "Discord",         status: "connected", detail: "DM to @rafe · 4 channels",            provider: "discord" },
  { id: "in3", name: "GitHub",          status: "connected", detail: "activity signals · read-only",        provider: "github" },
  { id: "in4", name: "Slack (lab)",     status: "available", detail: "not connected",                        provider: "slack" },
];

for (const i of INTEGRATIONS) {
  await db.insert(schema.integrations).values({
    id: i.id,
    userId: USER_ID,
    provider: i.provider,
    status: i.status,
    detail: i.detail,
    lastSyncedAt: i.status === "connected" ? d(0, now.getHours(), now.getMinutes() - 3) : null,
  });
}

// Seed today's generated plan (what the dashboard "Proposed plan" panel shows)
await db.insert(schema.plans).values({
  id: "plan-today",
  userId: USER_ID,
  planType: "daily",
  periodStart: d(0, 0, 0),
  periodEnd: d(0, 23, 59),
  contentJson: JSON.stringify({
    generatedAt: d(0, 6, 48).toISOString(),
    summary: "Today is meeting-heavy, so prioritize one deep-work task.",
    blocks: [
      { start: "09:15", end: "09:45", label: "Prep for advisor 1:1",     sub: "pulled last week's notes", kind: "block" },
      { start: "10:00", end: "10:45", label: "Advisor 1:1 — Prof. Chen", sub: "BBB 4816",                 kind: "meeting" },
      { start: "11:00", end: "12:30", label: "Rebuttal §3 — deep work",  sub: "your best focus window",   kind: "block", hero: true },
      { start: "12:30", end: "13:00", label: "Lunch",                    sub: "",                         kind: "personal" },
      { start: "13:00", end: "14:30", label: "EECS 598 lecture",         sub: "DOW 1017",                 kind: "class" },
      { start: "14:45", end: "15:15", label: "Process Alex's PR",        sub: "code review",              kind: "block" },
      { start: "15:30", end: "16:30", label: "Reading group — RAG",      sub: "Zoom",                     kind: "meeting" },
      { start: "17:00", end: "18:30", label: "Office hours (EECS 484)",  sub: "BBB 1690",                 kind: "teach" },
    ],
  }),
  generatedBy: "planner-stub",
  createdAt: d(0, 6, 48),
});

console.log("seeded: 1 user · 6 projects · 11 events · 14 tasks · 4 alerts · 6 tendencies · 6 prefs · 4 integrations · 1 plan");
rawDb.close();
