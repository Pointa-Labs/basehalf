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
