# AI SDK Provider

`@prefactor/ai` instruments Vercel AI SDK model calls and supports both non-streaming and streaming execution paths. It captures model identity, selected generation settings, response completion data, tool activity, and token usage when usage metadata is present in provider responses. The middleware is designed to fit naturally into `wrapLanguageModel` workflows, so most projects can adopt it with a small initialization change.

For request data, the middleware records model settings and prompt content, with configuration flags that let you disable content capture or tool capture when data minimization is required. For response data, it captures finish reason, text content, structured content parts, and tool-call payloads when available. Tool execution spans are created for executable tools and, when tool results are present in prompt messages, those results are captured so traces remain coherent across iterative tool loops.

The integration favors resilient behavior over exhaustive provider-specific normalization. When providers omit usage fields or return shapes that do not include expected keys, spans are still emitted with the available information and no additional failures are introduced in your app runtime. For custom schemas or tighter validation, configure `httpConfig.agentSchema` in the core transport settings.
