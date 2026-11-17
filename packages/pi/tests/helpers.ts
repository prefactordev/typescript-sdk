import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Handler = (event: Record<string, unknown>, ctx: FakeContext) => unknown;
type Command = { handler: (args: string, ctx: FakeContext) => Promise<void> };

export type FakeContext = ReturnType<typeof createContext>;

const ENV_KEYS = [
  'PREFACTOR_API_URL',
  'PREFACTOR_API_TOKEN',
  'PREFACTOR_AGENT_ID',
  'PI_CODING_AGENT_DIR',
];

/** A stand-in for pi's `ExtensionAPI` that records handlers and commands. */
export function createPi() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
  };
  const emit = async (event: Record<string, unknown> & { type: string }, ctx: FakeContext) => {
    for (const handler of handlers.get(event.type) ?? []) {
      await handler(event, ctx);
    }
  };
  const runCommand = async (name: string, args: string, ctx: FakeContext) => {
    const command = commands.get(name);
    if (!command) {
      throw new Error(`No command ${name}`);
    }
    await command.handler(args, ctx);
  };
  return { pi, emit, runCommand };
}

/**
 * A stand-in for pi's extension context. Dialogs answer from `answers` in order; a function
 * answer receives the dialog's title and options.
 */
export function createContext(options: {
  hasUI: boolean;
  answers?: Array<unknown | ((title: string, choices?: string[]) => unknown)>;
}) {
  const notifications: string[] = [];
  const dialogs: Array<{ kind: string; title: string; choices?: string[] }> = [];
  const widgets: Array<string[] | undefined> = [];
  const answers = [...(options.answers ?? [])];
  const answer = async (kind: string, title: string, choices?: string[]) => {
    dialogs.push({ kind, title, ...(choices ? { choices } : {}) });
    const next = answers.shift();
    return typeof next === 'function' ? next(title, choices) : next;
  };
  return {
    notifications,
    dialogs,
    widgets,
    hasUI: options.hasUI,
    mode: options.hasUI ? 'tui' : 'print',
    cwd: '/work/repo',
    model: { provider: 'anthropic', id: 'claude-sonnet' },
    sessionManager: { getSessionId: () => 'session-1' },
    ui: {
      notify: (message: string) => notifications.push(message),
      setWidget: (_key: string, lines: string[] | undefined) => widgets.push(lines),
      select: (title: string, choices: string[]) => answer('select', title, choices),
      confirm: (title: string) => answer('confirm', title),
      input: (title: string) => answer('input', title),
    },
  };
}

/**
 * Clears the `PREFACTOR_*` variables and points pi's agent directory at a new temporary
 * directory. Returns a function that restores the environment and removes the directory.
 */
export function isolateEnvironment(): { dir: string; restore: () => void } {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  const dir = mkdtempSync(join(tmpdir(), 'prefactor-pi-'));
  process.env.PI_CODING_AGENT_DIR = dir;
  return {
    dir,
    restore: () => {
      rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}
