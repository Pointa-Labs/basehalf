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
	planBaseHalfMarkdownMerge,
	segmentBaseHalfMarkdownBody,
	spliceBaseHalfMarkdownSave
} from '../../common/basehalfMarkdownProjection.js';
import { BaseHalfNoteTestEditor } from './basehalfNoteTestEditor.js';

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
		const idOf = (block: unknown) => (block as { id: string }).id;
		const textOf = (block: unknown) => ((block as { content: { text: string }[] }).content).map(run => run.text).join('');
		const withText = (block: unknown, text: string) => ({ ...(block as object), content: [{ type: 'text', text, styles: {} }] });

		test('save contributions reproduce the on-disk body byte for byte while untouched', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const body = '# Title\n\npara one\n\n- item a\n- item b\n\npara two\n';
			const { blocks, byId, note } = await buildBaseHalfMarkdownLoadProjection(editor, body);

			const contributions = await collectBaseHalfMarkdownSaveContributions(editor, blocks, byId, note);
			assert.strictEqual(contributions.map(contribution => contribution.text).join(''), body);
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, blocks, '', byId, note), body);

			const groups = groupBaseHalfMarkdownContributions(
				contributions.map(contribution => contribution.text),
				segmentBaseHalfMarkdownBody(body).map(segment => segment.raw)
			);
			assert.deepStrictEqual(groups, [[0], [1], [2], [3], [4]]);
		});

		test('an outside change reads its segment anew and keeps every other block', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const oldBody = '# Title\n\npara one\n\npara two\n';
			const newBody = '# Title\n\npara one CHANGED\n\npara two\n';
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);

			const plan = await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, oldBody, newBody);
			assert.ok(plan);
			assert.deepStrictEqual(plan.removeIds, [idOf(projection.blocks[1])]);
			assert.deepStrictEqual(plan.blocks.map(textOf), ['para one CHANGED']);

			const document = [projection.blocks[0], ...plan.blocks, projection.blocks[2]];
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, document, '', plan.byId, plan.note), newBody);
		});

		test('blocks the user moved and saved keep standing for what was saved after an outside change', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'A\n\nB\n\nC');
			const [a, b, c] = projection.blocks;
			const moved = [a, c, b];
			const saved = await spliceBaseHalfMarkdownSave(editor, moved, '', projection.byId, projection.note);
			assert.strictEqual(saved, 'A\n\nC\n\nB\n');

			const outside = `${saved}\nD\n`;
			const plan = await planBaseHalfMarkdownMerge(editor, moved, projection.byId, projection.note, saved, outside);
			assert.ok(plan);
			assert.deepStrictEqual(plan.removeIds, [idOf(b)]);
			const document = [a, c, ...plan.blocks];
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, document, '', plan.byId, plan.note), outside);
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [a, withText(c, 'C!'), ...plan.blocks], '', plan.byId, plan.note), 'A\n\nC!\n\nB\n\nD\n');
		});

		test('an outside insertion goes beside the block before it', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const oldBody = 'A\n\nC\n';
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);

			const plan = await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, oldBody, 'A\n\nB\n\nC\n');
			assert.ok(plan);
			assert.deepStrictEqual(plan.removeIds, []);
			assert.deepStrictEqual(plan.anchor, { id: idOf(projection.blocks[0]), placement: 'after' });
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [projection.blocks[0], ...plan.blocks, projection.blocks[1]], '', plan.byId, plan.note), 'A\n\nB\n\nC\n');
		});

		test('a document that does not stand for the old body, and a change that leaves no block, are loaded anew', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'A\n\nB\n');

			assert.strictEqual(await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, 'A\n\nX\n', 'A\n\nY\n'), undefined);
			assert.strictEqual(await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, 'A\n\nB\n', 'A\n\nB\n'), undefined);
		});

		test('a toggle that an outside change leaves keeps its blocks, and an edit in it after changes that block alone', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const oldBody = 'Intro\n\n<details>\n<summary>T</summary>\n\none\n\ntwo\n\n</details>\n\nEnd\n';
			const newBody = 'Intro changed\n\nAnd more\n\n<details>\n<summary>T</summary>\n\none\n\ntwo\n\n</details>\n\nEnd\n';
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);
			const [intro, toggle, end] = projection.blocks as { id: string; children: unknown[] }[];

			const plan = await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, oldBody, newBody);
			assert.ok(plan);
			assert.deepStrictEqual(plan.removeIds, [intro.id]);
			const document = [...plan.blocks, toggle, end];
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, document, '', plan.byId, plan.note), newBody);

			const edited = { ...toggle, children: [toggle.children[0], withText(toggle.children[1], 'two!')] };
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [...plan.blocks, edited, end], '', plan.byId, plan.note), newBody.replace('two', 'two!'));
		});

		test('an outside change inside a toggle reads the toggle anew', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const oldBody = '<details>\n<summary>T</summary>\n\none\n\n</details>\n\nEnd\n';
			const newBody = '<details>\n<summary>T</summary>\n\none\n\nadded\n\n</details>\n\nEnd\n';
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);

			const plan = await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, oldBody, newBody);
			assert.ok(plan);
			assert.deepStrictEqual(plan.removeIds, [idOf(projection.blocks[0])]);
			assert.strictEqual((plan.blocks[0] as { children: unknown[] }).children.length, 2);
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [...plan.blocks, projection.blocks[1]], '', plan.byId, plan.note), newBody);
		});

		test('an outside change of the reference definitions loads the note anew', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const oldBody = 'See [it].\n\nEnd\n';
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, oldBody);

			assert.strictEqual(await planBaseHalfMarkdownMerge(editor, projection.blocks, projection.byId, projection.note, oldBody, 'See [it].\n\nEnd\n\n[it]: https://example.com\n'), undefined);
		});

		test('contribution view matches splice save after a user edit too', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const { blocks, byId, note } = await buildBaseHalfMarkdownLoadProjection(editor, 'para one\n\npara two\n');
			const edited = [withText(blocks[0], 'para one edited'), blocks[1]];

			const contributions = await collectBaseHalfMarkdownSaveContributions(editor, edited, byId, note);
			assert.strictEqual(
				contributions.map(contribution => contribution.text).join(''),
				await spliceBaseHalfMarkdownSave(editor, edited, '', byId, note)
			);
		});
	});
});
