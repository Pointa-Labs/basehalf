// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

/**
 * Something the command could not do, in words for the person who ran it:
 * what could not be done, and what they can do. The command prints the
 * message alone and ends with status 1.
 */
export class InstallError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InstallError';
  }
}

/** The run was interrupted. The command leaves nothing and says nothing more. */
export class Interrupted extends Error {
  constructor() {
    super('interrupted');
    this.name = 'Interrupted';
  }
}

/**
 * Stops at once when the run was interrupted.
 * @param {AbortSignal | undefined} signal
 */
export function throwIfInterrupted(signal) {
  if (signal?.aborted) {
    throw new Interrupted();
  }
}

/**
 * The code of a failure of the file system, such as `ENOENT`.
 * @param {unknown} error
 * @returns {string | undefined}
 */
export function errorCode(error) {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}
