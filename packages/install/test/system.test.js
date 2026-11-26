// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchEnvironment, run } from '../src/system.js';

test('BaseHalf is started without what npx and this Node added to the environment', () => {
  assert.deepEqual(
    launchEnvironment({
      HOME: '/Users/someone',
      LANG: 'en_US.UTF-8',
      EDITOR: 'vi',
      PATH: [
        '/Users/someone/project/node_modules/.bin',
        '/Users/someone/node_modules/.bin',
        '/Users/someone/.npm/_npx/0123abcd/node_modules/.bin',
        '/usr/local/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',
        '/usr/local/bin',
        '/usr/bin',
      ].join(':'),
      NODE_OPTIONS: '--max-old-space-size=64',
      ELECTRON_RUN_AS_NODE: '1',
      INIT_CWD: '/Users/someone/project',
      NODE: '/usr/local/bin/node',
      COLOR: '0',
      npm_command: 'exec',
      npm_config_user_agent: 'npm/11 node/v24',
      npm_lifecycle_event: 'npx',
      UNSET: undefined,
    }),
    {
      HOME: '/Users/someone',
      LANG: 'en_US.UTF-8',
      EDITOR: 'vi',
      PATH: '/usr/local/bin:/usr/bin',
    },
  );
});

test('a program that cannot be started, that fails, or that takes too long answers in words', async () => {
  const node = process.execPath;
  const results = {
    printed: await run(node, ['-e', 'console.log("ok")'], 10_000),
    failed: await run(node, ['-e', 'console.error("no"); process.exit(3)'], 10_000),
    silent: (await run(node, ['-e', 'process.exit(2)'], 10_000)).status,
    late: await run(node, ['-e', 'setTimeout(() => {}, 10000)'], 300),
    missing: (await run('/nonexistent/launcher', [], 10_000)).status,
  };
  assert.deepEqual(results, {
    printed: { status: 0, stdout: 'ok\n', stderr: '' },
    failed: { status: 3, stdout: '', stderr: 'no\n' },
    silent: 2,
    late: { status: 1, stdout: '', stderr: 'it did not end in 0 seconds' },
    missing: 1,
  });
});
