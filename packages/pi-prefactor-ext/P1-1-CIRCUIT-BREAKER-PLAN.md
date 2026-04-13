# P1-1: Circuit Breaker for API Failures

**Priority**: HIGH (v0.0.2)  
**Effort**: ~1-2 hours  
**Status**: Planning  

---

## Problem Statement

### Current Behavior

When the Prefactor API is unavailable (network issues, API downtime, rate limiting), span creation fails silently:

```typescript
async createSpan(...) {
  try {
    const spanId = await this.api.post('/spans', payload);
    return spanId;
  } catch (err) {
    this.logger.error('span_creation_failed', { sessionKey, schemaName });
    return null;  // ← Silent failure
  }
}
```

**Consequences**:
1. **Silent data loss** - Spans not created, user has no idea
2. **No backpressure** - Continues hammering failing API
3. **Resource waste** - Every span creation attempt costs CPU/network
4. **Poor UX** - No visibility into tracing health
5. **Cascading failures** - API overload during recovery

---

### Real-World Scenarios

**Scenario 1: API Downtime**
```
Prefactor API goes down for maintenance
→ Extension continues sending span requests
→ All requests fail (100% error rate)
→ No spans recorded for 30 minutes
→ User has no idea tracing is broken
```

**Scenario 2: Network Blip**
```
Temporary network issue (5 seconds)
→ 50 span creation attempts fail
→ Queue backs up with retries
→ API recovers but now overwhelmed
→ Extended outage due to retry storm
```

**Scenario 3: Rate Limiting**
```
User hits API rate limit
→ Extension ignores 429 responses
→ Continues sending requests
→ Rate limit window extends
→ Legitimate requests also blocked
```

---

## Circuit Breaker Pattern

### What Is It?

A circuit breaker is a state machine that prevents repeated failures:

```
[ CLOSED ] --(failures ≥ threshold)--> [ OPEN ]
    ↑                                      |
    |                                      | (timeout expires)
    └──────────────────────────────────────┘
              [ HALF-OPEN ]
```

### Three States

| State | Behavior | When |
|-------|----------|------|
| **CLOSED** | Normal operation, requests flow through | System healthy |
| **OPEN** | Requests fail immediately (no API calls) | System unhealthy |
| **HALF-OPEN** | Test with single request | Checking if recovered |

### State Transitions

```
CLOSED → OPEN: After N consecutive failures (e.g., 5)
OPEN → HALF-OPEN: After timeout (e.g., 30 seconds)
HALF-OPEN → CLOSED: If test request succeeds
HALF-OPEN → OPEN: If test request fails
```

---

## Implementation Plan

### Task 1: Add Circuit Breaker State to Agent

**File**: `src/agent.ts`

**Add to `PrefactorAgent` class**:

```typescript
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastFailureTime: number;
  openedAt: number;
  successCount: number;  // For half-open state
}

class PrefactorAgent {
  private circuitBreaker: CircuitBreakerState = {
    state: 'closed',
    consecutiveFailures: 0,
    lastFailureTime: 0,
    openedAt: 0,
    successCount: 0,
  };
  
  private readonly config = {
    failureThreshold: 5,        // Failures before opening
    resetTimeoutMs: 30000,      // Time before trying again (30s)
    halfOpenMaxRequests: 1,     // Test requests in half-open
  };
  
  // ... rest of class
}
```

---

### Task 2: Add Circuit Breaker Methods

**File**: `src/agent.ts`

**Add these methods**:

```typescript
/**
 * Check if circuit breaker allows request
 */
private canAttemptRequest(): boolean {
  const cb = this.circuitBreaker;
  
  if (cb.state === 'closed') {
    return true;  // Normal operation
  }
  
  if (cb.state === 'open') {
    // Check if reset timeout has elapsed
    const elapsed = Date.now() - cb.openedAt;
    if (elapsed >= this.config.resetTimeoutMs) {
      this.logger.info('circuit_breaker_half_open', {
        consecutiveFailures: cb.consecutiveFailures,
        elapsedMs: elapsed,
      });
      cb.state = 'half-open';
      cb.successCount = 0;
      return true;  // Allow test request
    }
    return false;  // Still open, reject request
  }
  
  if (cb.state === 'half-open') {
    // Allow limited requests in half-open state
    return cb.successCount < this.config.halfOpenMaxRequests;
  }
  
  return false;  // Should never reach here
}

/**
 * Record successful request
 */
private recordSuccess(): void {
  const cb = this.circuitBreaker;
  
  if (cb.state === 'half-open') {
    cb.successCount++;
    if (cb.successCount >= this.config.halfOpenMaxRequests) {
      this.logger.info('circuit_breaker_closed', {
        successCount: cb.successCount,
      });
      cb.state = 'closed';
      cb.consecutiveFailures = 0;
    }
  } else {
    // Reset failure counter on any success
    cb.consecutiveFailures = 0;
  }
}

/**
 * Record failed request
 */
private recordFailure(): void {
  const cb = this.circuitBreaker;
  cb.consecutiveFailures++;
  cb.lastFailureTime = Date.now();
  
  if (cb.state === 'half-open') {
    // Failed test request, back to open
    this.logger.warn('circuit_breaker_opened_from_half_open', {
      consecutiveFailures: cb.consecutiveFailures,
    });
    cb.state = 'open';
    cb.openedAt = Date.now();
  } else if (cb.state === 'closed' && 
             cb.consecutiveFailures >= this.config.failureThreshold) {
    // Threshold reached, open circuit
    this.logger.error('circuit_breaker_opened', {
      consecutiveFailures: cb.consecutiveFailures,
      failureThreshold: this.config.failureThreshold,
      resetTimeoutMs: this.config.resetTimeoutMs,
    });
    cb.state = 'open';
    cb.openedAt = Date.now();
  } else {
    // Log warning as we approach threshold
    this.logger.warn('circuit_breaker_failure_count', {
      consecutiveFailures: cb.consecutiveFailures,
      failureThreshold: this.config.failureThreshold,
    });
  }
}

/**
 * Get circuit breaker status for debugging
 */
getCircuitBreakerStatus(): {
  state: string;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  openedAt: number | null;
} {
  const cb = this.circuitBreaker;
  return {
    state: cb.state,
    consecutiveFailures: cb.state === 'closed' ? 0 : cb.consecutiveFailures,
    lastFailureTime: cb.lastFailureTime || null,
    openedAt: cb.state === 'open' ? cb.openedAt : null,
  };
}
```

---

### Task 3: Wrap API Calls with Circuit Breaker

**File**: `src/agent.ts`

**Update `createSpan` method**:

```typescript
async createSpan(
  sessionKey: string,
  schemaName: string,
  payload: Record<string, unknown>,
  parentSpanId: string | null
): Promise<string | null> {
  // Check circuit breaker before attempting
  if (!this.canAttemptRequest()) {
    this.logger.warn('circuit_breaker_open_span_skipped', {
      sessionKey,
      schemaName,
      state: this.circuitBreaker.state,
    });
    return null;  // Fail fast, don't attempt API call
  }
  
  try {
    const spanId = await this.doCreateSpan(sessionKey, schemaName, payload, parentSpanId);
    this.recordSuccess();
    return spanId;
  } catch (err) {
    this.recordFailure();
    
    // Still log the error for debugging
    this.logger.error('span_creation_failed', {
      sessionKey,
      schemaName,
      error: err instanceof Error ? err.message : String(err),
      circuitBreakerState: this.circuitBreaker.state,
    });
    
    throw err;  // Let caller handle
  }
}

/**
 * Internal span creation (actual API call)
 */
private async doCreateSpan(
  sessionKey: string,
  schemaName: string,
  payload: Record<string, unknown>,
  parentSpanId: string | null
): Promise<string> {
  // ... existing implementation (HTTP request to Prefactor API)
}
```

**Update `finishSpan` method** (same pattern):

```typescript
async finishSpan(
  sessionKey: string,
  spanId: string,
  status: 'complete' | 'failed' | 'cancelled',
  payload?: Record<string, unknown>
): Promise<void> {
  if (!this.canAttemptRequest()) {
    this.logger.warn('circuit_breaker_open_finish_skipped', {
      sessionKey,
      spanId,
      state: this.circuitBreaker.state,
    });
    return;  // Fail fast
  }
  
  try {
    await this.doFinishSpan(sessionKey, spanId, status, payload);
    this.recordSuccess();
  } catch (err) {
    this.recordFailure();
    this.logger.error('span_finish_failed', {
      sessionKey,
      spanId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

---

### Task 4: Add Configuration Options

**File**: `src/config.ts`

**Add to config schema**:

```typescript
export const configSchema = z.object({
  // ... existing fields
  
  // Circuit breaker configuration
  circuitBreakerFailureThreshold: z.number().positive().default(5)
    .describe('Number of consecutive failures before opening circuit'),
  circuitBreakerResetTimeoutMs: z.number().positive().default(30000)
    .describe('Time in ms before attempting to close circuit (30s)'),
});
```

**Add environment variables**:

```typescript
// In loadConfig()
circuitBreakerFailureThreshold: 
  packageConfig?.circuitBreakerFailureThreshold ?? 
  (process.env.PREFACTOR_CIRCUIT_BREAKER_FAILURE_THRESHOLD
    ? parseInt(process.env.PREFACTOR_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 10)
    : 5),
circuitBreakerResetTimeoutMs: 
  packageConfig?.circuitBreakerResetTimeoutMs ?? 
  (process.env.PREFACTOR_CIRCUIT_BREAKER_RESET_TIMEOUT_MS
    ? parseInt(process.env.PREFACTOR_CIRCUIT_BREAKER_RESET_TIMEOUT_MS, 10)
    : 30000),
```

**Pass config to Agent**:

```typescript
// In src/index.ts
const agent = createAgent({
  // ... existing config
  circuitBreakerFailureThreshold: config.circuitBreakerFailureThreshold,
  circuitBreakerResetTimeoutMs: config.circuitBreakerResetTimeoutMs,
}, logger);
```

---

### Task 5: Add Status Command (Optional but Useful)

**File**: `src/index.ts`

**Add command**:

```typescript
pi.registerCommand('prefactor-status', {
  description: 'Show Prefactor extension runtime status',
  handler: async (_args, ctx) => {
    const status = {
      circuitBreaker: agent.getCircuitBreakerStatus(),
      activeSessions: sessionManager.getActiveSessionCount(),
      // Could add more metrics here
    };
    
    console.log('Prefactor Extension Status:');
    console.log(`  Circuit Breaker: ${status.circuitBreaker.state}`);
    if (status.circuitBreaker.state !== 'closed') {
      console.log(`    Consecutive Failures: ${status.circuitBreaker.consecutiveFailures}`);
      console.log(`    Last Failure: ${new Date(status.circuitBreaker.lastFailureTime!).toISOString()}`);
    }
    console.log(`  Active Sessions: ${status.activeSessions}`);
    
    return { status };
  },
});
```

---

## Configuration Options

### Environment Variables

```bash
# Circuit breaker settings
export PREFACTOR_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5    # Default: 5
export PREFACTOR_CIRCUIT_BREAKER_RESET_TIMEOUT_MS=30000 # Default: 30s

# Package config (settings.json)
{
  "packages": [{
    "id": "pi-prefactor",
    "config": {
      "circuitBreakerFailureThreshold": 5,
      "circuitBreakerResetTimeoutMs": 30000
    }
  }]
}
```

### Tuning Guidelines

| Scenario | Threshold | Reset Timeout | Rationale |
|----------|-----------|---------------|-----------|
| **Stable API** | 5 | 30s | Default, balanced |
| **Unstable network** | 10 | 60s | More tolerant of blips |
| **Critical tracing** | 3 | 15s | Fail fast, recover quickly |
| **High volume** | 10 | 60s | Prevent false positives |

---

## Testing Plan

### Test 1: Normal Operation (Closed State)

```bash
pi -p -e ./src/index.ts "What is 2+2?"
```

**Expected**:
- Circuit breaker stays `closed`
- All spans created successfully
- No circuit breaker logs

**Verify**:
```bash
pi -p -e ./src/index.ts "/prefactor-status"
# Should show: Circuit Breaker: closed
```

---

### Test 2: Simulate API Failure

```bash
# Use invalid token to force failures
export PREFACTOR_API_TOKEN='invalid_token'
pi -p -e ./src/index.ts "Test"
pi -p -e ./src/index.ts "Test"
pi -p -e ./src/index.ts "Test"
pi -p -e ./src/index.ts "Test"
pi -p -e ./src/index.ts "Test"
pi -p -e ./src/index.ts "Test"  # This should trigger open state
```

**Expected Logs**:
```
[circuit_breaker_failure_count] consecutiveFailures=1
[circuit_breaker_failure_count] consecutiveFailures=2
[circuit_breaker_failure_count] consecutiveFailures=3
[circuit_breaker_failure_count] consecutiveFailures=4
[circuit_breaker_opened] consecutiveFailures=5
[circuit_breaker_open_span_skipped]  # Subsequent requests
```

**Verify**:
```bash
pi -p -e ./src/index.ts "/prefactor-status"
# Should show: Circuit Breaker: open
#             Consecutive Failures: 5
```

---

### Test 3: Recovery (Half-Open → Closed)

```bash
# Restore valid token
export PREFACTOR_API_TOKEN='valid_token'
sleep 30  # Wait for reset timeout
pi -p -e ./src/index.ts "Test"  # Should succeed, close circuit
```

**Expected Logs**:
```
[circuit_breaker_half_open] elapsedMs=30000
[circuit_breaker_closed] successCount=1
```

**Verify**:
```bash
pi -p -e ./src/index.ts "/prefactor-status"
# Should show: Circuit Breaker: closed
```

---

### Test 4: Half-Open Failure

```bash
# Use invalid token
export PREFACTOR_API_TOKEN='invalid_token'
sleep 30  # Wait for reset timeout
pi -p -e ./src/index.ts "Test"  # Should fail, reopen circuit
```

**Expected Logs**:
```
[circuit_breaker_half_open] elapsedMs=30000
[circuit_breaker_opened_from_half_open] consecutiveFailures=6
```

---

## Benefits

### 1. Prevents Silent Data Loss

**Before**:
- Spans fail silently
- User has no idea tracing is broken
- Data loss goes unnoticed

**After**:
- Circuit opens after failures
- Clear logs show circuit state
- User can check `/prefactor-status`

---

### 2. Protects API from Overload

**Before**:
- Continues hammering failing API
- Retry storms during recovery
- Extended outages

**After**:
- Fails fast when circuit open
- No API calls during outage
- Controlled recovery (half-open)

---

### 3. Resource Efficiency

**Before**:
- Every span creation attempts API call
- Wastes CPU/network on guaranteed failures
- Queue backs up with retries

**After**:
- Immediate failure when circuit open
- No wasted resources
- Queue stays manageable

---

### 4. Better Observability

**Before**:
- No visibility into API health
- Can't tell if tracing is working

**After**:
- Circuit state visible in logs
- `/prefactor-status` command
- Clear failure counts

---

### 5. Graceful Degradation

**Before**:
- All-or-nothing (works or completely broken)

**After**:
- Degrades gracefully
- Continues operating (without tracing)
- Auto-recovers when API healthy

---

## Acceptance Criteria

- [ ] Circuit breaker state machine implemented (closed/open/half-open)
- [ ] Failure threshold configurable (default: 5)
- [ ] Reset timeout configurable (default: 30s)
- [ ] All API calls wrapped with circuit breaker
- [ ] Logs show circuit state transitions
- [ ] `/prefactor-status` command shows circuit state
- [ ] Tested with normal operation (stays closed)
- [ ] Tested with API failures (opens after threshold)
- [ ] Tested with recovery (half-open → closed)
- [ ] Tested with half-open failure (reopens)
- [ ] TypeScript compilation passes
- [ ] No regressions in span creation

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/agent.ts` | Add circuit breaker state + methods | ~150 |
| `src/config.ts` | Add circuit breaker config options | ~20 |
| `src/index.ts` | Add status command, pass config | ~40 |
| **Total** | **3 files** | **~210 lines** |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| False positives (circuit opens unnecessarily) | Low | Medium | Configurable threshold, tune based on environment |
| Circuit stays open too long | Low | Low | Configurable reset timeout, manual reset option |
| Half-open test overloads API | Low | Low | Limit to 1 test request |
| Complexity adds bugs | Medium | Medium | Thorough testing, simple state machine |

---

## Implementation Order

1. **Add circuit breaker state** to `PrefactorAgent` (~30 min)
2. **Implement state machine methods** (canAttemptRequest, recordSuccess, recordFailure) (~30 min)
3. **Wrap API calls** (createSpan, finishSpan) (~30 min)
4. **Add configuration** (config.ts, env vars) (~15 min)
5. **Add status command** (~15 min)
6. **Test all scenarios** (~30 min)

**Total**: ~2.5 hours (including testing)

---

## Commit Message

```
feat: Add circuit breaker for API failures

- Implement circuit breaker pattern (closed/open/half-open states)
- Add failure threshold (default: 5 consecutive failures)
- Add reset timeout (default: 30s before retry)
- Wrap createSpan and finishSpan with circuit breaker
- Add /prefactor-status command to show circuit state
- Log circuit state transitions for observability
- Configurable via PREFACTOR_CIRCUIT_BREAKER_* env vars

Benefits:
- Prevents silent data loss during API outages
- Protects API from overload (no retry storms)
- Fails fast when API unavailable (resource efficient)
- Clear visibility into tracing health
- Graceful degradation with auto-recovery

Validated with:
- Normal operation (circuit stays closed)
- API failures (circuit opens after threshold)
- Recovery (half-open → closed on success)
- Half-open failure (reopens circuit)
```

---

**Ready to start!**
