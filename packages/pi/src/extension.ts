import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  VERSION as PI_VERSION,
} from '@earendil-works/pi-coding-agent';
import { createConfig, getLogger } from '@prefactor/core';
import {
  getCredentialsFilePath,
  type PrefactorCredentialOptions,
  type ResolvedCredentials,
  resolveCredentials,
} from './credentials.js';
import { PrefactorSession } from './prefactor-session.js';
import { buildAgentSchemaVersion } from './schema.js';
import { type AssistantMessageLike, SessionTracer } from './session-tracer.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

const logger = getLogger('pi');

const AGENT_NAME = 'pi';
const AGENT_DESCRIPTION = 'pi coding agent sessions recorded by @prefactor/pi';
const SDK_HEADER_ENTRY = `${PACKAGE_NAME}@${PACKAGE_VERSION} @earendil-works/pi-coding-agent@${PI_VERSION}`;

/**
 * Options for {@link prefactorExtension}. Each credential falls back to the `PREFACTOR_*`
 * environment variables, then to the credentials file in pi's agent directory.
 */
export interface PrefactorExtensionOptions extends PrefactorCredentialOptions {}

let setupNoticeShown = false;

/**
 * Creates a pi extension that records each pi session in Prefactor as one agent instance, with
 * spans for agent runs, LLM responses and tool executions.
 *
 * When no Prefactor token is found, the extension records nothing and tells the user once how to
 * set Prefactor up, so pi keeps working.
 */
export function prefactorExtension(options: PrefactorExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let session: PrefactorSession | null = null;
    let tracer: SessionTracer | null = null;

    const guard =
      <T extends unknown[]>(name: string, handler: (...args: T) => void | Promise<void>) =>
      async (...args: T): Promise<void> => {
        try {
          await handler(...args);
        } catch (error) {
          logger.warn(`Error handling pi ${name} event`, error);
        }
      };

    pi.on(
      'session_start',
      guard('session_start', async (event, ctx) => {
        const credentials = await loadCredentials(options, ctx);
        if (!credentials) {
          return;
        }

        session = new PrefactorSession({
          apiUrl: credentials.apiUrl,
          apiToken: credentials.apiToken,
          agentId: credentials.agentId,
          agentVersion: {
            external_identifier: PI_VERSION,
            name: AGENT_NAME,
            description: AGENT_DESCRIPTION,
          },
          agentSchemaVersion: buildAgentSchemaVersion(),
          sdkHeaderEntry: SDK_HEADER_ENTRY,
          onError: (error) =>
            notify(ctx, `Prefactor could not record this session: ${describe(error)}`),
        });

        const config = createConfig();
        tracer = new SessionTracer(session, {
          maxInputLength: config.maxInputLength,
          maxOutputLength: config.maxOutputLength,
        });
        tracer.sessionStart({
          sessionId: ctx.sessionManager.getSessionId(),
          cwd: ctx.cwd,
          mode: ctx.mode,
          reason: event.reason,
          provider: ctx.model?.provider,
          model: ctx.model?.id,
        });
      })
    );

    pi.on(
      'before_agent_start',
      guard('before_agent_start', (event) => {
        if (event.messageType === 'user') {
          tracer?.beforeAgentStart(event.prompt, event.images);
        }
      })
    );
    pi.on(
      'agent_start',
      guard('agent_start', () => tracer?.agentStart())
    );
    pi.on(
      'agent_end',
      guard('agent_end', () => tracer?.agentEnd())
    );
    pi.on(
      'context',
      guard('context', (event) => tracer?.context(event.messages))
    );
    pi.on(
      'message_end',
      guard('message_end', (event) => {
        if (event.message.role === 'assistant') {
          tracer?.assistantMessage(event.message as unknown as AssistantMessageLike);
        }
      })
    );
    pi.on(
      'tool_execution_start',
      guard('tool_execution_start', (event) => tracer?.toolStart(event))
    );
    pi.on(
      'tool_execution_end',
      guard('tool_execution_end', (event) => tracer?.toolEnd(event))
    );
    pi.on(
      'session_shutdown',
      guard('session_shutdown', async (event) => {
        tracer?.sessionShutdown(event.reason);
        tracer = null;
        const current = session;
        session = null;
        await current?.finish();
      })
    );
  };
}

async function loadCredentials(
  options: PrefactorExtensionOptions,
  ctx: ExtensionContext
): Promise<ResolvedCredentials | undefined> {
  let credentials: ResolvedCredentials | undefined;
  try {
    credentials = await resolveCredentials(options);
  } catch (error) {
    notify(ctx, `Prefactor could not read its credentials: ${describe(error)}`);
    return undefined;
  }
  if (!credentials && !setupNoticeShown) {
    setupNoticeShown = true;
    notify(
      ctx,
      'Prefactor is not set up, so this session is not recorded. Set PREFACTOR_API_TOKEN ' +
        `(and optionally PREFACTOR_API_URL and PREFACTOR_AGENT_ID), or save credentials to ${getCredentialsFilePath()}.`
    );
  }
  return credentials;
}

/**
 * Shows a message in pi's UI when it has one, otherwise writes one line to stderr.
 */
function notify(ctx: ExtensionContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, 'warning');
    return;
  }
  process.stderr.write(`${message}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @internal Resets the once-per-process setup notice, for tests. */
export function resetSetupNoticeForTests(): void {
  setupNoticeShown = false;
}
