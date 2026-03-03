# Configuration and Environment Variables

SDK configuration can be provided in code, through environment variables, or as a combination of both. Programmatic values take precedence, while environment variables provide deployment-friendly defaults. This pattern allows local development and production deployments to share the same initialization path with minimal branching.

Core runtime controls include:

- `PREFACTOR_TRANSPORT`: selects the transport implementation used by SDK `init`/config creation logic (currently `http` from the transport selection path). Default is `http` when unset. If you provide `transportType` programmatically, that value takes precedence over `PREFACTOR_TRANSPORT`.
- `PREFACTOR_SAMPLE_RATE`: sets trace sampling from `0` to `1`.
- `PREFACTOR_CAPTURE_INPUTS` and `PREFACTOR_CAPTURE_OUTPUTS`: control whether input and output payloads are recorded.
- `PREFACTOR_MAX_INPUT_LENGTH` and `PREFACTOR_MAX_OUTPUT_LENGTH`: limit serialized payload sizes to keep telemetry bounded.
- `PREFACTOR_LOG_LEVEL`: controls SDK log verbosity (`debug`, `info`, `warn`, `error`) as consumed by the logger configuration. Default is `info` when unset or invalid. Unlike tracing config fields, log level is not part of the main `Config` object, so there is no `init` config override for it; it is driven by logging configuration/environment handling.
- `PREFACTOR_API_URL` and `PREFACTOR_API_TOKEN`: configure HTTP transport connection, with optional identifiers such as `PREFACTOR_AGENT_ID`, `PREFACTOR_AGENT_NAME`, and `PREFACTOR_AGENT_IDENTIFIER` to label agent instances.

Retry behavior can also be tuned for network conditions through HTTP config fields like `maxRetries`, `initialRetryDelay`, `maxRetryDelay`, and `retryMultiplier`, or via `PREFACTOR_RETRY_ON_STATUS_CODES` for status-code matching. In most applications, the default retry profile is sufficient, so the best practice is to begin with defaults, observe behavior, and only adjust values when operational data shows a clear need.
