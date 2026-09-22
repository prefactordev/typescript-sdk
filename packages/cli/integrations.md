# Account integration commands

The `integrations` group manages notification delivery for the authenticated account. Slack is the supported integration type. Use an account-scoped token with permission to manage integrations.

## Configure Slack

Create an incoming webhook in Slack, then provide its URL and the events to enable:

```bash
prefactor --profile production integrations update slack \
  --webhook_url "$SLACK_WEBHOOK_URL" \
  --enabled_events "agent_created,agent_version_deployed,alert_raised"
```

The command creates a new active integration or replaces the existing configuration. Both options are required so replacements are explicit. It does not change an existing integration's active or paused status. Event names are comma-separated. Use an empty string to disable every event:

```bash
prefactor integrations update slack --webhook_url "$SLACK_WEBHOOK_URL" --enabled_events ""
```

Webhook URLs grant permission to post messages. Store them securely and avoid including literal URLs in shell history. An environment variable avoids a literal secret in history, but the expanded argument can still be visible to local process inspection.

## Inspect, test and remove

```bash
prefactor integrations list
prefactor integrations retrieve slack
prefactor integrations test slack
prefactor integrations delete slack
```

All commands print JSON. List returns integration summaries. Retrieve returns configuration with the webhook URL redacted by the API. Test sends a real Slack notification and returns `{"delivered":true,"status":"success"}` when accepted. Errors are reported through the normal CLI error path. Delete immediately removes the integration.

Commands take a type such as `slack`, not an integration ID. The CLI resolves that type through the list endpoint. Missing integrations cause retrieve, test and delete to fail.

## Event names

| Category | Events |
| --- | --- |
| Agent | `agent_created`, `agent_updated`, `agent_retired`, `agent_reinstated`, `agent_deleted` |
| Version and deployment | `agent_version_created`, `agent_version_deployed` |
| Instance | `agent_instance_registered`, `agent_instance_started`, `agent_instance_completed`, `agent_instance_failed`, `agent_instance_cancelled`, `agent_instance_terminated`, `agent_instance_first_started`, `agent_instance_auto_completed` |
| User | `user_invited`, `user_added` |
| API token | `api_token_created`, `api_token_suspended`, `api_token_revoked`, `api_token_first_used` |
| Environment and team | `environment_created`, `team_created`, `agent_assigned_to_team` |
| Alert | `alert_raised`, `alert_cleared` |

The API validates event names and webhook URLs. An event is delivered only when the integration is active and the event is enabled.

## Typed client

The exported client maps directly to the API and uses integration IDs rather than command-line type names:

```typescript
import { ApiClient, IntegrationClient } from '@prefactor/cli';

const client = new IntegrationClient(
  new ApiClient('https://app.prefactorai.com', process.env.PREFACTOR_API_TOKEN!)
);
const { summaries } = await client.list();
const slack = summaries.find((integration) => integration.integration_type === 'slack');
if (slack) {
  const response = await client.retrieve(slack.id);
  console.log(response); // The API redacts the webhook URL.
}
```

The client also exposes `create(details)`, `update(id, details)`, `delete(id)` and `test(id)`. Configuration is a versioned JSON object. Slack configuration uses `_version: 1`, `webhook_url` and `enabled_events`. Create details include `integration_type: "slack"` and `status: "active"`; update can omit status to retain it.
