/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The fixture workspace that each suite starts on, its git history, and what it holds before BaseHalf first opens it.

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { workspacePath } from './context.mts';

export const FAR_FIXTURE_CONTENT = '# Far\n\nkeeps the docs canvas taller than the viewport at high zoom\n';
// The file BaseHalf writes at `.bh/.gitignore` before it writes a layout, byte for byte.
export const BH_IGNORE_FILE = [
	'# Written by BaseHalf. Card positions and BaseHalf\'s working files are',
	'# not shared through git.',
	'/.gitignore',
	'canvas.yaml',
	'!canvas.yaml/',
	'/cache/',
	'*.basehalf-tmp',
	''
].join('\n');
export const CANVAS_MALFORMED_EMPHASIS_PARAGRAPH = '曾经繁华的长安，如今已是断壁残垣。宫殿倾颓，街市萧条，只有那巍峨的山河依旧矗立，仿佛在无声地诉说着往日的辉煌。春风吹过，城中的草木却长得异常茂盛**，';
// What the fixture holds under .bh/ before BaseHalf first opens it.
export let bhTreeBeforeLaunch;
// What git shows of the fixture before BaseHalf first opens it.
export let gitStatusBeforeLaunch;

export function recordFixtureBeforeLaunch() {
	bhTreeBeforeLaunch = readBhTree();
	gitStatusBeforeLaunch = gitStatusOfWorkspace();
}

export function createFixtureWorkspace(workspace) {
	fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
	fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror'), { recursive: true });
	// Park the delay-based auto-save far beyond the test timeouts: with the
	// product default (250ms) it would write the source-card marker on its
	// own, making the flush-on-navigation step pass even with the navigation
	// flush broken. The rich Markdown autosave has its own webview timer and
	// is unaffected; it gets a dedicated disk assertion instead.
	fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
	// Deletes made by the smoke are permanent, so a run leaves nothing in the
	// system trash of the machine it runs on.
	fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'files.autoSaveDelay': 3_600_000, 'files.enableTrash': false, 'basehalf.agents.offerSkill': false }, null, '\t'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'README.md'), [
		'# Smoke README',
		'',
		'soft-line-alpha',
		'soft-line-beta',
		'soft-line-gamma',
		'',
		CANVAS_MALFORMED_EMPHASIS_PARAGRAPH,
		'',
		'> **Smoke editable quote.** It keeps a [guide link](docs/guide.md) as a rich quote block.',
		'',
		'- **Smoke nested item** starts here',
		'  nested-menu-anchor continuation',
		'',
		'needle-basehalf-routing',
		'',
		'needle-basehalf-second',
		'',
		'External merge target paragraph.',
		'',
		'<div class="smoke-raw-island">raw html island</div>',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const needleSymbol = 42;\n', 'utf8');
	// Keep the media fixture below docs so the root-canvas framing contract is
	// unchanged by this additional smoke-only file.
	fs.writeFileSync(path.join(workspace, 'docs', 'concept.svg'), [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">',
		'  <rect width="320" height="180" fill="#1f2937"/>',
		'  <circle cx="160" cy="90" r="54" fill="#60a5fa"/>',
		'</svg>',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'textbook.pdf'), createMinimalPdfFixture());
	fs.writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# Guide\n\nfolder target\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'far.md'), FAR_FIXTURE_CONTENT, 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'README.md'), { recursive: true });
	// The fixture is a folder that BaseHalf has written layouts in before: its
	// ignore file is there, so the layouts below are on disk and not in git.
	fs.writeFileSync(path.join(workspace, '.bh', '.gitignore'), BH_IGNORE_FILE, 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'badge.yaml'), [
		'path: "README.md"',
		'kind: file',
		'description: "Smoke file badge"',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'adhd.yaml'), [
		'path: "README.md"',
		'kind: file',
		'highlight_keywords:',
		'  - "Smoke"',
		'read_paragraphs:',
		'  - [1, 2]',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'canvas.yaml'), [
		'path: ""',
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		'  - path: "README.md"',
		'    kind: file',
		'    x: -140',
		'    y: -110',
		'    width: 300',
		'    height: 220',
		'edges: []',
		''
	].join('\n'), 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'docs'), { recursive: true });
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'docs', 'canvas.yaml'), [
		'path: "docs"',
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		'  - path: "docs/guide.md"',
		'    kind: file',
		'    x: -140',
		'    y: -110',
		'    width: 300',
		'    height: 220',
		'  - path: "docs/far.md"',
		'    kind: file',
		'    x: 420',
		'    y: 980',
		'    width: 300',
		'    height: 220',
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

export function commitFixtureChanges(workspace, message) {
	execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', message], { cwd: workspace, stdio: 'ignore' });
}

export function gitStatusOfWorkspace() {
	return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspacePath, encoding: 'utf8' });
}

// Every entry under the workspace's .bh/, keyed by workspace-relative path:
// directories end with '/', symbolic links map to their target, and files map
// to a hash of their bytes.
export function readBhTree() {
	const tree = {};
	const pending = [path.join(workspacePath, '.bh')];
	while (pending.length > 0) {
		const directory = pending.pop();
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			const rel = path.relative(workspacePath, entryPath).split(path.sep).join('/');
			if (entry.isSymbolicLink()) {
				tree[rel] = `link:${fs.readlinkSync(entryPath)}`;
			} else if (entry.isDirectory()) {
				tree[`${rel}/`] = 'directory';
				pending.push(entryPath);
			} else {
				tree[rel] = createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex');
			}
		}
	}
	return tree;
}

export function createMinimalPdfFixture() {
	const stream = 'BT /F1 18 Tf 40 120 Td (BaseHalf PDF smoke) Tj ET';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
	const offsets = [0];
	for (let index = 0; index < objects.length; index++) {
		offsets.push(Buffer.byteLength(body, 'binary'));
		body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(body, 'binary');
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body, 'binary');
}
