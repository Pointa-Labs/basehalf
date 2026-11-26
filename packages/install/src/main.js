// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { readFile } from 'node:fs/promises';
import { USAGE, parseArguments } from './arguments.js';
import { InstallError, Interrupted } from './errors.js';
import { install } from './install.js';
import { systemEnvironment } from './system.js';

/** The version of this package, which is not the version of BaseHalf. */
async function packageVersion() {
  /** @type {unknown} */
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  return typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? String(manifest.version)
    : '';
}

/**
 * The progress of the download on one line of a terminal, written again
 * for each whole percent.
 * @param {NodeJS.WriteStream} stream
 * @returns {{ progress: (received: number, length: number) => void, end: () => void }}
 */
function progressLine(stream) {
  let shown = -1;
  return {
    progress(received, length) {
      const percent = Math.floor((received / length) * 100);
      if (percent !== shown) {
        shown = percent;
        stream.write(`\r${percent}%`);
      }
    },
    end() {
      if (shown !== -1) {
        shown = -1;
        stream.write('\r    \r');
      }
    },
  };
}

/**
 * Runs the command and resolves its status.
 * @param {readonly string[]} argv The arguments after the command's name.
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const request = parseArguments(argv);
  if (request.kind === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (request.kind === 'version') {
    console.log(await packageVersion());
    return 0;
  }
  if (request.kind === 'refused') {
    console.error(`${request.reason}\n\n${USAGE}`);
    return 1;
  }

  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const line = process.stderr.isTTY ? progressLine(process.stderr) : undefined;
  try {
    await install(
      request,
      systemEnvironment({
        print: (text) => {
          line?.end();
          console.log(text);
        },
        ...(line ? { progress: line.progress } : {}),
        signal: interrupted.signal,
      }),
    );
    return 0;
  } catch (error) {
    line?.end();
    if (error instanceof Interrupted || interrupted.signal.aborted) {
      return 130;
    }
    if (error instanceof InstallError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
