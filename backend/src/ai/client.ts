import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";
import { getActiveKey } from "../services/apiKeys.js";
import { getProvider, type ProviderId } from "./registry.js";

export type ChatMsg = { role: "user" | "assistant"; content: string };
export type CompletionRequest = {
  system: string;
  messages: ChatMsg[];
  maxTokens?: number;
};
export type CompletionResult = {
  text: string;
  usage?: { in: number; out: number };
};

const anthropicCache = new Map<string, Anthropic>();

// Strips reasoning-model scratchpad blocks. DeepSeek/MiniMax/GLM/Kimi R-series
// all emit their chain-of-thought inside <think>…</think> (and some variants
// use <thinking>). Also handles an unterminated trailing block caused by
// max_tokens truncation.
const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;
const UNTERMINATED_TRAILING = /<(think|thinking|reasoning)>[\s\S]*$/i;

export function stripReasoning(text: string): string {
  return text.replace(THINK_BLOCK, "").replace(UNTERMINATED_TRAILING, "").trim();
}

function getAnthropic(apiKey: string): Anthropic {
  let c = anthropicCache.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    anthropicCache.set(apiKey, c);
  }
  return c;
}

/**
 * Dispatches a completion to whichever provider the user selected.
 * Returns null if the provider requires a key and the user has none.
 */
export async function complete(
  userId: string,
  provider: ProviderId,
  model: string,
  req: CompletionRequest,
): Promise<CompletionResult | null> {
  const entry = getProvider(provider);
  if (!entry) return null;

  const apiKey = await getActiveKey(userId, provider);
  if (entry.requiresApiKey && !apiKey) return null;

  if (entry.transport === "anthropic") {
    if (!apiKey) return null;
    const anthro = getAnthropic(apiKey);
    const resp = await anthro.messages.create({
      model,
      max_tokens: req.maxTokens ?? 600,
      system: req.system,
      messages: req.messages,
    });
    const rawText = resp.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      text: stripReasoning(rawText),
      usage: { in: resp.usage.input_tokens, out: resp.usage.output_tokens },
    };
  }

  // OpenAI + OpenAI-compatible (openrouter, lmstudio, minimax, opencode-*, z-ai, kimi)
  const baseUrl =
    entry.baseUrl ??
    (entry.transport === "openai" ? "https://api.openai.com/v1" : "");
  if (!baseUrl) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (provider === "openrouter") headers["X-Title"] = "cortex";

  const body = {
    model,
    max_tokens: req.maxTokens ?? 600,
    messages: [
      { role: "system", content: req.system },
      ...req.messages,
    ],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = stripReasoning(json.choices?.[0]?.message?.content ?? "");
  return {
    text,
    usage: json.usage
      ? { in: json.usage.prompt_tokens ?? 0, out: json.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

// Legacy shim — some older code paths still ask for a raw Anthropic client.
// Returns null if no anthropic key is stored and the user hasn't set
// ANTHROPIC_API_KEY either.
export async function llmClientFor(userId: string): Promise<Anthropic | null> {
  const key = await getActiveKey(userId, "anthropic");
  if (!key) return null;
  return getAnthropic(key);
}

export const LLM_MODEL = env.LLM_MODEL;
