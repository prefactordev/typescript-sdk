import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  VERSION as PI_VERSION,
} from '@earendil-works/pi-coding-agent';
import { createConfig, getLogger } from '@prefactor/core';
import { registerPrefactorCommand } from './commands.js';
import {
  type PrefactorCredentialOptions,
  type ResolvedCredentials,
  resolveCredentials,
} from './credentials.js';
import { createHttpClient, PrefactorSession } from './prefactor-session.js';
import { buildAgentSchemaVersion } from './schema.js';
import {
  type AssistantMessageLike,
  SessionTracer,
  type UserMessageLike,
} from './session-tracer.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

const logger = getLogger('pi');

const AGENT_NAME = 'pi';
const AGENT_DESCRIPTION = 'pi coding agent sessions recorded by @prefactor/pi';
const SDK_HEADER_ENTRY = `${PACKAGE_NAME}@${PACKAGE_VERSION} @earendil-works/pi-coding-agent@${PI_VERSION}`;

/**
 * Options for {@link prefactorExtension}. Each credential falls back to the `PREFACTOR_*`
 * environment variables, then to the credentials file in pi's agent directory.
 */
export interface PrefactorExtensionOptions extends PrefactorCredentialOptions {
  /**
   * Agent version recorded for each session, for agents built on pi's SDK. Defaults to the
   * version of the pi framework, which is also what the `pi` command uses.
   */
  agentVersion?: string;
}

let setupNoticeShown = false;

/**
 * Creates a pi extension that records each pi session in Prefactor as one agent instance, as a
 * conversation of user turns, assistant turns, LLM calls and tool executions.
 *
 * When no Prefactor token is found, the extension records nothing and tells the user once how to
 * set Prefactor up, so pi keeps working.
 */
export function prefactorExtension(options: PrefactorExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let recording: {
      credentials: ResolvedCredentials;
      session: PrefactorSession;
      tracer: SessionTracer;
    } | null = null;

    const guard =
      <T extends unknown[]>(name: string, handler: (...args: T) => void | Promise<void>) =>
      async (...args: T): Promise<void> => {
        try {
          await handler(...args);
        } catch (error) {
          logger.warn(`Error handling pi ${name} event`, error);
        }
      };

    const startRecording = (
      ctx: ExtensionContext,
      reason: string,
      credentials: ResolvedCredentials
    ): void => {
      // Validate the configuration before the session queues its registration, so a bad setting
      // cannot leave an agent instance that nothing finishes.
      const config = createConfig();
      const tools = pi.getAllTools();
      const session = new PrefactorSession({
        apiUrl: credentials.apiUrl,
        apiToken: credentials.apiToken,
        agentId: credentials.agentId,
        agentVersion: {
          external_identifier: options.agentVersion ?? PI_VERSION,
          name: AGENT_NAME,
          description: AGENT_DESCRIPTION,
        },
        agentSchemaVersion: buildAgentSchemaVersion(tools),
        sdkHeaderEntry: SDK_HEADER_ENTRY,
        onError: (error) =>
          notify(ctx, `Prefactor could not record this session: ${describe(error)}`),
      });

      const tracer = new SessionTracer(session, {
        maxInputLength: config.maxInputLength,
        maxOutputLength: config.maxOutputLength,
      });
      tracer.sessionStart({
        sessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd,
        mode: ctx.mode,
        reason,
        provider: ctx.model?.provider,
        model: ctx.model?.id,
        toolNames: tools.map((tool) => tool.name),
      });
      recording = { credentials, session, tracer };
    };

    const replaceRecording = async (ctx: ExtensionContext): Promise<void> => {
      recording = null;
      const credentials = await resolveCredentials(options);
      if (credentials) {
        startRecording(ctx, 'setup', credentials);
      }
    };

    pi.on(
      'session_start',
      guard('session_start', async (event, ctx) => {
        const credentials = await loadCredentials(options, ctx);
        if (credentials) {
          startRecording(ctx, event.reason, credentials);
        }
      })
    );

    registerPrefactorCommand(pi, {
      resolveCredentials: () => resolveCredentials(options),
      getRecording: () =>
        recording
          ? {
              credentials: recording.credentials,
              lastError: recording.session.getLastError(),
              startState: recording.session.getStartState(),
            }
          : null,
      startRecording: async (ctx) => {
        const current = recording;
        const state = current?.session.getStartState();
        if (!current || state === 'failed') {
          // A recording whose agent instance never started records nothing, so the saved
          // credentials replace it.
          await replaceRecording(ctx);
          return;
        }
        if (state === 'pending') {
          // Setup can finish before the current registration does. If that registration then
          // fails, switch this session to the saved credentials.
          void current.session
            .whenStartSettled()
            .then(async (started) => {
              if (!started && recording === current) {
                await replaceRecording(ctx);
              }
            })
            .catch((error: unknown) =>
              logger.warn('Could not start recording with the saved credentials', error)
            );
        }
      },
      createClient: (apiUrl, apiToken) => createHttpClient(apiUrl, apiToken, SDK_HEADER_ENTRY),
      clientVersion: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
    });

    pi.on(
      'agent_start',
      guard('agent_start', (_event, ctx) => recording?.tracer.agentStart(ctx.getSystemPrompt()))
    );
    pi.on(
      'agent_end',
      guard('agent_end', () => recording?.tracer.agentEnd())
    );
    pi.on(
      'message_end',
      guard('message_end', (event) => {
        if (event.message.role === 'user') {
          recording?.tracer.userMessage(event.message as unknown as UserMessageLike);
        } else if (event.message.role === 'assistant') {
          recording?.tracer.assistantMessage(event.message as unknown as AssistantMessageLike);
        }
      })
    );
    pi.on(
      'tool_execution_start',
      guard('tool_execution_start', (event) => recording?.tracer.toolStart(event))
    );
    pi.on(
      'tool_execution_end',
      guard('tool_execution_end', (event) => recording?.tracer.toolEnd(event))
    );
    pi.on(
      'session_shutdown',
      guard('session_shutdown', async (event) => {
        const current = recording;
        recording = null;
        current?.tracer.sessionShutdown(event.reason);
        await current?.session.finish();
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
      ctx.hasUI
        ? 'Prefactor is not set up. Run /prefactor setup to connect pi to Prefactor.'
        : 'Prefactor is not set up, so this session is not recorded. Set PREFACTOR_API_URL, ' +
            'PREFACTOR_API_TOKEN and PREFACTOR_AGENT_ID, or run /prefactor setup in interactive pi.'
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
