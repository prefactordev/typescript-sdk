---
"@prefactor/core": minor
---

Report runtime environment at agent registration. The SDK now automatically populates the optional `runtime_environment` field of `agent_version` with `prefactor_sdk` (the Prefactor packages in use), `agent_sdk` (upstream adaptor packages from the SDK header chain), `runtime` (the JavaScript runtime and version, e.g. `node@22.12.0` or `bun@1.2.3`), and `os` (the host platform). No user configuration is required.
