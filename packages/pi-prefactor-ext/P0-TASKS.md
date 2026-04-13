# P0 Critical Fixes Task

**Priority**: CRITICAL - Must fix before production use  
**Files to modify**: `src/agent.ts`, `src/config.ts`

---

## TASK 1: Fix Unregistered Span Type (pi:agent_thinking)

**Problem**: The `pi:agent_thinking` span type is created in `session-state.ts` but NOT registered in the `agent.ts` schema. This causes Prefactor backend to reject these spans.

**File to fix**: `src/agent.ts` (around lines 156-200)

**Add this schema to `agentSchemaVersion.span_type_schemas` array**:

```typescript
{
  name: 'pi:agent_thinking',
  description: 'Agent reasoning/thinking content',
  template: '{{ thinking | default: "(thinking captured)" | truncate: 200 }}',
  params_schema: {
    type: 'object',
    properties: {
      thinking: { type: 'string', description: 'Thinking content' },
      tokens: { type: 'object', description: 'Token usage during thinking' },
      provider: { type: 'string', description: 'Model provider' },
      model: { type: 'string', description: 'Model ID' },
    },
  },
}
```

**Location**: Add after the `pi:assistant_response` schema in the `span_type_schemas` array.

---

## TASK 2: Fix Config Schema Mismatch

**Problem**: `getConfigSummary()` in `config.ts` references fields (`captureThinking`, `captureToolInputs`, `captureToolOutputs`) that don't exist in `configSchema`.

**File to fix**: `src/config.ts` (around lines 23-57 in the `configSchema` definition)

**Add these fields to `configSchema`** (add after `maxOutputLength` field):

```typescript
// Capture flags
captureThinking: z.boolean().default(true)
  .describe('Capture agent thinking/reasoning content'),
captureToolInputs: z.boolean().default(true)
  .describe('Capture tool input parameters'),
captureToolOutputs: z.boolean().default(true)
  .describe('Capture tool output results'),
```

---

## TASK 3: Add Missing Critical Config Options

**File to fix**: `src/config.ts` (same location as TASK 2)

**Add these additional fields to `configSchema`**:

```typescript
// Sampling
samplingRate: z.number().min(0).max(1).default(1.0)
  .describe('Sampling rate for sessions (0.0-1.0)'),

// Enable/disable
enabled: z.boolean().default(true)
  .describe('Enable/disable extension'),
```

---

## VALIDATION STEPS AFTER FIXING

1. **Build check**: Run `bun run build` or `bun run typecheck`
2. **Verify extension loads**: Check logs for `[pi-prefactor:config_loaded]` without errors
3. **Test with simple question**: Ask "What files are in this directory?"
4. **Verify spans in Prefactor**:
   ```bash
   cd /home/sprite/typescript-sdk/packages/cli
   ./dist/bin/cli.js agent_instances list --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa
   ```
   Look for recent instance with status 'active'

5. **Run config command**: `/prefactor-config` should show all config fields

---

## COMMIT MESSAGE

After completing all 3 fixes:

```
fix: Add P0 critical fixes - thinking schema, config fields

- Add pi:agent_thinking to span type schemas (was causing silent data loss)
- Add captureThinking, captureToolInputs, captureToolOutputs to config schema
- Add samplingRate and enabled config options
- Fixes critical issues from CRITICAL-REVIEW.md
```

---

## AFTER COMMITTING

Ask: **"All 3 P0 fixes complete. Ready for validation?"**

I will then verify the fixes using the Prefactor CLI and test the extension.
