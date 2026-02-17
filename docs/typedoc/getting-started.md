# Getting Started

The quickest path to using the Prefactor SDK is to pick the provider package that matches your stack and initialize it once during app startup. Most teams start with either `@prefactor/langchain` or `@prefactor/ai`, then attach the returned middleware to existing model or agent calls. This keeps setup small and avoids any refactor of your orchestration code.

If your project uses custom runtime logic or a framework that does not yet have a dedicated adapter, `@prefactor/core` gives you the same tracing primitives used by the provider integrations. You can create a runtime with `createCore`, use `withSpan` or `Tracer.startSpan` for instrumentation, and keep span context connected across async boundaries through `SpanContext`.

A typical setup sequence is straightforward: provide transport settings through code or environment variables, initialize once, run your app normally, and call `shutdown` when your process exits so pending spans flush cleanly. The provider guides in this section describe what each integration captures automatically and where manual spans are still useful.
