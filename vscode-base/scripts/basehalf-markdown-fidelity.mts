/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Markdown fidelity regression: opens every file in
 * `scripts/basehalf-fidelity-corpus/` in the rich editor, forces a serialize
 * (Cmd+S), and asserts the file on disk stays byte-identical. This guards the
 * product's core promise — the Markdown file is the single content truth and
 * merely opening it in the rich projection never rewrites it.
 *
 * Run from `vscode-base/` after a compile (same prerequisites as
 * `npm run basehalf:smoke-no-compile`):
 *
 *     npm run basehalf:fidelity
 */

import { _electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const corpusDir = path.join(__dirname, 'basehalf-fidelity-corpus');

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-fidelity-'));
const workspacePath = path.join(runRoot, 'workspace');
const userDataDir = path.join(runRoot, 'user-data');
const extensionsDir = path.join(runRoot, 'extensions');
for (const dir of [workspacePath, userDataDir, extensionsDir]) {
	fs.mkdirSync(dir, { recursive: true });
}

const corpusFiles = fs.readdirSync(corpusDir).filter(name => name.endsWith('.md')).sort();
if (corpusFiles.length === 0) {
	throw new Error(`No corpus files found in ${corpusDir}`);
}
const originals = new Map<string, Buffer>();
for (const name of corpusFiles) {
	const bytes = fs.readFileSync(path.join(corpusDir, name));
	originals.set(name, bytes);
	fs.writeFileSync(path.join(workspacePath, name), bytes);
}

// A DOM needle unique to each file, used to await the right webview frame.
const needles: Record<string, string> = {
	'comments-only.md': 'top comment',
	'crlf.md': 'Windows line endings',
	'deep-nesting.md': 'third level quote',
	'edge-whitespace.md': 'hard break',
	'frontmatter.md': 'Content under frontmatter',
	'html-and-comments.md': 'HTML block content',
	'links-and-refs.md': 'Links of every kind',
	'no-trailing-newline.md': 'ends without a final newline',
	'real-notes.md': 'Reading notes',
	'setext-and-escapes.md': 'Setext Title',
	'structures.md': 'Heading one',
};
for (const name of corpusFiles) {
	if (!needles[name]) {
		throw new Error(`Missing DOM needle for corpus file ${name}`);
	}
}

const electronPath = getDevElectronPath();
if (!fs.existsSync(electronPath)) {
	throw new Error(`Dev Electron was not found at ${electronPath}. Run npm run basehalf:smoke first.`);
}

const env: Record<string, string | undefined> = {
	...process.env,
	NODE_ENV: 'development',
	VSCODE_DEV: '1',
	VSCODE_CLI: '1',
	ELECTRON_RUN_AS_NODE: undefined,
};

const app = await _electron.launch({
	executablePath: electronPath,
	args: [
		root,
		workspacePath,
		'--skip-release-notes', '--skip-welcome', '--disable-telemetry', '--disable-experiments',
		'--no-cached-data', '--disable-updates', '--disable-workspace-trust',
		`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
	],
	timeout: 60_000,
	env: env as Record<string, string>,
});

const failures: string[] = [];
try {
	const page = await app.firstWindow();
	await page.setViewportSize({ width: 1280, height: 860 });
	await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.waitForTimeout(2000);

	for (const name of corpusFiles) {
		await quickOpen(page, name);

		const frame = await richFrameContaining(page, needles[name]);
		await frame.locator('.bn-editor').first().click();
		await page.keyboard.press('Meta+s');
		await page.locator('.basehalf-card-detail-save-status', { hasText: /^Saved$/ }).waitFor({ state: 'visible', timeout: 15_000 });
		await page.waitForTimeout(300);

		const after = fs.readFileSync(path.join(workspacePath, name));
		const before = originals.get(name)!;
		if (after.equals(before)) {
			console.log(`[fidelity] pass ${name}`);
		} else {
			failures.push(name);
			console.error(`[fidelity] FAIL ${name}: ${before.length} -> ${after.length} bytes`);
			console.error(firstDivergence(before, after));
		}
	}
} finally {
	await app.close().catch(() => undefined);
	fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

if (failures.length > 0) {
	console.error(`[fidelity] ${failures.length}/${corpusFiles.length} files were rewritten: ${failures.join(', ')}`);
	process.exit(1);
}
console.log(`[fidelity] all ${corpusFiles.length} corpus files stayed byte-identical`);
process.exit(0);

async function quickOpen(page: Awaited<ReturnType<typeof app.firstWindow>>, value: string) {
	await page.keyboard.press('Meta+P');
	const quickInput = page.locator('.quick-input-widget:visible input:visible').last();
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(value);
	await page.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: value }).first()
		.waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
}

async function richFrameContaining(page: Awaited<ReturnType<typeof app.firstWindow>>, needle: string) {
	const started = Date.now();
	while (Date.now() - started < 30_000) {
		for (const frame of page.frames()) {
			const ready = await frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
			if (ready === 0) {
				continue;
			}
			const hasNeedle = await frame.evaluate(
				(text: string) => document.body.textContent?.includes(text) ?? false, needle
			).catch(() => false);
			if (hasNeedle) {
				return frame;
			}
		}
		await page.waitForTimeout(150);
	}
	throw new Error(`Rich editor frame containing "${needle}" was not ready`);
}

function firstDivergence(before: Buffer, after: Buffer): string {
	const max = Math.min(before.length, after.length);
	let index = 0;
	while (index < max && before[index] === after[index]) {
		index++;
	}
	const context = (buffer: Buffer) => JSON.stringify(buffer.subarray(Math.max(0, index - 40), index + 40).toString('utf8'));
	return `[fidelity]   diverges at byte ${index}\n[fidelity]   before: ${context(before)}\n[fidelity]   after:  ${context(after)}`;
}

function getDevElectronPath(): string {
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
