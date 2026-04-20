import { getActiveKey } from "../services/apiKeys.js";
import { getProvider, type ProviderId } from "./registry.js";

export type DiscoveredModel = { id: string; label: string; note?: string };

/**
 * Queries the provider's /v1/models endpoint and returns a normalized list.
 * Throws on HTTP failure so the route can surface the error.
 */
export async function discoverModels(
  userId: string,
  provider: ProviderId,
): Promise<DiscoveredModel[]> {
  const entry = getProvider(provider);
  if (!entry) throw new Error(`unknown provider: ${provider}`);

  const apiKey = await getActiveKey(userId, provider);
  if (entry.requiresApiKey && !apiKey) {
    throw new Error(`no API key for ${entry.label}`);
  }

  if (entry.transport === "anthropic") {
    return fetchAnthropicModels(apiKey!);
  }

  const baseUrl =
    entry.baseUrl ??
    (entry.transport === "openai" ? "https://api.openai.com/v1" : null);
  if (!baseUrl) throw new Error(`no base URL configured for ${provider}`);

  return fetchOpenAICompatModels(baseUrl, apiKey, provider);
}

async function fetchAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=200", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { id?: string; display_name?: string; created_at?: string }[];
  };
  const rows = json.data ?? [];
  return rows
    .filter((m): m is { id: string; display_name?: string; created_at?: string } => !!m.id)
    .map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
      note: m.created_at ? relativeDate(m.created_at) : undefined,
    }));
}

async function fetchOpenAICompatModels(
  baseUrl: string,
  apiKey: string | null,
  provider: string,
): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `${provider} doesn't expose a /models listing endpoint — use the curated list or type a model ID`,
      );
    }
    const body = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: {
      id?: string;
      name?: string;
      display_name?: string;
      owned_by?: string;
      context_length?: number;
      description?: string;
    }[];
  };
  const rows = json.data ?? [];
  return rows
    .filter((m): m is NonNullable<typeof rows[number]> & { id: string } => !!m?.id)
    .map((m) => ({
      id: m.id,
      label: m.display_name || m.name || m.id,
      note: m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : undefined,
    }));
}

function relativeDate(iso: string): string | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}
