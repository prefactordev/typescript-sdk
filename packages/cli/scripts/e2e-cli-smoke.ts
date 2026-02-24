import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

type EntityResponse = {
  details?: {
    id?: string;
  };
};

function runCli(repoRoot: string, homeDir: string, commandCwd: string, args: string[]): string {
  console.log(`$ prefactor ${args.join(' ')}`);
  const result = spawnSync('bun', [join(repoRoot, 'packages/cli/src/bin/cli.ts'), ...args], {
    cwd: commandCwd,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `CLI command failed: prefactor ${args.join(' ')}`,
        `exit=${result.status ?? 'unknown'}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n\n')
    );
  }

  const output = result.stdout.trim();
  if (output.length > 0) {
    console.log(output);
  }

  return output;
}

function parseJson<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Expected JSON output from ${context}, got: ${value}`);
  }
}

function getId(details: { id?: string } | undefined, context: string): string {
  const id = details?.id;
  if (!id) {
    throw new Error(`Expected an id in ${context} response.`);
  }
  return id;
}

function main(): void {
  const apiKey = process.env.PREFACTOR_API_TOKEN;
  if (!apiKey) {
    throw new Error('Missing PREFACTOR_API_TOKEN environment variable.');
  }

  validateTokenCanCreateEnvironment(apiKey);

  const baseUrl =
    process.env.PREFACTOR_API_URL ?? 'https://p2demo.prefactor.dev/api/v1/openapi';
  const accountId = extractAccountIdFromToken(apiKey);
  const runId = `${Date.now()}`;
  const profileName = process.env.PREFACTOR_PROFILE ?? 'test-cli';
  const repoRoot = resolve(import.meta.dir, '../../..');
  const tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-e2e-'));
  const homeDir = join(tempRoot, 'home');
  const commandCwd = join(tempRoot, 'workspace');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(commandCwd, { recursive: true });

  try {
    runCli(repoRoot, homeDir, commandCwd, ['profiles', 'add', profileName, apiKey, baseUrl]);

    const environmentName = `cli-e2e-env-${runId}`;
    const environmentRaw = runCli(repoRoot, homeDir, commandCwd, [
      '--profile',
      profileName,
      'environments',
      'create',
      '--name',
      environmentName,
      '--account_id',
      accountId,
    ]);
    const environment = parseJson<EntityResponse>(environmentRaw, 'environments create');
    const environmentId = getId(environment.details, 'environments create');

    const agentName = `cli-e2e-agent-${runId}`;
    const agentRaw = runCli(repoRoot, homeDir, commandCwd, [
      '--profile',
      profileName,
      'agents',
      'create',
      '--name',
      agentName,
      '--environment_id',
      environmentId,
    ]);
    const agent = parseJson<EntityResponse>(agentRaw, 'agents create');
    const agentId = getId(agent.details, 'agents create');

    const agentInstanceRaw = runCli(repoRoot, homeDir, commandCwd, [
      '--profile',
      profileName,
      'agent_instances',
      'register',
      '--agent_id',
      agentId,
      '--agent_version_external_identifier',
      `cli-e2e-version-${runId}`,
      '--agent_version_name',
      `CLI E2E Version ${runId}`,
      '--agent_schema_version_external_identifier',
      `cli-e2e-schema-${runId}`,
      '--span_schemas',
      '{"unknown":{}}',
      '--update_current_version',
    ]);
    const agentInstance = parseJson<EntityResponse>(agentInstanceRaw, 'agent_instances register');
    const agentInstanceId = getId(agentInstance.details, 'agent_instances register');

    console.log(
      JSON.stringify(
        {
          ok: true,
          profileName,
          accountId,
          environmentId,
          agentId,
          agentInstanceId,
        },
        null,
        2
      )
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function extractAccountIdFromToken(token: string): string {
  const payload = decodeJwtPayload(token) as {
    _?: {
      a?: unknown;
    };
  };

  const accountId = payload._?.a;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new Error(
      'Unable to derive account id from token. Set PREFACTOR_E2E_ACCOUNT_ID explicitly.'
    );
  }

  return accountId;
}

function validateTokenCanCreateEnvironment(token: string): void {
  const payload = decodeJwtPayload(token) as {
    _?: {
      e?: unknown;
    };
  };

  if (typeof payload._?.e === 'string' && payload._.e.length > 0) {
    throw new Error(
      'PREFACTOR_API_TOKEN appears to be environment-scoped. This e2e flow creates a new environment and requires an account-scoped token.'
    );
  }
}

function decodeJwtPayload(token: string): unknown {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new Error('Invalid JWT format for PREFACTOR_API_TOKEN.');
  }

  const payload = segments[1];
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(base64, 'base64').toString('utf8');

  return parseJson<unknown>(decoded, 'JWT payload');
}

main();
