import { z } from "zod";

// "Playable" states — planner considers these.
export const PLAYABLE_STATUSES = ["inbox", "today", "doing"] as const;
// Full state vocabulary — includes gardener/triage states that are still
// alive but should not be scheduled.
export const TaskStatus = z.enum([
  "inbox",
  "today",
  "doing",
  "done",
  "snoozed",
  "blocked",
  "abandoned",
  "merged",
  "stale",
]);
export const Priority = z.enum(["P0", "P1", "P2"]);
export const Energy = z.enum(["low", "med", "high"]);

export const TaskCreate = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: Priority.default("P2"),
  status: TaskStatus.default("inbox"),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  projectId: z.string().nullable().optional(),
  energyLevel: Energy.default("med"),
  tags: z.array(z.string()).default([]),
});

export const TaskPatch = TaskCreate.partial();

export type TaskCreateInput = z.infer<typeof TaskCreate>;
export type TaskPatchInput = z.infer<typeof TaskPatch>;
