# pi-pioneer-provider

A [Pi](https://pi.dev) provider extension that connects to [Pioneer AI](https://pioneer.ai)'s OpenAI-compatible API.

## Installation

Install the package via Pi's package manager:

```bash
pi install npm:pi-pioneer-provider
```

Or pin to a specific version:

```bash
pi install npm:pi-pioneer-provider@1.0.0
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

The following model capabilities are reported:

- **Reasoning**: Enabled for all discovered models
- **Context window**: Fetched from Pioneer API
- **Max tokens**: Set to `min(context_window / 4, 131072)`

## Configuration

The provider uses `https://api.pioneer.ai/v1` as the default base URL. You can override it via the `PIONEER_BASE_URL` environment variable:

```bash
export PIONEER_BASE_URL=https://your-custom-endpoint.com/v1
```

## Usage

After installation and authentication, select a Pioneer model via `/model` or `Ctrl+L` inside Pi.

Example prompt:

```
Write a TypeScript function that fetches JSON from an API and retries on failure.
```

## Requirements

- Pi coding agent (`@earendil-works/pi-coding-agent`)
- Pioneer AI API key (starts with `pio_sk_`)

## License

MIT
