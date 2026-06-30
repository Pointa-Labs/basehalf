/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { _electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

assertProductIdentity();

const opts = parseArgs(process.argv.slice(2));
const runRoot = opts.output ?? fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-smoke-'));
const logsPath = path.join(runRoot, 'logs');
const crashesPath = path.join(runRoot, 'crashes');
const userDataDir = path.join(runRoot, 'user-data');
const extensionsDir = path.join(runRoot, 'extensions');
const workspacePath = path.join(runRoot, 'workspace');

for (const dir of [logsPath, crashesPath, userDataDir, extensionsDir, workspacePath]) {
	fs.mkdirSync(dir, { recursive: true });
}

createFixtureWorkspace(workspacePath);

const electronPath = getDevElectronPath();

const args = [
	root,
	workspacePath,
	'--skip-release-notes',
	'--skip-welcome',
	'--disable-telemetry',
	'--disable-experiments',
	'--no-cached-data',
	'--disable-updates',
	'--disable-extension=vscode.vscode-api-tests',
	`--crash-reporter-directory=${crashesPath}`,
	'--disable-workspace-trust',
	`--logsPath=${logsPath}`,
	`--user-data-dir=${userDataDir}`,
	`--extensions-dir=${extensionsDir}`,
	'--use-inmemory-secretstorage',
	'--enable-smoke-test-driver'
];

if (opts.verbose) {
	args.push('--verbose');
}

const env = {
	...process.env,
	NODE_ENV: 'development',
	VSCODE_DEV: '1',
	VSCODE_CLI: '1',
	ELECTRON_ENABLE_STACK_DUMPING: '1',
	ELECTRON_ENABLE_LOGGING: '1'
};

let app;
try {
	if (!fs.existsSync(electronPath)) {
		throw new Error(`Dev Electron was not found at ${electronPath}. Run npm run electron or npm run basehalf:smoke first.`);
	}

	app = await _electron.launch({ executablePath: electronPath, args, timeout: 60_000, env });
	const page = await app.firstWindow();
	page.on('pageerror', error => console.error(`[basehalf-smoke] pageerror: ${error.stack || error.message}`));
	page.on('console', message => {
		if (shouldLogConsoleMessage(message)) {
			console.error(`[basehalf-smoke] console.${message.type()}: ${message.text()}`);
		}
	});

	await page.setViewportSize({ width: 1280, height: 860 });
	await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });

	await assertOpenEditorsHidden(page);
	await assertCompetingViewContainersHidden(page);
	await assertAgentAreaChoices(page);
	await assertSourceControlPanel(page);

	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await assertNoEditorTabFor(page, 'README.md');

	await quickOpen(page, 'src/app.ts', 'Alt+Enter');
	await assertCardDetail(page, 'app.ts');
	await assertNoEditorTabFor(page, 'app.ts');
	await assertSourceCardFlushesBeforeNavigation(page);
	await assertCardDetail(page, 'README.md');
	await assertNoEditorTabFor(page, 'README.md');

	await quickOpen(page, '%needle-basehalf-routing');
	await assertCardDetail(page, 'README.md');
	await assertNoEditorTabFor(page, 'README.md');
	await assertFocusLine('README.md', 3);
	await quickOpen(page, '%needle-basehalf-second');
	await assertCardDetail(page, 'README.md');
	await assertNoEditorTabFor(page, 'README.md');
	await assertFocusLine('README.md', 5);
	await quickOpen(page, '%needleSymbol', 'Alt+Enter');
	await assertCardDetail(page, 'app.ts');
	await assertNoEditorTabFor(page, 'app.ts');

	await quickOpen(page, 'docs');
	await page.locator('.basehalf-canvas-title', { hasText: 'docs' }).waitFor({ state: 'visible', timeout: 20_000 });

	const summary = {
		ok: true,
		workspace: workspacePath,
		checks: [
			'product-identity-basehalf',
			'canvas-visible',
			'open-editors-hidden',
			'competing-view-containers-hidden',
			'agent-area-mounted-connected-choices',
			'source-control-git-provider',
			'quick-open-card-detail',
			'quick-open-side-card-detail-no-tab',
			'source-card-detail-flush-on-navigation',
			'quick-text-search-card-detail-no-tab',
			'quick-text-search-selection-focus',
			'quick-text-search-repeated-selection-focus',
			'quick-text-search-side-card-detail-no-tab',
			'folder-quick-open-canvas'
		]
	};
	if (opts.keep || opts.output) {
		summary.runRoot = runRoot;
	}
	console.log(JSON.stringify(summary, null, 2));
} catch (error) {
	await writeFailureArtifacts(error);
	throw error;
} finally {
	if (app) {
		await app.close().catch(() => undefined);
	}

	if (!opts.keep && !opts.output) {
		fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

function parseArgs(args) {
	const parsed = {
		keep: false,
		verbose: false,
		output: undefined
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
			case '--output':
				parsed.output = path.resolve(requireValue(args, ++i, arg));
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
	console.log(`Usage: npm run basehalf:smoke-no-compile -- [options]

Options:
  --output <path>     Store smoke logs/user-data/crashes in this directory.
  --keep              Keep the generated temporary directory after the run.
  --verbose           Echo renderer console logs and pass --verbose to the dev Electron app.
`);
	process.exit(0);
}

function assertProductIdentity() {
	const expected = {
		nameShort: 'BaseHalf',
		nameLong: 'BaseHalf',
		applicationName: 'basehalf',
		dataFolderName: '.basehalf',
		urlProtocol: 'basehalf',
		darwinBundleIdentifier: 'com.pointalabs.basehalf'
	};

	for (const [key, value] of Object.entries(expected)) {
		if (product[key] !== value) {
			throw new Error(`BaseHalf product identity mismatch: product.${key} is ${JSON.stringify(product[key])}, expected ${JSON.stringify(value)}.`);
		}
	}

	if (packageJson.name !== 'basehalf-vscode-dev') {
		throw new Error(`BaseHalf dev package identity mismatch: package.name is ${JSON.stringify(packageJson.name)}, expected "basehalf-vscode-dev".`);
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

function createFixtureWorkspace(workspace) {
	fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
	fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
	fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke README\n\nneedle-basehalf-routing\n\nneedle-basehalf-second\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const needleSymbol = 42;\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# Guide\n\nfolder target\n', 'utf8');
	initializeGitWorkspace(workspace);
}

function initializeGitWorkspace(workspace) {
	try {
		execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
	} catch {
		execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
		execFileSync('git', ['checkout', '-B', 'main'], { cwd: workspace, stdio: 'ignore' });
	}
}

function getDevElectronPath() {
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

async function quickOpen(page, value, acceptKey = 'Enter') {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = page.locator('.quick-input-widget input');
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(value);
	await page.waitForTimeout(1_500);
	await page.keyboard.press(acceptKey);
}

async function assertOpenEditorsHidden(page) {
	const headers = await page.locator('.pane-header h3.title').evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(text => text === 'Open Editors'));
	if (headers.length) {
		throw new Error('Open Editors view is visible in Explorer');
	}
}

async function assertCompetingViewContainersHidden(page) {
	const visibleTitles = await page.locator('.part.sidebar .title-label h2, .part.panel .title-label h2, .part.auxiliarybar .title-label h2').evaluateAll(nodes => nodes
		.filter(node => {
			const element = node;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0
				&& rect.right > 0
				&& rect.bottom > 0
				&& rect.left < window.innerWidth
				&& rect.top < window.innerHeight;
		})
		.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(Boolean));
	const forbidden = ['Extensions', 'Chat', 'Run and Debug', 'Testing', 'Remote Explorer'];
	for (const title of forbidden) {
		if (visibleTitles.includes(title)) {
			throw new Error(`Competing VS Code view container is visible: ${title}`);
		}
	}
}

async function assertAgentAreaChoices(page) {
	await page.locator('.basehalf-agent-area').waitFor({ state: 'attached', timeout: 15_000 });
	const choices = await page.locator('.basehalf-agent-choice').evaluateAll(nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
	const expected = ['Codex', 'Claude Code', 'Terminal'];
	if (choices.join('|') !== expected.join('|')) {
		throw new Error(`Unexpected Agent Area choices: ${choices.join(', ')}`);
	}
	for (const hidden of ['Codex Extension', 'Claude Code Extension']) {
		if (choices.includes(hidden)) {
			throw new Error(`Disconnected Agent Area choice is visible: ${hidden}`);
		}
	}
}

async function assertSourceControlPanel(page) {
	await page.locator('.activitybar .action-label[aria-label*="Source Control"]').first().click();
	await page.locator('.part.sidebar .title-label h2', { hasText: /Source Control/i }).waitFor({ state: 'visible', timeout: 20_000 });
	const changesPane = page.locator('.pane', { has: page.locator('.pane-header', { hasText: 'Changes' }) }).first();
	await changesPane.locator('.scm-view').waitFor({ state: 'visible', timeout: 20_000 });
	await changesPane.locator('.monaco-button', { hasText: /Commit/ }).first().waitFor({ state: 'visible', timeout: 20_000 });

	await changesPane.evaluate(async element => {
		const started = Date.now();
		while (Date.now() - started < 20_000) {
			const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
			if (text.includes('main')
				&& text.includes('Changes')
				&& text.includes('README.md')
				&& text.includes('app.ts')) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
		throw new Error(`Source Control Changes view did not show expected Git state: ${text}`);
	});
}

async function assertCardDetail(page, title) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-card-detail-title', { hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertNoEditorTabFor(page, name) {
	let lastTabs = [];
	const started = Date.now();
	while (Date.now() - started < 5_000) {
		lastTabs = await page.locator('.monaco-workbench .part.editor .tabs-container .tab').evaluateAll(rows => rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim()));
		if (!lastTabs.some(tab => tab && tab.includes(name))) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Unexpected VS Code editor tab for ${name}: ${lastTabs.join(', ')}`);
}

async function assertSourceCardFlushesBeforeNavigation(page) {
	const marker = 'export const sourceFlushSmoke = true;';
	const appPath = path.join(workspacePath, 'src', 'app.ts');
	await page.locator('.basehalf-card-detail-source-editor .monaco-editor').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.insertText(`\n${marker}\n`);
	await page.locator('.basehalf-card-detail-source-status', { hasText: /Unsaved changes/ }).waitFor({ state: 'visible', timeout: 10_000 });

	await quickOpen(page, 'README.md');
	await waitUntil(() => fs.readFileSync(appPath, 'utf8').includes(marker), 'source card detail to flush before navigation');
}

async function assertFocusLine(relativePath, line) {
	const focusPath = path.join(workspacePath, '.bh', 'mirror', ...relativePath.split('/'), 'focus.yaml');
	await waitUntil(() => {
		if (!fs.existsSync(focusPath)) {
			return false;
		}
		const content = fs.readFileSync(focusPath, 'utf8');
		return content.includes('projection: rich')
			&& content.includes('cursor:')
			&& content.includes(`  line: ${line}`);
	}, `focus.yaml for ${relativePath} to point at line ${line}`);
}

async function waitUntil(predicate, description, timeoutMs = 10_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function writeFailureArtifacts(error) {
	console.error(`[basehalf-smoke] failed: ${error?.stack || error}`);
	console.error(`[basehalf-smoke] runRoot: ${runRoot}`);

	if (!app) {
		return;
	}

	const page = app.windows()[0];
	if (!page) {
		return;
	}

	fs.mkdirSync(logsPath, { recursive: true });
	await page.screenshot({ path: path.join(logsPath, 'failure.png'), fullPage: true }).catch(() => undefined);
	const html = await page.locator('html').evaluate(element => element.outerHTML).catch(() => undefined);
	if (html) {
		fs.writeFileSync(path.join(logsPath, 'failure.html'), html, 'utf8');
	}
}
