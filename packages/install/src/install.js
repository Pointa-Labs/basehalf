// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { choosePlace, findApplication, placeApplication } from './application.js';
import { downloadArchive } from './download.js';
import { InstallError, errorCode, throwIfInterrupted } from './errors.js';
import { readManifest } from './release.js';
import { INSTALL_SKILL_OPTION, SKILL_ENTRIES, linkedAgents, waitForSkill } from './skill.js';

/**
 * @typedef {import('./application.js').Application} Application
 */

/**
 * What a program that was run answered.
 * @typedef {object} RunResult
 * @property {number} status
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Everything of the computer that a run touches, so that a test can stand
 * in for each part (`system.js` is the real one).
 * @typedef {object} Environment
 * @property {string} platform Node's name of the system.
 * @property {string} arch Node's name of the processor.
 * @property {() => Promise<boolean>} translated Whether the system translates this Node for another processor.
 * @property {string} home The user's home folder.
 * @property {string | undefined} cwd The folder the command runs in, or none when it is gone.
 * @property {readonly string[]} places Where BaseHalf is looked for and installed, the home folder's last.
 * @property {string} tmpdir Where the folder of a download is made.
 * @property {typeof fetch} fetch
 * @property {string} feedUrl
 * @property {string} publicKey
 * @property {(archive: string, folder: string, signal?: AbortSignal) => Promise<void>} unpack
 * @property {(file: string, args: readonly string[], timeoutMs: number) => Promise<RunResult>} run
 * @property {(line: string) => void} print One line on standard output.
 * @property {(received: number, length: number) => void} [progress] The progress of the download, where a terminal shows it.
 * @property {number} stallMs How long a download may bring nothing, and how long the feed may take to answer.
 * @property {number} skillTimeoutMs
 * @property {number} skillGraceMs
 * @property {number} skillIntervalMs
 * @property {AbortSignal} [signal] Aborted when the run is interrupted.
 */

/** A translated Node on a computer BaseHalf runs on reports this processor. */
const TRANSLATED_ARCH = 'x64';
const HELP_TIMEOUT_MS = 20_000;
const OPEN_TIMEOUT_MS = 60_000;

/**
 * The folder to open, or none: the home folder and the root of a disk are
 * not opened. A folder that was named has to be one.
 * @param {string | undefined} named
 * @param {Environment} environment
 * @returns {Promise<string | undefined>}
 */
async function folderToOpen(named, environment) {
  const { cwd } = environment;
  if (cwd === undefined && (named === undefined || !isAbsolute(named))) {
    if (named === undefined) {
      return undefined;
    }
    throw new InstallError(
      `The folder this runs in is gone, so ${named} names nothing. Name the folder by its whole path.`,
    );
  }
  const path = named === undefined ? (cwd ?? '') : resolve(cwd ?? '', named);
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new InstallError(`${path} is a file. Name a folder.`);
    }
  } catch (error) {
    if (error instanceof InstallError) {
      throw error;
    }
    if (named === undefined) {
      // The folder the command runs in is gone: open none.
      return undefined;
    }
    throw new InstallError(
      errorCode(error) === 'ENOENT'
        ? `${path} does not exist. Name a folder that does.`
        : `${path} cannot be read. Name a folder that can.`,
    );
  }
  const real = await realpath(path);
  const home = await realpath(environment.home).catch(() => environment.home);
  return real === home || (await isRootOfADisk(real)) ? undefined : real;
}

/**
 * Whether a folder is the root of a disk: the root of all, or a folder on
 * another disk than the folder it is in, as a disk that was attached is.
 * @param {string} folder
 */
async function isRootOfADisk(folder) {
  const parent = dirname(folder);
  if (parent === folder) {
    return true;
  }
  try {
    return (await stat(folder)).dev !== (await stat(parent)).dev;
  } catch {
    return false;
  }
}

/**
 * @param {Environment} environment
 * @returns {Promise<void>}
 */
async function requireSupportedSystem(environment) {
  const supported =
    environment.platform === 'darwin' &&
    (environment.arch === 'arm64' ||
      (environment.arch === TRANSLATED_ARCH && (await environment.translated())));
  if (!supported) {
    throw new InstallError(
      'BaseHalf is not released for this computer yet: https://basehalf.com/download says which it runs on. Nothing was changed.',
    );
  }
}

/**
 * Downloads the latest release, checks it, and places it.
 * @param {Environment} environment
 * @returns {Promise<Application>}
 */
async function installApplication(environment) {
  const { signal } = environment;
  const place = await choosePlace(environment.places);
  const manifest = await readManifest({
    fetch: environment.fetch,
    feedUrl: environment.feedUrl,
    publicKey: environment.publicKey,
    timeoutMs: environment.stallMs,
    ...(signal ? { signal } : {}),
  });
  environment.print(
    `Downloading BaseHalf ${manifest.version} (${Math.round(manifest.length / 1_000_000)} MB).`,
  );
  const folder = await mkdtemp(join(environment.tmpdir, 'basehalf-install-')).catch((error) => {
    throw new InstallError(
      `BaseHalf could not be downloaded: no temporary folder could be made in ${environment.tmpdir} (${errorCode(error) ?? error}). Nothing was installed.`,
    );
  });
  try {
    const archive = join(folder, `BaseHalf-${manifest.version}.zip`);
    await downloadArchive({
      fetch: environment.fetch,
      manifest,
      publicKey: environment.publicKey,
      file: archive,
      stallMs: environment.stallMs,
      ...(environment.progress ? { onProgress: environment.progress } : {}),
      ...(signal ? { signal } : {}),
    });
    throwIfInterrupted(signal);
    const { application, appeared } = await placeApplication({
      archive,
      place,
      version: manifest.version,
      unpack: environment.unpack,
      ...(signal ? { signal } : {}),
    });
    environment.print(
      appeared
        ? `BaseHalf ${application.version} is already installed in ${application.place}.`
        : `BaseHalf ${application.version} installed in ${application.place}.`,
    );
    return application;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * What the run does about the skill: `left` as it is, `installed` already,
 * `asked` of the application, or left to the `window` of a BaseHalf that
 * has not the option.
 * @param {boolean} wanted
 * @param {Application} application
 * @param {Environment} environment
 * @returns {Promise<{ plan: 'left' | 'installed' | 'asked' | 'window', linkedBefore: number }>}
 */
async function skillPlan(wanted, application, environment) {
  if (!wanted) {
    return { plan: 'left', linkedBefore: 0 };
  }
  const linkedBefore = (await linkedAgents(environment.home)).length;
  if (linkedBefore === SKILL_ENTRIES.length) {
    return { plan: 'installed', linkedBefore };
  }
  const help = await environment.run(application.launcher, ['--help'], HELP_TIMEOUT_MS);
  const has = help.status === 0 && help.stdout.includes(INSTALL_SKILL_OPTION);
  return { plan: has ? 'asked' : 'window', linkedBefore };
}

/**
 * `Claude Code`, or `Claude Code and Codex`.
 * @param {readonly string[]} labels
 * @returns {string}
 */
function listed(labels) {
  return labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * One run of the command (the install command, "What it does, in order").
 * It prints one line for each thing it did and throws an `InstallError` for
 * what it could not do.
 * @param {{ folder: string | undefined, skill: boolean }} request
 * @param {Environment} environment
 * @returns {Promise<void>}
 */
export async function install(request, environment) {
  const { signal } = environment;
  const folder = await folderToOpen(request.folder, environment);
  await requireSupportedSystem(environment);

  let application = await findApplication(environment.places);
  if (application) {
    environment.print(
      `BaseHalf ${application.version} is already installed in ${application.place}.`,
    );
  } else {
    application = await installApplication(environment);
  }
  throwIfInterrupted(signal);

  const { plan, linkedBefore } = await skillPlan(request.skill, application, environment);
  const opened = await environment.run(
    application.launcher,
    [
      ...(plan === 'asked' ? [INSTALL_SKILL_OPTION] : []),
      ...(folder === undefined ? [] : [folder]),
    ],
    OPEN_TIMEOUT_MS,
  );
  if (opened.status !== 0) {
    const said = opened.stderr.trim() || `its launcher ended with status ${opened.status}`;
    throw new InstallError(
      `BaseHalf is installed in ${application.place} and could not be opened: ${said}`,
    );
  }
  environment.print(
    folder === undefined
      ? 'Opened BaseHalf without a folder: a canvas of your whole home folder or disk is not what you want. Run this again in the folder you want to see.'
      : `Opened ${folder} in BaseHalf.`,
  );

  if (plan === 'installed') {
    environment.print('The BaseHalf skill is already installed for your agents.');
  } else if (plan === 'window') {
    environment.print('BaseHalf asks in its window whether to install its skill for your agents.');
  } else if (plan === 'asked') {
    const agents = await waitForSkill({
      home: environment.home,
      linkedBefore,
      timeoutMs: environment.skillTimeoutMs,
      graceMs: environment.skillGraceMs,
      intervalMs: environment.skillIntervalMs,
      ...(signal ? { signal } : {}),
    });
    environment.print(
      agents.length > 0
        ? `The BaseHalf skill is installed for ${listed(agents)}. Agent sessions you start from now on can use it.`
        : 'BaseHalf has not confirmed its skill for your agents yet. Its window says why.',
    );
  }
}
