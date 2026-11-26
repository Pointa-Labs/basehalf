// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

export const USAGE = [
  'Usage: npx basehalf [folder] [--no-skill]',
  '',
  'Installs BaseHalf when it is not installed, opens the folder as a canvas,',
  'and installs the BaseHalf skill for your agents.',
  '',
  '  folder       The folder to open. Without it, the folder you are in.',
  '  --no-skill   Leave the skill as it is.',
  '  --help       Print this.',
  '  --version    Print the version of this command.',
].join('\n');

/**
 * What a command line asks for.
 * @typedef {{ kind: 'run', folder: string | undefined, skill: boolean }
 *   | { kind: 'help' }
 *   | { kind: 'version' }
 *   | { kind: 'refused', reason: string }} Request
 */

/**
 * Reads the arguments after the command's name. Options are read anywhere
 * on the line, and what follows `--` is a folder whatever it starts with.
 * @param {readonly string[]} argv
 * @returns {Request}
 */
export function parseArguments(argv) {
  /** @type {string[]} */
  const folders = [];
  /** @type {string[]} */
  const unknown = [];
  let skill = true;
  let help = false;
  let version = false;
  let optionsEnded = false;
  for (const argument of argv) {
    if (optionsEnded || !argument.startsWith('-') || argument === '-') {
      folders.push(argument);
    } else if (argument === '--') {
      optionsEnded = true;
    } else if (argument === '--no-skill') {
      skill = false;
    } else if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--version' || argument === '-v') {
      version = true;
    } else {
      unknown.push(argument);
    }
  }
  const first = unknown[0];
  if (first !== undefined) {
    return { kind: 'refused', reason: `Unknown option ${first}.` };
  }
  if (folders.length > 1) {
    return { kind: 'refused', reason: 'Name one folder.' };
  }
  if (help) {
    return { kind: 'help' };
  }
  if (version) {
    return { kind: 'version' };
  }
  return { kind: 'run', folder: folders[0], skill };
}
