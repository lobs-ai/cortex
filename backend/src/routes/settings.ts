import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { getRegistry, getSettings, setRoleConfig } from "../services/settings.js";
import {
  addKey,
  deleteKey,
  listKeys,
  setActiveKey,
} from "../services/apiKeys.js";
import {
  addEndpoint,
  deleteEndpoint,
  getEndpointBaseUrl,
  listEndpoints,
  setActiveEndpoint,
  updateEndpoint,
} from "../services/lmstudioEndpoints.js";
import { fetchLmstudioModelsAt } from "../ai/discover.js";
import { PROVIDER_IDS, ROLES, type ProviderId, type RoleId } from "../ai/registry.js";
import { discoverModels } from "../ai/discover.js";

const ProviderIds = PROVIDER_IDS as unknown as [ProviderId, ...ProviderId[]];
const Cfg = z.object({
  provider: z.enum(ProviderIds),
  model: z.string().min(1),
});
const RoleIds = ROLES.map((r) => r.id) as unknown as [RoleId, ...RoleId[]];
const KeyCreate = z.object({
  provider: z.enum(ProviderIds),
  label: z.string().min(1).max(40),
  key: z.string().min(4),
});

const LmEndpointCreate = z.object({
  label: z.string().min(1).max(40),
  baseUrl: z.string().min(1).max(200),
});
const LmEndpointPatch = z.object({
  label: z.string().min(1).max(40).optional(),
  baseUrl: z.string().min(1).max(200).optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async (req) => {
    const u = currentUser(req);
    return getSettings(u.id);
  });

  app.get("/api/settings/providers", async (req) => {
    const u = currentUser(req);
    return getRegistry(u.id);
  });

  app.get("/api/settings/providers/:provider/models", async (req, reply) => {
    const u = currentUser(req);
    const { provider } = z
      .object({ provider: z.enum(ProviderIds) })
      .parse(req.params);
    try {
      const models = await discoverModels(u.id, provider);
      return { provider, models };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "discover_failed", message: msg });
    }
  });

  app.put("/api/settings/:role", async (req) => {
    const u = currentUser(req);
    const { role } = z.object({ role: z.enum(RoleIds) }).parse(req.params);
    const body = Cfg.parse(req.body);
    await setRoleConfig(u.id, role, body);
    return { ok: true };
  });

  app.get("/api/settings/keys", async (req) => {
    const u = currentUser(req);
    return listKeys(u.id);
  });

  app.post("/api/settings/keys", async (req) => {
    const u = currentUser(req);
    const body = KeyCreate.parse(req.body);
    return addKey(u.id, body);
  });

  app.delete("/api/settings/keys/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await deleteKey(u.id, id);
    return { ok: true };
  });

  app.post("/api/settings/keys/:id/activate", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await setActiveKey(u.id, id);
    return { ok: true };
  });

  // LM Studio endpoints — multiple base URLs per user, one active.
  app.get("/api/settings/lmstudio/endpoints", async (req) => {
    const u = currentUser(req);
    return listEndpoints(u.id);
  });

  app.post("/api/settings/lmstudio/endpoints", async (req) => {
    const u = currentUser(req);
    const body = LmEndpointCreate.parse(req.body);
    return addEndpoint(u.id, body);
  });

  app.patch("/api/settings/lmstudio/endpoints/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = LmEndpointPatch.parse(req.body);
    await updateEndpoint(u.id, id, body);
    return { ok: true };
  });

  app.delete("/api/settings/lmstudio/endpoints/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await deleteEndpoint(u.id, id);
    return { ok: true };
  });

  app.post("/api/settings/lmstudio/endpoints/:id/activate", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await setActiveEndpoint(u.id, id);
    return { ok: true };
  });

  app.get("/api/settings/lmstudio/endpoints/:id/models", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const baseUrl = await getEndpointBaseUrl(u.id, id);
    if (!baseUrl) return reply.code(404).send({ error: "endpoint_not_found" });
    try {
      const models = await fetchLmstudioModelsAt(baseUrl);
      return { baseUrl, models };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "fetch_failed", message: msg });
    }
  });
}
