// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArguments } from '../src/arguments.js';

test('no argument is the folder of the run, and one path is the folder', () => {
  assert.deepEqual(
    [parseArguments([]), parseArguments(['notes']), parseArguments(['--', '-odd'])],
    [
      { kind: 'run', folder: undefined, skill: true },
      { kind: 'run', folder: 'notes', skill: true },
      { kind: 'run', folder: '-odd', skill: true },
    ],
  );
});

test('the options are read anywhere on the line', () => {
  assert.deepEqual(
    [
      parseArguments(['--no-skill', 'notes']),
      parseArguments(['notes', '--no-skill']),
      parseArguments(['notes', '--help']),
      parseArguments(['-h']),
      parseArguments(['--version', 'notes']),
      parseArguments(['-v']),
    ],
    [
      { kind: 'run', folder: 'notes', skill: false },
      { kind: 'run', folder: 'notes', skill: false },
      { kind: 'help' },
      { kind: 'help' },
      { kind: 'version' },
      { kind: 'version' },
    ],
  );
});

test('an unknown option and a second folder are refused, also beside --help', () => {
  assert.deepEqual(
    [
      parseArguments(['--skill']),
      parseArguments(['--help', '--fast']),
      parseArguments(['notes', 'more']),
    ],
    [
      { kind: 'refused', reason: 'Unknown option --skill.' },
      { kind: 'refused', reason: 'Unknown option --fast.' },
      { kind: 'refused', reason: 'Name one folder.' },
    ],
  );
});
