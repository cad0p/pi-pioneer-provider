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

import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
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

  return data.models
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
    }));
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const baseUrl =
    process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1";

  const models = await fetchModels(baseUrl);

  pi.registerProvider("pioneer", {
    name: "Pioneer AI",
    baseUrl,
    apiKey: "PIONEER_API_KEY",
    authHeader: true,
    api: "openai-completions",

    oauth: {
      name: "Pioneer AI",
      login,
      refreshToken,
      getApiKey,
    },

    models: models.map(({ id, name, reasoning, contextWindow, maxTokens }) => ({
      id,
      name,
      reasoning,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
      // Pioneer persists every inference by default (store: true), feeding its
      // evaluation, use-case clustering, and adapter-training pipeline. pi's
      // openai-completions client only emits `store: false` when the provider
      // is known to support the `store` field, which it auto-detects from the
      // baseUrl. Pioneer's URL isn't recognized, so opt in explicitly to turn
      // off inference retention on every request.
      compat: { supportsStore: true },
    })),
  });
}
