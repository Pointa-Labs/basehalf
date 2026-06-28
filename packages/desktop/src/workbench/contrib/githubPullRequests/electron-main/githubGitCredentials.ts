import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SecretStore } from '../../../../platform/secrets/common/secrets.js';
import type { GitRunner } from '../../scm/common/git.js';
import { systemGit } from '../../scm/electron-main/systemGit.js';

export const GITHUB_TOKEN_SECRET_KEY = 'github.token';

export type { SecretStore };

export const GITHUB_ASKPASS_SCRIPT = `#!/bin/sh
host_from_prompt() {
  rest="$1"
  case "$rest" in
    *://*) rest="\${rest#*://}" ;;
  esac
  rest="\${rest%% *}"
  rest="\${rest%%\\'*}"
  rest="\${rest%%\\"*}"
  rest="\${rest%%)*}"
  hostport="\${rest%%/*}"
  hostport="\${hostport%%:*}"
  printf '%s\\n' "\${hostport##*@}"
}

case "$(host_from_prompt "$*")" in
  github.com|api.github.com)
    case "$*" in
      *Username*) printf '%s\\n' "\${BH_GIT_ASKPASS_USERNAME:-x-access-token}" ;;
      *Password*) printf '%s\\n' "\${BH_GIT_ASKPASS_PASSWORD}" ;;
      *) printf '\\n' ;;
    esac
    ;;
  *) printf '\\n' ;;
esac
`;

const REMOTE_GIT_COMMANDS = new Set(['fetch', 'pull', 'push', 'ls-remote', 'clone']);

export function isRemoteGitCommand(args: readonly string[]): boolean {
  const command = args[0];
  return command !== undefined && REMOTE_GIT_COMMANDS.has(command);
}

export function githubAskpassEnv(
  scriptPath: string,
  token: string,
): Readonly<Record<string, string>> {
  return {
    GIT_ASKPASS: scriptPath,
    GIT_TERMINAL_PROMPT: '0',
    GIT_HTTP_USER_AGENT: 'BaseHalf',
    BH_GIT_ASKPASS_USERNAME: 'x-access-token',
    BH_GIT_ASKPASS_PASSWORD: token,
  };
}

export function gitUrlHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    const scpLike = /^[^@\s]+@([^:\s]+):[^:\s].*$/.exec(value);
    return scpLike?.[1] ?? null;
  }
}

export function isGithubHost(host: string | null): boolean {
  const normalized = host?.toLowerCase() ?? null;
  return normalized === 'github.com' || normalized === 'api.github.com';
}

export function isGithubUrl(value: string): boolean {
  return isGithubHost(gitUrlHost(value));
}

export function remoteNameForGitCommand(args: readonly string[]): string | null {
  const command = args[0];
  const positional = gitCommandPositionals(args.slice(1));
  if (command === 'fetch') {
    if (args.includes('--all') || args.includes('--multiple')) return null;
    return positional[0] ?? 'origin';
  }
  if (command === 'pull' || command === 'ls-remote') return positional[0] ?? null;
  if (command === 'push') {
    const repo = gitOptionValue(args.slice(1), '--repo');
    if (repo !== null) return repo;
    const first = positional[0];
    if (first === undefined || first.includes(':')) return null;
    return first;
  }
  return null;
}

async function shouldInjectGithubAskpass(
  args: readonly string[],
  opts: Parameters<GitRunner>[1],
  base: GitRunner,
): Promise<boolean> {
  const directUrl = args.find((arg) => gitUrlHost(arg) !== null);
  if (directUrl !== undefined) return isGithubUrl(directUrl);

  const remote = remoteNameForGitCommand(args);
  if (remote === null || gitUrlHost(remote) !== null) return remote !== null && isGithubUrl(remote);

  const res = await base(['remote', 'get-url', remote], {
    ...opts,
    acceptExitCodes: [0, 2, 128],
  });
  return res.exitCode === 0 && isGithubUrl(res.stdout.trim());
}

export async function ensureGithubAskpassScript(configDir: string): Promise<string> {
  const scriptPath = join(configDir, 'git', 'github-askpass.sh');
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, GITHUB_ASKPASS_SCRIPT, { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

/**
 * Desktop-side GitHub credentials provider for git.exe/git. This mirrors VS Code's
 * Git extension askpass boundary: the renderer never receives the token, and the
 * git module stays generic; the host injects credentials only for network git ops.
 */
export function createGithubGitRunner(
  configDir: string,
  secrets: SecretStore,
  base: GitRunner = systemGit(),
): GitRunner {
  return async (args, opts) => {
    if (!isRemoteGitCommand(args)) return base(args, opts);

    const token = await secrets.get(GITHUB_TOKEN_SECRET_KEY);
    if (token === null || token.trim() === '') return base(args, opts);
    if (!(await shouldInjectGithubAskpass(args, opts, base))) return base(args, opts);

    const scriptPath = await ensureGithubAskpassScript(configDir);
    return base(args, {
      ...opts,
      env: {
        ...(opts.env ?? {}),
        ...githubAskpassEnv(scriptPath, token),
      },
    });
  };
}

const GIT_REMOTE_OPTIONS_WITH_VALUE = new Set([
  '--config-env',
  '--depth',
  '--exec',
  '--jobs',
  '--negotiation-tip',
  '--receive-pack',
  '--refmap',
  '--repo',
  '--server-option',
  '--shallow-exclude',
  '--shallow-since',
  '--strategy',
  '--strategy-option',
  '--upload-pack',
  '-c',
  '-j',
  '-o',
  '-s',
  '-X',
]);

function gitCommandPositionals(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (GIT_REMOTE_OPTIONS_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    out.push(arg);
  }
  return out;
}

function gitOptionValue(args: readonly string[], option: string): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === option) return args[i + 1] ?? null;
    const prefix = `${option}=`;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}
