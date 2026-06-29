/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	IBaseHalfMarkdownFocusBlock,
	baseHalfMarkdownBlockFileLine,
	baseHalfMarkdownBlockOrdinal,
	baseHalfMarkdownBlockReadSpan,
	baseHalfMarkdownBlockSourceSpan,
	baseHalfMarkdownLinesToBlockIds,
	baseHalfMarkdownTileSourceNewlines,
	baseHalfMarkdownTopLevelBlockOf,
	buildBaseHalfMarkdownFocusFields,
	countBaseHalfMarkdownNewlines,
	refineBaseHalfMarkdownCursorLine
} from '../../common/basehalfMarkdownFocus.js';
import {
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	IBaseHalfMarkdownReuseEntry,
	segmentBaseHalfMarkdownBody
} from '../../common/basehalfMarkdownProjection.js';

suite('BaseHalfMarkdownFocus', () => {
	suite('countBaseHalfMarkdownNewlines', () => {
		test('counts line breaks regardless of EOL style', () => {
			assert.strictEqual(countBaseHalfMarkdownNewlines(''), 0);
			assert.strictEqual(countBaseHalfMarkdownNewlines('one line'), 0);
			assert.strictEqual(countBaseHalfMarkdownNewlines('a\nb\nc'), 2);
			assert.strictEqual(countBaseHalfMarkdownNewlines('a\r\nb\r\n'), 2);
		});
	});

	suite('baseHalfMarkdownBlockFileLine', () => {
		test('maps consecutive paragraphs to their source lines', () => {
			const { blocks, byId } = indexBody('First paragraph.\n\nSecond paragraph here.\n');

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b0', byId, 0), 1);
			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b1', byId, 0), 3);
		});

		test('accounts for leading blank lines owned by a block prefix', () => {
			const { blocks, byId } = indexBody('\n\n# After blanks\n\ntext\n');

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b0', byId, 0), 3);
			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b1', byId, 0), 5);
		});

		test('offsets lines by frontmatter line count', () => {
			const { blocks, byId } = indexBody('Body line.\n');

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b0', byId, 3), 4);
		});

		test('keeps tight list items on consecutive source lines', () => {
			const { blocks, byId } = indexBody('- one\n- two\n- three\n');

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b0', byId, 0), 1);
			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b1', byId, 0), 2);
			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'b2', byId, 0), 3);
		});

		test('counts raw passthrough blocks by carried raw bytes', () => {
			const byId = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['head', { key: '# Doc', raw: '# Doc\n\n', prefix: '', sep: '\n\n' }],
				['body', { key: 'Body.', raw: 'Body.\n', prefix: '', sep: '\n' }]
			]);
			const blocks: IBaseHalfMarkdownFocusBlock[] = [
				{ id: 'head', type: 'heading' },
				{ id: 'cmt', type: BASEHALF_RAW_PASSTHROUGH_BLOCK, props: { raw: '<!-- a comment -->\n\n' } },
				{ id: 'body', type: 'paragraph' }
			];

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'body', byId, 0), 5);
		});

		test('estimates fresh unindexed paragraph and list item offsets', () => {
			const paragraphById = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['kept', { key: 'Kept.', raw: 'Kept.\n', prefix: '', sep: '\n' }]
			]);
			assert.strictEqual(baseHalfMarkdownBlockFileLine([
				{ id: 'fresh', type: 'paragraph' },
				{ id: 'kept', type: 'paragraph' }
			], 'kept', paragraphById, 0), 3);

			const listById = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['kept', { key: '- kept', raw: '- kept\n', prefix: '', sep: '\n' }]
			]);
			assert.strictEqual(baseHalfMarkdownBlockFileLine([
				{ id: 'fresh', type: 'bulletListItem' },
				{ id: 'kept', type: 'bulletListItem' }
			], 'kept', listById, 0), 2);
		});

		test('resolves nested ids to their enclosing top-level block line', () => {
			const byId = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['p0', { key: 'Intro.', raw: 'Intro.\n\n', prefix: '', sep: '\n\n' }],
				['parent', { key: '- parent', raw: '- parent\n  - child\n', prefix: '', sep: '' }]
			]);
			const blocks: IBaseHalfMarkdownFocusBlock[] = [
				{ id: 'p0', type: 'paragraph' },
				{ id: 'parent', type: 'bulletListItem', children: [{ id: 'child', type: 'bulletListItem' }] }
			];

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'parent', byId, 0), 3);
			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'child', byId, 0), 3);
		});

		test('returns null when the id is absent', () => {
			const { blocks, byId } = indexBody('only.\n');

			assert.strictEqual(baseHalfMarkdownBlockFileLine(blocks, 'nope', byId, 0), null);
		});
	});

	suite('block ordinal and top-level resolution', () => {
		test('counts nested blocks in rendered depth-first order', () => {
			const blocks: IBaseHalfMarkdownFocusBlock[] = [
				{ id: 'p0' },
				{ id: 'parent', children: [{ id: 'child1' }, { id: 'child2' }] },
				{ id: 'after' }
			];

			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'p0'), 1);
			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'parent'), 2);
			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'child1'), 3);
			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'child2'), 4);
			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'after'), 5);
			assert.strictEqual(baseHalfMarkdownBlockOrdinal(blocks, 'missing'), null);
		});

		test('resolves nested ids to top-level blocks', () => {
			const blocks: IBaseHalfMarkdownFocusBlock[] = [{ id: 'p0' }, { id: 'parent', children: [{ id: 'child' }] }];

			assert.deepStrictEqual(baseHalfMarkdownTopLevelBlockOf(blocks, 'p0'), { block: blocks[0], direct: true });
			assert.deepStrictEqual(baseHalfMarkdownTopLevelBlockOf(blocks, 'child'), { block: blocks[1], direct: false });
			assert.strictEqual(baseHalfMarkdownTopLevelBlockOf(blocks, 'missing'), null);
		});
	});

	suite('source spans and cursor precision', () => {
		test('counts only source bytes, excluding prefix and separator', () => {
			assert.strictEqual(baseHalfMarkdownTileSourceNewlines({ key: 'a', raw: 'a\n\n', prefix: '', sep: '\n\n' }), 0);
			assert.strictEqual(baseHalfMarkdownTileSourceNewlines({
				key: 'c',
				raw: '\n```\nx\n```\n\n',
				prefix: '\n',
				sep: '\n\n'
			}), 2);
		});

		test('computes source spans for indexed, fresh, and nested blocks', () => {
			const byId = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['code', { key: '```', raw: '```\na\nb\n```\n\n', prefix: '', sep: '\n\n' }],
				['parent', { key: '- parent', raw: '- parent\n  - child\n', prefix: '', sep: '\n' }]
			]);
			const blocks: IBaseHalfMarkdownFocusBlock[] = [
				{ id: 'code', type: 'codeBlock' },
				{ id: 'fresh', type: 'paragraph' },
				{ id: 'parent', type: 'bulletListItem', children: [{ id: 'child', type: 'paragraph' }] }
			];

			assert.deepStrictEqual(baseHalfMarkdownBlockSourceSpan(blocks, 'code', byId, 0), { start: 1, end: 4 });
			assert.deepStrictEqual(baseHalfMarkdownBlockSourceSpan(blocks, 'fresh', byId, 0), { start: 6, end: 6 });
			assert.deepStrictEqual(baseHalfMarkdownBlockSourceSpan(blocks, 'child', byId, 0), { start: 8, end: 9 });
		});

		test('refines cursor line precision', () => {
			assert.deepStrictEqual(refineBaseHalfMarkdownCursorLine({
				blockStart: 5,
				hasEntry: false,
				blockSourceNewlines: 0,
				directHit: true,
				codeWithinOffset: null
			}), { line: 5, precision: 'estimated' });
			assert.deepStrictEqual(refineBaseHalfMarkdownCursorLine({
				blockStart: 5,
				hasEntry: true,
				blockSourceNewlines: 0,
				directHit: true,
				codeWithinOffset: null
			}), { line: 5, precision: 'exact' });
			assert.deepStrictEqual(refineBaseHalfMarkdownCursorLine({
				blockStart: 10,
				hasEntry: true,
				blockSourceNewlines: 4,
				directHit: true,
				codeWithinOffset: 2
			}), { line: 13, precision: 'exact' });
			assert.deepStrictEqual(refineBaseHalfMarkdownCursorLine({
				blockStart: 7,
				hasEntry: true,
				blockSourceNewlines: 3,
				directHit: false,
				codeWithinOffset: null
			}), { line: 7, precision: 'block_start' });
		});
	});

	suite('read ranges and focus fields', () => {
		test('extends read spans through blank separators but not tight list lines', () => {
			const paragraphs = indexBody('First.\n\nSecond.\n');
			assert.deepStrictEqual(baseHalfMarkdownBlockReadSpan(paragraphs.blocks, 'b0', paragraphs.byId, 0), { start: 1, end: 2 });
			assert.deepStrictEqual(baseHalfMarkdownBlockReadSpan(paragraphs.blocks, 'b1', paragraphs.byId, 0), { start: 3, end: 3 });

			const list = indexBody('- one\n- two\n');
			assert.deepStrictEqual(baseHalfMarkdownBlockReadSpan(list.blocks, 'b0', list.byId, 0), { start: 1, end: 1 });
		});

		test('maps source-line ranges back to top-level block ids', () => {
			const { blocks, byId } = indexBody('First.\n\n```\na\nb\n```\n\nLast.\n');

			assert.deepStrictEqual(baseHalfMarkdownLinesToBlockIds(blocks, byId, 0, [[1, 1]]), ['b0']);
			assert.deepStrictEqual(baseHalfMarkdownLinesToBlockIds(blocks, byId, 0, [[3, 5]]), ['b1']);
			assert.deepStrictEqual(baseHalfMarkdownLinesToBlockIds(blocks, byId, 0, [[8, 8]]), ['b2']);
			assert.deepStrictEqual(baseHalfMarkdownLinesToBlockIds(blocks, byId, 0, []), []);
		});

		test('builds rich focus fields with source lines and visible block ordinals', () => {
			const byId = new Map<string, IBaseHalfMarkdownReuseEntry>([
				['intro', { key: 'Intro.', raw: 'Intro.\n\n', prefix: '', sep: '\n\n' }],
				['code', { key: '```', raw: '```\na\nb\n```\n\n', prefix: '', sep: '\n\n' }],
				['after', { key: 'After.', raw: 'After.\n', prefix: '', sep: '\n' }]
			]);
			const blocks: IBaseHalfMarkdownFocusBlock[] = [
				{ id: 'intro', type: 'paragraph' },
				{ id: 'code', type: 'codeBlock' },
				{ id: 'after', type: 'paragraph' }
			];

			assert.deepStrictEqual(buildBaseHalfMarkdownFocusFields({
				blocks,
				byId,
				frontmatterLines: 3,
				cursor: { blockId: 'code', column: 2, codeWithinOffset: 1 },
				visibleBlockId: 'after'
			}), {
				visible_lines: { start: 11 },
				visible_blocks: { start: 3 },
				cursor: { line: 8, column: 2, line_precision: 'exact', block: 2 }
			});
		});
	});
});

function indexBody(body: string): { blocks: IBaseHalfMarkdownFocusBlock[]; byId: Map<string, IBaseHalfMarkdownReuseEntry> } {
	const segments = segmentBaseHalfMarkdownBody(body);
	const blocks: IBaseHalfMarkdownFocusBlock[] = [];
	const byId = new Map<string, IBaseHalfMarkdownReuseEntry>();
	segments.forEach((segment, index) => {
		const id = `b${index}`;
		blocks.push({ id, type: blockTypeFor(segment.source) });
		byId.set(id, { key: segment.source, raw: segment.raw, prefix: segment.prefix, sep: segment.sep });
	});
	return { blocks, byId };
}

function blockTypeFor(markdown: string): string {
	if (/^\s*`{3}/.test(markdown)) {
		return 'codeBlock';
	}
	if (/^\s*(?:[-*+]|\d+\.)\s/.test(markdown)) {
		return 'bulletListItem';
	}
	return 'paragraph';
}
