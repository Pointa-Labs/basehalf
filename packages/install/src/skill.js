// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { lstat, readlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { throwIfInterrupted } from './errors.js';

/**
 * The command reads the state of the skill and never writes it: BaseHalf
 * installs its skill (the install command, "The skill"). The entries and
 * the copy are the ones of the agent skill's "Where it is installed".
 */

/** The option of the application's command line that installs the skill. */
export const INSTALL_SKILL_OPTION = '--install-agent-skill';

/** The agents' entries, below the home folder, with the agents' names in messages. */
export const SKILL_ENTRIES = Object.freeze([
  Object.freeze({ label: 'Claude Code', segments: ['.claude', 'skills', 'basehalf'] }),
  Object.freeze({ label: 'Codex', segments: ['.agents', 'skills', 'basehalf'] }),
]);

/** BaseHalf's own copy of the skill, below the home folder, which the entries link to. */
const SKILL_COPY_SEGMENTS = ['.basehalf', 'agent-skill', 'basehalf'];

/**
 * The agents whose entry is a link to BaseHalf's own copy, while that copy
 * holds the skill.
 * @param {string} home
 * @returns {Promise<string[]>}
 */
export async function linkedAgents(home) {
  const copy = join(home, ...SKILL_COPY_SEGMENTS);
  try {
    if (!(await lstat(join(copy, 'SKILL.md'))).isFile()) {
      return [];
    }
  } catch {
    return [];
  }
  /** @type {string[]} */
  const linked = [];
  for (const entry of SKILL_ENTRIES) {
    const path = join(home, ...entry.segments);
    try {
      if (resolve(dirname(path), await readlink(path)) === copy) {
        linked.push(entry.label);
      }
    } catch {
      // Missing, or not a link: not installed there.
    }
  }
  return linked;
}

/**
 * Looks at the agents' entries until both are links, or until BaseHalf
 * made one and `graceMs` brought no second, for at most `timeoutMs`.
 * `linkedBefore` is how many were links before BaseHalf was asked, so that
 * a link of an earlier day is not taken for its answer. Resolves the agents
 * whose entries are links then, or none when BaseHalf made no link in time.
 * @param {object} options
 * @param {string} options.home
 * @param {number} options.linkedBefore
 * @param {number} options.timeoutMs
 * @param {number} options.graceMs
 * @param {number} options.intervalMs
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string[]>}
 */
export async function waitForSkill({ home, linkedBefore, timeoutMs, graceMs, intervalMs, signal }) {
  const started = Date.now();
  /** @type {number | undefined} */
  let firstSeen;
  for (;;) {
    throwIfInterrupted(signal);
    const linked = await linkedAgents(home);
    const now = Date.now();
    if (linked.length === SKILL_ENTRIES.length) {
      return linked;
    }
    if (linked.length > linkedBefore) {
      firstSeen ??= now;
      if (now - firstSeen >= graceMs) {
        return linked;
      }
    }
    if (now - started >= timeoutMs) {
      return linked.length > linkedBefore ? linked : [];
    }
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}
