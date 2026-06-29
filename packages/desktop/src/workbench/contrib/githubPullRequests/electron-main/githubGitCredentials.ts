import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { dirname, join } from 'node:path';
import type { GitRunner } from '../../scm/common/git.js';
import {
  type GitCredentialsProvider,
  type GitCredentialsProviderRegistration,
  GitCredentialsProviderRegistry,
  createCredentialedGitRunner,
} from '../../scm/electron-main/gitCredentials.js';
import { systemGit } from '../../scm/electron-main/systemGit.js';

export const GITHUB_TOKEN_SECRET_KEY = 'github.token';

export interface GithubCredentialsTokenProvider {
  getToken(): Promise<string | null>;
}

export interface GithubGitCredentialsProviderOptions {
  readonly configDir: string;
  readonly tokenProvider: GithubCredentialsTokenProvider;
}

export interface GithubAskpassBroker {
  readonly url: string;
  readonly authToken: string;
  dispose(): Promise<void>;
}

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
      *Password*)
        if command -v curl >/dev/null 2>&1 && [ -n "\${BH_GIT_ASKPASS_URL}" ] && [ -n "\${BH_GIT_ASKPASS_TOKEN}" ]; then
          curl --fail --silent --max-time 5 -H "Authorization: Bearer \${BH_GIT_ASKPASS_TOKEN}" "\${BH_GIT_ASKPASS_URL}/password" || printf '\\n'
        else
          printf '\\n'
        fi
        ;;
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
  broker: Pick<GithubAskpassBroker, 'url' | 'authToken'>,
): Readonly<Record<string, string>> {
  return {
    GIT_ASKPASS: scriptPath,
    GIT_TERMINAL_PROMPT: '0',
    GIT_HTTP_USER_AGENT: 'BaseHalf',
    BH_GIT_ASKPASS_USERNAME: 'x-access-token',
    BH_GIT_ASKPASS_URL: broker.url,
    BH_GIT_ASKPASS_TOKEN: broker.authToken,
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

  if (args[0] === 'fetch' && (args.includes('--all') || args.includes('--multiple'))) {
    return hasGithubFetchRemote(args, opts, base);
  }

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

export async function createGithubAskpassBroker(secret: string): Promise<GithubAskpassBroker> {
  const authToken = randomUUID();
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/password') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(secret);
  });
  await listenLocalhost(server);
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    await closeServer(server);
    throw new Error('Failed to start GitHub askpass broker.');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    authToken,
    dispose: () => closeServer(server),
  };
}

/**
 * Desktop-side GitHub credentials provider for git.exe/git. This mirrors VS
 * Code's Git extension credentials provider boundary: the renderer never
 * receives the token, and the git module stays generic; the host injects
 * credentials only for matching network git ops.
 */
export class GithubGitCredentialsProvider implements GitCredentialsProvider {
  readonly id = 'github';

  constructor(private readonly opts: GithubGitCredentialsProviderOptions) {}

  async provideGitEnvironment(
    args: readonly string[],
    gitOpts: Parameters<GitRunner>[1],
    base: GitRunner,
  ): Promise<{ readonly env: Readonly<Record<string, string>>; dispose(): Promise<void> } | null> {
    if (!isRemoteGitCommand(args)) return null;

    const token = await this.opts.tokenProvider.getToken();
    if (token === null || token.trim() === '') return null;
    if (!(await shouldInjectGithubAskpass(args, gitOpts, base))) return null;

    const scriptPath = await ensureGithubAskpassScript(this.opts.configDir);
    const broker = await createGithubAskpassBroker(token);
    return {
      env: githubAskpassEnv(scriptPath, broker),
      dispose: () => broker.dispose(),
    };
  }
}

export function registerGithubGitCredentialsProvider(
  registry: GitCredentialsProviderRegistry,
  options: GithubGitCredentialsProviderOptions,
): GitCredentialsProviderRegistration {
  return registry.register(new GithubGitCredentialsProvider(options));
}

export function createGithubGitRunner(
  configDir: string,
  tokenProvider: GithubCredentialsTokenProvider,
  base: GitRunner = systemGit(),
): GitRunner {
  const registry = new GitCredentialsProviderRegistry();
  registerGithubGitCredentialsProvider(registry, { configDir, tokenProvider });
  return createCredentialedGitRunner(registry, base);
}

async function listenLocalhost(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err === undefined ? resolve() : reject(err)));
  });
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

async function hasGithubFetchRemote(
  args: readonly string[],
  opts: Parameters<GitRunner>[1],
  base: GitRunner,
): Promise<boolean> {
  const remotes = args.includes('--all')
    ? await allRemoteNames(opts, base)
    : gitCommandPositionals(args.slice(1));
  for (const remote of remotes) {
    if (gitUrlHost(remote) !== null) {
      if (isGithubUrl(remote)) return true;
      continue;
    }
    if (await remoteResolvesToGithub(remote, opts, base)) return true;
  }
  return false;
}

async function allRemoteNames(
  opts: Parameters<GitRunner>[1],
  base: GitRunner,
): Promise<readonly string[]> {
  const res = await base(['remote'], {
    ...opts,
    acceptExitCodes: [0, 2, 128],
  });
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

async function remoteResolvesToGithub(
  remote: string,
  opts: Parameters<GitRunner>[1],
  base: GitRunner,
): Promise<boolean> {
  const res = await base(['remote', 'get-url', remote], {
    ...opts,
    acceptExitCodes: [0, 2, 128],
  });
  return res.exitCode === 0 && isGithubUrl(res.stdout.trim());
}
