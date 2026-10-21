/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Launching BaseHalf and closing it: the development or packaged Electron, the page's console and errors, the size of its window, and what a failed run leaves behind.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import process from 'process';
import {
	app,
	logsPath,
	opts,
	packageJson,
	product,
	root,
	runRoot
} from './context.mts';

export const SMOKE_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1280, height: 860 });
export const pageErrors = [];

export function assertProductIdentity() {
	const expected = {
		nameShort: 'BaseHalf',
		nameLong: 'BaseHalf',
		applicationName: 'basehalf',
		dataFolderName: '.basehalf',
		sharedDataFolderName: '.basehalf-shared',
		serverApplicationName: 'basehalf-server',
		serverDataFolderName: '.basehalf-server',
		tunnelApplicationName: 'basehalf-tunnel',
		win32DirName: 'BaseHalf',
		win32NameVersion: 'BaseHalf',
		win32RegValueName: 'BaseHalf',
		win32AppUserModelId: 'PointaLabs.BaseHalf',
		win32ShellNameShort: '&BaseHalf',
		win32TunnelServiceMutex: 'basehalf-tunnelservice',
		win32TunnelMutex: 'basehalf-tunnel',
		urlProtocol: 'basehalf',
		darwinBundleIdentifier: 'com.pointalabs.basehalf',
		linuxIconName: 'basehalf'
	};

	for (const [key, value] of Object.entries(expected)) {
		if (product[key] !== value) {
			throw new Error(`BaseHalf product identity mismatch: product.${key} is ${JSON.stringify(product[key])}, expected ${JSON.stringify(value)}.`);
		}
	}

	if (packageJson.name !== 'basehalf-vscode-dev') {
		throw new Error(`BaseHalf dev package identity mismatch: package.name is ${JSON.stringify(packageJson.name)}, expected "basehalf-vscode-dev".`);
	}

	// The BaseHalf darwin update service (updateService.basehalfDarwin.ts) polls
	// an Ed25519-signed manifest from this URL; quality + a strict x.y.z
	// basehalfVersion are what its feed gating requires.
	if (product.updateUrl !== 'https://github.com/Pointa-Labs/basehalf/releases/latest/download') {
		throw new Error(`BaseHalf product.json updateUrl must point at the releases/latest/download feed; got ${JSON.stringify(product.updateUrl)}.`);
	}
	if (product.quality !== 'stable') {
		throw new Error(`BaseHalf product.json quality must be "stable" (the update service is disabled without it); got ${JSON.stringify(product.quality)}.`);
	}
	if (!/^\d+\.\d+\.\d+$/.test(product.basehalfVersion ?? '')) {
		throw new Error(`BaseHalf product.json basehalfVersion must be strict x.y.z; got ${JSON.stringify(product.basehalfVersion)}.`);
	}
}

function shouldLogConsoleMessage(message) {
	if (opts.verbose) {
		return true;
	}
	if (message.type() !== 'error') {
		return false;
	}

	const text = message.text();
	return !text.includes('[Extension Host (stderr)] Debugger listening on')
		&& !text.includes('[Extension Host (stderr)] For help, see: https://nodejs.org/learn/getting-started/debugging');
}

export function observePage(page, label) {
	const sourceLabel = label ? `${label} ` : '';
	page.on('pageerror', error => {
		pageErrors.push(error);
		console.error(`[basehalf-smoke] ${sourceLabel}pageerror: ${error.stack || error.message}`);
	});
	page.on('console', message => {
		if (shouldLogConsoleMessage(message)) {
			const location = message.location();
			const source = location.url ? ` (${location.url}:${location.lineNumber + 1})` : '';
			console.error(`[basehalf-smoke] ${sourceLabel}console.${message.type()}: ${message.text()}${source}`);
		}
	});
}

export async function setNativeWindowContentSize(application, page, size) {
	const browserWindow = await application.browserWindow(page);
	await browserWindow.evaluate((window, target) => window.setContentSize(target.width, target.height, false), size);
	await page.waitForFunction(
		target => window.innerWidth === target.width && window.innerHeight === target.height,
		size,
		{ timeout: 10_000 }
	);
}

export async function assertNativeWindowResizeResponsive(application, page) {
	// `page.setViewportSize()` installs a Chromium device-metrics override in
	// Electron. That makes the native frame resizable while the workbench stays
	// frozen at the old CSS viewport, leaving apparent dead space and preventing
	// canvas layout from following a user window resize. Exercise two real
	// BrowserWindow sizes instead so the smoke harness also guards the desktop
	// resize contract it depends on.
	await setNativeWindowContentSize(application, page, { width: 1184, height: 780 });
	await setNativeWindowContentSize(application, page, SMOKE_WINDOW_CONTENT_SIZE);
}

export function getPackagedElectronPath(packagedApp) {
	switch (process.platform) {
		case 'darwin':
			return path.join(packagedApp, 'Contents', 'MacOS', product.nameShort);
		case 'linux':
			return path.join(packagedApp, product.applicationName);
		case 'win32':
			return path.join(packagedApp, `${product.nameShort}.exe`);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export function getDevElectronPath() {
	switch (process.platform) {
		case 'darwin':
			return path.join(root, '.build', 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', product.nameShort);
		case 'linux':
			return path.join(root, '.build', 'electron', product.applicationName);
		case 'win32':
			return path.join(root, '.build', 'electron', `${product.nameShort}.exe`);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export async function writeFailureArtifacts(error) {
	console.error(`[basehalf-smoke] failed: ${error?.stack || error}`);
	console.error(`[basehalf-smoke] runRoot: ${runRoot}`);

	if (!app) {
		return;
	}

	const pages = app.windows();
	if (pages.length === 0) {
		return;
	}

	fs.mkdirSync(logsPath, { recursive: true });
	for (let index = 0; index < pages.length; index++) {
		const page = pages[index];
		const artifactName = index === 0 ? 'failure' : `failure-window-${index + 1}`;
		await page.screenshot({ path: path.join(logsPath, `${artifactName}.png`), fullPage: true }).catch(() => undefined);
		const html = await page.locator('html').evaluate(element => element.outerHTML).catch(() => undefined);
		if (html) {
			fs.writeFileSync(path.join(logsPath, `${artifactName}.html`), html, 'utf8');
		}
	}
}

export async function closeElectronApplication(application, timeoutMs = 15_000) {
	const pid = application.process().pid;
	let timeoutHandle;
	try {
		await Promise.race([
			application.close(),
			new Promise((_, reject) => {
				timeoutHandle = setTimeout(
					() => reject(new Error(`Electron did not close within ${timeoutMs}ms`)),
					timeoutMs
				);
			}),
		]);
	} catch (error) {
		console.error(`[basehalf-smoke] graceful Electron shutdown failed; forcing process-tree cleanup: ${error instanceof Error ? error.message : String(error)}`);
		if (pid) {
			try {
				forceKillProcessTree(pid);
			} catch (killError) {
				console.error(`[basehalf-smoke] forced Electron cleanup failed: ${killError instanceof Error ? killError.message : String(killError)}`);
			}
		}
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}

function forceKillProcessTree(pid) {
	if (process.platform === 'win32') {
		execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
		return;
	}

	try {
		process.kill(-pid, 'SIGKILL');
	} catch (groupError) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch (processError) {
			if (groupError?.code !== 'ESRCH' || processError?.code !== 'ESRCH') {
				throw processError;
			}
		}
	}
}
