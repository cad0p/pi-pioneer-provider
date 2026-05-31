# Changelog

All notable changes to this project will be documented in this file.

## [calver-released]

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
