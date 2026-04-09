# Configuration Guide

How to configure the pi-prefactor extension with Prefactor API credentials.

---

## Configuration Methods

Pi extensions support **three** configuration methods (in priority order):

1. **Environment Variables** (simplest, works everywhere)
2. **Package Configuration** via `settings.json` (pi-specific, supports UI hints)
3. **Hybrid Approach** (env vars as fallbacks, package config for overrides)

---

## Method 1: Environment Variables (Recommended for Development)

### Setup

```bash
export PREFACTOR_API_URL=https://app.prefactorai.com
export PREFACTOR_API_TOKEN=your-api-token
export PREFACTOR_AGENT_ID=your-agent-id
export PREFACTOR_AGENT_NAME="Pi Agent"
export PREFACTOR_LOG_LEVEL=info
```

### Usage in Extension

```typescript
// src/config.ts
import { z } from 'zod';

const configSchema = z.object({
  apiUrl: z.string().url(),
  apiToken: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().default('Pi Agent'),
  agentVersion: z.string().default('default'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  userInteractionTimeoutMinutes: z.number().positive().default(5),
  sessionTimeoutHours: z.number().positive().default(24),
});

export function loadConfig() {
  const config = configSchema.parse({
    apiUrl: process.env.PREFACTOR_API_URL,
    apiToken: process.env.PREFACTOR_API_TOKEN,
    agentId: process.env.PREFACTOR_AGENT_ID,
    agentName: process.env.PREFACTOR_AGENT_NAME,
    agentVersion: process.env.PREFACTOR_AGENT_VERSION,
    logLevel: process.env.PREFACTOR_LOG_LEVEL,
    userInteractionTimeoutMinutes: process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES
      ? parseInt(process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES, 10)
      : undefined,
    sessionTimeoutHours: process.env.PREFACTOR_SESSION_TIMEOUT_HOURS
      ? parseInt(process.env.PREFACTOR_SESSION_TIMEOUT_HOURS, 10)
      : undefined,
  });

  return config;
}
```

### Pros
- ✅ Simple, works immediately
- ✅ No pi-specific configuration needed
- ✅ Easy to test with `pi -e ./test-harness.ts`
- ✅ Standard across all Node.js apps

### Cons
- ❌ Not visible in pi UI
- ❌ No validation feedback to user
- ❌ Must be set in shell environment

---

## Method 2: Package Configuration via settings.json

### Setup

Edit `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "packages": [
    {
      "id": "pi-prefactor",
      "path": "/home/sprite/typescript-sdk/packages/pi-prefactor-ext",
      "config": {
        "apiUrl": "https://app.prefactorai.com",
        "apiToken": "your-api-token",
        "agentId": "your-agent-id",
        "agentName": "Pi Agent",
        "logLevel": "info"
      }
    }
  ]
}
```

### Usage in Extension

```typescript
// src/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { z } from 'zod';

const configSchema = z.object({
  apiUrl: z.string().url().optional(),
  apiToken: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string().default('Pi Agent'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export default function prefactorExtension(pi: ExtensionAPI) {
  // Get config from package configuration
  const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
  
  const config = configSchema.parse({
    ...packageConfig,
    // Fallback to env vars if not in package config
    apiUrl: packageConfig.apiUrl ?? process.env.PREFACTOR_API_URL,
    apiToken: packageConfig.apiToken ?? process.env.PREFACTOR_API_TOKEN,
    agentId: packageConfig.agentId ?? process.env.PREFACTOR_AGENT_ID,
  });

  // Validate required fields
  if (!config.apiUrl || !config.apiToken || !config.agentId) {
    console.error('[pi-prefactor] Missing required configuration');
    console.error('[pi-prefactor] Set PREFACTOR_API_URL, PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID');
    console.error('[pi-prefactor] Or configure in settings.json packages[].config');
    return;
  }

  // Use config...
}
```

### Pros
- ✅ Integrated with pi's package system
- ✅ Configuration visible in settings.json
- ✅ Can be version-controlled (project-level)
- ✅ Supports different configs per project

### Cons
- ❌ Requires pi package system setup
- ❌ No built-in UI for configuration (yet)
- ❌ `pi.getPackageConfig()` may not be available in all pi versions

---

## Method 3: Hybrid Approach (Recommended for Production)

Combine both methods: package config with env var fallbacks.

### Implementation

```typescript
// src/config.ts
import { z } from 'zod';

const configSchema = z.object({
  apiUrl: z.string().url(),
  apiToken: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().default('Pi Agent'),
  agentVersion: z.string().default('default'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  userInteractionTimeoutMinutes: z.number().positive().default(5),
  sessionTimeoutHours: z.number().positive().default(24),
  captureThinking: z.boolean().default(true),
  captureToolInputs: z.boolean().default(true),
  captureToolOutputs: z.boolean().default(true),
});

export type PrefactorConfig = z.infer<typeof configSchema>;

export function loadConfig(packageConfig?: Record<string, unknown>): PrefactorConfig {
  // Merge: package config > env vars > defaults
  const merged = {
    apiUrl: packageConfig?.apiUrl ?? process.env.PREFACTOR_API_URL,
    apiToken: packageConfig?.apiToken ?? process.env.PREFACTOR_API_TOKEN,
    agentId: packageConfig?.agentId ?? process.env.PREFACTOR_AGENT_ID,
    agentName: packageConfig?.agentName ?? process.env.PREFACTOR_AGENT_NAME ?? 'Pi Agent',
    agentVersion: packageConfig?.agentVersion ?? process.env.PREFACTOR_AGENT_VERSION ?? 'default',
    logLevel: packageConfig?.logLevel ?? process.env.PREFACTOR_LOG_LEVEL ?? 'info',
    userInteractionTimeoutMinutes: 
      packageConfig?.userInteractionTimeoutMinutes ?? 
      (process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES 
        ? parseInt(process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES, 10) 
        : 5),
    sessionTimeoutHours: 
      packageConfig?.sessionTimeoutHours ?? 
      (process.env.PREFACTOR_SESSION_TIMEOUT_HOURS 
        ? parseInt(process.env.PREFACTOR_SESSION_TIMEOUT_HOURS, 10) 
        : 24),
    captureThinking: packageConfig?.captureThinking ?? 
      (process.env.PREFACTOR_CAPTURE_THINKING === 'false' ? false : true),
    captureToolInputs: packageConfig?.captureToolInputs ?? 
      (process.env.PREFACTOR_CAPTURE_TOOL_INPUTS === 'false' ? false : true),
    captureToolOutputs: packageConfig?.captureToolOutputs ?? 
      (process.env.PREFACTOR_CAPTURE_TOOL_OUTPUTS === 'false' ? false : true),
  };

  return configSchema.parse(merged);
}

export function validateConfig(config: PrefactorConfig): { ok: boolean; error?: string } {
  if (!config.apiUrl) {
    return { ok: false, error: 'Missing PREFACTOR_API_URL' };
  }
  if (!config.apiToken) {
    return { ok: false, error: 'Missing PREFACTOR_API_TOKEN' };
  }
  if (!config.agentId) {
    return { ok: false, error: 'Missing PREFACTOR_AGENT_ID' };
  }
  return { ok: true };
}
```

### Usage in Extension

```typescript
// src/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, validateConfig } from './config.js';

export default function prefactorExtension(pi: ExtensionAPI) {
  // Try to get package config (if available)
  const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
  
  // Load merged config
  const config = loadConfig(packageConfig);
  
  // Validate
  const validation = validateConfig(config);
  if (!validation.ok) {
    console.error(`[pi-prefactor] Configuration error: ${validation.error}`);
    console.error('[pi-prefactor] Extension will not instrument spans');
    console.error('[pi-prefactor] Set environment variables or configure in settings.json');
    
    // Still register a command to help user configure
    pi.registerCommand('prefactor-config', {
      description: 'Show Prefactor extension configuration status',
      handler: async (_args, ctx) => {
        const msg = `Prefactor Configuration Status:\n\n` +
          `❌ ${validation.error}\n\n` +
          `Required environment variables:\n` +
          `- PREFACTOR_API_URL\n` +
          `- PREFACTOR_API_TOKEN\n` +
          `- PREFACTOR_AGENT_ID\n\n` +
          `Or configure in settings.json packages[].config`;
        
        if (ctx.hasUI) {
          ctx.ui.notify(msg, 'error');
        } else {
          console.log(msg);
        }
      },
    });
    
    return;
  }
  
  // Config is valid, proceed with initialization
  console.log('[pi-prefactor] Configuration loaded successfully');
  console.log(`[pi-prefactor] API URL: ${config.apiUrl}`);
  console.log(`[pi-prefactor] Agent ID: ${config.agentId}`);
  console.log(`[pi-prefactor] Log Level: ${config.logLevel}`);
  
  // Initialize agent, session manager, etc.
  // ... rest of extension code
}
```

---

## Configuration with Package Metadata (Advanced)

For a more integrated experience, add package metadata to enable pi's configuration UI:

### package.json

```json
{
  "name": "@prefactor/pi-prefactor-ext",
  "version": "0.0.1",
  "type": "module",
  "pi": {
    "extensions": ["./src/index.ts"],
    "config": {
      "schema": {
        "type": "object",
        "properties": {
          "apiUrl": {
            "type": "string",
            "description": "Prefactor API URL",
            "default": "https://app.prefactorai.com"
          },
          "apiToken": {
            "type": "string",
            "description": "Prefactor API token",
            "sensitive": true
          },
          "agentId": {
            "type": "string",
            "description": "Agent ID in Prefactor"
          },
          "agentName": {
            "type": "string",
            "description": "Human-readable agent name",
            "default": "Pi Agent"
          },
          "logLevel": {
            "type": "string",
            "enum": ["debug", "info", "warn", "error"],
            "default": "info"
          }
        },
        "required": ["apiUrl", "apiToken", "agentId"]
      }
    }
  },
  "dependencies": {
    "@prefactor/core": "workspace:*",
    "zod": "^3.0.0"
  }
}
```

---

## Complete Example: config.ts

```typescript
// src/config.ts
import { z } from 'zod';

/**
 * Prefactor extension configuration.
 * Supports both environment variables and package configuration.
 */
export const configSchema = z.object({
  // Required
  apiUrl: z.string().url().describe('Prefactor API URL'),
  apiToken: z.string().min(1).describe('Prefactor API token'),
  agentId: z.string().min(1).describe('Agent ID registered in Prefactor'),
  
  // Optional with defaults
  agentName: z.string().default('Pi Agent').describe('Human-readable agent name'),
  agentVersion: z.string().default('default').describe('Agent version suffix'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Timeouts
  userInteractionTimeoutMinutes: z.number().positive().default(5)
    .describe('Timeout for user interaction spans'),
  sessionTimeoutHours: z.number().positive().default(24)
    .describe('Timeout for session spans'),
  
  // Capture flags
  captureThinking: z.boolean().default(true)
    .describe('Capture agent thinking/reasoning content'),
  captureToolInputs: z.boolean().default(true)
    .describe('Capture tool call inputs'),
  captureToolOutputs: z.boolean().default(true)
    .describe('Capture tool call outputs'),
  
  // Payload limits
  maxInputLength: z.number().positive().default(10000)
    .describe('Maximum input payload length to capture'),
  maxOutputLength: z.number().positive().default(10000)
    .describe('Maximum output payload length to capture'),
});

export type PrefactorConfig = z.infer<typeof configSchema>;

/**
 * Load configuration from environment variables and/or package config.
 * Priority: package config > environment variables > defaults
 */
export function loadConfig(packageConfig?: Record<string, unknown>): PrefactorConfig {
  const merged = {
    apiUrl: packageConfig?.apiUrl ?? process.env.PREFACTOR_API_URL,
    apiToken: packageConfig?.apiToken ?? process.env.PREFACTOR_API_TOKEN,
    agentId: packageConfig?.agentId ?? process.env.PREFACTOR_AGENT_ID,
    agentName: packageConfig?.agentName ?? process.env.PREFACTOR_AGENT_NAME ?? 'Pi Agent',
    agentVersion: packageConfig?.agentVersion ?? process.env.PREFACTOR_AGENT_VERSION ?? 'default',
    logLevel: packageConfig?.logLevel ?? process.env.PREFACTOR_LOG_LEVEL ?? 'info',
    userInteractionTimeoutMinutes: 
      packageConfig?.userInteractionTimeoutMinutes ?? 
      (process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES 
        ? parseInt(process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES, 10) 
        : 5),
    sessionTimeoutHours: 
      packageConfig?.sessionTimeoutHours ?? 
      (process.env.PREFACTOR_SESSION_TIMEOUT_HOURS 
        ? parseInt(process.env.PREFACTOR_SESSION_TIMEOUT_HOURS, 10) 
        : 24),
    captureThinking: packageConfig?.captureThinking ?? 
      (process.env.PREFACTOR_CAPTURE_THINKING === 'false' ? false : true),
    captureToolInputs: packageConfig?.captureToolInputs ?? 
      (process.env.PREFACTOR_CAPTURE_TOOL_INPUTS === 'false' ? false : true),
    captureToolOutputs: packageConfig?.captureToolOutputs ?? 
      (process.env.PREFACTOR_CAPTURE_TOOL_OUTPUTS === 'false' ? false : true),
    maxInputLength: packageConfig?.maxInputLength ?? 
      (process.env.PREFACTOR_MAX_INPUT_LENGTH 
        ? parseInt(process.env.PREFACTOR_MAX_INPUT_LENGTH, 10) 
        : 10000),
    maxOutputLength: packageConfig?.maxOutputLength ?? 
      (process.env.PREFACTOR_MAX_OUTPUT_LENGTH 
        ? parseInt(process.env.PREFACTOR_MAX_OUTPUT_LENGTH, 10) 
        : 10000),
  };

  return configSchema.parse(merged);
}

/**
 * Validate that required configuration is present.
 */
export function validateConfig(config: PrefactorConfig): { 
  ok: boolean; 
  error?: string;
  missing?: string[];
} {
  const missing: string[] = [];
  
  if (!config.apiToken) missing.push('PREFACTOR_API_TOKEN');
  if (!config.agentId) missing.push('PREFACTOR_AGENT_ID');
  
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required configuration: ${missing.join(', ')}`,
      missing,
    };
  }
  
  return { ok: true };
}

/**
 * Get configuration summary for logging/debugging.
 * Hides sensitive values (apiToken).
 */
export function getConfigSummary(config: PrefactorConfig): Record<string, unknown> {
  return {
    apiUrl: config.apiUrl,
    agentId: config.agentId,
    agentName: config.agentName,
    agentVersion: config.agentVersion,
    logLevel: config.logLevel,
    userInteractionTimeoutMinutes: config.userInteractionTimeoutMinutes,
    sessionTimeoutHours: config.sessionTimeoutHours,
    captureThinking: config.captureThinking,
    captureToolInputs: config.captureToolInputs,
    captureToolOutputs: config.captureToolOutputs,
    apiToken: config.apiToken ? '***' + config.apiToken.slice(-4) : undefined,
  };
}
```

---

## Usage in Main Extension

```typescript
// src/index.ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig, validateConfig, getConfigSummary } from './config.js';
import { createLogger } from './logger.js';
import { createAgent } from './agent.js';
import { createSessionStateManager } from './session-state.js';

export default function prefactorExtension(pi: ExtensionAPI) {
  // Load configuration
  const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
  const config = loadConfig(packageConfig);
  
  // Validate
  const validation = validateConfig(config);
  if (!validation.ok) {
    console.error('[pi-prefactor] Configuration error:', validation.error);
    console.error('[pi-prefactor] Required:', validation.missing?.join(', '));
    console.error('[pi-prefactor] Extension will not instrument spans');
    
    // Register help command
    registerConfigCommand(pi, config);
    return;
  }
  
  // Initialize logger
  const logger = createLogger(config.logLevel);
  logger.info('config_loaded', getConfigSummary(config));
  
  // Initialize Prefactor agent HTTP client
  const agent = createAgent({
    apiUrl: config.apiUrl,
    apiToken: config.apiToken,
    agentId: config.agentId,
    agentName: config.agentName,
    agentVersion: config.agentVersion,
  }, logger);
  
  // Initialize session state manager
  const sessionManager = createSessionStateManager(agent, logger, {
    userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
    sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
  });
  
  // Register all hooks...
  registerHooks(pi, sessionManager, logger, config);
  
  // Register configuration command
  registerConfigCommand(pi, config);
  
  logger.info('extension_initialized');
}

function registerConfigCommand(pi: ExtensionAPI, config: PrefactorConfig) {
  pi.registerCommand('prefactor-config', {
    description: 'Show Prefactor extension configuration',
    handler: async (_args, ctx) => {
      const summary = getConfigSummary(config);
      const validation = validateConfig(config);
      
      const msg = `Prefactor Extension Configuration:\n\n` +
        `Status: ${validation.ok ? '✅ Valid' : '❌ Invalid'}\n\n` +
        Object.entries(summary)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join('\n');
      
      if (ctx.hasUI) {
        ctx.ui.notify(msg, validation.ok ? 'info' : 'error');
      } else {
        console.log(msg);
      }
    },
  });
}
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PREFACTOR_API_URL` | ❌ | `https://app.prefactorai.com` | Prefactor API URL |
| `PREFACTOR_API_TOKEN` | ✅ | - | Prefactor API token |
| `PREFACTOR_AGENT_ID` | ✅ | - | Agent ID registered in Prefactor |
| `PREFACTOR_AGENT_NAME` | ❌ | `Pi Agent` | Human-readable agent name |
| `PREFACTOR_AGENT_VERSION` | ❌ | `default` | Agent version suffix |
| `PREFACTOR_LOG_LEVEL` | ❌ | `info` | Logging level (debug/info/warn/error) |
| `PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES` | ❌ | `5` | User interaction span timeout |
| `PREFACTOR_SESSION_TIMEOUT_HOURS` | ❌ | `24` | Session span timeout |
| `PREFACTOR_CAPTURE_THINKING` | ❌ | `true` | Capture agent thinking content |
| `PREFACTOR_CAPTURE_TOOL_INPUTS` | ❌ | `true` | Capture tool call inputs |
| `PREFACTOR_CAPTURE_TOOL_OUTPUTS` | ❌ | `true` | Capture tool call outputs |
| `PREFACTOR_MAX_INPUT_LENGTH` | ❌ | `10000` | Max input payload length |
| `PREFACTOR_MAX_OUTPUT_LENGTH` | ❌ | `10000` | Max output payload length |

---

## Quick Start

### Development (Env Vars)

```bash
# Set environment variables
export PREFACTOR_API_URL=https://app.prefactorai.com
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id

# Run with test harness
pi -e ./test-harness.ts
```

### Production (Package Config)

Edit `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "id": "pi-prefactor",
      "path": "/path/to/pi-prefactor-ext",
      "config": {
        "apiUrl": "https://app.prefactorai.com",
        "apiToken": "your-token",
        "agentId": "your-agent-id",
        "logLevel": "info"
      }
    }
  ]
}
```

Then in pi:
```
/reload
/prefactor-config  # Verify configuration
```

---

## Security Notes

⚠️ **Never commit API tokens to version control!**

- Use environment variables for sensitive values
- Add `.env` to `.gitignore`
- Use project-local `.pi/settings.json` (not committed) for configs
- Mark `apiToken` as `sensitive: true` in package schema

---

## Troubleshooting

### "Missing required configuration"

1. Check environment variables:
   ```bash
   echo $PREFACTOR_API_URL
   echo $PREFACTOR_API_TOKEN
   echo $PREFACTOR_AGENT_ID
   ```

2. Or check `settings.json` package config

3. Run `/prefactor-config` in pi to see current status

### Configuration not loading

1. Restart pi after changing environment variables
2. Run `/reload` after changing `settings.json`
3. Check extension is in correct location

### Token authentication fails

1. Verify token is correct (no extra whitespace)
2. Check token hasn't expired
3. Verify API URL is correct
