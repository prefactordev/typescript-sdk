# LangChain Provider

`@prefactor/langchain` integrates with the modern LangChain middleware API and captures model and tool execution without requiring manual callbacks. The middleware creates provider-prefixed span types, keeps parent and child relationships intact across async work, and records token usage when the underlying model response exposes usage metadata.

For model calls, the integration captures recent message context, model identity when available, output content, and token usage fields normalized into prompt, completion, and total counts. For tool calls, it records tool identity, input arguments, output values, and error outcomes when a tool throws. This gives you consistent execution traces for the parts of LangChain applications that are usually hardest to debug under load.

Current behavior is intentionally focused. Root agent spans are not emitted, and chain-level spans are not generated automatically by the middleware itself. If you want explicit trace boundaries around higher-level orchestration steps, use `withSpan` from `@prefactor/langchain` to wrap those sections manually. This keeps automatic instrumentation lightweight while still allowing detailed traces where your application needs them.
