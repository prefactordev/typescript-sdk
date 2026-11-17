import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export const DEFAULT_API_URL = 'https://app.prefactorai.com';
export const CREDENTIALS_FILE_NAME = 'prefactor.json';

/**
 * Credentials passed to the extension factory in code.
 */
export interface PrefactorCredentialOptions {
  /** Prefactor API URL. Defaults to `https://app.prefactorai.com`. */
  apiUrl?: string;
  /** Prefactor agent-deployment token. */
  apiToken?: string;
  /** Prefactor agent id. Read from the token with `GET /api/v1/ping` when omitted. */
  agentId?: string;
}

export type CredentialSource = 'options' | 'environment' | 'file';

/**
 * Credentials chosen for a session, before the agent id has been looked up.
 */
export interface ResolvedCredentials {
  source: CredentialSource;
  apiUrl: string;
  apiToken: string;
  /** Agent id from the same source as the token, when that source supplies one. */
  agentId?: string;
}

/**
 * Contents of the credentials file at `<pi agent dir>/prefactor.json`.
 */
export interface CredentialsFile {
  api_url?: string;
  api_token?: string;
  agent_id?: string;
  agent_name?: string;
  environment_id?: string;
  account_id?: string;
  account_name?: string;
  created_at?: string;
}

type CredentialCandidate = {
  source: CredentialSource;
  apiUrl?: string;
  apiToken?: string;
  agentId?: string;
};

/**
 * Returns the path of the credentials file, which follows pi's `PI_CODING_AGENT_DIR` setting.
 */
export function getCredentialsFilePath(): string {
  return join(getAgentDir(), CREDENTIALS_FILE_NAME);
}

/**
 * Reads the credentials file, returning `undefined` when it does not exist.
 *
 * @throws When the file exists but cannot be read or does not hold a JSON object.
 */
export async function readCredentialsFile(
  path: string = getCredentialsFilePath()
): Promise<CredentialsFile | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a JSON object`);
  }
  return parsed as CredentialsFile;
}

/**
 * Writes the credentials file with file mode `0600`, replacing any existing file.
 */
export async function writeCredentialsFile(
  contents: CredentialsFile,
  path: string = getCredentialsFilePath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  // The mode passed to writeFile is masked by the umask, so set it explicitly.
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

/**
 * Deletes the credentials file.
 *
 * @returns Whether a file was deleted.
 */
export async function deleteCredentialsFile(
  path: string = getCredentialsFilePath()
): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Chooses credentials from, in order, the extension options, the `PREFACTOR_*` environment
 * variables and the credentials file. The first source that supplies a token wins, and the agent
 * id is taken only from that source. The API URL comes from that source or a later one, so a
 * higher-priority URL never redirects a lower-priority token, then falls back to the default.
 *
 * @returns The chosen credentials, or `undefined` when no source supplies a token.
 */
export async function resolveCredentials(
  options: PrefactorCredentialOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  credentialsFilePath: string = getCredentialsFilePath()
): Promise<ResolvedCredentials | undefined> {
  const candidates: CredentialCandidate[] = [
    {
      source: 'options',
      apiUrl: options.apiUrl,
      apiToken: options.apiToken,
      agentId: options.agentId,
    },
    {
      source: 'environment',
      apiUrl: env.PREFACTOR_API_URL,
      apiToken: env.PREFACTOR_API_TOKEN,
      agentId: env.PREFACTOR_AGENT_ID,
    },
  ];

  // The file is read only when a higher-priority source leaves a token or URL to find, so an
  // unreadable file never blocks credentials from options or the environment.
  let chosenIndex = candidates.findIndex((candidate) => nonEmpty(candidate.apiToken));
  const needsFile =
    chosenIndex === -1 || !candidates.slice(chosenIndex).some((c) => nonEmpty(c.apiUrl));
  if (needsFile) {
    const file = await readCredentialsFile(credentialsFilePath);
    candidates.push({
      source: 'file',
      apiUrl: file?.api_url,
      apiToken: file?.api_token,
      agentId: file?.agent_id,
    });
    if (chosenIndex === -1) {
      chosenIndex = candidates.findIndex((candidate) => nonEmpty(candidate.apiToken));
    }
  }

  const chosen = candidates[chosenIndex];
  if (!chosen?.apiToken) {
    return undefined;
  }

  const apiUrl =
    candidates
      .slice(chosenIndex)
      .map((candidate) => candidate.apiUrl)
      .find(nonEmpty) ?? DEFAULT_API_URL;
  const agentId = nonEmpty(chosen.agentId) ? chosen.agentId : undefined;

  return {
    source: chosen.source,
    apiUrl,
    apiToken: chosen.apiToken,
    ...(agentId ? { agentId } : {}),
  };
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
