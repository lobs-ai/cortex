import { eq } from "drizzle-orm";
import { db, rawDb, schema } from "./client.js";
import { DEMO_USER_ID } from "../lib/user.js";

// Apply schema first so this can run on a fresh DB.
await import("./push.js");

const now = new Date();

const [existing] = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.id, DEMO_USER_ID));

if (!existing) {
  await db.insert(schema.users).values({
    id: DEMO_USER_ID,
    email: "you@example.com",
    name: "You",
    timezone: "America/Detroit",
    createdAt: now,
    updatedAt: now,
  });
  console.log("created empty user — add tasks/events/projects as you go");
} else {
  console.log("user already exists, nothing to seed");
}

rawDb.close();
