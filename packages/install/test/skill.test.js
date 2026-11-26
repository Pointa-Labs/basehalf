// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { SKILL_ENTRIES, linkedAgents, waitForSkill } from '../src/skill.js';
import { linkSkill, scratch } from './helpers.js';

const [claude, shared] = SKILL_ENTRIES.map((entry) => entry.segments);

test('an agent has the skill while its entry is a link to the copy and the copy holds it', async (t) => {
  const none = await scratch(t);
  const one = await scratch(t);
  await linkSkill(one, claude);
  const both = await scratch(t);
  await linkSkill(both, claude);
  await linkSkill(both, shared);
  const elsewhere = await scratch(t);
  await linkSkill(elsewhere, claude, join(elsewhere, 'my-own-skill'));
  const folder = await scratch(t);
  await linkSkill(folder, shared);
  await mkdir(join(folder, ...claude), { recursive: true });
  await writeFile(join(folder, ...claude, 'SKILL.md'), 'a copy of an earlier release');
  const emptied = await scratch(t);
  await linkSkill(emptied, claude);
  await rm(join(emptied, '.basehalf'), { recursive: true });
  assert.deepEqual(
    {
      none: await linkedAgents(none),
      one: await linkedAgents(one),
      both: await linkedAgents(both),
      elsewhere: await linkedAgents(elsewhere),
      folder: await linkedAgents(folder),
      emptied: await linkedAgents(emptied),
    },
    {
      none: [],
      one: ['Claude Code'],
      both: ['Claude Code', 'Codex'],
      elsewhere: [],
      folder: ['Codex'],
      emptied: [],
    },
  );
});

test('waiting ends when both entries are links, or a while after the only one', async (t) => {
  const timing = { linkedBefore: 0, timeoutMs: 2_000, graceMs: 150, intervalMs: 10 };
  const both = await scratch(t);
  setTimeout(() => linkSkill(both, claude).then(() => linkSkill(both, shared)), 40);
  const one = await scratch(t);
  setTimeout(() => linkSkill(one, shared), 40);
  const never = await scratch(t);
  const started = Date.now();
  const results = {
    both: await waitForSkill({ home: both, ...timing }),
    one: await waitForSkill({ home: one, ...timing }),
    never: await waitForSkill({ home: never, ...timing, timeoutMs: 100 }),
  };
  assert.deepEqual(
    { ...results, withinTheTime: Date.now() - started < 1_500 },
    { both: ['Claude Code', 'Codex'], one: ['Codex'], never: [], withinTheTime: true },
  );
});

test('a link of an earlier day is not taken for the answer of BaseHalf', async (t) => {
  const timing = { linkedBefore: 1, timeoutMs: 2_000, graceMs: 50, intervalMs: 10 };
  // One entry was a link before; BaseHalf makes the other well after the grace.
  const second = await scratch(t);
  await linkSkill(second, claude);
  setTimeout(() => linkSkill(second, shared), 200);
  const unchanged = await scratch(t);
  await linkSkill(unchanged, claude);
  assert.deepEqual(
    {
      second: await waitForSkill({ home: second, ...timing }),
      unchanged: await waitForSkill({ home: unchanged, ...timing, timeoutMs: 150 }),
    },
    { second: ['Claude Code', 'Codex'], unchanged: [] },
  );
});
