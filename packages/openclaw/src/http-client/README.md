# Prefactor HTTP Client

HTTP client for the Prefactor API, implementing AgentInstance and AgentSpan POST endpoints.

## Installation

This is part of the `prefactor-openclaw` package. No separate installation needed.

## Configuration

The client requires three configuration values with **no defaults**:

- `apiUrl` - Prefactor API base URL (e.g., `https://p2demo.prefactor.dev`)
- `apiToken` - Prefactor API authentication token
- `agentId` - Agent identifier for registration

Optional configuration:
- `maxRetries` - Maximum retry attempts (default: 3)
- `retryDelay` - Initial retry delay in ms (default: 1000)
- `timeout` - Request timeout in ms (default: 30000)

## Usage

### Using Environment Variables

Set environment variables:

```bash
export PREFACTOR_API_URL="https://p2demo.prefactor.dev"
export PREFACTOR_API_TOKEN="your-api-token-here"
export PREFACTOR_AGENT_ID="your-agent-id-here"
```

Create client:

```typescript
import { createClientFromEnv } from './src/http-client/index.js';

const client = createClientFromEnv();
```

With configuration overrides:

```typescript
const client = createClientFromEnv({
  maxRetries: 5,
  retryDelay: 2000,
  timeout: 60000,
});
```

### Using PrefactorClient Class Directly

```typescript
import { PrefactorClient } from './src/http-client/index.js';

const client = new PrefactorClient({
  apiUrl: 'https://p2demo.prefactor.dev',
  apiToken: 'your-api-token',
  agentId: 'your-agent-id',
  maxRetries: 3,
  retryDelay: 1000,
});
```

## API Methods

### AgentInstance Endpoints

#### Register Agent Instance

Register a new agent instance with version information.

```typescript
const instance = await client.registerAgentInstance({
  agent_id: client.agentId,
  agent_version: {
    external_identifier: 'v1.0.0',
    name: 'My Agent',
    description: 'Agent description',
  },
  agent_schema_version: {
    external_identifier: 'schema-v1',
    span_schemas: {
      llm: { /* JSON schema */ },
      tool: { /* JSON schema */ },
    },
  },
  idempotency_key: 'unique-key-123', // Optional
});

console.log(instance.id); // Agent instance ID
console.log(instance.status); // 'pending'
```

#### Start Agent Instance

Mark an agent instance as started.

```typescript
const instance = await client.startAgentInstance(instanceId, {
  timestamp: new Date().toISOString(), // Optional
  idempotency_key: 'unique-key-456', // Optional
});

console.log(instance.status); // 'active'
console.log(instance.started_at);
```

#### Finish Agent Instance

Mark an agent instance as finished with a status.

```typescript
const instance = await client.finishAgentInstance(instanceId, {
  status: 'complete', // 'complete', 'failed', or 'cancelled'
  timestamp: new Date().toISOString(), // Optional
  idempotency_key: 'unique-key-789', // Optional
});

console.log(instance.status); // 'complete'
console.log(instance.finished_at);
```

### AgentSpan Endpoints

#### Create Agent Span

Create a new span for tracking operations.

```typescript
const span = await client.createAgentSpan({
  details: {
    agent_instance_id: instanceId,
    schema_name: 'llm',
    status: 'active',
    payload: {
      model: 'gpt-4',
      prompt: 'Hello world',
    },
    parent_span_id: null, // Optional
    started_at: new Date().toISOString(), // Optional
  },
  idempotency_key: 'span-key-123', // Optional
});

console.log(span.id); // Span ID
console.log(span.status); // 'active'
```

#### Finish Agent Span

Mark a span as finished.

```typescript
const span = await client.finishAgentSpan(spanId, {
  body: {
    status: 'complete', // 'complete', 'failed', or 'cancelled'
    timestamp: new Date().toISOString(), // Optional
  },
  idempotency_key: 'span-finish-key', // Optional
});

console.log(span.status); // 'complete'
console.log(span.finished_at);
```

## Error Handling

The client throws specific error types:

```typescript
import {
  PrefactorError,
  PrefactorNetworkError,
  PrefactorTimeoutError,
  PrefactorConfigError,
} from './src/http-client/index.js';

try {
  await client.createAgentSpan({ ... });
} catch (error) {
  if (error instanceof PrefactorConfigError) {
    // Missing or invalid configuration
    console.error('Config error:', error.message);
  } else if (error instanceof PrefactorTimeoutError) {
    // Request timed out after retries
    console.error('Timeout:', error.message);
  } else if (error instanceof PrefactorNetworkError) {
    // Network connectivity issue
    console.error('Network error:', error.message);
  } else if (error instanceof PrefactorError) {
    // API error with response details
    console.error('API error:', error.message);
    console.error('Error code:', error.code);
    console.error('HTTP status:', error.statusCode);
    console.error('Response:', error.response);
  }
}
```

## Retry Logic

The client implements exponential backoff for retryable errors:

- **Retryable errors**: Network failures, 5xx server errors
- **Non-retryable errors**: 4xx client errors (validation, auth, etc.)
- **Retry delays**: 1000ms, 2000ms, 4000ms (default settings)

## Type Exports

All TypeScript types are available:

```typescript
import type {
  AgentInstanceDetails,
  AgentSpanDetails,
  RegisterAgentInstanceRequest,
  StartAgentInstanceRequest,
  FinishAgentInstanceRequest,
  CreateAgentSpanRequest,
  FinishAgentSpanRequest,
  // ... and more
} from './src/http-client/index.js';
```

## Complete Example

```typescript
import { createClientFromEnv } from './src/http-client/index.js';

async function runAgent() {
  const client = createClientFromEnv();
  
  // Register the agent instance
  const instance = await client.registerAgentInstance({
    agent_id: client.agentId,
    agent_version: {
      external_identifier: 'v1.0.0',
      name: 'Example Agent',
    },
    agent_schema_version: {
      external_identifier: 'v1',
      span_schemas: {},
    },
  });
  
  // Start the instance
  await client.startAgentInstance(instance.id, {
    timestamp: new Date().toISOString(),
  });
  
  // Create a span
  const span = await client.createAgentSpan({
    details: {
      agent_instance_id: instance.id,
      schema_name: 'llm',
      status: 'active',
      payload: { model: 'gpt-4' },
    },
  });
  
  // Do work...
  
  // Finish the span
  await client.finishAgentSpan(span.id, {
    body: { status: 'complete' },
  });
  
  // Finish the instance
  await client.finishAgentInstance(instance.id, {
    status: 'complete',
  });
}

runAgent().catch(console.error);
```
