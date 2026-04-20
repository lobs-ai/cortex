import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../lib/ids.js";
import { currentUser } from "../lib/user.js";
import { chatReply } from "../ai/chat.js";

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/chat/conversations", async (req) => {
    const u = currentUser(req);
    const rows = await db
      .select()
      .from(schema.assistantMessages)
      .where(eq(schema.assistantMessages.userId, u.id))
      .orderBy(asc(schema.assistantMessages.createdAt));
    const convs = new Map<string, { id: string; lastAt: Date; lastText: string; count: number }>();
    for (const r of rows) {
      const prev = convs.get(r.conversationId);
      convs.set(r.conversationId, {
        id: r.conversationId,
        lastAt: r.createdAt,
        lastText: r.content.slice(0, 80),
        count: (prev?.count ?? 0) + 1,
      });
    }
    return [...convs.values()].sort((a, b) => +b.lastAt - +a.lastAt);
  });

  app.get("/api/chat/conversations/:id", async (req) => {
    const u = currentUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const rows = await db
      .select()
      .from(schema.assistantMessages)
      .where(
        and(
          eq(schema.assistantMessages.userId, u.id),
          eq(schema.assistantMessages.conversationId, id),
        ),
      )
      .orderBy(asc(schema.assistantMessages.createdAt));
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      cards: r.cardsJson ? JSON.parse(r.cardsJson) : [],
      createdAt: r.createdAt,
    }));
  });

  app.post("/api/chat", async (req) => {
    const u = currentUser(req);
    const body = z
      .object({
        text: z.string().min(1),
        conversationId: z.string().optional(),
      })
      .parse(req.body);

    const convId = body.conversationId ?? newId("conv");
    const now = new Date();

    const prior = body.conversationId
      ? await db
          .select()
          .from(schema.assistantMessages)
          .where(
            and(
              eq(schema.assistantMessages.userId, u.id),
              eq(schema.assistantMessages.conversationId, convId),
            ),
          )
          .orderBy(asc(schema.assistantMessages.createdAt))
      : [];

    await db.insert(schema.assistantMessages).values({
      id: newId("m"),
      userId: u.id,
      conversationId: convId,
      role: "user",
      content: body.text,
      createdAt: now,
    });

    const history = prior.map((p) => ({ role: p.role, content: p.content }));
    const reply = await chatReply(u.id, body.text, history);

    const replyId = newId("m");
    await db.insert(schema.assistantMessages).values({
      id: replyId,
      userId: u.id,
      conversationId: convId,
      role: "assistant",
      content: reply.text,
      cardsJson: JSON.stringify(reply.cards),
      createdAt: new Date(),
    });

    return {
      conversationId: convId,
      message: {
        id: replyId,
        role: "assistant",
        content: reply.text,
        cards: reply.cards,
      },
    };
  });
}
