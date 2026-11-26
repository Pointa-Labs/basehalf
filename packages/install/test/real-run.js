// Copyright (c) Pointa Labs. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.

// The command, for real, on a computer BaseHalf is released for (the install
// command, criterion 10). It downloads the latest release from the feed,
// accepts it under the key of the releases, and places it, with the places
// for applications and the home folder of the run's own, so that nothing of
// the computer changes. It opens no window: where the command would open
// BaseHalf, this asks the placed application for its version.
//
//   node packages/install/test/real-run.js

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallError } from '../src/errors.js';
import { install } from '../src/install.js';
import { run, systemEnvironment } from '../src/system.js';

const root = await realpath(await mkdtemp(join(tmpdir(), 'basehalf-real-run-')));
const home = join(root, 'home');
const project = join(home, 'project');
const places = [join(root, 'Applications'), join(home, 'Applications')];
await mkdir(project, { recursive: true });
await mkdir(places[0] ?? root);
await mkdir(join(root, 'tmp'));

const started = Date.now();
const seconds = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
let status = 0;
try {
  const system = systemEnvironment({ print: (line) => console.log(`[${seconds()}] ${line}`) });
  await install(
    { folder: undefined, skill: true },
    {
      ...system,
      home,
      cwd: project,
      places,
      tmpdir: join(root, 'tmp'),
      skillTimeoutMs: 0,
      run: async (file, args, timeoutMs) => {
        if (args.includes('--help')) {
          return system.run(file, args, timeoutMs);
        }
        const version = await system.run(file, ['--version'], timeoutMs);
        console.log(`[${seconds()}] In place of opening (${args.join(' ')}), its version:`);
        console.log(version.stdout.trimEnd() || version.stderr.trimEnd());
        return version;
      },
    },
  );
  const bundle = join(places[0] ?? root, 'BaseHalf.app');
  const mark = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', bundle], 10_000);
  console.log(
    mark.status === 0
      ? `The application carries the mark of a download: ${mark.stdout.trim()}`
      : 'The application carries no mark of a download.',
  );
} catch (error) {
  status = 1;
  console.error(error instanceof InstallError ? error.message : error);
} finally {
  await rm(root, { recursive: true, force: true });
  console.log(`[${seconds()}] Removed ${root}.`);
}
process.exitCode = status;
