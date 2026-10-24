/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The smoke of BaseHalf. Its steps are in suites by area, as VS Code's smoke
// tests are (scripts/basehalf-smoke/README.md). Each suite runs in a process of
// its own, on a BaseHalf of its own with a fresh fixture workspace. This script
// runs the suites one after another and says which passed.
//
//   npm run basehalf:smoke-no-compile                               every suite
//   npm run basehalf:smoke-no-compile -- --suite canvas,cardDetail  some suites

import { spawnSync } from 'child_process';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { SUITE_LIST } from './basehalf-smoke/suiteList.mts';

const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'basehalf-smoke', 'runSuite.mts');

const forwarded = [];
let requested;
let output;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === '--suite') {
		requested = (args[++i] ?? '').split(',').map(name => name.trim()).filter(Boolean);
	} else if (arg === '--output') {
		output = path.resolve(args[++i] ?? '');
	} else if (arg === '--help') {
		printHelp();
		process.exit(0);
	} else {
		forwarded.push(arg);
	}
}

const known = new Set(SUITE_LIST.map(suite => suite.name));
const suites = requested ?? SUITE_LIST.map(suite => suite.name);
const unknown = suites.filter(name => !known.has(name));
if (unknown.length || suites.length === 0) {
	console.error(`Unknown suite ${unknown.join(', ') || '(none)'}: the suites are ${[...known].join(', ')}.`);
	process.exit(2);
}

const results = [];
for (const suite of suites) {
	console.error(`[basehalf-smoke] suite ${suite}`);
	const started = Date.now();
	// Each suite keeps its own folder of an --output folder.
	const suiteArgs = ['--suite', suite, ...forwarded, ...(output ? ['--output', path.join(output, suite)] : [])];
	const result = spawnSync(process.execPath, ['--experimental-strip-types', runner, ...suiteArgs], { stdio: 'inherit' });
	results.push({ suite, ok: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

for (const result of results) {
	console.error(`[basehalf-smoke] suite ${result.suite} ${result.ok ? 'passed' : 'failed'} in ${Math.floor(result.seconds / 60)}m ${result.seconds % 60}s`);
}
process.exit(results.every(result => result.ok) ? 0 : 1);

function printHelp() {
	console.log(`Usage: npm run basehalf:smoke-no-compile -- [options]

Runs the suites of the smoke one after another, each on a BaseHalf of its own
with a fresh fixture workspace (scripts/basehalf-smoke/README.md).

Options:
  --suite <names>     Run these suites only, separated by commas.
  --output <path>     Store each suite's logs, user data, and crashes in <path>/<suite>.
  --packaged-app <path>
                      Run against a packaged application bundle or folder instead of
                      the development build, for example ../VSCode-darwin-arm64/BaseHalf.app.
  --keep              Keep each suite's temporary folder after the run.
  --verbose           Echo renderer console logs and pass --verbose to the dev Electron app.

Suites:
${SUITE_LIST.map(suite => `  ${suite.name.padEnd(12)}${suite.description}`).join('\n')}
`);
}
