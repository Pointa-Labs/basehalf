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
	let focusCount = 0;
	let handledCount = 0;
	const commandView = { focus: () => focusCount++ } as EditorView;
	const handled = runCanvasFormatCommand(
		command,
		state,
		transaction => {
			dispatchCount++;
			emitted = transaction;
		},
		commandView,
		() => handledCount++,
	);
	const nextState = emitted ? state.apply(emitted) : state;
	const serialized: string[] = [];
	nextState.doc.forEach(node => {
		const content = node.type === canvasSchema.nodes.markdown_unit ? node.content : Fragment.from(node);
		serialized.push(canvasSerializer.serialize(canvasSchema.nodes.doc.create(null, content)).replace(/\\n$/, ''));
	});
	return {
		handled,
		dispatchCount,
		focusCount,
		handledCount,
		markdown: serialized.join('\\n\\n'),
	};
}

export function exerciseCanvasProjectionPersistence(source: string, edited: string, renderedCandidate: string) {
	const input = {
		id: 'persistence-unit',
		markdown: source,
		prefix: '',
		separator: '',
		element: undefined as unknown as HTMLElement,
	};
	const sourceDocument = parseMarkdown(source);
	const initialNode = canvasSchema.nodes.markdown_unit.create({ unitId: input.id }, sourceDocument.content);
	const records = new Map<string, CanvasMarkdownRuntimeUnit>([[input.id, {
		input,
		initialNode,
		staticElement: undefined as unknown as HTMLElement,
	}]]);
	const unchangedDocument = canvasSchema.nodes.doc.create(null, [initialNode]);
	const editedSourceDocument = parseMarkdown(edited);
	const editedNode = canvasSchema.nodes.markdown_unit.create({ unitId: input.id }, editedSourceDocument.content);
	const editedDocument = canvasSchema.nodes.doc.create(null, [editedNode]);
	const renderedDocument = parseMarkdown(renderedCandidate);
	return {
		renderedCandidatePreservesSourceProjection:
			canvasMarkdownProjectionIsEquivalent(renderedDocument, sourceDocument),
		unchanged: serializeCanvasMarkdownDocument(unchangedDocument, records, source.includes('\\r\\n') ? '\\r\\n' : '\\n'),
		edited: serializeCanvasMarkdownDocument(editedDocument, records, source.includes('\\r\\n') ? '\\r\\n' : '\\n'),
	};
}

function unitDocument(sources: readonly string[]) {
	// A source of '<html>' stands for a unit the editor keeps as it is.
	return canvasSchema.nodes.doc.create(null, sources.map((source, index) => source === '<html>'
		? canvasSchema.nodes.unsupported_markdown.create({ unitId: 'unit-' + index })
		: canvasSchema.nodes.markdown_unit.create({ unitId: 'unit-' + index }, parseMarkdown(source).content)));
}

function textPosition(document: ProseMirrorNode, needle: string, end: boolean): number {
	let found: number | undefined;
	document.descendants((node, position) => {
		if (found === undefined && node.isText) {
			const offset = (node.text ?? '').indexOf(needle);
			if (offset >= 0) {
				found = position + offset + (end ? needle.length : 0);
			}
		}
	});
	if (found === undefined) {
		throw new Error('Missing selection text: ' + needle);
	}
	return found;
}

export function exerciseSelectionAcrossDocuments(before: readonly string[], after: readonly string[], anchorText: string, headText: string) {
	const previous = unitDocument(before);
	const next = unitDocument(after);
	const mapped = mapSelectionAcrossDocuments({ anchor: textPosition(previous, anchorText, false), head: textPosition(previous, headText, true) }, previous.toJSON(), next);
	return mapped ? next.textBetween(Math.min(mapped.anchor, mapped.head), Math.max(mapped.anchor, mapped.head), '\\n') : undefined;
}

export function exerciseTypedText(source: string, afterText: string, typed: string) {
	const document = canvasSchema.nodes.doc.create(null, [canvasSchema.nodes.markdown_unit.create({ unitId: 'typed-unit' }, parseMarkdown(source).content)]);
	const position = textPosition(document, afterText, true);
	const state = EditorState.create({ doc: document, selection: TextSelection.create(document, position) });
	const next = state.apply(state.tr.insertText(typed));
	return serializeCanvasMarkdownUnit(canvasSchema.nodes.doc.create(null, next.doc.firstChild!.content));
}

export function exerciseSelectedSource(units: readonly { readonly markdown: string; readonly prefix: string; readonly separator: string }[], anchorText: string, headText: string) {
	const records = new Map<string, CanvasMarkdownRuntimeUnit>();
	const nodes = units.map((unit, index) => {
		const id = 'unit-' + index;
		const initialNode = canvasSchema.nodes.markdown_unit.create({ unitId: id }, parseMarkdown(unit.markdown).content);
		records.set(id, { input: { id, editable: true, element: undefined as unknown as HTMLElement, ...unit }, initialNode, staticElement: undefined as unknown as HTMLElement });
		return initialNode;
	});
	const document = canvasSchema.nodes.doc.create(null, nodes);
	const state = EditorState.create({ doc: document, selection: TextSelection.between(document.resolve(textPosition(document, anchorText, false)), document.resolve(textPosition(document, headText, true))) });
	return selectedCanvasMarkdownSource(state, records, '\\n');
}

type FixedTestUnit = { readonly markdown: string; readonly prefix: string; readonly separator: string; readonly editable: boolean; readonly appended?: boolean };
export function exerciseFixedUnits(units: readonly FixedTestUnit[], action: { readonly select: number; readonly letter?: string; readonly enter?: boolean; readonly remove?: boolean; readonly typeIn?: { readonly unit: number; readonly text: string } }) {
	const records = new Map<string, CanvasMarkdownRuntimeUnit>();
	const nodes = units.map((unit, index) => {
		const id = 'unit-' + index;
		const initialNode = unit.editable
			? canvasSchema.nodes.markdown_unit.create({ unitId: id }, parseMarkdown(unit.markdown).childCount > 0 ? parseMarkdown(unit.markdown).content : canvasSchema.nodes.paragraph.create())
			: canvasSchema.nodes.unsupported_markdown.create({ unitId: id });
		records.set(id, { input: { id, element: undefined as unknown as HTMLElement, ...unit }, initialNode, staticElement: { textContent: unit.markdown } as unknown as HTMLElement });
		return initialNode;
	});
	const document = canvasSchema.nodes.doc.create(null, nodes);
	let offset = 0;
	const offsets = nodes.map(node => { const at = offset; offset += node.nodeSize; return at; });
	let state = EditorState.create({ doc: document, selection: units[action.select].editable ? TextSelection.near(document.resolve(offsets[action.select] + 1)) : NodeSelection.create(document, offsets[action.select]) });
	const dispatch = (transaction: Transaction) => { state = state.apply(transaction); };
	const copied = markdownOfSelectedBlocks(state.selection, records);
	if (action.letter !== undefined || action.enter) {
		startParagraphAfterFixedUnit(action.letter)(state, dispatch);
	}
	if (action.remove) {
		dispatch(state.tr.deleteSelection());
	}
	if (action.typeIn) {
		dispatch(state.tr.insertText(action.typeIn.text, offsets[action.typeIn.unit] + 2));
	}
	const near = units.map((unit, index) => unit.editable ? undefined : editablePlaceNear(document, index)?.from);
	return { markdown: serializeCanvasMarkdownDocument(state.doc, records, '\\n'), copied, near, offsets };
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
	) => {
		readonly handled: boolean;
		readonly dispatchCount: number;
		readonly focusCount: number;
		readonly handledCount: number;
		readonly markdown: string;
	};
	readonly exerciseSelectionAcrossDocuments: (before: readonly string[], after: readonly string[], anchorText: string, headText: string) => string | undefined;
	readonly exerciseTypedText: (source: string, afterText: string, typed: string) => string;
	readonly exerciseFixedUnits: (units: readonly { readonly markdown: string; readonly prefix: string; readonly separator: string; readonly editable: boolean; readonly appended?: boolean }[], action: { readonly select: number; readonly letter?: string; readonly enter?: boolean; readonly remove?: boolean; readonly typeIn?: { readonly unit: number; readonly text: string } }) => { readonly markdown: string; readonly copied: string | undefined; readonly near: readonly (number | undefined)[]; readonly offsets: readonly number[] };
	readonly canEditCanvasMarkdownUnit: (markdown: string) => boolean;
	readonly exerciseSelectedSource: (units: readonly { readonly markdown: string; readonly prefix: string; readonly separator: string }[], anchorText: string, headText: string) => { readonly text: string; readonly start: number; readonly end: number; readonly firstEnd: number; readonly lastStart: number } | undefined;
	readonly exerciseCanvasProjectionPersistence: (
		source: string,
		edited: string,
		renderedCandidate: string,
	) => {
		readonly renderedCandidatePreservesSourceProjection: boolean;
		readonly unchanged: string;
		readonly edited: string;
	};
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
	assert.equal(actual.focusCount, 0, `${name}: formatting command moved focus`);
	assert.equal(actual.handledCount, 1, `${name}: handled callback should run once`);
	assert.equal(actual.markdown, expectedMarkdown, `${name}: unexpected Markdown`);
}

function assertRejectedCommand(name: string, input: string | readonly string[], command: string, token: string): void {
	const actual = exercise(input, command, token);
	assert.equal(actual.handled, false, `${name}: command should not be handled`);
	assert.equal(actual.dispatchCount, 0, `${name}: rejected command dispatched a transaction`);
	assert.equal(actual.focusCount, 0, `${name}: rejected command moved focus`);
	assert.equal(actual.handledCount, 0, `${name}: rejected command ran handled callback`);
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

const malformedEmphasis = '春风吹过，城中的草木却长得异常茂盛**，';
const malformedPersistence = testModule.exerciseCanvasProjectionPersistence(
	malformedEmphasis,
	'春风吹过，城中的草木却长得异常茂盛新**，',
	`${malformedEmphasis}******`,
);
assert.equal(malformedPersistence.renderedCandidatePreservesSourceProjection, false, 'synthetic renderer text must be rejected');
assert.equal(malformedPersistence.unchanged, malformedEmphasis, 'untouched malformed Markdown must remain byte-identical');
assert.equal(malformedPersistence.edited, '春风吹过，城中的草木却长得异常茂盛新\\*\\*，', 'an intentional edit must not persist synthetic stars');

const formattingMismatch = testModule.exerciseCanvasProjectionPersistence('**same text**', '**same text**', 'same text');
assert.equal(formattingMismatch.renderedCandidatePreservesSourceProjection, false, 'equal visible text with different Markdown semantics must be rejected');

const hiddenSourceSemantics = [
	['hard break', 'line\\\nnext', 'line\nnext'],
	['fence language', '```ts\nconst value = 1;\n```', '```\nconst value = 1;\n```'],
	['tight list rhythm', '- one\n- two', '- one\n\n- two'],
	['link destination', '[guide](docs/guide.md "Guide")', '[guide]()'],
] as const;
for (const [name, sourceMarkdown, renderedMarkdown] of hiddenSourceSemantics) {
	const result = testModule.exerciseCanvasProjectionPersistence(sourceMarkdown, sourceMarkdown, renderedMarkdown);
	assert.equal(result.renderedCandidatePreservesSourceProjection, true, `${name}: invisible source metadata must not force a different glyph projection`);
}

const malformedListProjection = testModule.exerciseCanvasProjectionPersistence('- **()*', '- **()*', '- \\*\\*()*');
assert.equal(malformedListProjection.renderedCandidatePreservesSourceProjection, false, 'list/source metadata must not bypass a visible-text mismatch');

// The selection agents can see: a selection follows a change made elsewhere,
// and what is selected maps to the Markdown of the units it is in.
assert.deepEqual([
	testModule.exerciseSelectionAcrossDocuments(['intro', 'target text here'], ['intro', 'a new paragraph', 'target text here'], 'target', 'text'),
	testModule.exerciseSelectionAcrossDocuments(['intro', 'old wordy paragraph', 'outro'], ['intro', 'short one', 'outro'], 'old', 'paragraph'),
	testModule.exerciseSelectionAcrossDocuments(['target', 'tail'], ['target', 'tail changed'], 'target', 'target'),
	// A unit kept as it is at the end is renamed too when a unit is added before it.
	testModule.exerciseSelectionAcrossDocuments(['# Title', 'alpha beta', '<html>'], ['# Title', 'Added by an agent.', 'alpha beta', '<html>'], 'beta', 'beta'),
], ['target text', 'short one', 'target', 'beta'], 'a selection follows text added before it, covers what replaced it, and stays when the change is after it');
const heading = { markdown: '# 核心概念', prefix: '', separator: '' };
const list = { markdown: '- IR 用户想要什么\n- SR 系统必须做什么', prefix: '\n\n', separator: '' };
const tail = { markdown: 'tail', prefix: '\n\n', separator: '\n' };
const listStart = heading.markdown.length + list.prefix.length;
const listEnd = listStart + list.markdown.length;
assert.deepEqual([
	testModule.exerciseSelectedSource([heading, list, tail], 'SR', '必须'),
	testModule.exerciseSelectedSource([heading, list, tail], '概念', 'IR'),
], [
	{ text: 'SR 系统必须', start: listStart, end: listEnd, firstEnd: listEnd, lastStart: listStart },
	{ text: '概念\nIR', start: 0, end: listEnd, firstEnd: heading.markdown.length, lastStart: listStart },
], 'selected text is read as shown, with the Markdown of the first and the last unit it is in');

// The formats a note stores as HTML (note formats, rule 82): the card's editor
// edits underline and the palette's colors, reads the tags Rich writes, keeps
// an untouched unit byte for byte, and writes what it changes as Rich does.
const noteFormats = [
	'A <u>word</u> here.',
	'One <span style="color:#e8706b;">red</span> word.',
	'**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**',
	'A <strong>strong</strong> word and <code>a`b</code> in code.',
	'# A <u>heading</u> line',
];
assert.deepEqual(noteFormats.map(source => ({
	editable: testModule.canEditCanvasMarkdownUnit(source),
	kept: testModule.exerciseCanvasProjectionPersistence(source, source, source).unchanged,
})), noteFormats.map(source => ({ editable: true, kept: source })), 'units with the tags Rich writes are editable and kept byte for byte when untouched');
assert.deepEqual([
	testModule.exerciseTypedText('A <u>word</u> here.', 'wo', 'x'),
	testModule.exerciseTypedText('**important <span style="color:#e8706b;background-color:#4a401d;"><u>word</u></span> here**', 'wor', 'x'),
	testModule.exerciseTypedText('Start.', 'Start.', ' <div>'),
], [
	'A <u>woxrd</u> here.',
	'**important <span style="color:#e8706b;background-color:#4a401d;"><u>worxd</u></span> here**',
	'Start. &lt;div>',
], 'a letter typed into an underlined or colored word keeps its tags, and a typed tag is written as text');
assert.deepEqual([
	'a <span style="color:red">x</span>',
	'a <span style="color:#123456;">x</span>',
	'a <u>x',
	'a <b>x</b>',
	'<details>\n<summary>Title</summary>\n\nchild\n\n</details>',
].map(source => testModule.canEditCanvasMarkdownUnit(source)), [false, false, false, false, false], 'other HTML, other colors, and tags that do not close keep their unit as it is');

// A fixed block is one unit of the card's editor (note formats, rules 82 and 82a).
const picture = { markdown: '![](a.png)', prefix: '\n\n', separator: '', editable: false };
const before = { markdown: 'Before.', prefix: '', separator: '', editable: true };
const after = { markdown: 'After.', prefix: '\n\n', separator: '\n', editable: true };
const middle = testModule.exerciseFixedUnits([before, picture, after], { select: 1, letter: 'x' });
const last = testModule.exerciseFixedUnits([before, { ...picture, separator: '\n' }], { select: 1, letter: 'x' });
const entered = testModule.exerciseFixedUnits([before, { ...picture, separator: '\n' }], { select: 1, enter: true });
const removed = testModule.exerciseFixedUnits([before, picture, after], { select: 1, remove: true });
const alone = { markdown: '![](a.png)', prefix: '', separator: '\n', editable: false };
const appended = { markdown: '', prefix: '', separator: '', editable: true, appended: true };
const untouched = testModule.exerciseFixedUnits([alone, appended], { select: 0 });
const typedBelow = testModule.exerciseFixedUnits([alone, appended], { select: 0, typeIn: { unit: 1, text: 'below' } });
const leading = testModule.exerciseFixedUnits([{ ...picture, prefix: '' }, after], { select: 0 });
assert.deepEqual({
	middle: middle.markdown,
	last: last.markdown,
	entered: entered.markdown,
	removed: removed.markdown,
	copied: middle.copied,
	untouched: untouched.markdown,
	typedBelow: typedBelow.markdown,
	nearBefore: middle.near[1] === middle.offsets[1] - 2,
	nearAfter: leading.near[0] === leading.offsets[1] + 2,
}, {
	middle: 'Before.\n\n![](a.png)\n\nx\n\nAfter.\n',
	last: 'Before.\n\n![](a.png)\n\nx\n',
	entered: 'Before.\n\n![](a.png)\n',
	removed: 'Before.\n\nAfter.\n',
	copied: '![](a.png)',
	untouched: '![](a.png)\n',
	typedBelow: '![](a.png)\n\nbelow\n',
	nearBefore: true,
	nearAfter: true,
}, 'a fixed block is one unit: a letter after it starts a paragraph, Delete removes it, Copy takes its Markdown, and the line after a note of fixed blocks writes nothing until it holds text');

console.log('Canvas Markdown inline command tests passed.');
