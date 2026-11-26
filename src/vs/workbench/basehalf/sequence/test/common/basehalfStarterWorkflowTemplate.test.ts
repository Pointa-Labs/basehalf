/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseBaseHalfCanvasTemplate } from '../../../canvas/common/basehalfCanvasTemplate.js';
import { parseBaseHalfSequenceDocument, parseBaseHalfShotDocument } from '../../common/basehalfSequence.js';
import { BASEHALF_STARTER_WORKFLOW_TEMPLATE, BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE } from '../../common/basehalfStarterWorkflowTemplate.js';

interface TemplateDraft {
	readonly path: string;
	readonly prompt?: string;
}

// The template as the tests read it: its JSON, as the canvas reads it.
const template = JSON.parse(BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE);

suite('BaseHalfStarterWorkflowTemplate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('is a template the canvas reads, and its JSON is the template', () => {
		assert.deepStrictEqual(template, JSON.parse(JSON.stringify(BASEHALF_STARTER_WORKFLOW_TEMPLATE)));
		const parsed = parseBaseHalfCanvasTemplate(BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE);
		assert.deepStrictEqual(parsed.drafts.map(draft => draft.path), ['shots/shot-01/clip.mp4']);
	});

	test('makes notes, a video draft, and an empty Sequence, and nothing that runs (D63)', () => {
		assert.deepStrictEqual(Object.keys(template).sort(), ['cards', 'drafts', 'files', 'references', 'version']);
		const drafts = template.drafts as readonly TemplateDraft[];
		// A draft is declared by its path and, optionally, its prompt; its file lands under that name.
		assert.deepStrictEqual(drafts, [{ path: 'shots/shot-01/clip.mp4' }]);
		for (const draft of drafts) {
			assert.deepStrictEqual(Object.keys(draft).filter(key => !['path', 'prompt'].includes(key)), []);
		}
		const paths = [...template.files, ...drafts].map((entry: { path: string }) => entry.path);
		assert.strictEqual(new Set(paths).size, paths.length);
		// Every card shows a file or a draft of the template; only the README stays off the canvas.
		assert.deepStrictEqual(template.cards.map((card: { path: string }) => card.path).sort(), paths.filter(path => path !== 'README.md').sort());

		const forbiddenKeys = new Set(['nodes', 'role', 'recipe', 'attempts', 'task', 'result', 'credentials', 'outputs', 'upstream', 'generation', 'provider', 'model']);
		walkKeys(template, key => assert.strictEqual(forbiddenKeys.has(key), false, `template must not contain '${key}'`));
		const text = JSON.stringify(template);
		for (const retired of ['.aivideo', '.bhnode', 'outputs/', 'Video node']) {
			assert.strictEqual(text.includes(retired), false, retired);
		}
	});

	test('every shot folder holds a note, so that git keeps the folder of its draft', () => {
		const files = template.files as readonly { path: string }[];
		const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
		for (const draft of template.drafts as readonly TemplateDraft[]) {
			assert.ok(files.some(file => folderOf(file.path) === folderOf(draft.path) && /\.md$/.test(file.path)), draft.path);
		}
		const shotFolders = new Set(files.map(file => file.path).filter(path => path.startsWith('shots/')).map(folderOf));
		for (const folder of shotFolders) {
			assert.ok(files.some(file => folderOf(file.path) === folder && /\.md$/.test(file.path)), folder);
		}
	});

	test('connects the shot\'s notes to its video draft, where they join the prompt', () => {
		const paths = new Set([...template.files, ...template.drafts].map((entry: { path: string }) => entry.path));
		const upstreamByTarget = new Map<string, string[]>();
		for (const reference of template.references as readonly { from: string; to: string }[]) {
			assert.ok(paths.has(reference.from) && paths.has(reference.to), `${reference.from} -> ${reference.to}`);
			upstreamByTarget.set(reference.to, [...upstreamByTarget.get(reference.to) ?? [], reference.from]);
		}
		assert.deepStrictEqual(upstreamByTarget.get('shots/shot-01/clip.mp4'), ['shots/shot-01/storyboard.md', 'shots/shot-01/audio-plan.md']);
		assert.strictEqual(upstreamByTarget.has('video-sequence.json'), false);
		for (const file of template.files as readonly { path: string; contents: string }[]) {
			if (/\.(?:md|markdown)$/i.test(file.path)) {
				const frontmatter = /^(?:﻿)?---\r?\n(?<block>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(file.contents)?.groups?.block ?? '';
				assert.strictEqual(/^upstream\s*:/m.test(frontmatter), false, `${file.path} must not declare upstream`);
			}
		}
		const clipCard = template.cards.find((card: { path: string }) => card.path === 'shots/shot-01/clip.mp4');
		assert.deepStrictEqual({ width: clipCard.width, height: clipCard.height }, { width: 720, height: 405 });
	});

	test('starts with an empty, portable clip sequence and a shot that names its video draft', () => {
		const shotFile = template.files.find((file: { path: string }) => file.path === 'shots/shot-01/shot.json');
		const shot = parseBaseHalfShotDocument(shotFile.contents);
		const shotDirectory = shotFile.path.slice(0, shotFile.path.lastIndexOf('/') + 1);
		assert.ok((template.drafts as readonly TemplateDraft[]).some(draft => draft.path === `${shotDirectory}${shot.clipNodePath}`));
		const sequenceFile = template.files.find((file: { path: string }) => file.path === 'video-sequence.json');
		assert.deepStrictEqual(parseBaseHalfSequenceDocument(sequenceFile.contents).items, []);
		const readme = template.files.find((file: { path: string }) => file.path === 'README.md');
		assert.match(readme.contents, /Add Video Result to Sequence/);
		assert.match(readme.contents, /Show Video Sequence Status/);
		assert.match(readme.contents, /Remove Video Sequence Clip/);
		assert.match(readme.contents, /clip\.mp4/);
		assert.doesNotMatch(readme.contents, /sealed|recipe|Attempt|outputs|Video node|\.bhnode/i);
	});
});

function walkKeys(value: unknown, visitor: (key: string) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			walkKeys(item, visitor);
		}
		return;
	}
	if (!value || typeof value !== 'object') {
		return;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		visitor(key);
		walkKeys(child, visitor);
	}
}
