import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser } from "../lib/user.js";
import { ProjectCreate, ProjectPatch } from "../schemas/projects.js";
import {
  createProject,
  getProject,
  listProjects,
  patchProject,
} from "../services/projects.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async (req) => {
    const u = currentUser(req);
    return listProjects(u.id);
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = await getProject(u.id, id);
    if (!p) return reply.code(404).send({ error: "not_found" });
    return p;
  });

  app.post("/api/projects", async (req) => {
    const u = currentUser(req);
    const body = ProjectCreate.parse(req.body);
    return createProject(u.id, body);
  });

  app.patch("/api/projects/:id", async (req, reply) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = ProjectPatch.parse(req.body);
    const p = await patchProject(u.id, id, body);
    if (!p) return reply.code(404).send({ error: "not_found" });
    return p;
  });
}
