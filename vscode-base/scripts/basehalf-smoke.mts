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

	await step('open-editors-hidden', () => assertOpenEditorsHidden(page));
	await step('competing-view-containers-hidden', () => assertCompetingViewContainersHidden(page));
	await step('hidden-surface-runtime-guard', () => assertHiddenSurfaceCommandsStayHidden(page));
	await step('agent-area-five-choices-command-unavailable-state', () => assertAgentAreaChoices(page));
	await step('agent-area-terminal-command-no-stock-panel', () => assertAgentAreaTerminalCommand(page));
	await step('toggle-panel-remaps-to-agent-area', () => assertTogglePanelRemapsToAgentArea(page));
	await step('source-control-git-provider', () => assertSourceControlPanel(page));
	commitFixtureChanges(workspacePath, 'smoke changes');
	await step('git-refresh', () => runCommand(page, 'Git: Refresh'));
	await step('source-control-publish-branch-action', () => assertSourceControlPublishBranchAction(page));
	await step('git-branch-checkout-quickpick', () => assertGitBranchCheckoutQuickPick(page));

	await step('canvas-card-badge-preview-connectors', () => assertCanvasCardBadgePreviewAndConnectors(page));
	await step('canvas-scroll-before-card-detail', () => scrollCanvasWorkbenchForCardDetail(page));
	await step('quick-open-readme', () => quickOpen(page, 'README.md'));
	await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('readme-card-detail-covers-scrolled-canvas', () => assertCardDetailCoversCanvasViewport(page));
	await step('readme-rich-status-in-header', () => assertMarkdownRichStatusInHeader(page));
	await step('readme-rich-editor-edit-save', () => assertMarkdownRichEditorEditsAndSaves(page));
	await step('readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));

	await step('quick-open-app-side', () => quickOpen(page, 'src/app.ts', 'Alt+Enter'));
	await step('app-card-detail', () => assertCardDetail(page, 'app.ts'));
	await step('app-no-editor-tab', () => assertNoEditorTabFor(page, 'app.ts'));
	await step('source-card-detail-flush-on-navigation', () => assertSourceCardFlushesBeforeNavigation(page));
	await step('readme-card-detail-after-flush', () => assertCardDetail(page, 'README.md'));
	await step('readme-no-editor-tab-after-flush', () => assertNoEditorTabFor(page, 'README.md'));

	await step('quick-text-search-readme-routing', () => quickOpen(page, '%needle-basehalf-routing'));
	await step('quick-text-search-readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-readme-focus-routing-line', () => assertFocusLine('README.md', lineNumberForText('README.md', 'needle-basehalf-routing')));
	await step('quick-text-search-readme-second', () => quickOpen(page, '%needle-basehalf-second'));
	await step('quick-text-search-readme-second-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-second-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-readme-focus-second-line', () => assertFocusLine('README.md', lineNumberForText('README.md', 'needle-basehalf-second')));
	await step('quick-text-search-app-side', () => quickOpen(page, '%needleSymbol', 'Alt+Enter'));
	await step('quick-text-search-app-card-detail', () => assertCardDetail(page, 'app.ts'));
	await step('quick-text-search-app-no-editor-tab', () => assertNoEditorTabFor(page, 'app.ts'));

	await step('explorer-folder-row-canvas-open', () => openExplorerRow(page, 'docs'));
	await step('explorer-folder-row-canvas', () => assertCanvasFolder(page, 'docs'));
	await step('explorer-file-row-card-open', () => openExplorerRow(page, 'guide.md'));
	await step('explorer-file-row-card-detail', () => assertCardDetail(page, 'guide.md'));
	await step('detail-breadcrumb-folder-navigation', () => assertDetailBreadcrumbOpensFolder(page, 'docs'));
	await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
	await step('canvas-breadcrumb-root-navigation', () => assertCanvasBreadcrumbOpensRoot(page));
	await step('explorer-file-row-no-editor-tab', () => assertNoEditorTabFor(page, 'guide.md'));

	await step('folder-quick-open', () => quickOpen(page, 'docs'));
	await step('folder-quick-open-canvas', () => assertCanvasFolder(page, 'docs'));

	const summary = {
		ok: true,
		workspace: workspacePath,
		checks: [
			'product-identity-basehalf',
			'canvas-visible',
			'open-editors-hidden',
			'competing-view-containers-hidden',
			'hidden-surface-runtime-guard',
			'agent-area-five-choices-command-unavailable-state',
			'agent-area-terminal-command-no-stock-panel',
			'source-control-git-provider',
			'source-control-publish-branch-action',
			'git-branch-checkout-quickpick',
			'canvas-card-badge-preview-connectors',
			'card-detail-covers-scrolled-canvas',
			'markdown-rich-status-in-header',
			'quick-open-card-detail',
			'markdown-rich-editor-edit-save',
			'quick-open-side-card-detail-no-tab',
			'source-card-detail-flush-on-navigation',
			'quick-text-search-card-detail-no-tab',
			'quick-text-search-selection-focus',
			'quick-text-search-repeated-selection-focus',
			'quick-text-search-side-card-detail-no-tab',
			'explorer-folder-row-canvas',
			'detail-breadcrumb-folder-navigation',
			'canvas-zoom-controls',
			'canvas-breadcrumb-root-navigation',
			'explorer-file-row-card-detail-no-tab',
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

async function step(name, run) {
	console.error(`[basehalf-smoke] start ${name}`);
	await run();
	console.error(`[basehalf-smoke] pass ${name}`);
}

function createFixtureWorkspace(workspace) {
	fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
	fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror'), { recursive: true });
	fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke README\n\nneedle-basehalf-routing\n\nneedle-basehalf-second\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const needleSymbol = 42;\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# Guide\n\nfolder target\n', 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'README.md'), { recursive: true });
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'badge.yaml'), [
		'path: "README.md"',
		'kind: file',
		'description: "Smoke file badge"',
		'references: []',
		'referenced_by: []',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'canvas.yaml'), [
		'path: ""',
		'size:',
		'  width: 1400',
		'  height: 1800',
		'cards: []',
		'edges: []',
		''
	].join('\n'), 'utf8');
	initializeGitWorkspace(workspace);
	configureGitAuthor(workspace);
	commitFixtureChanges(workspace, 'initial smoke fixture');
	execFileSync('git', ['branch', 'branch-picker-target'], { cwd: workspace, stdio: 'ignore' });
	fs.appendFileSync(path.join(workspace, 'README.md'), '\nscm dirty change\n', 'utf8');
	fs.appendFileSync(path.join(workspace, 'src', 'app.ts'), '\nexport const smokeDirtyChange = true;\n', 'utf8');
}

function initializeGitWorkspace(workspace) {
	try {
		execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
	} catch {
		execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
		execFileSync('git', ['checkout', '-B', 'main'], { cwd: workspace, stdio: 'ignore' });
	}
}

function configureGitAuthor(workspace) {
	execFileSync('git', ['config', 'user.email', 'basehalf-smoke@example.invalid'], { cwd: workspace, stdio: 'ignore' });
	execFileSync('git', ['config', 'user.name', 'BaseHalf Smoke'], { cwd: workspace, stdio: 'ignore' });
}

function commitFixtureChanges(workspace, message) {
	execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', message], { cwd: workspace, stdio: 'ignore' });
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
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(value);
	await waitForQuickInputResult(page);
	if (await quickInput.isVisible().catch(() => false)) {
		await page.keyboard.press(acceptKey);
		try {
			await quickInput.waitFor({ state: 'hidden', timeout: 5_000 });
		} catch {
			await page.keyboard.press('Escape');
			await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		}
	}
}

async function runCommand(page, value) {
	const ran = await tryRunCommand(page, value, { expectedBestRowText: value });
	if (!ran) {
		throw new Error(`Command not found in QuickInput: ${value}`);
	}
}

async function tryRunCommand(page, value, options = {}) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(`>${value}`);
	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (/^No matching/.test(firstRowText) || (options.expectedBestRowText && !isExpectedCommandRow(firstRowText, options.expectedBestRowText))) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	const disabled = await firstRow.evaluate(row => {
		const element = row;
		return element.getAttribute('aria-disabled') === 'true'
			|| element.classList.contains('disabled')
			|| !!element.querySelector('.disabled');
	});
	if (disabled) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	await page.keyboard.press('Enter');
	try {
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	} catch (error) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	return true;
}

function visibleQuickInput(page) {
	return page.locator('.quick-input-widget:visible input').last();
}

function isExpectedCommandRow(rowText, expectedText) {
	return rowText === expectedText
		|| rowText.startsWith(`${expectedText} `)
		|| rowText.startsWith(`${expectedText},`)
		|| rowText.endsWith(`: ${expectedText}`);
}

async function waitForQuickInputResult(page) {
	await page.waitForFunction(() => {
		const input = Array.from(document.querySelectorAll('.quick-input-widget input')).find(candidate => {
			const element = candidate;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		});
		const inputVisible = !!input && (() => {
			const element = input;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		})();
		const rows = Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row[role="option"]'));
		const hasResult = rows.some(row => {
			const text = (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim();
			return text && text !== 'No matching results';
		});
		return hasResult || !inputVisible;
	}, null, { timeout: 15_000 });
}

async function openExplorerRow(page, label) {
	const row = page.locator('.explorer-viewlet .monaco-list-row', { hasText: label }).first();
	if (!(await row.isVisible().catch(() => false))) {
		await runCommand(page, 'Focus on Files Explorer');
	}
	await row.waitFor({ state: 'visible', timeout: 20_000 });
	await row.click();
	const isFolder = (await row.getAttribute('aria-expanded')) !== null;
	const openKey = process.platform === 'darwin' && !isFolder ? 'Meta+ArrowDown' : 'Enter';
	await page.keyboard.press(openKey);
}

async function assertOpenEditorsHidden(page) {
	const headers = await page.locator('.pane-header h3.title').evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(text => text === 'Open Editors'));
	if (headers.length) {
		throw new Error('Open Editors view is visible in Explorer');
	}
}

async function assertCompetingViewContainersHidden(page) {
	const forbidden = ['Extensions', 'Chat', 'Run and Debug', 'Debug Console', 'Testing', 'Test Results', 'Remote Explorer', 'Terminal'];
	const started = Date.now();
	let visibleForbidden = [];
	while (Date.now() - started < 5_000) {
		const visibleTitles = await visibleViewContainerTitles(page);
		visibleForbidden = forbidden.filter(title => visibleTitles.includes(title));
		if (!visibleForbidden.length) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Competing VS Code view containers are visible: ${visibleForbidden.join(', ')}`);
}

async function visibleViewContainerTitles(page) {
	return page.locator('.part.sidebar .title-label h2, .part.panel .title-label h2, .part.auxiliarybar .title-label h2').evaluateAll(nodes => nodes
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
}

async function assertHiddenSurfaceCommandsStayHidden(page) {
	const hiddenSurfaceCommands = [
		'Extensions: Focus on Extensions View',
		'Chat: Open Chat',
		'View: Show Run and Debug',
		'Debug Console: Focus on Debug Console View',
		'View: Show Testing',
		'View: Show Remote Explorer'
	];
	let exercisedCommands = 0;
	for (const command of hiddenSurfaceCommands) {
		console.error(`[basehalf-smoke] try hidden command ${command}`);
		if (await tryRunCommand(page, command, { expectedBestRowText: command })) {
			exercisedCommands++;
		}
		await assertCompetingViewContainersHidden(page);
		console.error(`[basehalf-smoke] pass hidden command ${command}`);
	}
	if (!exercisedCommands) {
		throw new Error('Hidden surface runtime guard did not exercise any VS Code command palette entries');
	}
}

async function assertAgentAreaChoices(page) {
	await page.locator('.basehalf-agent-area').waitFor({ state: 'attached', timeout: 15_000 });
	const choices = await page.locator('.basehalf-agent-choice').evaluateAll(nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
	const expected = ['Codex', 'Claude Code', 'Codex Extension', 'Claude Code Extension', 'Terminal'];
	if (choices.join('|') !== expected.join('|')) {
		throw new Error(`Unexpected Agent Area choices: ${choices.join(', ')}`);
	}

	await runCommand(page, 'New Codex Extension Session');
	await page.locator('.basehalf-agent-area.visible').waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-agent-tab.unavailable', { hasText: 'Codex Extension' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-agent-extension-state', { hasText: /openai\.chatgpt/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-agent-tab.unavailable .basehalf-agent-tab-close').click();
	await page.locator('.basehalf-agent-area-icon[aria-label="Hide Agent Area"]').click();
}

async function assertAgentAreaTerminalCommand(page) {
	await runCommand(page, 'Terminal: Create New Terminal');
	await page.locator('.basehalf-agent-area.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-agent-tab.active').first().waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForFunction(() => {
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		return !!activeSession?.querySelector('.terminal-wrapper, .xterm');
	}, null, { timeout: 20_000 });
	await assertStockTerminalPanelHidden(page);
	await page.locator('.basehalf-agent-area-icon[aria-label="Hide Agent Area"]').click();
	await assertStockTerminalPanelHidden(page);
}

async function assertTogglePanelRemapsToAgentArea(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area.visible').waitFor({ state: 'visible', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area.visible').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

async function assertStockTerminalPanelHidden(page) {
	const visibleTerminalPanelTitles = await page.locator('.part.panel .title-label h2').evaluateAll(nodes => nodes
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
		.filter(text => text === 'Terminal'));
	if (visibleTerminalPanelTitles.length) {
		throw new Error('Stock VS Code Terminal panel is visible instead of BaseHalf Agent Area');
	}
}

async function assertSourceControlPanel(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
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

async function assertSourceControlPublishBranchAction(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.waitForFunction(() => {
		const buttons = Array.from(document.querySelectorAll('.pane .monaco-button'));
		return buttons.some(button => (button.textContent || '').replace(/\s+/g, ' ').includes('Publish Branch'));
	}, null, { timeout: 20_000 });
}

async function assertGitBranchCheckoutQuickPick(page) {
	await page.locator('.part.statusbar .statusbar-item', { hasText: 'main' }).first().click();
	const quickInput = page.locator('.quick-input-widget input');
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('branch-picker-target');
	await waitForQuickInputResult(page);

	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (!firstRowText.includes('branch-picker-target')) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		throw new Error(`Git branch picker did not offer branch-picker-target first: ${firstRowText}`);
	}

	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 20_000 });
	await page.waitForFunction(() => {
		const shell = document.querySelector('.monaco-workbench');
		const text = (shell?.textContent || '').replace(/\s+/g, ' ');
		return text.includes('branch-picker-target');
	}, null, { timeout: 20_000 });
}

async function assertCardDetail(page, title) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-card-detail-title', { hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertCanvasFolder(page, title) {
	await page.locator('.basehalf-canvas-title', { hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertDetailBreadcrumbOpensFolder(page, relativePath) {
	await page.locator(`.basehalf-card-detail-title .basehalf-breadcrumb[data-relative-path="${relativePath}"]`).click();
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await assertCanvasFolder(page, relativePath);
}

async function assertCanvasZoomControls(page) {
	await page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom In"]').click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1.1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '110%' }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]').click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertCanvasBreadcrumbOpensRoot(page) {
	const rootCrumb = page.locator('.basehalf-canvas-title .basehalf-breadcrumb[data-relative-path=""]').first();
	const rootLabel = ((await rootCrumb.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	await rootCrumb.click();
	await assertCanvasFolder(page, rootLabel);
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

async function assertCanvasCardBadgePreviewAndConnectors(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await readme.locator('.basehalf-canvas-card-badge-description', { hasText: 'Smoke file badge' }).waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });

	const handleCount = await readme.locator('.basehalf-canvas-card-connect-handle').count();
	if (handleCount !== 4) {
		throw new Error(`Expected four card connection handles, got ${handleCount}`);
	}

	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	await src.waitFor({ state: 'visible', timeout: 10_000 });
	await docs.hover();
	const fromBox = await docs.locator('.basehalf-canvas-card-connect-handle.east').boundingBox();
	const targetBox = await src.boundingBox();
	if (!fromBox || !targetBox) {
		throw new Error('Missing card connection geometry');
	}

	await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetBox.x + 2, targetBox.y + targetBox.height / 2, { steps: 8 });
	await page.mouse.up();

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const docsBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'badge.yaml');
	const srcBadgePath = path.join(workspacePath, '.bh', 'mirror', 'src', 'badge.yaml');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('from_anchor: east')
			&& canvas.includes('to: "src"')
			&& canvas.includes('to_anchor: west');
	}, 'canvas.yaml to persist a four-side edge');
	await waitUntil(() => fs.existsSync(docsBadgePath) && fs.readFileSync(docsBadgePath, 'utf8').includes('- "src"'), 'source badge reference to persist');
	await waitUntil(() => fs.existsSync(srcBadgePath) && fs.readFileSync(srcBadgePath, 'utf8').includes('- "docs"'), 'target badge inbound reference to persist');
}

async function scrollCanvasWorkbenchForCardDetail(page) {
	const result = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		if (!(root instanceof HTMLElement)) {
			throw new Error('Missing BaseHalf canvas workbench');
		}

		root.scrollTop = Math.min(320, Math.max(0, root.scrollHeight - root.clientHeight));
		root.scrollLeft = Math.min(120, Math.max(0, root.scrollWidth - root.clientWidth));
		return {
			top: root.scrollTop,
			left: root.scrollLeft,
			scrollHeight: root.scrollHeight,
			clientHeight: root.clientHeight
		};
	});

	if (result.top < 100) {
		throw new Error(`Expected scrollable canvas before card detail, got top=${result.top}, scrollHeight=${result.scrollHeight}, clientHeight=${result.clientHeight}`);
	}
}

async function assertCardDetailCoversCanvasViewport(page) {
	const geometry = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const detail = document.querySelector('.basehalf-card-detail.visible');
		if (!(root instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
			throw new Error('Missing visible BaseHalf card detail');
		}

		const rootRect = root.getBoundingClientRect();
		const detailRect = detail.getBoundingClientRect();
		const bottomProbe = document.elementFromPoint(rootRect.left + rootRect.width / 2, rootRect.bottom - 24);
		return {
			rootTop: rootRect.top,
			rootLeft: rootRect.left,
			rootBottom: rootRect.bottom,
			rootRight: rootRect.right,
			detailTop: detailRect.top,
			detailLeft: detailRect.left,
			detailBottom: detailRect.bottom,
			detailRight: detailRect.right,
			scrollTop: root.scrollTop,
			scrollLeft: root.scrollLeft,
			locked: root.classList.contains('basehalf-card-detail-open'),
			bottomProbeIsCanvas: !!bottomProbe?.closest('.basehalf-canvas-card, .basehalf-canvas-surface')
		};
	});

	const tolerance = 1;
	if (!geometry.locked || geometry.scrollTop !== 0 || geometry.scrollLeft !== 0) {
		throw new Error(`Card detail did not lock canvas scroll: ${JSON.stringify(geometry)}`);
	}
	if (Math.abs(geometry.detailTop - geometry.rootTop) > tolerance
		|| Math.abs(geometry.detailLeft - geometry.rootLeft) > tolerance
		|| Math.abs(geometry.detailBottom - geometry.rootBottom) > tolerance
		|| Math.abs(geometry.detailRight - geometry.rootRight) > tolerance) {
		throw new Error(`Card detail does not cover canvas viewport: ${JSON.stringify(geometry)}`);
	}
	if (geometry.bottomProbeIsCanvas) {
		throw new Error(`Card detail leaves canvas visible at the bottom: ${JSON.stringify(geometry)}`);
	}
}

async function assertMarkdownRichStatusInHeader(page) {
	const toolbarCount = await page.locator('.basehalf-card-detail-markdown-rich-toolbar').count();
	const bodyStatusCount = await page.locator('.basehalf-card-detail-markdown-rich-status').count();
	if (toolbarCount !== 0 || bodyStatusCount !== 0) {
		throw new Error(`Markdown rich status should live in the detail header, toolbarCount=${toolbarCount}, bodyStatusCount=${bodyStatusCount}`);
	}
	await page.locator('.basehalf-card-detail-meta', { hasText: /Rich • (Saved|Readonly|Source has unsaved changes|Unsaved changes|Saving|Loading)/ }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertMarkdownRichEditorEditsAndSaves(page) {
	const marker = `rich editor smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(marker);

	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'rich Markdown editor to persist edits', 15_000);
}

async function activeMarkdownRichFrame(page) {
	const started = Date.now();
	let lastFrameUrls = [];
	while (Date.now() - started < 20_000) {
		const frames = page.frames();
		lastFrameUrls = frames.map(frame => frame.url()).filter(Boolean);
		for (const frame of frames) {
			const editorCount = await frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
			if (editorCount > 0) {
				return frame;
			}
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Markdown rich editor webview was not ready. Frames: ${lastFrameUrls.join(', ')}`);
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

function lineNumberForText(relativePath, needle) {
	const filePath = path.join(workspacePath, ...relativePath.split('/'));
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const index = lines.findIndex(line => line.includes(needle));
	if (index < 0) {
		throw new Error(`Did not find ${needle} in ${relativePath}`);
	}
	return index + 1;
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
