// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { chmod, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { choosePlace, findApplication, placeApplication } from '../src/application.js';
import { InstallError } from '../src/errors.js';
import { makeApplication, names, scratch } from './helpers.js';

/**
 * The words of what a step refused.
 * @param {() => Promise<unknown>} step
 */
async function refusal(step) {
  try {
    await step();
  } catch (error) {
    assert.ok(error instanceof InstallError, String(error));
    return error.message;
  }
  return 'not refused';
}

test('a usable BaseHalf is found in either place, the first place first', async (t) => {
  const root = await scratch(t);
  const [first, second, empty] = [join(root, 'a'), join(root, 'b'), join(root, 'c')];
  await makeApplication(first, '0.7.2');
  await makeApplication(second, '0.6.0');
  const found = async (/** @type {string[]} */ places) => {
    const application = await findApplication(places);
    return application && { place: application.place, version: application.version };
  };
  assert.deepEqual(
    {
      both: await found([first, second]),
      second: await found([empty, second]),
      none: await found([empty, join(root, 'missing')]),
      launcher: (await findApplication([first]))?.launcher,
    },
    {
      both: { place: first, version: '0.7.2' },
      second: { place: second, version: '0.6.0' },
      none: undefined,
      launcher: join(first, 'BaseHalf.app', 'Contents', 'Resources', 'app', 'bin', 'basehalf'),
    },
  );
});

test('something else of that name stops the command only when no place has a usable one', async (t) => {
  const root = await scratch(t);
  const half = join(root, 'half');
  const other = join(root, 'other');
  const file = join(root, 'file');
  const usable = join(root, 'usable');
  await makeApplication(half, '0.7.2', { whole: false });
  await makeApplication(other, '1.0.0', { applicationName: 'code' });
  await mkdir(file, { recursive: true });
  await writeFile(join(file, 'BaseHalf.app'), 'a file');
  await makeApplication(usable, '0.7.2');
  const inTheWay = (/** @type {string} */ place) =>
    `${join(place, 'BaseHalf.app')} is in the way: it is not a whole BaseHalf. Move it away and run this again.`;
  assert.deepEqual(
    {
      half: await refusal(() => findApplication([half])),
      other: await refusal(() => findApplication([other])),
      file: await refusal(() => findApplication([file])),
      besideUsable: (await findApplication([half, usable]))?.place,
    },
    { half: inTheWay(half), other: inTheWay(other), file: inTheWay(file), besideUsable: usable },
  );
});

test('a new BaseHalf goes where the user may write, and choosing a place makes nothing', async (t) => {
  const root = await scratch(t);
  const [open, locked, home] = [
    join(root, 'open'),
    join(root, 'locked'),
    join(root, 'home', 'Apps'),
  ];
  await mkdir(open);
  await mkdir(locked);
  await mkdir(join(root, 'home'));
  await chmod(locked, 0o555);
  // Someone who may write anywhere, such as root in a container, is refused nowhere.
  const mayWriteAnywhere = process.getuid?.() === 0;
  const chosen = {
    first: await choosePlace([open, home]),
    fallsBack: await choosePlace([locked, home]),
    made: await names(home),
    nowhere: await refusal(() => choosePlace([locked, locked])),
  };
  await chmod(locked, 0o755);
  assert.deepEqual(chosen, {
    first: open,
    fallsBack: mayWriteAnywhere ? locked : home,
    made: undefined,
    nowhere: mayWriteAnywhere
      ? 'not refused'
      : `BaseHalf could not be installed: you may not write to ${locked} or ${locked}.`,
  });
});

test('what is unpacked becomes the application, and nothing else is left', async (t) => {
  const place = await scratch(t);
  /** @type {string[]} */
  const unpackedInto = [];
  const { application, appeared } = await placeApplication({
    archive: 'archive.zip',
    place,
    version: '1.2.3',
    unpack: async (_archive, folder) => {
      unpackedInto.push(folder);
      await makeApplication(folder, '1.2.3');
    },
  });
  assert.deepEqual(
    {
      appeared,
      path: application.path,
      version: application.version,
      inPlace: await names(place),
      unpackedInsideThePlace: unpackedInto.map((folder) => folder.startsWith(join(place, '.'))),
    },
    {
      appeared: false,
      path: join(place, 'BaseHalf.app'),
      version: '1.2.3',
      inPlace: ['BaseHalf.app'],
      unpackedInsideThePlace: [true],
    },
  );
});

test('an archive that holds something else is refused and leaves nothing', async (t) => {
  const wrong =
    'The release of BaseHalf 1.2.3 does not hold BaseHalf 1.2.3 alone. Nothing was installed. Please report it at https://github.com/Pointa-Labs/basehalf/issues.';
  /** @param {(folder: string) => Promise<unknown>} unpack */
  const placed = async (unpack) => {
    const place = await scratch(t);
    const said = await refusal(() =>
      placeApplication({
        archive: 'archive.zip',
        place,
        version: '1.2.3',
        unpack: async (_archive, folder) => {
          await unpack(folder);
        },
      }),
    );
    return { said, left: await names(place) };
  };
  assert.deepEqual(
    {
      anotherVersion: await placed((folder) => makeApplication(folder, '1.2.4')),
      nothing: await placed(async () => {}),
      twoThings: await placed(async (folder) => {
        await makeApplication(folder, '1.2.3');
        await writeFile(join(folder, 'README.txt'), 'more');
      }),
      anotherName: await placed((folder) =>
        makeApplication(folder, '1.2.3', { name: 'Other.app' }),
      ),
      notWhole: await placed((folder) => makeApplication(folder, '1.2.3', { whole: false })),
      unpackFails: await placed(async () => {
        throw new InstallError('BaseHalf could not be unpacked.');
      }),
    },
    {
      anotherVersion: { said: wrong, left: [] },
      nothing: { said: wrong, left: [] },
      twoThings: { said: wrong, left: [] },
      anotherName: { said: wrong, left: [] },
      notWhole: { said: wrong, left: [] },
      unpackFails: { said: 'BaseHalf could not be unpacked.', left: [] },
    },
  );
});

test('a BaseHalf that appeared meanwhile is used, and what was unpacked is removed', async (t) => {
  const place = await scratch(t);
  const { application, appeared } = await placeApplication({
    archive: 'archive.zip',
    place,
    version: '1.2.3',
    unpack: async (_archive, folder) => {
      await makeApplication(folder, '1.2.3');
      // A second run finished first.
      await makeApplication(place, '1.2.2');
    },
  });
  const broken = await scratch(t);
  const said = await refusal(() =>
    placeApplication({
      archive: 'archive.zip',
      place: broken,
      version: '1.2.3',
      unpack: async (_archive, folder) => {
        await makeApplication(folder, '1.2.3');
        await makeApplication(broken, '1.2.3', { whole: false });
      },
    }),
  );
  assert.deepEqual(
    {
      appeared,
      version: application.version,
      inPlace: await names(place),
      said,
      left: await names(broken),
    },
    {
      appeared: true,
      version: '1.2.2',
      inPlace: ['BaseHalf.app'],
      said: `${join(broken, 'BaseHalf.app')} is in the way: it is not a whole BaseHalf. Move it away and run this again.`,
      left: ['BaseHalf.app'],
    },
  );
});

test('a place that is missing is made for the application, and goes again when nothing was placed', async (t) => {
  const root = await scratch(t);
  const kept = join(root, 'kept', 'Applications');
  const gone = join(root, 'gone', 'Applications');
  await mkdir(join(root, 'kept'));
  await mkdir(join(root, 'gone'));
  await placeApplication({
    archive: 'archive.zip',
    place: kept,
    version: '1.2.3',
    unpack: async (_archive, folder) => {
      await makeApplication(folder, '1.2.3');
    },
  });
  const said = await refusal(() =>
    placeApplication({
      archive: 'archive.zip',
      place: gone,
      version: '1.2.3',
      unpack: async () => {},
    }),
  );
  assert.deepEqual(
    { kept: await names(kept), gone: await names(join(root, 'gone')), said: said.slice(0, 26) },
    { kept: ['BaseHalf.app'], gone: [], said: 'The release of BaseHalf 1.' },
  );
});

test('what a killed run left is removed, and what a run of now unpacks into is not', async (t) => {
  const place = await scratch(t);
  const stale = join(place, '.basehalf-install-stale');
  const young = join(place, '.basehalf-install-young');
  await mkdir(stale);
  await mkdir(young);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
  await utimes(stale, twoHoursAgo, twoHoursAgo);
  await placeApplication({
    archive: 'archive.zip',
    place,
    version: '1.2.3',
    unpack: async (_archive, folder) => {
      await makeApplication(folder, '1.2.3');
    },
  });
  assert.deepEqual(await names(place), ['.basehalf-install-young', 'BaseHalf.app']);
});
