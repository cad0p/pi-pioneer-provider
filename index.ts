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
  streamSimple,
  type Api,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessageEventStream,
  AssistantMessage,
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
      maxTokens: getPioneerMaxTokens(m.id, m.context_window),
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
    // Pioneer's /messages router can select upstreams that reject Anthropic
    // extended-thinking payloads. Fresh interactive Pi sessions with
    // `--thinking high` produced a message_start followed by an upstream error
    // and no assistant text. Keep compatible concrete models reasoning-capable,
    // but disable Pi thinking controls for the auto router.
    reasoning: false,
    contextWindow: maxContextWindow,
    // The router can choose cheaper/smaller backends than the max-context pool.
    // Advertising 131k output caused real resumed sessions to fail upstream when
    // prompt tokens plus requested output exceeded the selected backend's budget.
    // Keep direct models at their catalog-derived caps; keep auto conservative.
    maxTokens: Math.min(maxTokens, 32768),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  return [routerModel, ...discovered];
}

// ---------------------------------------------------------------------------
// Provider transport selection
// ---------------------------------------------------------------------------

function getPioneerMaxTokens(_modelId: string, contextWindow: number): number {
  return Math.min(contextWindow >> 2, 128000);
}

function isClaudeModel(modelId: string): boolean {
  return modelId.startsWith("claude-");
}

function shouldUseAnthropicMessages(modelId: string): boolean {
  return modelId === "auto" || isClaudeModel(modelId);
}

function shouldUseOpenAIResponses(modelId: string): boolean {
  return isOpenAIModel(modelId);
}

function isAdaptiveThinkingClaude(modelId: string): boolean {
  // Verified against Pioneer's Anthropic-compatible /messages endpoint:
  // Opus 4.8 accepts adaptive thinking. Opus 4.7 currently rejects
  // budget-based thinking through Pioneer/Bedrock.
  return modelId === "claude-opus-4-8";
}

function supportsPioneerThinking(modelId: string): boolean {
  return modelId !== "auto" && modelId !== "claude-opus-4-7";
}

function isOpenAIModel(modelId: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(modelId);
}

function getPioneerApiModelId(modelId: string): string {
  return modelId === "auto" ? "pioneer/auto" : modelId;
}

function pioneerCacheControlOnToolsDisabled(): boolean {
  const value = process.env.PIONEER_CACHE_TOOLS;
  return value === "0" || value?.toLowerCase() === "false" ||
    value?.toLowerCase() === "no" || value?.toLowerCase() === "off";
}

function isLikelyAnthropicThinkingSignature(signature: unknown): boolean {
  return typeof signature === "string" &&
    signature.length > 64 &&
    !/\s/.test(signature) &&
    signature !== "reasoning" &&
    signature !== "reasoning_content";
}

function sanitizeContextForPioneerMessages(context: Context): Context {
  return {
    ...context,
    messages: context.messages.map((message) => {
      if (message.role !== "assistant") return message;

      const content: AssistantMessage["content"] = [];
      for (const block of message.content) {
        if (block.type !== "thinking") {
          content.push(block);
          continue;
        }
        if (isLikelyAnthropicThinkingSignature(block.thinkingSignature)) {
          content.push(block);
          continue;
        }
        if (block.thinking.trim().length === 0) continue;

        // Pi sessions can contain thinking blocks from OpenAI-compatible
        // providers where `thinkingSignature` is a field name such as
        // `reasoning_content`, not an Anthropic encrypted signature. Passing
        // that back through /messages can make the selected upstream reject the
        // whole request. Replaying it as plain text is the safe cross-provider
        // handoff behavior and matches pi-ai's own missing-signature fallback.
        content.push({ type: "text", text: block.thinking });
      }

      return { ...message, content };
    }),
  };
}

function isZaiGlmModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("zai-org/") ||
    /^glm-\d/i.test(modelId);
}

function cloneForPioneerTransport<TApi extends Api>(
  model: Model<any>,
  api: TApi,
): Model<TApi> {
  return { ...model, api } as Model<TApi>;
}

function pioneerPayload(payload: unknown, modelId: string): unknown {
  return payload && typeof payload === "object"
    ? { ...payload, model: getPioneerApiModelId(modelId), store: false }
    : payload;
}

async function replacePayloadWithPioneerModel(
  modelId: string,
  options: SimpleStreamOptions | undefined,
  payload: unknown,
  payloadModel: Model<Api>,
): Promise<unknown> {
  const pioneerPayloadValue = pioneerPayload(payload, modelId);
  const replacement = await options?.onPayload?.(pioneerPayloadValue, payloadModel);
  return replacement ?? pioneerPayloadValue;
}

function passThroughOriginalPayloadModel(
  model: Model<any>,
  options: SimpleStreamOptions | undefined,
): SimpleStreamOptions | undefined {
  if (!options?.onPayload) return options;
  return {
    ...options,
    onPayload: async (payload, _payloadModel) =>
      options.onPayload?.(payload, model),
  };
}

function streamPioneer(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (shouldUseOpenAIResponses(model.id)) {
    return streamSimple(
      cloneForPioneerTransport(model, "openai-responses"),
      context,
      {
        ...options,
        onPayload: (_payload, payloadModel) =>
          replacePayloadWithPioneerModel(model.id, options, _payload, payloadModel),
      },
    );
  }

  if (shouldUseAnthropicMessages(model.id)) {
    const anthropicModel = cloneForPioneerTransport(
      {
        ...model,
        // Anthropic SDK appends /v1/messages itself. Pioneer provider baseUrl is
        // the OpenAI-compatible /v1 URL, so strip /v1 for this transport.
        baseUrl: model.baseUrl.replace(/\/v1$/, ""),
        compat: {
          ...model.compat,
          supportsTemperature: false,
          // Default to on. Set PIONEER_CACHE_TOOLS=0/"false"/"no"/"off" to
          // avoid counting the very large pi tool schema as a fresh cache write.
          supportsCacheControlOnTools: !pioneerCacheControlOnToolsDisabled(),
          ...(isAdaptiveThinkingClaude(model.id)
            ? { forceAdaptiveThinking: true }
            : {}),
        },
      },
      "anthropic-messages",
    );

    return streamSimple(anthropicModel, sanitizeContextForPioneerMessages(context), {
      ...options,
      // Pioneer accepts either Authorization or x-api-key on /messages; x-api-key
      // matches their examples and avoids ambiguity with Anthropic SDK defaults.
      headers: { ...options?.headers, "x-api-key": options?.apiKey ?? "" },
      onPayload: (_payload, payloadModel) =>
        replacePayloadWithPioneerModel(model.id, options, _payload, payloadModel),
    });
  }

  return streamSimple(
    cloneForPioneerTransport(model, "openai-completions"),
    context,
    passThroughOriginalPayloadModel(model, options),
  );
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
      reasoning: reasoning && supportsPioneerThinking(id),
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
        supportsDeveloperRole: isOpenAIModel(id),
        maxTokensField: isOpenAIModel(id) ? "max_completion_tokens" : "max_tokens",
        cacheControlFormat: "anthropic",
        supportsTemperature: false,
        supportsCacheControlOnTools: !pioneerCacheControlOnToolsDisabled(),
        ...(isZaiGlmModel(id) ? { thinkingFormat: "zai" as const } : {}),
        ...(isAdaptiveThinkingClaude(id) ? { forceAdaptiveThinking: true } : {}),
      },
    })),
  });
}
