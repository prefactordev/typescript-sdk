# Core Instrumentation

`@prefactor/core` is the foundational package for teams that want direct control over tracing behavior. It exposes runtime configuration, tracer lifecycle management, span context propagation, and transport wiring without coupling you to any specific AI framework. The provider integrations use this package internally, so building on core keeps your instrumentation model consistent with the rest of the SDK.

In practice, core is most useful when you need to instrument business-specific steps that provider middleware cannot infer, such as retrieval pipelines, ranking logic, orchestration branches, or tool execution wrappers in custom code. The `withSpan` helper is the most convenient entry point for this style because it automatically scopes async work to the active span context and records success or error outcomes in the same structure used by adapter packages.

Core configuration is validated with Zod before runtime creation. This means transport settings, sampling controls, and payload capture limits are checked at startup rather than failing later in production traffic. When you need to tune behavior, keep the provider package for automatic spans and layer core spans around your own operations so traces remain readable and complete.
