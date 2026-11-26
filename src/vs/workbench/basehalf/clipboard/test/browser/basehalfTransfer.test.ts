/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CodeDataTransfers } from '../../../../../platform/dnd/browser/dnd.js';
import { BaseHalfTransfer } from '../../common/basehalfClipboard.js';
import { baseHalfDragHoldsTransfer, baseHalfTransferFromDrop } from '../../browser/basehalfTransfer.js';

function described(transfer: BaseHalfTransfer | undefined): unknown {
	switch (transfer?.kind) {
		case 'items': return { items: transfer.items.map(item => item.resource.path), cut: transfer.cut };
		case 'picture': return { picture: transfer.data.toString(), extension: transfer.extension, name: transfer.name };
		case 'text': return { text: transfer.text };
		default: return undefined;
	}
}

suite('BaseHalf transfer of a drop', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a drop is read as the first that is there of items from Files, a picture without a file, and text; Files moves what it drags', async () => {
		const fromFiles = new DataTransfer();
		fromFiles.setData(CodeDataTransfers.FILES, JSON.stringify(['/work/a.md', '/work/b.png']));
		fromFiles.setData('text/plain', '/work/a.md');
		const picture = new DataTransfer();
		picture.items.add(new File(['bytes'], 'cat.jpg', { type: 'image/jpeg' }));
		picture.setData('text/plain', 'https://example.com/cat.jpg');
		const unnamed = new DataTransfer();
		unnamed.items.add(new File(['bytes'], 'image.png', { type: 'image/png' }));
		const text = new DataTransfer();
		text.setData('text/plain', 'a line');
		const other = new DataTransfer();
		other.setData('application/x-basehalf-agent-tab', 'tab');
		assert.deepStrictEqual({
			fromFiles: described(await baseHalfTransferFromDrop(fromFiles)),
			picture: described(await baseHalfTransferFromDrop(picture)),
			unnamed: described(await baseHalfTransferFromDrop(unnamed)),
			text: described(await baseHalfTransferFromDrop(text)),
			other: described(await baseHalfTransferFromDrop(other)),
			held: [fromFiles, picture, text, other].map(baseHalfDragHoldsTransfer)
		}, {
			fromFiles: { items: ['/work/a.md', '/work/b.png'], cut: true },
			picture: { picture: 'bytes', extension: 'jpg', name: 'cat.jpg' },
			unnamed: { picture: 'bytes', extension: 'png', name: undefined },
			text: { text: 'a line' },
			other: undefined,
			held: [true, true, true, false]
		});
	});
});
