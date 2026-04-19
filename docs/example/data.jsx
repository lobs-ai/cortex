// Sample data — CSE grad student (Year 3, ML / systems research)

const today = new Date();
today.setHours(0, 0, 0, 0);
const d = (dayOffset, h = 0, m = 0) => {
  const t = new Date(today);
  t.setDate(t.getDate() + dayOffset);
  t.setHours(h, m, 0, 0);
  return t;
};

const PROJECTS = [
  { id: "p1", name: "Thesis: Hybrid Memory Retrieval", color: "amber", status: "active", health: 82, tasksOpen: 7, tasksDone: 34, lastActivity: d(0, 9, 12) },
  { id: "p2", name: "EECS 598 — Final Project", color: "blue",  status: "active", health: 64, tasksOpen: 4, tasksDone: 11, lastActivity: d(-1, 16, 30) },
  { id: "p3", name: "NeurIPS Rebuttal",             color: "red",   status: "active", health: 41, tasksOpen: 5, tasksDone: 2,  lastActivity: d(-2, 22, 10) },
  { id: "p4", name: "EECS 484 Grading (GSI)",       color: "gray",  status: "active", health: 90, tasksOpen: 2, tasksDone: 48, lastActivity: d(-1, 11, 0) },
  { id: "p5", name: "Advisor Reading Group",        color: "green", status: "active", health: 70, tasksOpen: 1, tasksDone: 9,  lastActivity: d(-3, 14, 0) },
  { id: "p6", name: "Side: replay-debugger",        color: "violet",status: "paused", health: 30, tasksOpen: 3, tasksDone: 6,  lastActivity: d(-8, 23, 0) },
];

const EVENTS = [
  { id: "e1", title: "Advisor 1:1 — Prof. Chen",       project: "p1", start: d(0, 10, 0),  end: d(0, 10, 45), kind: "meeting", location: "BBB 4816", attendees: 2, important: true },
  { id: "e2", title: "EECS 598 Lecture",                project: "p2", start: d(0, 13, 0),  end: d(0, 14, 30), kind: "class",   location: "DOW 1017", attendees: 40 },
  { id: "e3", title: "Reading Group — RAG survey",      project: "p5", start: d(0, 15, 30), end: d(0, 16, 30), kind: "meeting", location: "Zoom",      attendees: 8 },
  { id: "e4", title: "Office Hours (EECS 484)",         project: "p4", start: d(0, 17, 0),  end: d(0, 18, 30), kind: "teach",   location: "BBB 1690", attendees: 6 },

  { id: "e5", title: "EECS 598 Lecture",                project: "p2", start: d(1, 13, 0),  end: d(1, 14, 30), kind: "class" },
  { id: "e6", title: "Lab meeting",                     project: "p1", start: d(1, 11, 0),  end: d(1, 12, 0),  kind: "meeting", important: true },
  { id: "e7", title: "Gym",                             project: null, start: d(1, 7, 30),  end: d(1, 8, 30),  kind: "personal" },

  { id: "e8", title: "NeurIPS rebuttal DUE",            project: "p3", start: d(2, 23, 59), end: d(2, 23, 59), kind: "deadline", important: true },
  { id: "e9", title: "EECS 598 Lecture",                project: "p2", start: d(3, 13, 0),  end: d(3, 14, 30), kind: "class" },
  { id: "e10", title: "Committee check-in",             project: "p1", start: d(4, 14, 0),  end: d(4, 15, 0),  kind: "meeting", important: true },
  { id: "e11", title: "Seminar: Interpretability",      project: null, start: d(4, 16, 0),  end: d(4, 17, 0),  kind: "meeting" },
];

const TASKS = [
  // today
  { id: "t1",  title: "Write NeurIPS rebuttal section 3 (results)", project: "p3", due: d(2, 23, 59), priority: "P0", status: "doing",  estMin: 180, energy: "high", tags: ["writing"] },
  { id: "t2",  title: "Re-run ablation on mem-index-v4",            project: "p1", due: d(1, 18, 0),  priority: "P1", status: "today",  estMin: 90,  energy: "med",  tags: ["exp"] },
  { id: "t3",  title: "Prep slides for advisor 1:1",                project: "p1", due: d(0, 9, 45),  priority: "P0", status: "today",  estMin: 30,  energy: "low",  tags: ["meeting"] },
  { id: "t4",  title: "Grade project 3 submissions (batch 2)",      project: "p4", due: d(1, 23, 59), priority: "P2", status: "today",  estMin: 120, energy: "low",  tags: ["grading"] },
  { id: "t5",  title: "Review Alex's PR on retrieval branch",       project: "p1", due: d(0, 17, 0),  priority: "P1", status: "today",  estMin: 45,  energy: "med",  tags: ["review"] },

  // inbox / upcoming
  { id: "t6",  title: "Read: \"Retrieval-Augmented Generation v2\"", project: "p5", due: d(0, 15, 0),  priority: "P2", status: "today",  estMin: 60,  energy: "med",  tags: ["reading"] },
  { id: "t7",  title: "Book flights for CVPR",                     project: null, due: d(7, 17, 0),  priority: "P2", status: "inbox",  estMin: 30,  energy: "low",  tags: ["admin"] },
  { id: "t8",  title: "Draft 598 project proposal",                project: "p2", due: d(5, 23, 59), priority: "P1", status: "inbox",  estMin: 150, energy: "high", tags: ["writing"] },
  { id: "t9",  title: "Renew GSRA paperwork",                      project: null, due: d(3, 17, 0),  priority: "P2", status: "inbox",  estMin: 20,  energy: "low",  tags: ["admin"] },
  { id: "t10", title: "Fix eval leak in trainer.py",               project: "p1", due: d(2, 12, 0),  priority: "P1", status: "inbox",  estMin: 60,  energy: "high", tags: ["code"] },
  { id: "t11", title: "Reply to reviewer #3 email",                project: "p3", due: d(1, 9, 0),   priority: "P1", status: "inbox",  estMin: 20,  energy: "low",  tags: ["writing"] },

  // done
  { id: "t12", title: "Submit rebuttal outline",                   project: "p3", due: d(-1, 17, 0), priority: "P0", status: "done",   estMin: 60,  energy: "high", tags: ["writing"], completedAt: d(-1, 16, 42) },
  { id: "t13", title: "Index refactor PR",                         project: "p1", due: d(-1, 17, 0), priority: "P1", status: "done",   estMin: 120, energy: "med",  tags: ["code"],    completedAt: d(-1, 14, 10) },
  { id: "t14", title: "Send availability to committee",            project: "p1", due: d(-2, 17, 0), priority: "P2", status: "done",   estMin: 10,  energy: "low",  tags: ["admin"],   completedAt: d(-2, 9, 30) },
];

const ALERTS = [
  { id: "a1", severity: "high",   kind: "deadline_risk", title: "NeurIPS rebuttal due in 48h",       body: "You've scheduled 3h of work. Your last 5 writing tasks ran 35% over estimate — suggesting you block 4h today + 2h tomorrow.", actions: ["Reserve 4h today", "Show plan", "Dismiss"], createdAt: d(0, 8, 12), related: "t1" },
  { id: "a2", severity: "med",    kind: "prep",          title: "Advisor 1:1 in 1h 14m — no prep block", body: "You usually prep for 30m. I can reserve 9:15–9:45 and pull your notes from last week.", actions: ["Reserve prep", "Skip this time"], createdAt: d(0, 8, 46), related: "e1" },
  { id: "a3", severity: "low",    kind: "neglected",     title: "replay-debugger untouched for 8 days", body: "Last active Apr 11. Want to archive or schedule a 90m block this weekend?", actions: ["Archive", "Schedule block", "Dismiss"], createdAt: d(0, 7, 30), related: "p6" },
  { id: "a4", severity: "low",    kind: "pattern",       title: "Noticed: you do best at 10–12:30",     body: "Over the past 3 weeks, you've completed 68% of deep-work tasks in this window. I'm biasing future plans toward it.", actions: ["Got it", "Adjust"], createdAt: d(-1, 22, 0) },
];

const TENDENCIES = [
  { id: "td1", text: "Prefers deep work 10:00–12:30",                 evidence: 14, confidence: 0.88, lastSeen: d(0, 12, 0),  status: "active" },
  { id: "td2", text: "Underestimates writing tasks by ~35%",          evidence: 9,  confidence: 0.79, lastSeen: d(-1, 18, 0), status: "active" },
  { id: "td3", text: "Skips low-priority admin on Fridays",           evidence: 6,  confidence: 0.71, lastSeen: d(-4, 17, 0), status: "active" },
  { id: "td4", text: "Works best with 90-min blocks (not 60)",        evidence: 11, confidence: 0.83, lastSeen: d(-1, 11, 0), status: "active" },
  { id: "td5", text: "Reschedules Wed afternoons onto Thu mornings",  evidence: 4,  confidence: 0.62, lastSeen: d(-6, 13, 0), status: "watching" },
  { id: "td6", text: "Ignores reminders after 22:00",                 evidence: 8,  confidence: 0.91, lastSeen: d(-1, 23, 10), status: "active" },
];

const PREFERENCES = [
  { id: "pr1", key: "Work hours",         value: "09:00 – 19:00 (Mon–Fri), 12:00 – 17:00 (Sat)" },
  { id: "pr2", key: "Focus block length", value: "90 min (learned, adjustable)" },
  { id: "pr3", key: "Quiet hours",        value: "22:00 – 08:00 (no Discord pings)" },
  { id: "pr4", key: "Daily plan time",    value: "08:00 — delivered via Discord DM" },
  { id: "pr5", key: "Weekly review",      value: "Sunday 18:00" },
  { id: "pr6", key: "Timezone",           value: "America/Detroit" },
];

const INTEGRATIONS = [
  { id: "in1", name: "Google Calendar", status: "connected", detail: "2 calendars · last sync 3 min ago" },
  { id: "in2", name: "Discord",         status: "connected", detail: "DM to @rafe · 4 channels" },
  { id: "in3", name: "GitHub",          status: "connected", detail: "activity signals · read-only" },
  { id: "in4", name: "Slack (lab)",     status: "available", detail: "not connected" },
];

// Canned chat transcript
const CHAT_SEED = [
  { role: "user", text: "what should i focus on today?" },
  { role: "assistant", text: "Short answer: get the rebuttal draft moving. You have 4 meetings and a class today — only one real deep-work window.", cards: [
    { kind: "plan", title: "Proposed plan", blocks: [
      { start: "09:15", end: "09:45", label: "Prep for advisor 1:1", task: "t3" },
      { start: "10:00", end: "10:45", label: "Advisor 1:1", event: "e1" },
      { start: "11:00", end: "12:30", label: "Rebuttal §3 (deep work)", task: "t1" },
      { start: "13:00", end: "14:30", label: "EECS 598 lecture", event: "e2" },
      { start: "15:30", end: "16:30", label: "Reading group", event: "e3" },
      { start: "17:00", end: "18:30", label: "Office hours", event: "e4" },
    ] }
  ] },
];

Object.assign(window, { PROJECTS, EVENTS, TASKS, ALERTS, TENDENCIES, PREFERENCES, INTEGRATIONS, CHAT_SEED, today });
