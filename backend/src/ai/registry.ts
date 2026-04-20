// Curated list of providers + models for the settings picker. Keep
// models in recency order so the UI can default to the first entry.

export type ProviderId = "anthropic" | "openai" | "openrouter" | "lmstudio";

export type ProviderEntry = {
  id: ProviderId;
  label: string;
  requiresApiKey: boolean;
  keyEnvVar: string;
  models: { id: string; label: string; note?: string }[];
};

export const PROVIDERS: ProviderEntry[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    keyEnvVar: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", note: "most capable" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "balanced" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", note: "fast + cheap" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    requiresApiKey: true,
    keyEnvVar: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "fast + cheap" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "o1", label: "o1", note: "reasoning" },
      { id: "o1-mini", label: "o1-mini", note: "fast reasoning" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    requiresApiKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
    models: [
      { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7 (OR)" },
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (OR)" },
      { id: "openai/gpt-4.1", label: "GPT-4.1 (OR)" },
      { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    requiresApiKey: false,
    keyEnvVar: "",
    models: [
      { id: "local-any", label: "Any loaded model", note: "uses whichever model is running" },
    ],
  },
];

export const ROLES = [
  { id: "planner", label: "Planner", note: "daily/weekly plans, scheduling" },
  { id: "monitor", label: "Monitor", note: "proactive checks, alerts" },
  { id: "curator", label: "Memory curator", note: "promotes learned tendencies" },
  { id: "chat", label: "Chat assistant", note: "answers questions, runs actions" },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export const DEFAULT_ROLE_CONFIG: Record<RoleId, { provider: ProviderId; model: string }> = {
  planner: { provider: "anthropic", model: "claude-opus-4-7" },
  monitor: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  curator: { provider: "anthropic", model: "claude-sonnet-4-6" },
  chat: { provider: "anthropic", model: "claude-sonnet-4-6" },
};
