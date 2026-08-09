/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from '../node_modules/esbuild/lib/main.js';

const sourcePath = path.join(import.meta.dirname, 'canvas-markdown-inline-src', 'canvasMarkdownInline.ts');
const source = `${await readFile(sourcePath, 'utf8')}

export function exerciseCanvasFormatCommand(
	markdown: string | readonly string[],
	command: BaseHalfMarkdownFormatCommand,
	anchorText: string,
	headText = anchorText,
	includeHeadText = false,
) {
	const sources = typeof markdown === 'string' ? [markdown] : [...markdown];
	const units = sources.map((source, index) => {
		const parsed = parseMarkdown(source);
		return canvasSchema.nodes.markdown_unit.create({ unitId: 'test-unit-' + index }, parsed.content);
	});
	const document = canvasSchema.nodes.doc.create(null, units);
	const textNodes: Array<{ readonly text: string; readonly position: number }> = [];
	document.descendants((node, position) => {
		if (node.isText) {
			textNodes.push({ text: node.text ?? '', position });
		}
	});
	const findText = (needle: string, end: boolean): number => {
		for (const candidate of textNodes) {
			const offset = candidate.text.indexOf(needle);
			if (offset >= 0) {
				return candidate.position + offset + (end ? needle.length : 0);
			}
		}
		throw new Error('Missing selection text: ' + needle);
	};
	const anchor = findText(anchorText, false);
	const head = findText(headText, includeHeadText);
	const state = EditorState.create({
		doc: document,
		selection: TextSelection.between(document.resolve(anchor), document.resolve(head)),
	});
	let emitted: Transaction | undefined;
	let dispatchCount = 0;
	const handled = commandForFormat(command)(state, transaction => {
		dispatchCount++;
		emitted = transaction;
	});
	const nextState = emitted ? state.apply(emitted) : state;
	const serialized: string[] = [];
	nextState.doc.forEach(node => {
		const content = node.type === canvasSchema.nodes.markdown_unit ? node.content : Fragment.from(node);
		serialized.push(canvasSerializer.serialize(canvasSchema.nodes.doc.create(null, content)).replace(/\\n$/, ''));
	});
	return {
		handled,
		dispatchCount,
		markdown: serialized.join('\\n\\n'),
	};
}
`;

const result = await build({
	stdin: {
		contents: source,
		resolveDir: path.dirname(sourcePath),
		sourcefile: sourcePath,
		loader: 'ts',
	},
	bundle: true,
	write: false,
	platform: 'node',
	format: 'esm',
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const moduleSource = result.outputFiles[0]?.text;
if (!moduleSource) {
	throw new Error('Canvas Markdown inline command test bundle was empty.');
}
const testModule = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`) as {
	readonly exerciseCanvasFormatCommand: (
		markdown: string | readonly string[],
		command: string,
		anchorText: string,
		headText?: string,
		includeHeadText?: boolean,
	) => { readonly handled: boolean; readonly dispatchCount: number; readonly markdown: string };
};
const exercise = testModule.exerciseCanvasFormatCommand;

function assertCommand(
	name: string,
	input: string | readonly string[],
	command: string,
	anchorText: string,
	headText: string,
	includeHeadText: boolean,
	expectedMarkdown: string,
	expectedDispatchCount: number,
): void {
	const actual = exercise(input, command, anchorText, headText, includeHeadText);
	assert.equal(actual.handled, true, `${name}: command should be handled`);
	assert.equal(actual.dispatchCount, expectedDispatchCount, `${name}: unexpected transaction count`);
	assert.equal(actual.markdown, expectedMarkdown, `${name}: unexpected Markdown`);
}

function assertRejectedCommand(name: string, input: string | readonly string[], command: string, token: string): void {
	const actual = exercise(input, command, token);
	assert.equal(actual.handled, false, `${name}: command should not be handled`);
	assert.equal(actual.dispatchCount, 0, `${name}: rejected command dispatched a transaction`);
}

const mixedInput = '* one\n* two\n\noutside';
assertCommand('mixed selection to heading', mixedInput, 'setHeading1', 'two', 'outside', true, '* one\n\n# two\n\n# outside', 1);
assertCommand('mixed selection to paragraph', mixedInput, 'setParagraph', 'two', 'outside', true, '* one\n\ntwo\n\noutside', 1);
assertCommand('mixed selection to list', mixedInput, 'toggleOrderedList', 'two', 'outside', true, '* one\n\n1. two\n2. outside', 1);
assertCommand('mixed selection extends matching list', mixedInput, 'toggleBulletList', 'two', 'outside', true, '* one\n* two\n* outside', 1);
assertCommand('reverse mixed selection', mixedInput, 'setHeading2', 'outside', 'two', false, '* one\n\n## two\n\n## outside', 1);

const productionUnits = ['* one\n* two', 'outside'];
assertCommand('cross-unit mixed selection to heading', productionUnits, 'setHeading1', 'two', 'outside', true, '* one\n\n# two\n\n# outside', 1);
assertCommand('reverse cross-unit mixed selection to paragraph', productionUnits, 'setParagraph', 'outside', 'two', false, '* one\n\ntwo\n\noutside', 1);
assertCommand('cross-unit mixed selection to ordered list', productionUnits, 'toggleOrderedList', 'two', 'outside', true, '* one\n\n1. two\n\n1. outside', 1);
assertCommand('cross-unit mixed selection extends matching list', productionUnits, 'toggleBulletList', 'two', 'outside', true, '* one\n* two\n\n* outside', 1);
assertCommand('reverse cross-unit mixed selection', productionUnits, 'toggleOrderedList', 'outside', 'two', false, '* one\n\n1. two\n\n1. outside', 1);
assertCommand('cross-unit paragraphs become one semantic list', ['alpha', 'beta'], 'toggleBulletList', 'alpha', 'beta', true, '* alpha\n\n* beta', 1);

assertCommand('idempotent heading', '# head', 'setHeading1', 'head', 'head', false, '# head', 0);
assertCommand('idempotent paragraph', 'plain', 'setParagraph', 'plain', 'plain', false, 'plain', 0);
assertCommand('mixed bold selection becomes uniformly bold', '**bold** plain', 'toggleBold', 'bold', 'plain', true, '**bold plain**', 1);
assertCommand('reverse mixed italic selection becomes uniformly italic', '*italic* plain tail', 'toggleItalic', 'tail', 'italic', false, '*italic plain* tail', 1);
assertCommand('fully bold selection clears bold', '**bold**', 'toggleBold', 'bold', 'bold', true, 'bold', 1);
assertCommand('fully italic selection clears italic', '*italic*', 'toggleItalic', 'italic', 'italic', true, 'italic', 1);

const threeItems = '* one\n* two\n* three';
assertCommand('divider splits list at cursor item', threeItems, 'insertDivider', 'two', 'two', false, '* one\n* two\n\n---\n\n* three', 1);
assertCommand('different list changes selected item only', threeItems, 'toggleOrderedList', 'two', 'two', false, '* one\n\n1. two\n\n* three', 1);
assertCommand('same list exits selected item only', threeItems, 'toggleBulletList', 'two', 'two', false, '* one\n\ntwo\n\n* three', 1);
assertCommand('adjacent list kinds converge', '* bullet\n\n1. ordered', 'toggleOrderedList', 'bullet', 'ordered', true, '1. bullet\n2. ordered', 1);

const nestedWithChild = '* outer\n  * inner\n    * deep\n* tail';
assertCommand('nested item changes list kind in place', nestedWithChild, 'toggleOrderedList', 'inner', 'inner', false, '* outer\n  1. inner\n     * deep\n* tail', 1);
assertCommand('nested item exits matching list', nestedWithChild, 'toggleBulletList', 'inner', 'inner', false, '* outer\n\ninner\n\n* deep\n* tail', 1);
assertCommand('nested item becomes heading', nestedWithChild, 'setHeading3', 'inner', 'inner', false, '* outer\n\n### inner\n\n* deep\n* tail', 1);

const nestedSiblings = '* outer\n  * inner1\n  * inner2\n  * inner3\n* tail';
assertCommand('nested partial list conversion preserves siblings', nestedSiblings, 'toggleOrderedList', 'inner2', 'inner2', false, '* outer\n  * inner1\n  1. inner2\n  * inner3\n* tail', 1);
assertCommand('nested partial list exit preserves siblings', nestedSiblings, 'toggleBulletList', 'inner2', 'inner2', false, '* outer\n  * inner1\n\ninner2\n\n* inner3\n* tail', 1);

assertCommand('quote becomes heading', '> quoted', 'setHeading1', 'quoted', 'quoted', false, '# quoted', 1);
assertCommand('quote becomes paragraph', '> quoted', 'setParagraph', 'quoted', 'quoted', false, 'quoted', 1);
assertCommand('quote becomes bullet list', '> quoted', 'toggleBulletList', 'quoted', 'quoted', false, '* quoted', 1);
assertCommand('quote becomes ordered list', '> quoted', 'toggleOrderedList', 'quoted', 'quoted', false, '1. quoted', 1);
assertCommand('partial quote conversion preserves siblings', '> first\n>\n> second\n>\n> third', 'setHeading2', 'second', 'second', false, '> first\n\n## second\n\n> third', 1);
assertCommand('reverse partial quote conversion preserves siblings', '> first\n>\n> second\n>\n> third', 'toggleBulletList', 'third', 'second', false, '> first\n\n* second\n* third', 1);
assertCommand('cross-unit quote and paragraph become headings', ['> quoted', 'outside'], 'setHeading3', 'quoted', 'outside', true, '### quoted\n\n### outside', 1);
assertCommand('reverse cross-unit quote and paragraph become a list', ['> quoted', 'outside'], 'toggleOrderedList', 'outside', 'quoted', false, '1. quoted\n\n1. outside', 1);

assertRejectedCommand('code block rejects heading conversion', '```ts\nconst value = 1;\n```', 'setHeading1', 'const value = 1;');
assertRejectedCommand('code block rejects paragraph conversion', '```ts\nconst value = 1;\n```', 'setParagraph', 'const value = 1;');
assertRejectedCommand('code block rejects list conversion', '```ts\nconst value = 1;\n```', 'toggleBulletList', 'const value = 1;');
assertCommand('mixed code selection changes only rich-compatible blocks', ['```ts\nconst value = 1;\n```', 'plain'], 'setHeading1', 'const value = 1;', 'plain', true, '```ts\nconst value = 1;\n```\n\n# plain', 1);
assertCommand('reverse mixed code selection lists only rich-compatible blocks', ['```ts\nconst value = 1;\n```', 'plain'], 'toggleBulletList', 'plain', 'const value = 1;', false, '```ts\nconst value = 1;\n```\n\n* plain', 1);

console.log('Canvas Markdown inline command tests passed.');
