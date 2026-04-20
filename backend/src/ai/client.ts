import Anthropic from "@anthropic-ai/sdk";
import { env, hasLLM } from "../env.js";

let client: Anthropic | null = null;

export function llmClient() {
  if (!hasLLM) return null;
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const LLM_MODEL = env.LLM_MODEL;
