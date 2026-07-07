/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	diffBaseHalfMarkdownSegments,
	groupBaseHalfMarkdownContributions
} from '../../common/basehalfMarkdownMerge.js';
import {
	buildBaseHalfMarkdownLoadProjection,
	collectBaseHalfMarkdownSaveContributions,
	segmentBaseHalfMarkdownBody,
	spliceBaseHalfMarkdownSave,
	IBaseHalfMarkdownEditorApi
} from '../../common/basehalfMarkdownProjection.js';

suite('BaseHalfMarkdownMerge', () => {
	suite('diffBaseHalfMarkdownSegments', () => {
		test('returns null for identical sequences', () => {
			assert.strictEqual(diffBaseHalfMarkdownSegments(['a', 'b'], ['a', 'b']), null);
			assert.strictEqual(diffBaseHalfMarkdownSegments([], []), null);
		});

		test('locates replaced, inserted, and deleted regions', () => {
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b', 'c'], ['a', 'x', 'c']), {
				oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'c'], ['a', 'b', 'c']), {
				oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 2
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b', 'c'], ['a', 'c']), {
				oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 1
			});
		});

		test('handles edits at the edges and full rewrites', () => {
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b'], ['x', 'a', 'b']), {
				oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 1
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b'], ['a', 'b', 'x']), {
				oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 3
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b'], ['x', 'y']), {
				oldStart: 0, oldEnd: 2, newStart: 0, newEnd: 2
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments([], ['a']), {
				oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 1
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a'], []), {
				oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 0
			});
		});

		test('never lets prefix and suffix claim the same element twice', () => {
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'b', 'a'], ['a', 'a']), {
				oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 1
			});
			assert.deepStrictEqual(diffBaseHalfMarkdownSegments(['a', 'a'], ['a', 'b', 'a']), {
				oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 2
			});
		});
	});

	suite('groupBaseHalfMarkdownContributions', () => {
		test('groups one contribution per segment', () => {
			assert.deepStrictEqual(
				groupBaseHalfMarkdownContributions(['# A\n\n', 'text\n'], ['# A\n\n', 'text\n']),
				[[0], [1]]
			);
		});

		test('groups multiple contributions under one segment', () => {
			assert.deepStrictEqual(
				groupBaseHalfMarkdownContributions(['one\n', 'two\n\n', 'tail\n'], ['one\ntwo\n\n', 'tail\n']),
				[[0, 1], [2]]
			);
		});

		test('rejects misaligned or leftover contributions', () => {
			assert.strictEqual(groupBaseHalfMarkdownContributions(['abc\n'], ['abX\n']), null);
			assert.strictEqual(groupBaseHalfMarkdownContributions(['a\n', 'b\n'], ['a\n']), null);
			assert.strictEqual(groupBaseHalfMarkdownContributions(['a\n'], ['a\n', 'b\n']), null);
			assert.strictEqual(groupBaseHalfMarkdownContributions([], ['a\n']), null);
		});

		test('accepts empty inputs', () => {
			assert.deepStrictEqual(groupBaseHalfMarkdownContributions([], []), []);
		});
	});

	suite('merge alignment invariants', () => {
		test('save contributions reproduce the on-disk body byte for byte while untouched', async () => {
			const editor = new SimpleMarkdownEditor();
			const body = '# Title\n\npara one\n\n- item a\n- item b\n\npara two\n';
			const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(editor, body);

			const contributions = await collectBaseHalfMarkdownSaveContributions(editor, blocks, byId);
			assert.strictEqual(contributions.map(contribution => contribution.text).join(''), body);
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, blocks, '', byId), body);

			const groups = groupBaseHalfMarkdownContributions(
				contributions.map(contribution => contribution.text),
				segmentBaseHalfMarkdownBody(body).map(segment => segment.raw)
			);
			assert.deepStrictEqual(groups, [[0], [1], [2], [3], [4]]);
		});

		test('locates an agent edit to one segment with everything else aligned', async () => {
			const editor = new SimpleMarkdownEditor();
			const oldBody = '# Title\n\npara one\n\npara two\n';
			const newBody = '# Title\n\npara one CHANGED\n\npara two\n';
			const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);

			const contributions = await collectBaseHalfMarkdownSaveContributions(editor, blocks, byId);
			const oldRaws = segmentBaseHalfMarkdownBody(oldBody).map(segment => segment.raw);
			const newRaws = segmentBaseHalfMarkdownBody(newBody).map(segment => segment.raw);
			const groups = groupBaseHalfMarkdownContributions(contributions.map(contribution => contribution.text), oldRaws);
			assert.ok(groups);

			const region = diffBaseHalfMarkdownSegments(oldRaws, newRaws);
			assert.deepStrictEqual(region, { oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 });

			const removedIds = groups[1].map(index => contributions[index].id);
			assert.deepStrictEqual(removedIds, [(blocks[1] as { id?: string }).id]);
		});

		test('contribution view matches splice save after a user edit too', async () => {
			const editor = new SimpleMarkdownEditor();
			const body = 'para one\n\npara two\n';
			const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(editor, body);

			const edited = blocks.map(block => {
				const typed = block as { markdown?: string };
				return typed.markdown === 'para one'
					? { ...typed, markdown: 'para one edited', content: [{ type: 'text', text: 'para one edited' }] }
					: block;
			});

			const contributions = await collectBaseHalfMarkdownSaveContributions(editor, edited, byId);
			assert.strictEqual(
				contributions.map(contribution => contribution.text).join(''),
				await spliceBaseHalfMarkdownSave(editor, edited, '', byId)
			);
		});
	});
});

class SimpleMarkdownEditor implements IBaseHalfMarkdownEditorApi {
	private nextId = 1;

	tryParseMarkdownToBlocks(markdown: string): unknown[] {
		return [{
			id: `b${this.nextId++}`,
			type: /^\s*(?:[-*+]|\d+\.)\s/.test(markdown) ? 'bulletListItem' : 'paragraph',
			content: [{ type: 'text', text: markdown.trimEnd() }],
			markdown: markdown.trimEnd()
		}];
	}

	blocksToMarkdownLossy(blocks: unknown[]): string {
		return blocks.map(block => (block as { markdown?: string }).markdown ?? '').join('\n');
	}
}
