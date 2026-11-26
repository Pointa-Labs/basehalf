/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfNoteBlock, IBaseHalfNoteListHint } from '../../common/basehalfNoteBlocks.js';
import { baseHalfCardLexer } from '../../common/basehalfNoteInline.js';
import {
	BASEHALF_NOTE_REMOVED_PROPS,
	baseHalfNoteListHints,
	baseHalfNoteMayHold,
	postProcessBaseHalfNoteBlocks,
	restoreBaseHalfCodeTabs,
	shapeBaseHalfNoteTable,
	stripBaseHalfNoteReadHints
} from '../../common/basehalfNoteStructure.js';

interface ITestBlock {
	readonly id?: string;
	readonly type: string;
	readonly props: Record<string, unknown>;
	readonly content?: unknown;
	readonly children: ITestBlock[];
	readonly basehalfOpen?: boolean;
	readonly basehalfHints?: IBaseHalfNoteListHint;
}

function block(type: string, props: Record<string, unknown> = {}, content?: unknown, children: ITestBlock[] = []): ITestBlock {
	return { type, props, content, children };
}

const words = (value: string) => [{ type: 'text', text: value, styles: {} }];
const paragraph = (value: string, ...children: ITestBlock[]) => block('paragraph', {}, words(value), children);
const bullet = (value: string, ...children: ITestBlock[]) => block('bulletListItem', {}, words(value), children);
const numbered = (value: string, ...children: ITestBlock[]) => block('numberedListItem', {}, words(value), children);
const toggle = (value: string, ...children: ITestBlock[]) => block('toggleListItem', {}, words(value), children);
const code = (value: string) => block('codeBlock', { language: 'text' }, words(value));

/** The text of each block, in the order of the document, with its depth. */
function outline(blocks: readonly IBaseHalfNoteBlock[], depth = 0): string[] {
	return blocks.flatMap(value => [`${'  '.repeat(depth)}${value.type} ${Array.isArray(value.content) ? value.content.map(run => (run as { text?: string }).text ?? '').join('') : ''}`.trimEnd(), ...outline(value.children ?? [], depth + 1)]);
}

function hintsOf(markdown: string): IBaseHalfNoteListHint[] {
	return baseHalfNoteListHints(baseHalfCardLexer().lex(markdown));
}

function codeOf(value: unknown): string {
	return ((value as IBaseHalfNoteBlock).content as unknown as { text: string }[]).map(run => run.text).join('');
}

suite('BaseHalfNoteStructure', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('lets list items and toggles hold blocks of any kind, and no other block', () => {
		for (const type of ['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']) {
			assert.ok(baseHalfNoteMayHold(block(type)), type);
		}
		assert.ok(baseHalfNoteMayHold(block('heading', { level: 2, isToggleable: true })));
		for (const type of ['paragraph', 'heading', 'quote', 'codeBlock', 'divider', 'table', 'image', 'video', 'audio', 'file', 'rawPassthrough']) {
			assert.ok(!baseHalfNoteMayHold(block(type, { level: 1 })), type);
		}
		for (const value of [undefined, null, 'bulletListItem', { type: 4 }]) {
			assert.ok(!baseHalfNoteMayHold(value));
		}
	});

	test('moves the blocks under a block that may hold none out after it, in their order', () => {
		const blocks = postProcessBaseHalfNoteBlocks([
			paragraph('a', paragraph('b'), block('quote', {}, words('c'), [paragraph('d')])),
			bullet('e', paragraph('f', bullet('g'))),
			toggle('h', code('i')),
			'no block',
			{ type: 7 }
		]);
		assert.deepStrictEqual(outline(blocks), [
			'paragraph a', 'paragraph b', 'quote c', 'paragraph d',
			'bulletListItem e', '  paragraph f', '  bulletListItem g',
			'toggleListItem h', '  codeBlock i'
		]);
	});

	test('gives each toggle whether the file stores it open, in the order of the document', () => {
		const blocks = [toggle('a', toggle('b')), block('heading', { level: 2, isToggleable: true }, words('c')), block('heading', { level: 2 }, words('d'))];
		const flagged = postProcessBaseHalfNoteBlocks(blocks, { openFlags: [true, false, true] });
		assert.deepStrictEqual([flagged[0].basehalfOpen, flagged[0].children![0].basehalfOpen, flagged[1].basehalfOpen, flagged[2].basehalfOpen], [true, false, true, undefined]);
		// Flags that are not as many as the toggles go to none, and take away flags the blocks had.
		const mismatched = postProcessBaseHalfNoteBlocks(flagged, { openFlags: [true] });
		assert.deepStrictEqual([mismatched[0].basehalfOpen, mismatched[0].children![0].basehalfOpen, mismatched[1].basehalfOpen], [undefined, undefined, undefined]);
		assert.strictEqual(postProcessBaseHalfNoteBlocks(flagged)[0].basehalfOpen, true);
	});

	test('gives each list item what the file wrote of it, with the ids and kinds of its children', () => {
		const markdown = '- a\n\n  * b\n\n  para\n- c';
		const read = postProcessBaseHalfNoteBlocks([
			{ ...bullet('a', { ...bullet('b'), id: 'b' }, { ...paragraph('para'), id: 'p' }), id: 'a' },
			{ ...bullet('c'), id: 'c' }
		], { listHints: hintsOf(markdown) });
		assert.deepStrictEqual(read[0].basehalfHints, {
			marker: '-',
			childIndent: 2,
			separators: ['\n\n', '\n\n'],
			children: ['b', 'p'],
			kinds: [{ type: 'bulletListItem', marker: '*', task: false }, { type: 'paragraph' }]
		});
		assert.deepStrictEqual(read[0].children![0].basehalfHints, { marker: '*' });
		assert.deepStrictEqual(read[1].basehalfHints, { marker: '-' });
		// Hints that are not as many as the list items go to none.
		const mismatched = postProcessBaseHalfNoteBlocks(read, { listHints: hintsOf('- a') });
		assert.deepStrictEqual([mismatched[0].basehalfHints, mismatched[1].basehalfHints], [undefined, undefined]);
		// Children the file wrote differently, or without ids, keep the marker and the indentation only.
		const others = postProcessBaseHalfNoteBlocks([bullet('a', bullet('b'), paragraph('para')), bullet('c')], { listHints: hintsOf(markdown) });
		assert.deepStrictEqual(others[0].basehalfHints, { marker: '-', childIndent: 2 });
		const fewer = postProcessBaseHalfNoteBlocks([{ ...bullet('a', { ...bullet('b'), id: 'b' }), id: 'a' }, bullet('c')], { listHints: hintsOf(markdown) });
		assert.deepStrictEqual(fewer[0].basehalfHints, { marker: '-', childIndent: 2 });
	});

	test('reads the marker, the indentation of the children, and the line breaks before them from the file\'s lists', () => {
		const rows: [string, IBaseHalfNoteListHint[]][] = [
			['- a\n  - b\n  - c', [{ marker: '-', childIndent: 2, separators: ['\n', '\n'] }, { marker: '-' }, { marker: '-' }]],
			['- a\n  - b\n\n  - c', [{ marker: '-', childIndent: 2, separators: ['\n', '\n\n'] }, { marker: '-' }, { marker: '-' }]],
			['1. Install\n\n   - npm install\n   - npm test', [{ marker: '1.', childIndent: 3, separators: ['\n\n', '\n'] }, { marker: '-' }, { marker: '-' }]],
			['4. four\n   - sub', [{ marker: '4.', childIndent: 3, separators: ['\n'] }, { marker: '-' }]],
			['- a\n    - b', [{ marker: '-', childIndent: 4, separators: ['\n'] }, { marker: '-' }]],
			['- a\n\n  para\n\n  - sub\n\n  after', [{ marker: '-', childIndent: 2, separators: ['\n\n', '\n\n', '\n\n'] }, { marker: '-' }]],
			['- a\n\n\n  para', [{ marker: '-', childIndent: 2, separators: ['\n\n\n'] }]],
			['- [ ] todo\n\n  para', [{ marker: '-', childIndent: 2, separators: ['\n\n'] }]],
			['* a\n+ b', [{ marker: '*' }, { marker: '+' }]],
			['1) one\n2) two', [{ marker: '1)' }, { marker: '2)' }]],
			['1. a\n1. b\n1. c', [{ marker: '1.' }, { marker: '1.' }, { marker: '1.' }]],
			['- line one\\\n  line two\n  - child', [{ marker: '-', childIndent: 2, separators: ['\n'] }, { marker: '-' }]],
			['- a\nlazy\n  - child', [{ marker: '-', childIndent: 2, separators: ['\n'] }, { marker: '-' }]],
			[' - a\n   - b', [{ marker: '-', childIndent: 2, separators: ['\n'] }, { marker: '-' }]],
			['10. ten\n    more text', [{ marker: '10.' }]],
			// The writer judges an indentation that would make code of the children.
			['- a\n\n      code', [{ marker: '-', childIndent: 6, separators: ['\n\n'] }]],
			// A toggle is one child, whatever it holds.
			['- item\n\n  <details>\n  <summary>T</summary>\n\n  - x\n\n  </details>\n\n  after', [{ marker: '-', childIndent: 2, separators: ['\n\n', '\n\n'] }, { marker: '-' }]],
			// The rich editor reads no list item out of a quote.
			['> - quoted\n\n- a', [{ marker: '-' }]],
			['para', []]
		];
		for (const [markdown, hints] of rows) {
			assert.deepStrictEqual(hintsOf(markdown), hints, markdown);
		}
	});

	test('gives the first numbered item of a run the number the file starts its list at', () => {
		// The editor reads no start for an item whose text a list follows right under it.
		const four = postProcessBaseHalfNoteBlocks([numbered('four', bullet('sub'))], { listHints: hintsOf('4. four\n   - sub') });
		assert.strictEqual(four[0].props!.start, 4);
		const run = postProcessBaseHalfNoteBlocks([{ ...numbered('a'), props: { start: 9 } }, numbered('b')], { listHints: hintsOf('1. a\n2. b') });
		assert.deepStrictEqual([run[0].props!.start, run[1].props!.start], [undefined, undefined]);
		const nested = postProcessBaseHalfNoteBlocks([bullet('x', numbered('a'), numbered('b'))], { listHints: hintsOf('- x\n  3) a\n  4) b') });
		assert.deepStrictEqual([nested[0].children![0].props!.start, nested[0].children![1].props!.start], [3, undefined]);
		assert.strictEqual(postProcessBaseHalfNoteBlocks([numbered('four', bullet('sub'))])[0].props!.start, undefined);
	});

	test('takes the kind of pasted pictures and videos from their addresses, and shows every one at a whole width', () => {
		const media = [
			block('image', { url: 'clip.MP4?x=1#t', previewWidth: 320.4, textAlignment: 'center', backgroundColor: 'red' }),
			block('image', { url: 'song.ogg', previewWidth: 300, textAlignment: 'center' }),
			block('video', { url: 'voice.mp3' }),
			block('video', { url: 'pic.png' }),
			block('image', { url: 'https://example.com/picture', showPreview: false, previewWidth: 0 })
		];
		const pasted = postProcessBaseHalfNoteBlocks(media, { mode: 'paste' });
		assert.deepStrictEqual(pasted.map(value => [value.type, value.props]), [
			['video', { url: 'clip.MP4?x=1#t', previewWidth: 320, showPreview: true }],
			['audio', { url: 'song.ogg', showPreview: true }],
			['audio', { url: 'voice.mp3', showPreview: true }],
			['video', { url: 'pic.png', showPreview: true }],
			['image', { url: 'https://example.com/picture', showPreview: true }]
		]);
		assert.deepStrictEqual(postProcessBaseHalfNoteBlocks(media, { mode: 'drop' }).map(value => value.type), ['video', 'audio', 'audio', 'video', 'image']);
		// A note's Markdown shows a hand-written `<img>` of a video as a picture, as the card does.
		assert.deepStrictEqual(postProcessBaseHalfNoteBlocks(media).map(value => value.type), ['image', 'image', 'video', 'video', 'image']);
		for (const width of [0, -1, 100000, Number.POSITIVE_INFINITY, '320']) {
			assert.strictEqual(postProcessBaseHalfNoteBlocks([block('image', { url: 'a.png', previewWidth: width })])[0].props!.previewWidth, undefined, String(width));
		}
	});

	test('keeps palette colors on text by their names, and no other color', () => {
		const styled = (styles: Record<string, unknown>) => ({ type: 'text', text: 'x', styles });
		const [result] = postProcessBaseHalfNoteBlocks([block('paragraph', {}, [
			styled({ textColor: 'red', bold: true }),
			styled({ textColor: '#E8706B' }),
			styled({ backgroundColor: '#4a401d' }),
			styled({ textColor: 'default', backgroundColor: '#123456' }),
			{ type: 'link', href: 'u', content: [styled({ textColor: 'blue' }), styled({ textColor: 'rgb(1, 2, 3)' })] },
			'plain'
		])], { mode: 'paste' });
		assert.deepStrictEqual(result.content, [
			styled({ textColor: 'red', bold: true }),
			styled({ textColor: 'red' }),
			styled({ backgroundColor: 'yellow' }),
			styled({}),
			{ type: 'link', href: 'u', content: [styled({ textColor: 'blue' }), styled({})] },
			'plain'
		]);
	});

	test('takes off the props a note does not keep', () => {
		const blocks = postProcessBaseHalfNoteBlocks([
			block('paragraph', { textColor: 'red', backgroundColor: 'blue', textAlignment: 'center' }, words('x')),
			block('heading', { level: 2, textAlignment: 'right' }, words('h')),
			block('file', { url: 'f.pdf', name: 'f', caption: 'c', backgroundColor: 'red' }),
			block('audio', { url: 's.mp3', backgroundColor: 'red' }),
			block('table', { textColor: 'red' }, { type: 'tableContent', rows: [{ cells: [] }] })
		]);
		assert.deepStrictEqual(blocks.map(value => value.props), [{}, { level: 2 }, { url: 'f.pdf', name: 'f' }, { url: 's.mp3', showPreview: true }, { textColor: 'default' }]);
		assert.deepStrictEqual(Object.keys(BASEHALF_NOTE_REMOVED_PROPS).sort(), ['audio', 'bulletListItem', 'checkListItem', 'file', 'heading', 'image', 'numberedListItem', 'paragraph', 'quote', 'toggleListItem', 'video']);
		assert.deepStrictEqual(BASEHALF_NOTE_REMOVED_PROPS.file, ['backgroundColor', 'caption']);
	});

	test('gives a table one header row, no merged cells, no colors, and the alignment of its columns', () => {
		const cell = (text: string, props: Record<string, unknown> = {}) => ({ type: 'tableCell', props, content: words(text) });
		const shaped = shapeBaseHalfNoteTable({
			type: 'tableContent',
			columnWidths: [120, undefined, 80],
			headerRows: 2,
			headerCols: 1,
			rows: [
				{ cells: [cell('a', { colspan: 2, backgroundColor: 'red' }), cell('c')] },
				{ cells: [cell('d', { rowspan: 2, textColor: 'blue' }), cell('e', { textAlignment: 'center' }), cell('f', { textAlignment: 'right' })] },
				{ cells: [words('h'), cell('i')] }
			]
		}) as { rows: { cells: { props: Record<string, unknown>; content: unknown }[] }[]; headerRows: number; headerCols?: number; columnWidths: unknown[] };
		const texts = shaped.rows.map(row => row.cells.map(value => (value.content as { text: string }[]).map(run => run.text).join('')));
		assert.deepStrictEqual(texts, [['a', '', 'c'], ['d', 'e', 'f'], ['', 'h', 'i']]);
		assert.deepStrictEqual(shaped.rows.map(row => row.cells.map(value => value.props.textAlignment)), [['left', 'center', 'right'], ['left', 'center', 'right'], ['left', 'center', 'right']]);
		for (const row of shaped.rows) {
			for (const value of row.cells) {
				assert.deepStrictEqual([value.props.colspan, value.props.rowspan, value.props.backgroundColor, value.props.textColor], [1, 1, 'default', 'default']);
			}
		}
		assert.deepStrictEqual([shaped.headerRows, Object.keys(shaped).includes('headerCols'), shaped.columnWidths], [1, false, [undefined, undefined, undefined]]);
		assert.strictEqual(shapeBaseHalfNoteTable('none'), 'none');
		// The block pass shapes every table.
		const [table] = postProcessBaseHalfNoteBlocks([block('table', {}, { type: 'tableContent', rows: [{ cells: [cell('x', { colspan: 2 })] }] })]);
		assert.strictEqual((table.content as unknown as { rows: { cells: unknown[] }[] }).rows[0].cells.length, 2);
	});

	test('restores the tabs of code from the lines of the file it was read from', () => {
		const restore = (source: string, ...values: string[]) => restoreBaseHalfCodeTabs(values.map(code), source).map(codeOf);
		assert.deepStrictEqual(restore('```make\nall:\n\tgo build ./...\n```', 'all:\n    go build ./...'), ['all:\n\tgo build ./...']);
		// In a list item, the item's indentation is taken off before the tab.
		assert.deepStrictEqual(restore('- item\n\n  ```make\n  all:\n  \tgo build\n  ```', 'all:\n    go build'), ['all:\n\tgo build']);
		// Where the indentation of the item ends inside a tab, the line keeps its spaces.
		assert.deepStrictEqual(restore('- item\n\n  ```\n\tgo\n  ```', '  go'), ['  go']);
		assert.deepStrictEqual(restore('    \tx\n    y', '\tx\ny'.replace('\t', '    ')), ['\tx\ny']);
		assert.deepStrictEqual(restore('```\n\t\ttwo\n\t \tmixed\na\tb\n```', '        two\n     \tmixed\na\tb'), ['\t\ttwo\n\t \tmixed\na\tb']);
		// Each code block takes its own lines, in the order of the document.
		assert.deepStrictEqual(restore('```\n\tx\n```\n\n```\n    x\n```\n\n```\n\tx\n```', '    x', '    x', '    x'), ['\tx', '    x', '\tx']);
		assert.deepStrictEqual(restore('```\n\tx\n```', 'other'), ['other']);
		assert.deepStrictEqual(restore('```\n\n```', ''), ['']);
		const nested = restoreBaseHalfCodeTabs([bullet('item', code('    go'))], '- item\n\n  ```\n  \tgo\n  ```');
		assert.strictEqual(codeOf(nested[0].children[0]), '\tgo');
		// A line of text that reads as the code does is no code: the code takes its own lines.
		const continued = restoreBaseHalfCodeTabs([bullet('item', code('    run make'))], '- item\n      run make\n\n  ```\n  \trun make\n  ```');
		assert.strictEqual(codeOf(continued[0].children[0]), '\trun make');
		assert.deepStrictEqual(restore('para\n    \tx\n\n```\n\t\tx\n```', '        x'), ['\t\tx']);
		assert.deepStrictEqual(restore('# h\n    \tx', '    x'), ['\tx']);
		// Without a tab in the file, nothing changes.
		const blocks = [code('    x')];
		assert.strictEqual(restoreBaseHalfCodeTabs(blocks, '```\n    x\n```')[0], blocks[0]);
		// The block pass restores them from the Markdown it read.
		assert.strictEqual(codeOf(postProcessBaseHalfNoteBlocks([code('    go')], { source: '```\n\tgo\n```' })[0]), '\tgo');
	});

	test('reads a paragraph that is one link to a file as a file block, at any depth, named by the link\'s text', () => {
		const link = (href: string, ...runs: unknown[]) => ({ type: 'link', href, content: runs });
		const run = (value: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: value, styles });
		const linked = (...content: unknown[]) => block('paragraph', {}, content);
		const blocks = postProcessBaseHalfNoteBlocks([
			linked(link('attachments/f.pdf', run('my [file].pdf'))),
			bullet('item', linked(run(' '), link('handout.pdf', run('handout.pdf')), run(' '))),
			toggle('t', linked(link('docs/lecture%20%231.pdf'))),
			linked(link('handout.pdf', run('bold', { bold: true }), run(' name'))),
			linked(link('a.pdf', run('red', { textColor: 'red' }))),
			linked(link('notes/plan.md', run('plan'))),
			linked(link('https://example.com/spec.pdf', run('spec'))),
			linked(link('/Users/me/doc.pdf', run('doc'))),
			linked(link('attachments/Makefile', run('make'))),
			linked(run('see '), link('a.pdf', run('a')))
		]);
		const files = (values: readonly IBaseHalfNoteBlock[]): unknown[] => values.flatMap(value => [value.type === 'file' ? value.props : value.type, ...files(value.children ?? [])]);
		assert.deepStrictEqual(files(blocks), [
			{ name: 'my [file].pdf', url: 'attachments/f.pdf' },
			'bulletListItem', { name: 'handout.pdf', url: 'handout.pdf' },
			'toggleListItem', { name: 'lecture #1.pdf', url: 'docs/lecture%20%231.pdf' },
			'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph'
		]);
		assert.ok(!Object.keys(blocks[0]).includes('content'));
		// What another application drops keeps its link.
		assert.strictEqual(postProcessBaseHalfNoteBlocks([linked(link('a.pdf', run('a')))], { mode: 'drop' })[0].type, 'paragraph');
		assert.strictEqual(postProcessBaseHalfNoteBlocks([linked(link('a.pdf', run('a')))], { mode: 'paste' })[0].type, 'file');
	});

	test('takes off what the block pass learned of the file', () => {
		const read = postProcessBaseHalfNoteBlocks([toggle('t', bullet('a')), paragraph('p')], { openFlags: [true], listHints: hintsOf('- a') });
		assert.strictEqual(read[0].basehalfOpen, true);
		assert.ok(read[0].children![0].basehalfHints);
		const stripped = stripBaseHalfNoteReadHints(read);
		assert.ok(!Object.keys(stripped[0]).includes('basehalfOpen'));
		assert.ok(!Object.keys(stripped[0].children![0]).includes('basehalfHints'));
		assert.strictEqual(stripped[1], read[1]);
		assert.deepStrictEqual(stripBaseHalfNoteReadHints(['x', null]), ['x', null]);
	});
});
