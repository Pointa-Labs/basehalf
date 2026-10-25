/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfCanvasAppearanceWrites, parseBaseHalfCanvasAppearance } from '../../common/basehalfCanvasAppearance.js';

suite('BaseHalfCanvasAppearance', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts the complete background preset contract', () => {
		for (const background of ['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const) {
			assert.deepStrictEqual(parseBaseHalfCanvasAppearance(`background: ${background}\n`), { field: 'background', background });
		}
	});

	test('accepts whether the card of a PDF or a book shows its cover', () => {
		assert.deepStrictEqual(
			['cover: shown\n', 'cover: hidden\n'].map(raw => parseBaseHalfCanvasAppearance(raw)),
			[{ field: 'cover', cover: 'shown' }, { field: 'cover', cover: 'hidden' }]
		);
	});

	test('a drawing that read the files while this window wrote a card\'s appearance keeps what the card shows', async () => {
		const writes = new BaseHalfCanvasAppearanceWrites();
		const readBefore = writes.mark();
		let finish!: () => void;
		const written = writes.run('docs/paper.pdf', () => new Promise<void>(resolve => finish = resolve));
		const whileWriting = [...writes.unreadSince(readBefore)];
		finish();
		await written;
		const endedDuringRead = [...writes.unreadSince(readBefore)];
		const readAfter = writes.mark();
		const readAfterTheEnd = [...writes.unreadSince(readAfter)];
		assert.deepStrictEqual(
			{ whileWriting, endedDuringRead, readAfterTheEnd },
			{ whileWriting: ['docs/paper.pdf'], endedDuringRead: ['docs/paper.pdf'], readAfterTheEnd: [] }
		);
	});

	test('accepts comments but rejects unknown or ambiguous metadata', () => {
		assert.deepStrictEqual(parseBaseHalfCanvasAppearance('# card appearance\nbackground: blue\n'), { field: 'background', background: 'blue' });
		assert.throws(() => parseBaseHalfCanvasAppearance('background: pink\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('background: blue\nbackground: red\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('color: blue\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('cover: off\n'));
		assert.throws(() => parseBaseHalfCanvasAppearance('background: blue\ncover: hidden\n'));
	});
});
