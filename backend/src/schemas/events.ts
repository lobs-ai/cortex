import { z } from "zod";

export const EventKind = z.enum(["meeting", "class", "teach", "personal", "deadline", "block"]);

export const EventCreate = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  kind: EventKind.default("meeting"),
  projectId: z.string().nullable().optional(),
  important: z.boolean().default(false),
});

export const EventPatch = EventCreate.partial();

export type EventCreateInput = z.infer<typeof EventCreate>;
export type EventPatchInput = z.infer<typeof EventPatch>;
