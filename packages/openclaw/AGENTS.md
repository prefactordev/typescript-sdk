# Agent Instructions - Prefactor Plugin

## Project Overview
This is a TypeScript Node.js plugin for OpenClaw that hooks into lifecycle events for monitoring and instrumentation.

## Build/Lint/Test Commands

### Standard Commands
- **Build**: No build step needed - OpenClaw loads TypeScript directly via jiti
- **Lint**: Use TypeScript compiler for type checking: `npx tsc --noEmit`
- **Test**: No test framework configured yet (manual testing via OpenClaw CLI)

### Single Test Verification
```bash
# Test specific hook by triggering scenario
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:HOOK_NAME\]"

# Example: Test before_tool_call
openclaw agent -m "Read file README.md" --agent main
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:before_tool_call\]"
```

### Gateway Management (Sprite)
```bash
# Start/stop/restart
sprite-env services start openclaw
sprite-env services stop openclaw
sprite-env services restart openclaw

# View logs
sprite-env services logs openclaw  # if supported
cat /.sprite/logs/services/openclaw.log | tail -50
```

## Code Style Guidelines

### Imports
- Use ES modules (`"type": "module"` in package.json)
- Use `.js` extension for local imports (TypeScript with jiti): `import { foo } from './bar.js'`
- Node built-ins: `import { randomUUID } from 'crypto'`
- Group imports: 1) Node built-ins, 2) npm packages, 3) local modules

### Formatting
- 2 spaces indentation
- Single quotes for strings
- Trailing commas in objects/arrays
- Max line length: 100 characters
- Semicolons required

### Types
- Use TypeScript interfaces for contexts
- Always type function parameters and return types
- Use `unknown` over `any` for flexible types
- Prefer explicit typing over inference for public APIs

```typescript
// Good
interface ToolContext {
  sessionKey: string;
  toolName: string;
  params?: unknown;
}

// Bad
interface ToolContext {
  sessionKey: any;
  toolName: any;
  params?: any;
}
```

### Naming Conventions
- **Files**: kebab-case for multi-word (e.g., `openclaw.plugin.json`)
- **Functions**: camelCase (e.g., `createLogger()`)
- **Classes/Interfaces**: PascalCase (e.g., `Logger`, `PluginAPI`)
- **Constants**: UPPER_SNAKE_CASE or camelCase depending on scope
- **Plugin hooks**: snake_case matching OpenClaw convention (e.g., `before_agent_start`)

### Error Handling
- Never throw errors in hooks - log and continue
- Use try/catch for external operations
- Graceful degradation: hooks should not break core functionality

```typescript
// Good
api.on('some_hook', (ctx) => {
  try {
    riskyOperation(ctx);
  } catch (err) {
    logger.error('hook_failed', { error: err.message });
    // Continue without throwing
  }
});
```

### Logging
- Use structured logging format: `[prefactor:EVENT_NAME] key=value key2=value2`
- Log levels: debug, info, warn, error
- Never log sensitive data (API keys, tokens, personal data)
- Tool calls: log tool name only, not parameters

### Plugin Structure
```typescript
// Main entry: index.ts
export default function register(api: PluginAPI) {
  // 1. Initialize from config
  // 2. Register all hooks
  // 3. Log registration
}

// Separate utilities into src/
```

## Hook Implementation Pattern

```typescript
// Always type the context, use unknown for flexibility
api.on('hook_name', (_ctx: unknown) => {
  const ctx = _ctx as HookContext;
  const sessionKey = ctx?.sessionKey || 'unknown';
  
  // Log event
  logger.info('hook_name', {
    sessionKey,
    // other relevant fields
  });
  
  // Update metrics if enabled
  if (metrics.isEnabled()) {
    metrics.recordEvent('hook_name');
  }
  
  // Return value only if hook expects it (e.g., tool_result_persist)
  return ctx?.result;
});
```

## Configuration
- Plugin config in `~/.openclaw/openclaw.json` under `plugins.entries`
- Schema validation in `openclaw.plugin.json`
- Environment: Sprite VM with openclaw gateway service

## Testing Checklist
When modifying hooks, verify:
- [ ] Hook logs with `[prefactor:HOOK_NAME]` prefix
- [ ] No sensitive data in logs
- [ ] Metrics updated if enabled
- [ ] No errors thrown
- [ ] Gateway starts without warnings
- [ ] Check logs: `cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:"`

## Important Notes
- No build step - TypeScript loaded directly by OpenClaw
- Console.log goes to gateway logs (captured by sprite)
- Plugin runs in-process with gateway - treat as trusted code
- All 13 lifecycle hooks must be registered in index.ts
