/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Runs one suite of the smoke (README.md in this folder): a fresh fixture
// workspace, a BaseHalf of its own on it, the steps of the suite, and the
// summary of what passed. scripts/basehalf-smoke.mts runs each suite in a
// process of its own.

import { _electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import process from 'process';
import {
	assertNativeWindowResizeResponsive,
	assertProductIdentity,
	closeElectronApplication,
	getDevElectronPath,
	getPackagedElectronPath,
	observePage,
	writeFailureArtifacts
} from './app.mts';
import { stopVideoSmokeProvider } from './areas/video/generationCards.mts';
import {
	app,
	crashesPath,
	extensionsDir,
	logsPath,
	opts,
	root,
	runRoot,
	setApp,
	sharedDataDir,
	smokeHome,
	userDataDir,
	workspacePath
} from './context.mts';
import { createFixtureWorkspace, externalPluginFixturePath, prepareExternalPluginFixture, recordFixtureBeforeLaunch } from './fixture.mts';
import { passedSteps } from './lib/steps.mts';
import { SUITES } from './suites.mts';

assertProductIdentity();

const runSteps = SUITES[opts.suite];
if (!runSteps) {
	throw new Error(`Unknown suite ${opts.suite ?? '(none)'}: the suites are ${Object.keys(SUITES).join(', ')}.`);
}
// The workbench suite starts as a new window does by default, with the Welcome
// page. The other suites skip it.
const runsNewWindowWelcome = opts.suite === 'workbench';

for (const dir of [logsPath, crashesPath, userDataDir, sharedDataDir, extensionsDir, workspacePath, smokeHome]) {
	fs.mkdirSync(dir, { recursive: true });
}

// Context menus come from BaseHalf's product default (`window.menuStyle:
// custom`), not from this profile: every step that reads a menu also checks
// that default, since Playwright cannot inspect a native macOS context menu.
// Welcome runs force the broader stock startup choice: Folder/Workspace must
// still return to the canvas, while the empty New Window must keep BaseHalf
// Welcome.
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
	path.join(userDataDir, 'User', 'settings.json'),
	JSON.stringify(runsNewWindowWelcome ? { 'workbench.startupEditor': 'welcomePage' } : {}, null, '\t'),
	'utf8'
);

if (opts.verifyUninstalled || opts.verifyInstalled) {
	if (!fs.existsSync(externalPluginFixturePath())) {
		throw new Error(`Cannot verify an uninstalled plugin without the preserved fixture at ${externalPluginFixturePath()}`);
	}
} else {
	createFixtureWorkspace(workspacePath);
	prepareExternalPluginFixture();
}
// What the fixture holds under .bh/, and what git shows of it, before BaseHalf first opens it.
recordFixtureBeforeLaunch();

const electronPath = opts.packagedApp ? getPackagedElectronPath(opts.packagedApp) : getDevElectronPath();

const args = [
	// The development Electron takes the source tree as its application path.
	// A packaged application carries its own.
	...(opts.packagedApp ? [] : [root]),
	workspacePath,
	'--skip-release-notes',
	...(runsNewWindowWelcome ? [] : ['--skip-welcome']),
	'--disable-telemetry',
	'--disable-experiments',
	'--no-cached-data',
	'--disable-updates',
	'--disable-extension=vscode.vscode-api-tests',
	`--crash-reporter-directory=${crashesPath}`,
	'--disable-workspace-trust',
	`--logsPath=${logsPath}`,
	`--user-data-dir=${userDataDir}`,
	`--shared-data-dir=${sharedDataDir}`,
	`--extensions-dir=${extensionsDir}`,
	'--use-inmemory-secretstorage',
	'--enable-smoke-test-driver'
];

if (opts.verbose) {
	args.push('--verbose');
}

const env = {
	...process.env,
	// Harness processes (agents, editor terminals) may export this; it would
	// make the dev Electron start as plain node and never open a window.
	ELECTRON_RUN_AS_NODE: undefined,
	...(opts.packagedApp ? { NODE_ENV: undefined, VSCODE_DEV: undefined } : { NODE_ENV: 'development', VSCODE_DEV: '1' }),
	VSCODE_CLI: '1',
	BASEHALF_SMOKE_AGENT_SKILL_HOME: smokeHome,
	TERM: 'dumb',
	COLORTERM: '',
	NO_COLOR: '1',
	NODE_DISABLE_COLORS: '1',
	FORCE_COLOR: '0',
	ELECTRON_ENABLE_STACK_DUMPING: '1',
	ELECTRON_ENABLE_LOGGING: '1'
};

let smokeFailed = false;
try {
	if (!fs.existsSync(electronPath)) {
		throw new Error(opts.packagedApp
			? `The packaged application has no executable at ${electronPath}.`
			: `Dev Electron was not found at ${electronPath}. Run npm run electron or npm run basehalf:smoke first.`);
	}

	setApp(await _electron.launch({ executablePath: electronPath, args, timeout: 60_000, env }));
	const page = await app.firstWindow();
	observePage(page);

	await assertNativeWindowResizeResponsive(app, page);
	await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });

	const checks = await runSteps(page);
	const summary = {
		ok: true,
		suite: opts.suite,
		workspace: workspacePath,
		steps: Array.isArray(checks) ? checks : passedSteps()
	};
	if (opts.keep || opts.output) {
		summary.runRoot = runRoot;
	}
	console.log(JSON.stringify(summary, null, 2));
} catch (error) {
	smokeFailed = true;
	await writeFailureArtifacts(error);
	throw error;
} finally {
	if (app) {
		await closeElectronApplication(app);
	}
	await stopVideoSmokeProvider();

	if (!opts.keep && !opts.output && !smokeFailed) {
		fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	} else if (smokeFailed && !opts.keep && !opts.output) {
		console.error(`[basehalf-smoke] preserved failure artifacts: ${runRoot}`);
	}
}
