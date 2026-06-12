/**
 * Pioneer AI provider for pi.
 *
 * Connects pi to Pioneer AI's OpenAI-compatible API (https://api.pioneer.ai/v1).
 * Models are fetched dynamically from Pioneer's /base-models endpoint at startup.
 *
 * Authentication (pick one):
 *   1. Run `/login`, then select Pioneer AI — prompts for API key, auto-stores it
 *   2. Set PIONEER_API_KEY environment variable
 */

import {
  streamSimpleAnthropic,
  streamSimpleOpenAICompletions,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessageEventStream,
  Context,
  Model,
  OAuthCredentials,
  OAuthLoginCallbacks,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// OAuth — simple API key entry via /login
// ---------------------------------------------------------------------------

const API_KEY_TTL = 10 * 365 * 24 * 60 * 60 * 1000;

async function login(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const apiKey = await callbacks.onPrompt({
    message: "Enter your Pioneer API key (starts with pio_sk_):",
  });
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key cannot be empty");
  return {
    refresh: trimmed,
    access: trimmed,
    expires: Date.now() + API_KEY_TTL,
  };
}

async function refreshToken(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  return { ...credentials, expires: Date.now() + API_KEY_TTL };
}

function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}

// ---------------------------------------------------------------------------
// Dynamic model discovery from Pioneer /base-models
// ---------------------------------------------------------------------------

interface PioneerModel {
  id: string;
  label: string;
  task_type: string;
  context_window: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  cache_read_price_per_million?: number;
  cache_write_price_per_million?: number;
  supports_inference: boolean;
  is_chat_model: boolean;
}

async function fetchModels(
  baseUrl: string,
): Promise<
  Array<{
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }>
> {
  const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/base-models`);
  if (!res.ok) {
    console.warn(
      `[pioneer] Failed to fetch models (${res.status}), using fallback`,
    );
    return [];
  }

  const data = (await res.json()) as { models: PioneerModel[] };

  const discovered = data.models
    .filter(
      (m) =>
        m.task_type === "decoder" &&
        m.is_chat_model &&
        m.supports_inference,
    )
    .map((m) => ({
      id: m.id,
      name: `${m.label} (Pioneer)`,
      reasoning: true,
      contextWindow: m.context_window,
      maxTokens: Math.min(m.context_window >> 2, 131072),
      cost: {
        input: m.input_price_per_million ?? 0,
        output: m.output_price_per_million ?? 0,
        cacheRead: m.cache_read_price_per_million ?? 0,
        cacheWrite: m.cache_write_price_per_million ?? 0,
      },
    }));

  // Derive router model limits from max of all discoverable models
  // The router can route to any candidate, so effective max = max of pool
  const maxContextWindow = discovered.length > 0
    ? Math.max(...discovered.map((m) => m.contextWindow))
    : 200000;
  const maxTokens = Math.min(maxContextWindow >> 2, 131072);

  const routerModel = {
    id: "auto",
    name: "Pioneer Auto Router (Pioneer)",
    reasoning: true,
    contextWindow: maxContextWindow,
    maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  return [routerModel, ...discovered];
}

// ---------------------------------------------------------------------------
// Provider transport selection
// ---------------------------------------------------------------------------

function isClaudeModel(modelId: string): boolean {
  return modelId.startsWith("claude-");
}

function shouldUseAnthropicMessages(modelId: string): boolean {
  return modelId === "auto" || isClaudeModel(modelId) || isOpenAIModel(modelId);
}

function isAdaptiveThinkingClaude(modelId: string): boolean {
  // Verified against Pioneer's Anthropic-compatible /messages endpoint:
  // Opus 4.8 accepts adaptive thinking. Opus 4.7 and Sonnet/Opus 4.6
  // currently reject the adaptive payload shape through Pioneer/Bedrock.
  return modelId === "claude-opus-4-8";
}

function isOpenAIModel(modelId: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(modelId);
}

function getPioneerApiModelId(modelId: string): string {
  return modelId === "auto" ? "pioneer/auto" : modelId;
}

function streamPioneer(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (shouldUseAnthropicMessages(model.id)) {
    const anthropicModel = {
      ...model,
      api: "anthropic-messages" as const,
      // Anthropic SDK appends /v1/messages itself. Pioneer provider baseUrl is
      // the OpenAI-compatible /v1 URL, so strip /v1 for this transport.
      baseUrl: model.baseUrl.replace(/\/v1$/, ""),
      compat: {
        ...model.compat,
        supportsTemperature: false,
        // Pioneer's /messages endpoint accepts tool `cache_control`, but keeping
        // it off avoids counting the very large pi tool schema as a fresh cache
        // write on every request. The stable system prompt and latest message
        // are still cache-marked by the Anthropic provider.
        supportsCacheControlOnTools: false,
        ...(isAdaptiveThinkingClaude(model.id)
          ? { forceAdaptiveThinking: true }
          : {}),
      },
    };

    return streamSimpleAnthropic(anthropicModel, context, {
      ...options,
      // Pioneer accepts either Authorization or x-api-key on /messages; x-api-key
      // matches their examples and avoids ambiguity with Anthropic SDK defaults.
      headers: { ...options?.headers, "x-api-key": options?.apiKey ?? "" },
      onPayload: async (payload, payloadModel) => {
        const pioneerPayload = payload && typeof payload === "object"
          ? { ...payload, model: getPioneerApiModelId(model.id) }
          : payload;
        const replacement = await options?.onPayload?.(pioneerPayload, payloadModel);
        return replacement ?? pioneerPayload;
      },
    });
  }

  return streamSimpleOpenAICompletions(model as Model<"openai-completions">, context, options);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const baseUrl =
    process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1";

  const allModels = await fetchModels(baseUrl);

  pi.registerProvider("pioneer", {
    name: "Pioneer AI",
    baseUrl,
    apiKey: "$PIONEER_API_KEY",
    authHeader: true,
    api: "pioneer",
    streamSimple: streamPioneer,

    oauth: {
      name: "Pioneer AI",
      login,
      refreshToken,
      getApiKey,
    },

    models: allModels.map(({ id, name, reasoning, contextWindow, maxTokens, cost }) => ({
      id,
      name,
      api: "pioneer",
      reasoning,
      input: ["text"],
      cost,
      contextWindow,
      maxTokens,
      // Pioneer persists every inference by default (store: true), feeding its
      // evaluation, use-case clustering, and adapter-training pipeline. pi's
      // openai-completions client only emits `store: false` when the provider
      // is known to support the `store` field, which it auto-detects from the
      // baseUrl. Pioneer's URL isn't recognized, so opt in explicitly to turn
      // off inference retention on every request.
      compat: {
        supportsStore: true,
        supportsDeveloperRole: false,
        maxTokensField: isOpenAIModel(id) ? "max_completion_tokens" : "max_tokens",
        cacheControlFormat: "anthropic",
        supportsTemperature: false,
        supportsCacheControlOnTools: false,
        ...(isAdaptiveThinkingClaude(id) ? { forceAdaptiveThinking: true } : {}),
      },
    })),
  });
}
