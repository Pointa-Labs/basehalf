/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfCommentContext, findBaseHalfCommentQuote, normalizeBaseHalfCommentQuote } from '../../common/basehalfCommentAnchor.js';
import { baseHalfCommentsPageMessage, baseHalfCommentsSetMessage } from '../../common/basehalfCommentProtocol.js';
import { baseHalfCommentCut, IBaseHalfComment, isBaseHalfHighlight, newBaseHalfCommentId } from '../../common/basehalfComments.js';
import { applyBaseHalfCommentChange, baseHalfCommentIndex, baseHalfShownComments, parseBaseHalfComments, serializeBaseHalfComments } from '../../common/basehalfCommentsFile.js';

function passage(text: string, quote: string, before?: string, after?: string): string | undefined {
	const match = findBaseHalfCommentQuote(text, quote, before, after);
	return match && `${match.start}:${text.slice(match.start, match.end)}`;
}

suite('BaseHalf comments', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('finding the passage', () => {
		test('white space, letters made into one glyph, curly marks, and hyphens at the end of a line count as the text reads', () => {
			const page = 'Deep learning allows computational\r\nmodels that are com-\nposed of multiple processing layers. The \ufb01rst \u201clayer\u201d \u2014 input.';
			assert.deepStrictEqual([
				passage(page, 'computational models that'),
				passage(page, 'composed of multiple'),
				passage(page, 'The first "layer" - input'),
				passage(page, 'nowhere'),
				passage(page, '   ')
			], [
				'21:computational\r\nmodels that',
				'52:com-\nposed of multiple',
				'94:The \ufb01rst \u201clayer\u201d \u2014 input',
				undefined,
				undefined
			]);
		});

		test('a quote found more than once is the one whose text around it matches', () => {
			const text = 'the error is propagated back. Then the error is measured again, and the error is small.';
			assert.deepStrictEqual([
				passage(text, 'the error is'),
				passage(text, 'the error is', 'Then '),
				passage(text, 'the error is', undefined, ' small'),
				passage(text, 'the error is', 'again, and ', ' small.')
			], [
				'0:the error is',
				'35:the error is',
				'68:the error is',
				'68:the error is'
			]);
		});

		test('a page searched for many quotes is read once, and a page whose text changed is read again', () => {
			const page = 'Café au lait, then the error is measured. ';
			assert.deepStrictEqual([
				passage(page, 'the error is'),
				passage(page, 'au lait'),
				passage(page.replace('Café', 'Tea, '), 'the error is')
			], [
				'19:the error is',
				'5:au lait',
				'20:the error is'
			]);
		});

		test('a new comment keeps up to 32 characters around its passage', () => {
			const text = 'The   quick brown fox jumps over the lazy dog, again and again and again.';
			const start = text.indexOf('jumps');
			assert.deepStrictEqual(baseHalfCommentContext(text, start, start + 'jumps over'.length), { before: 'The quick brown fox ', after: ' the lazy dog, again and again an' });
			assert.deepStrictEqual(baseHalfCommentContext('whole', 0, 5), {});
			assert.strictEqual(normalizeBaseHalfCommentQuote('  a\n\tb  c '), 'a b c');
		});
	});

	suite('the file', () => {
		const written = [
			'# Comments on this file, by BaseHalf and agents. See the basehalf skill.',
			'comments:',
			'  - id: "m4k2p9wq"',
			'    page: 3',
			'    quote: "Deep learning allows"',
			'    after: " computational models"',
			'    text: "the definition"',
			'    at: "2026-11-16T09:12:04Z"',
			'  - id: "t8v1c3za"',
			'    page: 5',
			'    place: [0.84, 0.12]',
			'    color: "blue"',
			'    text: "look at [12]"',
			'    replies:',
			'      - text: "Reference 12 is about..."',
			'        by: "Claude Code"',
			''
		].join('\n');

		test('reads every field and writes the same bytes back', () => {
			const file = parseBaseHalfComments(written);
			assert.deepStrictEqual(baseHalfShownComments(file), [
				{ id: 'm4k2p9wq', quote: 'Deep learning allows', after: ' computational models', page: 3, color: 'yellow', text: 'the definition', at: '2026-11-16T09:12:04Z', replies: [] },
				{ id: 't8v1c3za', page: 5, place: [0.84, 0.12], color: 'blue', text: 'look at [12]', replies: [{ text: 'Reference 12 is about...', by: 'Claude Code' }] }
			]);
			assert.strictEqual(serializeBaseHalfComments(file), written);
		});

		test('an agent\'s comment without an id gets one from what it holds, the same at every read, and written with the next write', () => {
			const agent = [
				'comments:',
				'  - quote: "backpropagation"',
				'    page: 5',
				'    text: |',
				'      What is this?',
				'      Explain.',
				'    by: Codex',
				'    mood: curious',
				'    tags: [math, "hard one"]',
				'  - just a line',
				'  - id: "zzzzzzzz"',
				'    quote: "twice"',
				'  - id: "zzzzzzzz"',
				'    quote: "again"',
				'  - text: "no passage, no place, no page"',
				''
			].join('\n');
			const first = parseBaseHalfComments(agent);
			const second = parseBaseHalfComments(agent);
			const ids = baseHalfShownComments(first).map(comment => comment.id);
			assert.deepStrictEqual(ids, baseHalfShownComments(second).map(comment => comment.id));
			assert.strictEqual(ids.length, 3);
			assert.strictEqual(ids[1], 'zzzzzzzz');
			assert.notStrictEqual(ids[2], 'zzzzzzzz');
			assert.ok(ids.every(id => /^[a-z0-9]{8}$/.test(id)));
			assert.strictEqual(baseHalfShownComments(first)[0].text, 'What is this?\nExplain.\n');
			const text = serializeBaseHalfComments(first);
			assert.ok(text.includes(`id: "${ids[0]}"`));
			assert.ok(text.includes('mood: "curious"'));
			assert.ok(text.includes('tags: ["math","hard one"]'));
			assert.ok(text.includes('  - "just a line"'));
			// What was written reads back as what was read.
			assert.deepStrictEqual(baseHalfShownComments(parseBaseHalfComments(text)), baseHalfShownComments(first));
		});

		test('a file that is not YAML shows no comments and says why', () => {
			const conflict = '<<<<<<< HEAD\ncomments: []\n=======\ncomments:\n  - quote: "a"\n>>>>>>> theirs\n';
			const file = parseBaseHalfComments(conflict);
			assert.strictEqual(baseHalfShownComments(file).length, 0);
			assert.ok(file.unreadable);
			assert.deepStrictEqual(baseHalfShownComments(parseBaseHalfComments('')), []);
			assert.strictEqual(parseBaseHalfComments('').unreadable, undefined);
		});

		test('a change adds, replaces, and removes one comment, and keeps what it does not know', () => {
			const file = parseBaseHalfComments('comments:\n  - id: "aaaaaaaa"\n    quote: "one"\n    mood: "kept"\n  - id: "bbbbbbbb"\n    quote: "two"\n');
			const added: IBaseHalfComment = { id: 'cccccccc', quote: 'three', color: 'green', text: '', replies: [] };
			const withAdded = applyBaseHalfCommentChange(file, { kind: 'put', comment: added });
			const replaced = applyBaseHalfCommentChange(withAdded, { kind: 'put', comment: { ...baseHalfShownComments(file)[0], text: 'words' } });
			const removed = applyBaseHalfCommentChange(replaced, { kind: 'remove', id: 'bbbbbbbb' });
			const back = applyBaseHalfCommentChange(removed, { kind: 'put', comment: baseHalfShownComments(file)[1], index: baseHalfCommentIndex(file, 'bbbbbbbb') });
			assert.deepStrictEqual(baseHalfShownComments(back).map(comment => `${comment.id} ${comment.text}`), ['aaaaaaaa words', 'bbbbbbbb ', 'cccccccc ']);
			assert.ok(serializeBaseHalfComments(replaced).includes('mood: "kept"'));
			assert.strictEqual(serializeBaseHalfComments(applyBaseHalfCommentChange(applyBaseHalfCommentChange(removed, { kind: 'remove', id: 'aaaaaaaa' }), { kind: 'remove', id: 'cccccccc' })), '# Comments on this file, by BaseHalf and agents. See the basehalf skill.\ncomments: []\n');
		});
	});

	suite('the messages of a page', () => {
		test('a page\'s message is read field by field, and what is not right is left out', () => {
			assert.deepStrictEqual(baseHalfCommentsPageMessage({ type: 'basehalf.comments.change', step: 'highlight', comment: { id: 'abcd1234', quote: 'q', page: 2.5, place: [2, -1], color: 'red', text: 7, replies: [{ text: '' }, { text: 'ok', by: 'Claude Code' }] } }), {
				type: 'basehalf.comments.change',
				step: 'highlight',
				comment: { id: 'abcd1234', quote: 'q', place: [1, 0], color: 'yellow', text: '', replies: [{ text: 'ok', by: 'Claude Code' }] }
			});
			assert.strictEqual(baseHalfCommentsPageMessage({ type: 'basehalf.comments.change', step: 'erase', remove: 'abcd1234' }), undefined);
			assert.strictEqual(baseHalfCommentsPageMessage({ type: 'basehalf.comments.change', step: 'delete', comment: { id: '../etc', quote: 'q' } }), undefined);
			assert.deepStrictEqual(baseHalfCommentsPageMessage({ type: 'basehalf.comments.focus', id: 42 }), { type: 'basehalf.comments.focus' });
			assert.deepStrictEqual(baseHalfCommentsSetMessage({ type: 'basehalf.comments.set', comments: [{ id: 'abcd1234', text: 'x' }, { id: 'abcd1235', page: 1, text: 'y' }], unreadable: 'yes', color: 'pink' }), {
				type: 'basehalf.comments.set',
				comments: [{ id: 'abcd1235', page: 1, color: 'yellow', text: 'y', replies: [] }],
				unreadable: false,
				color: 'pink'
			});
		});

		test('ids, highlights, and cut text', () => {
			let next = 0;
			const id = newBaseHalfCommentId(new Set(['aaaaaaaa']), () => [0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99][next++]);
			assert.strictEqual(id, '99999999');
			assert.ok(isBaseHalfHighlight({ text: ' ', replies: [] }));
			assert.ok(!isBaseHalfHighlight({ text: '', replies: [{ text: 'a' }] }));
			assert.strictEqual(baseHalfCommentCut('ab😀', 3), 'ab');
		});
	});
});
