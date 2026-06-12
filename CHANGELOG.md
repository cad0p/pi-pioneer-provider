# Changelog

All notable changes to this project will be documented in this file.

## [calver-released]

<!-- USER-EDITABLE SECTION START -->
Privacy fix for the `/v1/messages` transport.

**Highlights:**
- Explicitly sends `store: false` on Pioneer Anthropic-compatible `/v1/messages` requests
- Prevents Claude, GPT/OpenAI-family, and `pioneer/auto` messages calls from being persisted in Pioneer's inference database
- Keeps full-tool Pi usage working across `pioneer/auto`, `pioneer/gpt-5.5`, `pioneer/claude-opus-4-7`, and `pioneer/claude-opus-4-8`
- Adjusts Opus 4.7 compatibility by disabling Pi thinking and capping max output tokens at 65,536
<!-- USER-EDITABLE SECTION END -->

### 🐛 Bug Fixes

- Send store false on messages transport ([#12](https://github.com/cad0p/pi-pioneer-provider/pull/12))


## [0.2.1] - 2026-06-12

<!-- USER-EDITABLE SECTION START -->
Bugfix release for Pioneer prompt caching and the `pioneer/auto` router.

**Highlights:**
- Routes Claude, GPT/OpenAI-family, and `pioneer/auto` through Pioneer's `/v1/messages` endpoint for clearer cache read/write accounting
- Keeps `store: false` opt-out behavior intact
- Fixes `pioneer/auto` model naming so Pi selects it as `pioneer/auto` while Pioneer receives `pioneer/auto` upstream
- Disables Pi extended-thinking for `pioneer/auto` to avoid router-selected upstream errors; concrete Pioneer models remain reasoning-capable
<!-- USER-EDITABLE SECTION END -->

### 🐛 Bug Fixes

- Route Pioneer cacheable models via messages ([#7](https://github.com/cad0p/pi-pioneer-provider/pull/7))
- Disable thinking for Pioneer auto router ([#9](https://github.com/cad0p/pi-pioneer-provider/pull/9))

### 📚 Documentation

- Clarify `pioneer/auto` router cache and thinking caveats


## [0.2.0] - 2026-06-11

<!-- USER-EDITABLE SECTION START -->
Pioneer 1.1.4 compatibility release.

**Highlights:**
- Adds `pioneer/auto` router model (not exposed via `/base-models`, limits derived dynamically from max of all discoverable models — currently 1M context / 131k max tokens)
- New models auto-discovered from `/base-models`: Claude Fable 5, Nemotron 3 Nano/Super/Ultra, Mimo V2.5/Pro, Gemma 4 12B IT
- Keeps Pioneer inference retention disabled by sending `store: false` on every request (`compat.supportsStore: true`)
- TypeScript type checking configured (`noEmit: true` for type stripping)
<!-- USER-EDITABLE SECTION END -->

### 🚀 Features

- Pioneer 1.1.4 compatibility - add pioneer/auto router with dynamic limits ([#4](https://github.com/cad0p/pi-pioneer-provider/pull/4))

### 📚 Documentation

- Remove premature v0.2.0 changelog section from main ([#6](https://github.com/cad0p/pi-pioneer-provider/pull/6))


## [0.1.1] - 2026-05-31

<!-- USER-EDITABLE SECTION START -->
- Removes the `Deprecation warning: registerProvider("pioneer") apiKey value "PIONEER_API_KEY"` when starting pi
<!-- USER-EDITABLE SECTION END -->


### 🐛 Bug Fixes

- Correct npm scope to @cad0p (matches existing scope/username) ([#1](https://github.com/cad0p/pi-pioneer-provider/pull/1))

- Use explicit $PIONEER_API_KEY env var reference syntax ([#2](https://github.com/cad0p/pi-pioneer-provider/pull/2))


## [0.1.0]

<!-- USER-EDITABLE SECTION START -->
Initial release of the `@cad0p` fork of `pi-pioneer-provider`.

**Highlights:**
- Disables Pioneer inference retention by sending `store: false` on every request (`compat.supportsStore: true`)
- Published under the `@cad0p` npm scope
<!-- USER-EDITABLE SECTION END -->
