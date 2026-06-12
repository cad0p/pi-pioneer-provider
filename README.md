# @cad0p/pi-pioneer-provider

A [Pi](https://pi.dev) provider extension that connects to [Pioneer AI](https://pioneer.ai)'s OpenAI-compatible API.

> Fork of [`jalyfeng/pi-pioneer-provider`](https://github.com/jalyfeng/pi-pioneer-provider) that opts out of
> Pioneer's inference retention by sending `store: false` on every request (see [Privacy](#privacy)).

## Installation

Install the package via Pi's package manager:

```bash
pi install npm:@cad0p/pi-pioneer-provider
```

Or pin to a specific version:

```bash
pi install npm:@cad0p/pi-pioneer-provider@0.2.0
```

## Authentication

Choose one of the following methods:

### 1. Interactive Login (Recommended)

Run `/login` inside Pi, select **Pioneer AI**, and enter your API key when prompted. The key is stored securely by Pi's auth system.

### 2. Environment Variable

Set the `PIONEER_API_KEY` environment variable before starting Pi:

```bash
export PIONEER_API_KEY=pio_sk_xxxxxxxxxxxxxxxx
pi
```

## Supported Models

Models are discovered dynamically at startup from Pioneer's `/base-models` endpoint. Only chat-capable decoder models with inference support are exposed.

**Plus the `pioneer/auto` router model** (added statically — not exposed via `/base-models`), which automatically routes tasks to the cheapest model meeting quality thresholds.

The following model capabilities are reported:

- **Reasoning**: Enabled for all discovered models
- **Context window**: Fetched from Pioneer API. For the router model, derived dynamically as the **maximum context window among all discoverable models** (currently 1M tokens)
- **Max tokens**: Set to `min(context_window / 4, 131072)` for all models

> **Note**: The router model's limits are computed at startup from the live `/base-models` catalog. Since the router can route to any candidate model, its effective limits equal the maximum of the pool.

## Configuration

The provider uses `https://api.pioneer.ai/v1` as the default base URL. You can override it via the `PIONEER_BASE_URL` environment variable:

```bash
export PIONEER_BASE_URL=https://your-custom-endpoint.com/v1
```

## Prompt Caching

Pioneer honors prompt caching on `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, and native generate endpoints. This provider routes Pioneer Claude models, GPT/OpenAI-family models, and the `pioneer/auto` router through Pioneer's Anthropic-compatible `/v1/messages` endpoint because its usage accounting exposes cache reads and writes cleanly (`cache_read_input_tokens` / `cache_creation_input_tokens`). Other models continue to use OpenAI-compatible chat completions.

- **Claude/Anthropic models**: Sent through `/v1/messages` with Anthropic `cache_control` markers
- **OpenAI/GPT models** (GPT-4, GPT-5 families): Sent through `/v1/messages` so cached prompt tokens are reported as cache reads instead of full prompt input
- **`pioneer/auto`**: Sent through `/v1/messages` so router choices, including GPT routes, get the cleaner cache accounting

See [Pioneer's prompt caching guide](https://docs.pioneer.ai/api-reference/prompt-caching) for details.

## Usage

After installation and authentication, select a Pioneer model via `/model` or `Ctrl+L` inside Pi.

Example prompt:

```
Write a TypeScript function that fetches JSON from an API and retries on failure.
```

## Privacy

By default, Pioneer persists every inference — input, output, and metadata — to drive
evaluation, use-case clustering, and adapter training. This fork sets `compat.supportsStore: true`
on each model so Pi emits `store: false` on every request, disabling that retention.

If you *want* retention enabled, use the upstream package instead.

## Requirements

- Pi coding agent (`@earendil-works/pi-coding-agent`)
- Pioneer AI API key (starts with `pio_sk_`)

## License

MIT
