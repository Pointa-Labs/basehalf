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
// its terminal reports the real one: `basehalf --run-node` must find the
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
		externalPluginId: undefined,
		externalPluginExtension: undefined,
		externalPluginVersion: undefined,
		seedVsix: undefined,
		verifyUninstalled: false,
		verifyInstalled: false,
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
			case '--external-plugin-id':
				parsed.externalPluginId = requireValue(args, ++i, arg).toLowerCase();
				break;
			case '--external-plugin-extension':
				parsed.externalPluginExtension = requireValue(args, ++i, arg).replace(/^\./, '').toLowerCase();
				break;
			case '--external-plugin-version':
				parsed.externalPluginVersion = requireValue(args, ++i, arg);
				break;
			case '--seed-vsix':
				parsed.seedVsix = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--verify-uninstalled':
				parsed.verifyUninstalled = true;
				break;
			case '--verify-installed':
				parsed.verifyInstalled = true;
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
	if (parsed.externalPluginId) {
		throw new Error('The reviewed-plugin lifecycle slice cannot run while the plugin platform is frozen: the product has no plugin surface (docs/specs/built-in-ai-video-and-plugin-freeze.md).');
	}
	if (parsed.externalPluginId && (parsed.suite !== 'plugin' || !parsed.externalPluginExtension || !parsed.externalPluginVersion)) {
		throw new Error('--external-plugin-id requires --suite plugin, --external-plugin-extension, and --external-plugin-version.');
	}
	if ((parsed.seedVsix || parsed.verifyUninstalled || parsed.verifyInstalled) && !parsed.externalPluginId) {
		throw new Error('--seed-vsix and verification modes require --external-plugin-id.');
	}
	if (parsed.verifyUninstalled && parsed.verifyInstalled) {
		throw new Error('--verify-installed and --verify-uninstalled are mutually exclusive.');
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
  --suite <name>      The suite to run: workbench, canvas, cardDetail, navigation, video, or plugin.
  --output <path>     Store smoke logs/user-data/crashes in this directory.
  --packaged-app <path>
                      Run against a packaged application bundle or folder instead of
                      the development build, for example ../VSCode-darwin-arm64/BaseHalf.app.
  --keep              Keep the generated temporary directory after the run.
  --external-plugin-id <id>
                      With --suite plugin: run the reviewed remote-plugin lifecycle. Refused
                      while the plugin platform is frozen.
  --external-plugin-extension <ext>
                      File extension contributed by the reviewed test plugin.
  --external-plugin-version <version>
                      Remote version expected after install or update.
  --seed-vsix <path>  Preinstall an older VSIX before exercising remote update.
  --verify-uninstalled
                      Relaunch an existing output profile and verify source fallback.
  --verify-installed  Relaunch an existing output profile and verify cached admission.
  --verbose           Echo renderer console logs and pass --verbose to the dev Electron app.
`);
	process.exit(0);
}
