import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import type { GitRunResult, GitRunner } from '../common/git.js';

export class GitError extends Error {
  override readonly name = 'GitError';

  constructor(
    readonly exitCode: number,
    readonly stderr: string,
    readonly args: readonly string[],
  ) {
    super(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim().split('\n')[0] ?? ''}`);
  }
}

const GIT_DEFAULT_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export function systemGit(): GitRunner {
  return (args, opts) =>
    new Promise<GitRunResult>((resolve, reject) => {
      const accept = opts.acceptExitCodes ?? [0];
      const timeoutMs = opts.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
      const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
        cwd: opts.cwd,
        env: {
          ...process.env,
          ...(opts.env ?? {}),
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'en_US.UTF-8',
          LANG: 'en_US.UTF-8',
          LANGUAGE: 'en',
          GIT_PAGER: 'cat',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let outLen = 0;
      let errLen = 0;
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const overflow = (): void => {
        child.kill('SIGKILL');
        finish(() =>
          reject(new Error(`git ${args.join(' ')} output exceeded ${GIT_MAX_OUTPUT_BYTES} bytes`)),
        );
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        outLen += chunk.length;
        if (outLen > GIT_MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        outChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errLen += chunk.length;
        if (errLen > GIT_MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        errChunks.push(chunk);
      });
      child.on('error', (err) => finish(() => reject(err)));
      child.stdin.on('error', () => undefined);
      child.on('close', (code) => {
        const exitCode = code ?? -1;
        const stdout = Buffer.concat(outChunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8');
        finish(() =>
          accept.includes(exitCode)
            ? resolve({ stdout, stderr, exitCode })
            : reject(new GitError(exitCode, stderr, args)),
        );
      });
      child.stdin.end(opts.stdin ?? '');
    });
}
