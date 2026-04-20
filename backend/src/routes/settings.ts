import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { getRegistry, getSettings, setRoleConfig } from "../services/settings.js";
import { ROLES, type RoleId } from "../ai/registry.js";

const Cfg = z.object({
  provider: z.enum(["anthropic", "openai", "openrouter", "lmstudio"]),
  model: z.string().min(1),
});
const RoleIds = ROLES.map((r) => r.id) as unknown as [RoleId, ...RoleId[]];

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async (req) => {
    const u = currentUser(req);
    return getSettings(u.id);
  });

  app.get("/api/settings/providers", async () => getRegistry());

  app.put("/api/settings/:role", async (req) => {
    const u = currentUser(req);
    const { role } = z.object({ role: z.enum(RoleIds) }).parse(req.params);
    const body = Cfg.parse(req.body);
    await setRoleConfig(u.id, role, body);
    return { ok: true };
  });
}
