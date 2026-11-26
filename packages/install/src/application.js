// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { InstallError, errorCode } from './errors.js';

export const APPLICATION_NAME = 'BaseHalf.app';

/** The name of what the run unpacks into, inside the place. It starts with a dot, so the system does not show it. */
const STAGE_PREFIX = '.basehalf-install-';
/** A folder of that name which is older than this belongs to a run that was killed. */
const STALE_STAGE_MS = 60 * 60_000;

/**
 * A BaseHalf that can be used as it is.
 * @typedef {object} Application
 * @property {string} path The bundle, `<place>/BaseHalf.app`.
 * @property {string} place The folder it is in.
 * @property {string} version
 * @property {string} launcher Its command-line launcher.
 */

/**
 * What is at a path where BaseHalf would be: nothing, a BaseHalf whose
 * product file names it and which has its launcher, or something else.
 * @param {string} place
 * @param {string} [name]
 * @returns {Promise<{ state: 'missing' } | { state: 'other', path: string } | { state: 'usable', application: Application }>}
 */
export async function inspectApplication(place, name = APPLICATION_NAME) {
  const path = join(place, name);
  try {
    await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
      return { state: 'missing' };
    }
    return { state: 'other', path };
  }
  const resources = join(path, 'Contents', 'Resources', 'app');
  const launcher = join(resources, 'bin', 'basehalf');
  try {
    /** @type {unknown} */
    const product = JSON.parse(await readFile(join(resources, 'product.json'), 'utf8'));
    if (typeof product !== 'object' || product === null) {
      return { state: 'other', path };
    }
    const { applicationName, basehalfVersion } = /** @type {Record<string, unknown>} */ (product);
    if (applicationName !== 'basehalf' || typeof basehalfVersion !== 'string') {
      return { state: 'other', path };
    }
    if (!(await lstat(launcher)).isFile()) {
      return { state: 'other', path };
    }
    return { state: 'usable', application: { path, place, version: basehalfVersion, launcher } };
  } catch {
    return { state: 'other', path };
  }
}

/**
 * The BaseHalf that is installed: the first usable one of the places, in
 * their order. Something else of that name stops the command when no place
 * holds a usable one, because the command replaces nothing.
 * @param {readonly string[]} places
 * @returns {Promise<Application | undefined>}
 */
export async function findApplication(places) {
  /** @type {string | undefined} */
  let other;
  for (const place of places) {
    const found = await inspectApplication(place);
    if (found.state === 'usable') {
      return found.application;
    }
    if (found.state === 'other') {
      other ??= found.path;
    }
  }
  if (other !== undefined) {
    throw new InstallError(
      `${other} is in the way: it is not a whole BaseHalf. Move it away and run this again.`,
    );
  }
  return undefined;
}

/**
 * Whether the user may make something in a folder.
 * @param {string} folder
 */
async function mayWrite(folder) {
  try {
    await access(folder, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The place a new BaseHalf goes: the first of the places that the user may
 * write to. The last place is the one of their home folder, which may be
 * missing: it counts when it can be made, and it is made only when the
 * application is placed.
 * @param {readonly string[]} places
 * @returns {Promise<string>}
 */
export async function choosePlace(places) {
  for (const [index, place] of places.entries()) {
    if (await mayWrite(place)) {
      return place;
    }
    if (index === places.length - 1) {
      const missing = await lstat(place).then(
        () => false,
        (error) => errorCode(error) === 'ENOENT',
      );
      if (missing && (await mayWrite(dirname(place)))) {
        return place;
      }
    }
  }
  throw new InstallError(
    `BaseHalf could not be installed: you may not write to ${places.join(' or ')}.`,
  );
}

/**
 * Removes what a run that was killed left in the place. A folder of a run
 * that is still unpacking is younger than this looks for.
 * @param {string} place
 */
async function removeStaleStages(place) {
  for (const name of await readdir(place)) {
    if (!name.startsWith(STAGE_PREFIX)) {
      continue;
    }
    try {
      const path = join(place, name);
      if (Date.now() - (await lstat(path)).mtimeMs > STALE_STAGE_MS) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // Another run removed it, or it may not be removed: it is not in the way.
    }
  }
}

/**
 * Unpacks a checked archive inside the place and gives what it holds the
 * name of the application by one rename. The archive has to hold exactly
 * one application, BaseHalf of the version the manifest names.
 *
 * Resolves the application, and whether it is one that appeared there
 * meanwhile, which is then used and not replaced.
 * @param {object} options
 * @param {string} options.archive
 * @param {string} options.place
 * @param {string} options.version
 * @param {(archive: string, folder: string, signal?: AbortSignal) => Promise<void>} options.unpack
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ application: Application, appeared: boolean }>}
 */
export async function placeApplication({ archive, place, version, unpack, signal }) {
  /** @type {string | undefined} */
  let made;
  /** @type {string | undefined} */
  let stage;
  try {
    try {
      made = await mkdir(place, { recursive: true });
      await removeStaleStages(place);
      stage = await mkdtemp(join(place, STAGE_PREFIX));
    } catch (error) {
      throw new InstallError(
        `BaseHalf ${version} could not be put into ${place}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await unpack(archive, stage, signal);
    const held = await readdir(stage);
    const unpacked = await inspectApplication(stage);
    if (
      held.length !== 1 ||
      unpacked.state !== 'usable' ||
      unpacked.application.version !== version
    ) {
      throw new InstallError(
        `The release of BaseHalf ${version} does not hold BaseHalf ${version} alone. Nothing was installed. Please report it at https://github.com/Pointa-Labs/basehalf/issues.`,
      );
    }
    if ((await inspectApplication(place)).state === 'missing') {
      try {
        await rename(unpacked.application.path, join(place, APPLICATION_NAME));
      } catch (error) {
        // Something took the name between the look and the rename.
        if (errorCode(error) !== 'ENOTEMPTY' && errorCode(error) !== 'EEXIST') {
          throw new InstallError(
            `BaseHalf ${version} could not be put into ${place}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const placed = await inspectApplication(place);
      if (placed.state === 'usable' && placed.application.version === version) {
        return { application: placed.application, appeared: false };
      }
    }
    const appeared = await inspectApplication(place);
    if (appeared.state === 'usable') {
      return { application: appeared.application, appeared: true };
    }
    throw new InstallError(
      `${join(place, APPLICATION_NAME)} is in the way: it is not a whole BaseHalf. Move it away and run this again.`,
    );
  } finally {
    if (stage !== undefined) {
      await rm(stage, { recursive: true, force: true });
    }
    if (made !== undefined) {
      // A place that this run made and that holds nothing goes again.
      await rmdir(place).catch(() => {});
    }
  }
}
