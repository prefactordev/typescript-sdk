import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKeybindings, type KeybindingsManager } from '@earendil-works/pi-tui';

type Handler = (event: Record<string, unknown>, ctx: FakeContext) => unknown;
type Command = { handler: (args: string, ctx: FakeContext) => Promise<void> };

export type FakeContext = ReturnType<typeof createContext>;

const ENV_KEYS = [
  'PREFACTOR_API_URL',
  'PREFACTOR_API_TOKEN',
  'PREFACTOR_AGENT_ID',
  'PI_CODING_AGENT_DIR',
];

/** pi's built-in tools, as `getAllTools` lists them. */
const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'].map((name) => ({
  name,
  description: `The ${name} tool`,
}));

/** A stand-in for pi's `ExtensionAPI` that records handlers and commands. */
export function createPi(options: { tools?: Array<{ name: string; description: string }> } = {}) {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    getAllTools: () => options.tools ?? DEFAULT_TOOLS,
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

/** The part of pi's theme the tests stand in for. */
type WidgetTheme = { fg(color: string, text: string): string; bold(text: string): string };

/** What an extension passed to `ctx.ui.setWidget`: lines, a component factory, or a removal. */
export type WidgetContent =
  | string[]
  | ((
      tui: { terminal: { rows: number; columns: number } },
      theme: WidgetTheme
    ) => { render(width: number): string[] })
  | undefined;

/** A theme that wraps text in SGR escapes, as pi's theme does, so tests can see where styles apply. */
const TEST_THEME: WidgetTheme = {
  fg: (color, text) => `\x1b[38;5;${color.length}m${text}\x1b[39m`,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};

/** Renders a component widget at a terminal width, as pi would, with escapes kept. */
export function renderWidget(content: WidgetContent, width: number): string[] {
  if (typeof content !== 'function') {
    throw new Error('Expected a component widget.');
  }
  return content({ terminal: { rows: 40, columns: width } }, TEST_THEME).render(width);
}

/** A rendered line as the terminal shows it: SGR and OSC escape sequences removed. */
export function visibleText(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences.
  return line.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

/**
 * A stand-in for pi's extension context. Dialogs answer from `answers` in order; a function
 * answer receives the dialog's title and options.
 */
export function createContext(options: {
  hasUI: boolean;
  mode?: 'tui' | 'rpc';
  answers?: Array<unknown | ((title: string, choices?: string[]) => unknown)>;
  /** Keys typed into a custom component, such as the agent filter list, in order. */
  customKeys?: string[];
}) {
  const notifications: string[] = [];
  const dialogs: Array<{ kind: string; title: string; choices?: string[]; placeholder?: string }> =
    [];
  const widgets: WidgetContent[] = [];
  const customRenders: string[][] = [];
  const answers = [...(options.answers ?? [])];
  const answer = async (kind: string, title: string, choices?: string[], placeholder?: string) => {
    dialogs.push({
      kind,
      title,
      ...(choices ? { choices } : {}),
      ...(placeholder !== undefined ? { placeholder } : {}),
    });
    const next = answers.shift();
    return typeof next === 'function' ? next(title, choices) : next;
  };
  /** Runs a custom component as pi would: renders it, then sends it each of `customKeys`. */
  const custom = <T>(
    factory: (
      tui: { requestRender(): void },
      theme: WidgetTheme,
      keybindings: KeybindingsManager,
      done: (result: T) => void
    ) => { render(width: number): string[]; handleInput?(data: string): void }
  ): Promise<T> =>
    new Promise<T>((resolve) => {
      const component = factory(
        { requestRender: () => undefined },
        TEST_THEME,
        getKeybindings(),
        resolve
      );
      customRenders.push(component.render(80));
      for (const key of options.customKeys ?? []) {
        component.handleInput?.(key);
        customRenders.push(component.render(80));
      }
    });
  return {
    notifications,
    dialogs,
    widgets,
    customRenders,
    hasUI: options.hasUI,
    mode: options.mode ?? (options.hasUI ? 'tui' : 'print'),
    cwd: '/work/repo',
    model: { provider: 'anthropic', id: 'claude-sonnet' },
    sessionManager: { getSessionId: () => 'session-1' },
    systemPrompt: 'You are pi.',
    getSystemPrompt(): string {
      return this.systemPrompt;
    },
    ui: {
      notify: (message: string) => notifications.push(message),
      setWidget: (_key: string, content: WidgetContent) => widgets.push(content),
      select: (title: string, choices: string[]) => answer('select', title, choices),
      confirm: (title: string) => answer('confirm', title),
      input: (title: string, placeholder?: string) =>
        answer('input', title, undefined, placeholder),
      custom,
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
