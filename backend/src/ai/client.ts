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

// Reasoning-class models burn most of their max_tokens inside <think> blocks.
// If the ceiling is too low the response is truncated mid-thought and the
// caller never sees any JSON/answer. Floor the budget for these providers so
// callers that pass a modest maxTokens (e.g. 800 for the planner) still leave
// enough headroom for the actual response.
const REASONING_PROVIDER_FLOOR: Partial<Record<ProviderId, number>> = {
  minimax: 16000,
  "z-ai": 16000,
  kimi: 12000,
};

function resolveMaxTokens(provider: ProviderId, model: string, requested: number | undefined, fallback: number): number {
  const base = requested ?? fallback;
  const floor = REASONING_PROVIDER_FLOOR[provider];
  if (floor && base < floor) return floor;
  // OpenRouter routes many reasoning models too — bump DeepSeek R-series / OSS thinkers.
  if (provider === "openrouter" && /(^|\/)(deepseek-r1|qwq|qwen.*thinking|glm-4\.?\d|minimax|kimi)/i.test(model) && base < 16000) {
    return 16000;
  }
  return base;
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
    max_tokens: resolveMaxTokens(provider, model, req.maxTokens, 600),
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

export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

type AnyMsg = { role: "user" | "assistant"; content: unknown };

export async function completeWithTools(
  userId: string,
  provider: ProviderId,
  model: string,
  req: CompletionRequest,
  tools: ToolDef[],
  toolHandlers: Record<string, ToolHandler>,
): Promise<CompletionResult | null> {
  const entry = getProvider(provider);
  if (!entry) return null;

  const apiKey = await getActiveKey(userId, provider);
  if (entry.requiresApiKey && !apiKey) return null;

  if (entry.transport === "anthropic") {
    if (!apiKey) return null;
    const anthro = getAnthropic(apiKey);
    const msgs: AnyMsg[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    let totalIn = 0, totalOut = 0;

    for (let i = 0; i < 8; i++) {
      const resp = await anthro.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1500,
        system: req.system,
        messages: msgs as Parameters<typeof anthro.messages.create>[0]["messages"],
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool["input_schema"],
        })),
      });

      totalIn += resp.usage.input_tokens;
      totalOut += resp.usage.output_tokens;

      if (resp.stop_reason !== "tool_use") {
        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return { text: stripReasoning(text), usage: { in: totalIn, out: totalOut } };
      }

      msgs.push({ role: "assistant", content: resp.content });

      const toolUseBlocks = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const handler = toolHandlers[block.name];
          let result: unknown;
          try {
            result = handler
              ? await handler(block.input as Record<string, unknown>)
              : { error: `Unknown tool: ${block.name}` };
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
          return { type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify(result) };
        }),
      );
      msgs.push({ role: "user", content: toolResults });
    }
    return null;
  }

  // OpenAI-compatible
  const baseUrl = entry.baseUrl ?? (entry.transport === "openai" ? "https://api.openai.com/v1" : "");
  if (!baseUrl) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (provider === "openrouter") headers["X-Title"] = "cortex";

  type OAIToolCall = { id: string; type: string; function: { name: string; arguments: string } };
  type OAIMessage = { role: string; content?: string | null; tool_calls?: OAIToolCall[]; tool_call_id?: string };
  const msgs: OAIMessage[] = [{ role: "system", content: req.system }, ...req.messages];
  let totalIn = 0, totalOut = 0;

  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: resolveMaxTokens(provider, model, req.maxTokens, 1500),
        messages: msgs,
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${provider} ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: OAIMessage; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    totalIn += json.usage?.prompt_tokens ?? 0;
    totalOut += json.usage?.completion_tokens ?? 0;

    const choice = json.choices?.[0];
    if (!choice?.message) return null;

    if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
      return { text: stripReasoning(choice.message.content ?? ""), usage: { in: totalIn, out: totalOut } };
    }

    msgs.push(choice.message);
    for (const call of choice.message.tool_calls) {
      const handler = toolHandlers[call.function.name];
      let result: unknown;
      try {
        const input = JSON.parse(call.function.arguments) as Record<string, unknown>;
        result = handler ? await handler(input) : { error: `Unknown tool: ${call.function.name}` };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      msgs.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return null;
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
