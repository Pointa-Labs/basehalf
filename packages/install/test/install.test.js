// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { InstallError, Interrupted } from '../src/errors.js';
import { install } from '../src/install.js';
import { SKILL_ENTRIES } from '../src/skill.js';
import {
  linkSkill,
  makeApplication,
  makeFetch,
  makeKey,
  makeManifest,
  names,
  scratch,
  stallingBody,
} from './helpers.js';

const FEED = 'https://example.test/feed.json';
const archive = Buffer.from('the bytes of an archive');
const HELP_WITH_OPTION = 'Options\n  --install-agent-skill  Install the BaseHalf skill.\n';
const HELP_WITHOUT_OPTION = 'Options\n  --generate <path>  Start a generation.\n';

/**
 * A computer of the test's own: a home folder with a project in it, two
 * places for applications, a feed with one signed release, and a launcher
 * that links the skill when it is asked to, as BaseHalf does.
 * @param {import('node:test').TestContext} t
 * @param {object} [options]
 * @param {string} [options.installed] The version of a BaseHalf that is there already.
 * @param {string} [options.help] What the launcher's help prints.
 * @param {boolean} [options.linksSkill] Whether the application links the skill when asked.
 * @param {Partial<import('../src/install.js').Environment>} [options.environment]
 * @param {(manifest: import('../src/release.js').Manifest) => Parameters<typeof makeFetch>[0]} [options.table] Other answers of the network.
 */
async function computer(t, options = {}) {
  const root = await scratch(t);
  const home = join(root, 'home');
  const project = join(home, 'project');
  const places = [join(root, 'Applications'), join(home, 'Applications')];
  const tmpdir = join(root, 'tmp');
  await mkdir(project, { recursive: true });
  await mkdir(places[0] ?? '');
  await mkdir(tmpdir);
  if (options.installed) {
    await makeApplication(places[0] ?? '', options.installed);
  }
  const key = makeKey();
  const manifest = makeManifest(key, archive);
  const network = makeFetch(
    options.table?.(manifest) ?? { [FEED]: { body: manifest }, [manifest.url]: { body: archive } },
  );
  /** @type {string[]} */
  const printed = [];
  /** @type {string[][]} */
  const launched = [];
  /** @type {import('../src/install.js').Environment} */
  const environment = {
    platform: 'darwin',
    arch: 'arm64',
    translated: async () => false,
    home,
    cwd: project,
    places,
    tmpdir,
    fetch: network.fetch,
    feedUrl: FEED,
    publicKey: key.publicKey,
    unpack: async (_archive, folder) => {
      await makeApplication(folder, manifest.version);
    },
    run: async (_file, args) => {
      launched.push([...args]);
      if (args.includes('--help')) {
        return { status: 0, stdout: options.help ?? HELP_WITH_OPTION, stderr: '' };
      }
      if (args.includes('--install-agent-skill') && options.linksSkill !== false) {
        for (const entry of SKILL_ENTRIES) {
          await linkSkill(home, entry.segments);
        }
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    print: (line) => printed.push(line),
    stallMs: 5_000,
    skillTimeoutMs: 150,
    skillGraceMs: 50,
    skillIntervalMs: 10,
    ...options.environment,
  };
  return {
    environment,
    manifest,
    key,
    home,
    project,
    places,
    tmpdir,
    printed,
    launched,
    asked: network.asked,
  };
}

/**
 * Runs the command and resolves the words of what it refused, if anything.
 * @param {{ folder?: string, skill?: boolean }} request
 * @param {import('../src/install.js').Environment} environment
 */
async function run(request, environment) {
  try {
    await install({ folder: request.folder, skill: request.skill ?? true }, environment);
    return undefined;
  } catch (error) {
    if (error instanceof Interrupted) {
      return 'interrupted';
    }
    assert.ok(error instanceof InstallError, String(error));
    return error.message;
  }
}

test('without BaseHalf: it is downloaded, placed, opened on the folder, and asked for its skill', async (t) => {
  const c = await computer(t);
  const refused = await run({}, c.environment);
  assert.deepEqual(
    {
      refused,
      printed: c.printed,
      launched: c.launched,
      asked: c.asked,
      placed: await names(c.places[0] ?? ''),
      temporary: await names(c.tmpdir),
      project: await names(c.project),
    },
    {
      refused: undefined,
      printed: [
        'Downloading BaseHalf 1.2.3 (0 MB).',
        `BaseHalf 1.2.3 installed in ${c.places[0]}.`,
        `Opened ${c.project} in BaseHalf.`,
        'The BaseHalf skill is installed for Claude Code and Codex. Agent sessions you start from now on can use it.',
      ],
      launched: [['--help'], ['--install-agent-skill', c.project]],
      asked: [FEED, c.manifest.url],
      placed: ['BaseHalf.app'],
      temporary: [],
      project: [],
    },
  );
});

test('with BaseHalf: nothing is asked of the network, and its version stays', async (t) => {
  const c = await computer(t, { installed: '0.7.2' });
  const refused = await run({}, c.environment);
  assert.deepEqual(
    { refused, printed: c.printed.slice(0, 2), launched: c.launched, asked: c.asked },
    {
      refused: undefined,
      printed: [
        `BaseHalf 0.7.2 is already installed in ${c.places[0]}.`,
        `Opened ${c.project} in BaseHalf.`,
      ],
      launched: [['--help'], ['--install-agent-skill', c.project]],
      asked: [],
    },
  );
});

test('the folder: a named one is opened, and the home folder and a root are not', async (t) => {
  const named = await computer(t, { installed: '0.7.2' });
  await mkdir(join(named.project, 'notes'));
  // Without BaseHalf, a refusal that came late would have asked the network.
  const refused = await computer(t);
  await writeFile(join(refused.project, 'plan.md'), '# Plan');
  const gone = await computer(t, { installed: '0.7.2' });
  const home = await computer(t, { installed: '0.7.2' });
  const root = await computer(t, { installed: '0.7.2' });
  const withoutFolder =
    'Opened BaseHalf without a folder: a canvas of your whole home folder or disk is not what you want. Run this again in the folder you want to see.';
  assert.deepEqual(
    {
      named: [await run({ folder: 'notes' }, named.environment), named.launched.at(-1)],
      missing: await run({ folder: 'gone' }, refused.environment),
      file: await run({ folder: 'plan.md' }, refused.environment),
      beforeARefusal: {
        asked: refused.asked,
        launched: refused.launched,
        printed: refused.printed,
      },
      folderOfTheRunIsGone: [
        await run({}, { ...gone.environment, cwd: undefined }),
        gone.launched.at(-1),
        await run({ folder: 'notes' }, { ...gone.environment, cwd: undefined }),
        await run({ folder: gone.project }, { ...gone.environment, cwd: undefined }),
        gone.launched.at(-1),
      ],
      home: [
        await run({}, { ...home.environment, cwd: home.home }),
        home.launched.at(-1),
        home.printed[1],
      ],
      root: [await run({ folder: '/' }, root.environment), root.launched.at(-1), root.printed[1]],
    },
    {
      named: [undefined, ['--install-agent-skill', join(named.project, 'notes')]],
      missing: `${join(refused.project, 'gone')} does not exist. Name a folder that does.`,
      file: `${join(refused.project, 'plan.md')} is a file. Name a folder.`,
      beforeARefusal: { asked: [], launched: [], printed: [] },
      folderOfTheRunIsGone: [
        undefined,
        ['--install-agent-skill'],
        'The folder this runs in is gone, so notes names nothing. Name the folder by its whole path.',
        undefined,
        // The first of these runs installed the skill.
        [gone.project],
      ],
      home: [undefined, ['--install-agent-skill'], withoutFolder],
      root: [undefined, ['--install-agent-skill'], withoutFolder],
    },
  );
});

test('the system: another one changes nothing, and a translated Node goes on', async (t) => {
  const unsupported =
    'BaseHalf is not released for this computer yet: https://basehalf.com/download says which it runs on. Nothing was changed.';
  /** @param {Partial<import('../src/install.js').Environment>} environment */
  const on = async (environment) => {
    const c = await computer(t, { environment });
    return [await run({}, c.environment), c.asked.length, c.launched.length];
  };
  assert.deepEqual(
    {
      linux: await on({ platform: 'linux', arch: 'arm64' }),
      windows: await on({ platform: 'win32', arch: 'x64' }),
      anotherProcessor: await on({ arch: 'x64', translated: async () => false }),
      translated: await on({ arch: 'x64', translated: async () => true }),
    },
    {
      linux: [unsupported, 0, 0],
      windows: [unsupported, 0, 0],
      anotherProcessor: [unsupported, 0, 0],
      translated: [undefined, 2, 2],
    },
  );
});

test('the skill: passed on only when it is missing and the application has the option', async (t) => {
  const linked = await computer(t, { installed: '0.7.2' });
  for (const entry of SKILL_ENTRIES) {
    await linkSkill(linked.home, entry.segments);
  }
  const older = await computer(t, { installed: '0.7.2', help: HELP_WITHOUT_OPTION });
  const silent = await computer(t, { installed: '0.7.2', linksSkill: false });
  const left = await computer(t, { installed: '0.7.2' });
  const results = {
    linked: [await run({}, linked.environment), linked.launched, linked.printed.at(-1)],
    older: [await run({}, older.environment), older.launched, older.printed.at(-1)],
    silent: [await run({}, silent.environment), silent.launched, silent.printed.at(-1)],
    left: [await run({ skill: false }, left.environment), left.launched, left.printed.at(-1)],
  };
  assert.deepEqual(results, {
    linked: [
      undefined,
      [[linked.project]],
      'The BaseHalf skill is already installed for your agents.',
    ],
    older: [
      undefined,
      [['--help'], [older.project]],
      'BaseHalf asks in its window whether to install its skill for your agents.',
    ],
    silent: [
      undefined,
      [['--help'], ['--install-agent-skill', silent.project]],
      'BaseHalf has not confirmed its skill for your agents yet. Its window says why.',
    ],
    left: [undefined, [[left.project]], `Opened ${left.project} in BaseHalf.`],
  });
});

test('a launcher that fails: BaseHalf stays installed, and the command says so', async (t) => {
  const c = await computer(t, { installed: '0.7.2' });
  const refused = await run(
    {},
    {
      ...c.environment,
      run: async (_file, args) =>
        args.includes('--help')
          ? { status: 0, stdout: HELP_WITH_OPTION, stderr: '' }
          : { status: 1, stdout: '', stderr: 'The application cannot be opened.\n' },
    },
  );
  assert.deepEqual(
    { refused, there: await names(c.places[0] ?? '') },
    {
      refused: `BaseHalf is installed in ${c.places[0]} and could not be opened: The application cannot be opened.`,
      there: ['BaseHalf.app'],
    },
  );
});

test('after a failure or an interrupt, nothing of the run is left', async (t) => {
  /**
   * @param {Parameters<typeof computer>[1]} options
   * @param {() => void} [during]
   */
  const left = async (options, during = () => {}) => {
    const c = await computer(t, options);
    const pending = run({}, c.environment);
    during();
    const refused = await pending;
    return {
      refused: refused?.split(':')[0],
      placed: await names(c.places[0] ?? ''),
      temporary: await names(c.tmpdir),
      launched: c.launched.length,
    };
  };
  const other = makeManifest(makeKey(), archive);
  const interrupted = new AbortController();
  const nothing = { placed: [], temporary: [], launched: 0 };
  assert.deepEqual(
    {
      feedOfAnotherKey: await left({ table: () => ({ [FEED]: { body: other } }) }),
      archiveOfOtherBytes: await left({
        table: (manifest) => ({
          [FEED]: { body: manifest },
          [manifest.url]: { body: Buffer.from('other bytes of an archive') },
        }),
      }),
      unpackedSomethingElse: await left({
        environment: {
          unpack: async (_archive, folder) => {
            await makeApplication(folder, '9.9.9');
          },
        },
      }),
      interruptedWhileDownloading: await left({
        table: (manifest) => ({
          [FEED]: { body: manifest },
          [manifest.url]: {
            body: stallingBody([archive.subarray(0, 4)], () => interrupted.abort()),
          },
        }),
        environment: { signal: interrupted.signal },
      }),
    },
    {
      feedOfAnotherKey: { refused: "The list of BaseHalf's releases was refused", ...nothing },
      archiveOfOtherBytes: { refused: 'The download of BaseHalf 1.2.3 was refused', ...nothing },
      unpackedSomethingElse: {
        refused:
          'The release of BaseHalf 1.2.3 does not hold BaseHalf 1.2.3 alone. Nothing was installed. Please report it at https',
        ...nothing,
      },
      interruptedWhileDownloading: { refused: 'interrupted', ...nothing },
    },
  );
});

test('one entry was a link before: the command waits for the answer of BaseHalf, not for that link', async (t) => {
  const c = await computer(t, { installed: '0.7.2', linksSkill: false });
  await linkSkill(c.home, SKILL_ENTRIES[0]?.segments ?? []);
  const refused = await run(
    {},
    {
      ...c.environment,
      skillTimeoutMs: 2_000,
      run: async (file, args, timeoutMs) => {
        if (args.includes('--install-agent-skill')) {
          // BaseHalf starts, and links the other entry well after the grace.
          setTimeout(() => linkSkill(c.home, SKILL_ENTRIES[1]?.segments ?? []), 200);
        }
        return c.environment.run(file, args, timeoutMs);
      },
    },
  );
  assert.deepEqual(
    { refused, said: c.printed.at(-1) },
    {
      refused: undefined,
      said: 'The BaseHalf skill is installed for Claude Code and Codex. Agent sessions you start from now on can use it.',
    },
  );
});

test('a temporary folder that cannot be made is said in a line', async (t) => {
  const c = await computer(t);
  assert.deepEqual(
    [
      await run({}, { ...c.environment, tmpdir: join(c.tmpdir, 'missing') }),
      await names(c.places[0] ?? ''),
    ],
    [
      `BaseHalf could not be downloaded: no temporary folder could be made in ${join(c.tmpdir, 'missing')} (ENOENT). Nothing was installed.`,
      [],
    ],
  );
});
