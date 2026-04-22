import { getConfigField } from "./integrationConfigs.js";

// Fires a notification to every configured push channel. Best-effort — a
// failing channel never blocks the row from landing in the database, which
// is the canonical delivery path.
//
// Discord is the only wired channel today. Config is a single webhook URL
// stored in integration_configs.provider='discord', field='webhook_url'.
// The payload uses plain content so it renders as a readable message in
// DMs or in a channel. We prefix with a marker the user can mute if needed.
export async function pushNotification(
  userId: string,
  input: {
    severity: "high" | "med" | "low";
    kind: string;
    title: string;
    body: string;
    actionsHint?: string; // e.g. "Reply done/skip/ack in the app"
    requiresAck: boolean;
    notificationId: string;
    commitmentId?: string | null;
  },
): Promise<{ attempted: string[]; delivered: string[] }> {
  const attempted: string[] = [];
  const delivered: string[] = [];

  const webhook = await getConfigField(userId, "discord", "webhook_url").catch(() => null);
  if (webhook) {
    attempted.push("discord");
    try {
      const marker = input.severity === "high" ? "🚨" : input.requiresAck ? "⏱️" : "•";
      const lines = [`**${marker} ${input.title}**`, input.body];
      if (input.actionsHint) lines.push(`— ${input.actionsHint}`);
      if (input.commitmentId) {
        lines.push(`(commitment \`${input.commitmentId}\`)`);
      }
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lines.join("\n") }),
      });
      if (res.ok || res.status === 204) delivered.push("discord");
      else console.warn(`discord webhook responded ${res.status}`);
    } catch (err) {
      console.warn("discord webhook failed:", err);
    }
  }

  return { attempted, delivered };
}
