// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallError, Interrupted } from './errors.js';
import { FEED_URL, RELEASE_PUBLIC_KEY } from './release.js';

/**
 * @typedef {import('./install.js').Environment} Environment
 * @typedef {import('./install.js').RunResult} RunResult
 */

/** The longest help and the longest refusal of a launcher are far below this. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs a program to its end and resolves what it answered. A program that
 * cannot be started, or that takes too long, answers with a status other
 * than 0 and the reason on its standard error.
 * @param {string} file
 * @param {readonly string[]} args
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 * @returns {Promise<RunResult>}
 */
export function run(file, args, timeoutMs, signal) {
  return new Promise((done) => {
    execFile(
      file,
      [...args],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: launchEnvironment(process.env),
        ...(signal ? { signal } : {}),
      },
      (error, stdout, stderr) => {
        if (!error) {
          done({ status: 0, stdout, stderr });
          return;
        }
        const status = typeof error.code === 'number' && error.code !== 0 ? error.code : 1;
        const said = error.killed
          ? `it did not end in ${Math.round(timeoutMs / 1000)} seconds`
          : stderr.trim()
            ? stderr
            : error.message;
        done({ status, stdout, stderr: said });
      },
    );
  });
}

/**
 * The environment of what the command starts. BaseHalf takes the
 * environment it is started with for its own, and its terminals inherit
 * it, so nothing of this run goes along: not what this Node was told to
 * load, and not what `npx` adds for the program it runs, which would stay
 * in every terminal of that BaseHalf.
 * @param {NodeJS.ProcessEnv} environment
 * @returns {NodeJS.ProcessEnv}
 */
export function launchEnvironment(environment) {
  /** @type {NodeJS.ProcessEnv} */
  const kept = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      value === undefined ||
      name.startsWith('npm_') ||
      ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'INIT_CWD', 'NODE', 'COLOR'].includes(name)
    ) {
      continue;
    }
    kept[name] =
      name === 'PATH'
        ? value
            .split(':')
            .filter((entry) => !/[/]node_modules[/]\.bin[/]?$|[/]node-gyp-bin[/]?$/.test(entry))
            .join(':')
        : value;
  }
  return kept;
}

/**
 * Unpacks an archive with the system's own tool, which keeps what an
 * application bundle needs: its links, and what its files are marked with.
 * @param {string} archive
 * @param {string} folder
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
async function unpack(archive, folder, signal) {
  const result = await run('/usr/bin/ditto', ['-x', '-k', archive, folder], 10 * 60_000, signal);
  if (signal?.aborted) {
    throw new Interrupted();
  }
  if (result.status !== 0) {
    throw new InstallError(
      `BaseHalf could not be unpacked: ${result.stderr.trim() || `the system's tool ended with status ${result.status}`}. Nothing was installed.`,
    );
  }
}

/** Whether the system translates this process for another processor. */
async function translated() {
  const result = await run('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], 5_000);
  return result.status === 0 && result.stdout.trim() === '1';
}

/** The folder the command runs in, or none when it was removed meanwhile. */
function currentFolder() {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/**
 * The computer the command runs on.
 * @param {object} options
 * @param {(line: string) => void} options.print
 * @param {(received: number, length: number) => void} [options.progress]
 * @param {AbortSignal} [options.signal]
 * @returns {Environment}
 */
export function systemEnvironment({ print, progress, signal }) {
  const home = homedir();
  return {
    platform: process.platform,
    arch: process.arch,
    translated,
    home,
    cwd: currentFolder(),
    places: ['/Applications', join(home, 'Applications')],
    tmpdir: tmpdir(),
    fetch: globalThis.fetch,
    feedUrl: FEED_URL,
    publicKey: RELEASE_PUBLIC_KEY,
    unpack,
    run: (file, args, timeoutMs) => run(file, args, timeoutMs, signal),
    print,
    ...(progress ? { progress } : {}),
    stallMs: 60_000,
    skillTimeoutMs: 60_000,
    skillGraceMs: 2_000,
    skillIntervalMs: 250,
    ...(signal ? { signal } : {}),
  };
}
