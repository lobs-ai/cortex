import { LLM_MODEL, llmClient } from "./client.js";
import { listTasks } from "../services/tasks.js";
import { listEvents } from "../services/events.js";
import { listProjects } from "../services/projects.js";
import { listTendencies } from "../services/memory.js";

export type ChatCard =
  | { kind: "plan"; title: string; blocks: { start: string; end: string; label: string; task?: string; event?: string }[] }
  | { kind: "items"; title: string; blocks: { label: string; sub: string }[] };

export type ChatReply = { text: string; cards: ChatCard[]; usage?: { in: number; out: number } };

const CANNED: Record<string, string> = {
  default: "Let me take a look... based on what's on your plate, I'd tackle the NeurIPS rebuttal next — it's the only P0 with a hard deadline inside 48h.",
  rebuttal: "Yeah, the rebuttal is the blocker. You've got ~5h of writing left based on your outline, and your writing tasks historically run 35% over — so call it 6.5h. I'd split it: 4h today (11:00–12:30 + 16:00–18:00), 2.5h tomorrow morning.",
  plan: "Okay — here's what I'd run. Your deep-work window is 11:00–12:30, which is your strongest. Everything else slots around your meetings.",
  behind: "Three things: (1) rebuttal §3, (2) the eval leak in trainer.py — due in 2 days and you haven't touched it, (3) the replay-debugger project has been dark for 8 days. Want me to handle any of these?",
  move: "Done. I moved the 3pm reading group to Thursday 10am — your advisor said that slot works. Everyone else is auto-confirmed.",
  tomorrow: "Tomorrow is lighter — lab meeting at 11, EECS 598 at 13:00, and your usual 7:30 gym block. I'd reserve 14:30–16:30 for ablation re-runs. Want me to schedule that?",
  time: "Looking at your calendar — you've got a clean 9:00–10:45 block Thursday and Friday 14:30–18:00. Either works for 2h focus. Thursday is better because you do deep work best in mornings.",
};

function cannedReply(userText: string): ChatReply {
  const t = userText.toLowerCase();
  const pick = (k: keyof typeof CANNED) => CANNED[k];
  let text = pick("default");
  if (t.includes("rebuttal")) text = pick("rebuttal");
  else if (t.includes("plan") || t.includes("today")) text = pick("plan");
  else if (t.includes("behind") || t.includes("overdue")) text = pick("behind");
  else if (t.includes("move") || t.includes("reschedule")) text = pick("move");
  else if (t.includes("tomorrow")) text = pick("tomorrow");
  else if (t.includes("when") || t.includes("fit") || t.includes("block")) text = pick("time");

  const cards: ChatCard[] = [];
  if (t.includes("plan") || t.includes("today")) {
    cards.push({
      kind: "plan",
      title: "Proposed plan for today",
      blocks: [
        { start: "09:15", end: "09:45", label: "Prep for advisor 1:1" },
        { start: "10:00", end: "10:45", label: "Advisor 1:1" },
        { start: "11:00", end: "12:30", label: "Rebuttal §3 — deep work" },
        { start: "13:00", end: "14:30", label: "EECS 598 lecture" },
        { start: "15:30", end: "16:30", label: "Reading group" },
        { start: "17:00", end: "18:30", label: "Office hours" },
      ],
    });
  } else if (t.includes("behind") || t.includes("overdue")) {
    cards.push({
      kind: "items",
      title: "Flagged",
      blocks: [
        { label: "Rebuttal §3", sub: "P0 · due in 48h · 3h scheduled of ~6.5h est" },
        { label: "Eval leak in trainer.py", sub: "P1 · due in 2 days · untouched" },
        { label: "replay-debugger project", sub: "dark for 8 days" },
      ],
    });
  }
  return { text, cards };
}

export async function chatReply(userId: string, userText: string, history: { role: string; content: string }[]): Promise<ChatReply> {
  const client = llmClient();
  if (!client) return cannedReply(userText);

  const [tasks, events, projects, tendencies] = await Promise.all([
    listTasks(userId),
    listEvents(userId, { from: startOfToday(), to: inDays(7) }),
    listProjects(userId),
    listTendencies(userId),
  ]);

  const context = {
    now: new Date().toISOString(),
    tasks: tasks.filter((t) => t.status !== "done").slice(0, 20),
    events: events.slice(0, 20),
    projects: projects.filter((p) => p.status === "active"),
    tendencies: tendencies.slice(0, 6),
  };

  const system = [
    "You are Cortex, a personal AI executive assistant. You reason over the user's structured schedule, tasks, projects, and learned tendencies.",
    "Respond conversationally but concisely. Reference concrete items (task titles, times) from the context when relevant.",
    "Do not invent tasks or events that aren't in the context. Do not promise to take actions unless the user asked.",
    "Context is delivered as JSON below. Times are ISO-8601 in the user's timezone.",
    "",
    `CONTEXT:\n${JSON.stringify(context, null, 2)}`,
  ].join("\n");

  try {
    const resp = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 600,
      system,
      messages: [
        ...history.slice(-8).map((h) => ({ role: h.role === "user" ? ("user" as const) : ("assistant" as const), content: h.content })),
        { role: "user" as const, content: userText },
      ],
    });
    const text = resp.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return {
      text: text || cannedReply(userText).text,
      cards: [],
      usage: { in: resp.usage.input_tokens, out: resp.usage.output_tokens },
    };
  } catch (err) {
    console.error("llm error, falling back to canned:", err);
    return cannedReply(userText);
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function inDays(n: number) {
  const d = startOfToday();
  d.setDate(d.getDate() + n);
  return d;
}
