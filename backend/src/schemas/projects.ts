import { z } from "zod";

export const ProjectCreate = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.enum(["amber", "blue", "red", "gray", "green", "violet"]).default("gray"),
  status: z.enum(["active", "paused", "archived"]).default("active"),
  targetDate: z.coerce.date().nullable().optional(),
});

export const ProjectPatch = ProjectCreate.partial();

export type ProjectCreateInput = z.infer<typeof ProjectCreate>;
