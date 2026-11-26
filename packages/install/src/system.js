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
  // What starts BaseHalf is not this Node: what this Node was told to load
  // is not for it.
  const { NODE_OPTIONS: _options, ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  return new Promise((done) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env, ...(signal ? { signal } : {}) },
      (error, stdout, stderr) => {
        if (!error) {
          done({ status: 0, stdout, stderr });
          return;
        }
        const status = typeof error.code === 'number' && error.code !== 0 ? error.code : 1;
        done({ status, stdout, stderr: stderr.trim() ? stderr : error.message });
      },
    );
  });
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
    cwd: process.cwd(),
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
