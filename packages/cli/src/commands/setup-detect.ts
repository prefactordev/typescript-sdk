import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SuggestedIntegration = {
  language: 'typescript' | 'python';
  suggested_package: string;
};

type DetectRule = {
  language: 'typescript' | 'python';
  suggested_package: string;
  npmPackages?: string[];
  npmPrefixes?: string[];
  pythonPackages?: string[];
};

const DETECT_RULES: DetectRule[] = [
  {
    language: 'typescript',
    suggested_package: '@prefactor/langchain',
    npmPackages: ['langchain'],
    npmPrefixes: ['@langchain/'],
  },
  {
    language: 'typescript',
    suggested_package: '@prefactor/ai',
    npmPackages: ['ai'],
    npmPrefixes: ['@ai-sdk/'],
  },
  {
    language: 'typescript',
    suggested_package: '@prefactor/claude',
    npmPackages: ['@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk'],
  },
  {
    language: 'typescript',
    suggested_package: '@prefactor/openclaw',
    npmPackages: ['openclaw'],
  },
  {
    language: 'python',
    suggested_package: 'prefactor-langchain',
    pythonPackages: ['langchain', 'langchain-core', 'langchain-openai'],
  },
  {
    language: 'python',
    suggested_package: 'prefactor-livekit',
    pythonPackages: ['livekit', 'livekit-agents'],
  },
];

/**
 * Scans the working directory for known framework dependencies and returns a
 * suggested Prefactor package when one clear match is found.
 */
export function detectSuggestedIntegration(cwd: string): SuggestedIntegration | null {
  const npmNames = readNpmDependencyNames(cwd);
  const pythonNames = readPythonDependencyNames(cwd);

  const matches: SuggestedIntegration[] = [];

  for (const rule of DETECT_RULES) {
    if (rule.language === 'typescript' && npmNames.size > 0 && matchesNpmRule(npmNames, rule)) {
      matches.push({
        language: rule.language,
        suggested_package: rule.suggested_package,
      });
    }

    if (
      rule.language === 'python' &&
      pythonNames.size > 0 &&
      matchesPythonRule(pythonNames, rule)
    ) {
      matches.push({
        language: rule.language,
        suggested_package: rule.suggested_package,
      });
    }
  }

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

function matchesNpmRule(npmNames: Set<string>, rule: DetectRule): boolean {
  for (const name of rule.npmPackages ?? []) {
    if (npmNames.has(name)) {
      return true;
    }
  }

  for (const prefix of rule.npmPrefixes ?? []) {
    for (const name of npmNames) {
      if (name.startsWith(prefix)) {
        return true;
      }
    }
  }

  return false;
}

function matchesPythonRule(pythonNames: Set<string>, rule: DetectRule): boolean {
  for (const name of rule.pythonPackages ?? []) {
    if (pythonNames.has(name)) {
      return true;
    }
  }

  return false;
}

function readNpmDependencyNames(cwd: string): Set<string> {
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    return new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function readPythonDependencyNames(cwd: string): Set<string> {
  const names = new Set<string>();

  const requirementsPath = join(cwd, 'requirements.txt');
  if (existsSync(requirementsPath)) {
    for (const line of readFileSync(requirementsPath, 'utf8').split(/\r?\n/)) {
      const name = parsePythonRequirementLine(line);
      if (name) {
        names.add(name);
      }
    }
  }

  const pyprojectPath = join(cwd, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    const content = readFileSync(pyprojectPath, 'utf8');
    const listBlock = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (listBlock) {
      for (const name of extractQuotedNames(listBlock[1])) {
        names.add(normalizePythonPackageName(name));
      }
    }
  }

  return names;
}

function parsePythonRequirementLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('-')) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z0-9_.-]+)/);
  return match ? normalizePythonPackageName(match[1]) : null;
}

function extractQuotedNames(text: string): string[] {
  const names: string[] = [];
  const re = /["']([A-Za-z0-9_.-]+)["']/g;
  let match = re.exec(text);
  while (match) {
    names.push(match[1]);
    match = re.exec(text);
  }
  return names;
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}
