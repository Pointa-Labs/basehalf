import type { GitRunResult } from './gitTypes.js';

export const GitErrorCodes = {
  BadConfigFile: 'BadConfigFile',
  BadRevision: 'BadRevision',
  AuthenticationFailed: 'AuthenticationFailed',
  NoRemoteRepositorySpecified: 'NoRemoteRepositorySpecified',
  NotAGitRepository: 'NotAGitRepository',
  NotASafeGitRepository: 'NotASafeGitRepository',
  Conflict: 'Conflict',
  RemoteConnectionError: 'RemoteConnectionError',
  DirtyWorkTree: 'DirtyWorkTree',
  CantAccessRemote: 'CantAccessRemote',
  RepositoryNotFound: 'RepositoryNotFound',
  RepositoryIsLocked: 'RepositoryIsLocked',
  BranchNotFullyMerged: 'BranchNotFullyMerged',
  NoRemoteReference: 'NoRemoteReference',
  InvalidBranchName: 'InvalidBranchName',
  BranchAlreadyExists: 'BranchAlreadyExists',
  NoUpstreamBranch: 'NoUpstreamBranch',
  CantLockRef: 'CantLockRef',
  CantRebaseMultipleBranches: 'CantRebaseMultipleBranches',
  TagConflict: 'TagConflict',
  BranchFastForwardRejected: 'BranchFastForwardRejected',
} as const;

export type GitErrorCode = (typeof GitErrorCodes)[keyof typeof GitErrorCodes];

export interface GitErrorData {
  readonly error?: Error | undefined;
  readonly message?: string | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly gitErrorCode?: GitErrorCode | undefined;
  readonly gitCommand?: string | undefined;
  readonly gitArgs?: readonly string[] | undefined;
}

export type GitIpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitErrorData };

export class GitError extends Error {
  override readonly name = 'GitError';
  error: Error | undefined;
  stdout: string | undefined;
  stderr: string | undefined;
  exitCode: number | undefined;
  gitErrorCode: GitErrorCode | undefined;
  gitCommand: string | undefined;
  gitArgs: readonly string[] | undefined;

  constructor(data: GitErrorData) {
    super(data.message ?? gitErrorMessage(data));
    this.error = data.error;
    this.stdout = data.stdout;
    this.stderr = data.stderr;
    this.exitCode = data.exitCode;
    this.gitErrorCode = data.gitErrorCode;
    this.gitCommand = data.gitCommand;
    this.gitArgs = data.gitArgs;
  }

  override toString(): string {
    return `${this.message} ${JSON.stringify({
      exitCode: this.exitCode,
      gitErrorCode: this.gitErrorCode,
      gitCommand: this.gitCommand,
      stdout: this.stdout,
      stderr: this.stderr,
    })}`;
  }
}

export function createGitErrorFromResult(
  result: GitRunResult,
  args: readonly string[],
  code = classifyGitError(result.stderr, result.stdout),
): GitError {
  return new GitError({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    gitErrorCode: code,
    gitCommand: args[0],
    gitArgs: args,
  });
}

export function ensureGitError(err: unknown): GitError {
  if (err instanceof GitError) return err;
  const data = gitErrorData(err);
  return new GitError({
    error: err instanceof Error ? err : undefined,
    message: data.message,
    stdout: data.stdout,
    stderr: data.stderr,
    exitCode: data.exitCode,
    gitErrorCode: data.gitErrorCode ?? classifyGitError(data.stderr ?? '', data.stdout ?? ''),
    gitCommand: data.gitCommand,
    gitArgs: data.gitArgs,
  });
}

export function gitErrorToData(err: unknown): GitErrorData {
  const gitError = ensureGitError(err);
  return {
    message: gitError.message,
    stdout: gitError.stdout,
    stderr: gitError.stderr,
    exitCode: gitError.exitCode,
    gitErrorCode: gitError.gitErrorCode,
    gitCommand: gitError.gitCommand,
    gitArgs: gitError.gitArgs,
  };
}

export function gitIpcSuccess<T>(value: T): GitIpcResult<T> {
  return { ok: true, value };
}

export function gitIpcFailure(err: unknown): GitIpcResult<never> {
  return { ok: false, error: gitErrorToData(err) };
}

export function unwrapGitIpcResult<T>(raw: unknown): T {
  if (!isGitIpcResult(raw)) return raw as T;
  if (raw.ok) return raw.value as T;
  throw new GitError(raw.error);
}

export function assignGitErrorCode(err: unknown, code: GitErrorCode): GitError {
  const gitError = ensureGitError(err);
  gitError.gitErrorCode = code;
  return gitError;
}

export function classifyGitError(stderr: string, stdout = ''): GitErrorCode | undefined {
  const text = `${stderr}\n${stdout}`;
  if (
    /Another git process seems to be running in this repository|If no other git process is currently running/.test(
      text,
    )
  ) {
    return GitErrorCodes.RepositoryIsLocked;
  }
  if (/Authentication failed/i.test(text)) return GitErrorCodes.AuthenticationFailed;
  if (/Not a git repository/i.test(text)) return GitErrorCodes.NotAGitRepository;
  if (/bad config file/.test(text)) return GitErrorCodes.BadConfigFile;
  if (/Repository not found/.test(text)) return GitErrorCodes.RepositoryNotFound;
  if (/unable to access/.test(text)) return GitErrorCodes.CantAccessRemote;
  if (/branch '.+' is not fully merged/.test(text)) return GitErrorCodes.BranchNotFullyMerged;
  if (/Couldn'?t find remote ref/.test(text)) return GitErrorCodes.NoRemoteReference;
  if (/A branch named '.+' already exists/.test(text)) return GitErrorCodes.BranchAlreadyExists;
  if (/'.+' is not a valid branch name/.test(text)) return GitErrorCodes.InvalidBranchName;
  if (/Please,? commit your changes or stash them/.test(text)) return GitErrorCodes.DirtyWorkTree;
  if (/detected dubious ownership in repository at/.test(text))
    return GitErrorCodes.NotASafeGitRepository;
  if (
    /There is no tracking information for the current branch|no tracking information/i.test(text)
  ) {
    return GitErrorCodes.NoUpstreamBranch;
  }
  if (
    /fatal: ambiguous argument|fatal: bad revision|unknown revision|Needed a single revision/i.test(
      text,
    )
  ) {
    return GitErrorCodes.BadRevision;
  }
  return undefined;
}

export function gitErrorMessage(data: Pick<GitErrorData, 'message' | 'stderr' | 'stdout'>): string {
  return (
    firstGitOutputLine(data.stderr) ??
    firstGitOutputLine(data.stdout) ??
    data.message ??
    'Git error'
  );
}

function firstGitOutputLine(output: string | undefined): string | undefined {
  const line = output
    ?.split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== '');
  return line;
}

function gitErrorData(err: unknown): GitErrorData {
  if (typeof err !== 'object' || err === null) {
    return { message: String(err) };
  }
  const record = err as Record<string, unknown>;
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    stdout: typeof record.stdout === 'string' ? record.stdout : undefined,
    stderr: typeof record.stderr === 'string' ? record.stderr : undefined,
    exitCode: typeof record.exitCode === 'number' ? record.exitCode : undefined,
    gitErrorCode: isGitErrorCode(record.gitErrorCode) ? record.gitErrorCode : undefined,
    gitCommand: typeof record.gitCommand === 'string' ? record.gitCommand : undefined,
    gitArgs: Array.isArray(record.gitArgs)
      ? record.gitArgs.filter((arg): arg is string => typeof arg === 'string')
      : undefined,
  };
}

function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === 'string' && Object.values(GitErrorCodes).includes(value as GitErrorCode);
}

function isGitIpcResult(raw: unknown): raw is GitIpcResult<unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (value.ok === true) return 'value' in value;
  if (value.ok !== false) return false;
  return typeof value.error === 'object' && value.error !== null && !Array.isArray(value.error);
}
