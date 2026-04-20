// Curated list of providers + models for the settings picker. Keep
// models in recency order so the UI can default to the first entry.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "lmstudio"
  | "opencode-zen"
  | "opencode-go"
  | "z-ai"
  | "minimax"
  | "kimi";

export type ProviderEntry = {
  id: ProviderId;
  label: string;
  requiresApiKey: boolean;
  keyEnvVar: string;
  // Transport the backend uses when dispatching to this provider. Everything
  // except anthropic speaks the OpenAI chat-completions protocol.
  transport: "anthropic" | "openai" | "openai-compatible";
  // Well-known OpenAI-compat base URL. Empty for anthropic/openai which use
  // the SDK defaults.
  baseUrl?: string;
  models: { id: string; label: string; note?: string }[];
};

export const PROVIDERS: ProviderEntry[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    keyEnvVar: "ANTHROPIC_API_KEY",
    transport: "anthropic",
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
    transport: "openai",
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
    transport: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7 (OR)" },
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (OR)" },
      { id: "openai/gpt-4.1", label: "GPT-4.1 (OR)" },
      { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    ],
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    requiresApiKey: true,
    keyEnvVar: "OPENCODE_API_KEY",
    transport: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/v1",
    models: [
      { id: "zen-coder", label: "Zen Coder", note: "coding-tuned default" },
      { id: "zen-thinker", label: "Zen Thinker", note: "reasoning" },
    ],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    requiresApiKey: true,
    keyEnvVar: "OPENCODE_API_KEY",
    transport: "openai-compatible",
    baseUrl: "https://opencode.ai/zen/go/v1",
    models: [
      { id: "go-fast", label: "Go Fast", note: "low-latency agent" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    requiresApiKey: true,
    keyEnvVar: "MINIMAX_API_KEY",
    transport: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    models: [
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", note: "flagship" },
      { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 highspeed" },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
      { id: "MiniMax-M2.1", label: "MiniMax M2.1" },
      { id: "MiniMax-M2", label: "MiniMax M2" },
    ],
  },
  {
    id: "z-ai",
    label: "Z.AI",
    requiresApiKey: true,
    keyEnvVar: "ZAI_API_KEY",
    transport: "openai-compatible",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: [
      { id: "glm-4.7", label: "GLM-4.7", note: "flagship" },
      { id: "glm-4.6", label: "GLM-4.6" },
      { id: "glm-4.5-air", label: "GLM-4.5 Air", note: "fast" },
    ],
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    requiresApiKey: true,
    keyEnvVar: "KIMI_API_KEY",
    transport: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      { id: "kimi-k2", label: "Kimi K2", note: "flagship" },
      { id: "moonshot-v1-128k", label: "Moonshot v1 128k" },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k" },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    requiresApiKey: false,
    keyEnvVar: "",
    transport: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    models: [
      { id: "local-any", label: "Any loaded model", note: "uses whichever model is running" },
    ],
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as ProviderId[];

export function getProvider(id: ProviderId | string): ProviderEntry | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

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
