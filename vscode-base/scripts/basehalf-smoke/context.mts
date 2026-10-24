/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What every module of a suite's run reads: the options of the run, its folders, the product, and the BaseHalf it launched.

import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// vscode-base/, two folders above this module.
export const root = path.resolve(__dirname, '..', '..');
export const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
export const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

export const opts = parseArgs(process.argv.slice(2));
export const runRoot = opts.output ?? fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-smoke-'));
export const logsPath = path.join(runRoot, 'logs');
export const crashesPath = path.join(runRoot, 'crashes');
export const userDataDir = path.join(runRoot, 'user-data');
export const sharedDataDir = path.join(runRoot, 'shared-data');
export const extensionsDir = path.join(runRoot, 'extensions');
// On macOS the temporary folder lies behind a symbolic link (/var is
// /private/var). The window opens the workspace by that path, while a shell in
// its terminal reports the real one: `basehalf --generate` must find the
// workspace either way.
export const workspacePath = path.join(runRoot, 'workspace');
// Where the window installs the BaseHalf skill instead of the home folder, so
// the smoke never reads or changes the agents' settings of the machine it runs
// on, and what the record of the selection agents can see does is the same on
// every machine. The window keeps its real home folder: macOS finds the
// keychain through it, and saving a provider key needs the keychain.
export const smokeHome = path.join(runRoot, 'home');

/** The BaseHalf that the runner launched (runSuite.mts). */
export let app;

export function setApp(application) {
	app = application;
}

function parseArgs(args) {
	const parsed = {
		keep: false,
		verbose: false,
		suite: undefined,
		output: undefined,
		packagedApp: undefined
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--keep':
				parsed.keep = true;
				break;
			case '--verbose':
				parsed.verbose = true;
				break;
			case '--suite':
				parsed.suite = requireValue(args, ++i, arg);
				break;
			case '--output':
				parsed.output = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--packaged-app':
				parsed.packagedApp = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--help':
				printHelpAndExit();
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return parsed;
}

function requireValue(args, index, flag) {
	const value = args[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function printHelpAndExit() {
	console.log(`Usage: node --experimental-strip-types scripts/basehalf-smoke/runSuite.mts --suite <name> [options]

Runs one suite of the smoke. scripts/basehalf-smoke.mts runs the suites, each in a
process of its own; use it through npm run basehalf:smoke or basehalf:smoke-no-compile.

Options:
  --suite <name>      The suite to run: workbench, canvas, cardDetail, navigation, or video.
  --output <path>     Store smoke logs/user-data/crashes in this directory.
  --packaged-app <path>
                      Run against a packaged application bundle or folder instead of
                      the development build, for example ../VSCode-darwin-arm64/BaseHalf.app.
  --keep              Keep the generated temporary directory after the run.
  --verbose           Echo renderer console logs and pass --verbose to the dev Electron app.
`);
	process.exit(0);
}
