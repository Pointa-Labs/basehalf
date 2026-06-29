/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	baseHalfMarkdownRichUpdateFromPayload,
	isBaseHalfMarkdownRichHostMessage,
	isBaseHalfMarkdownRichWebviewMessage,
	toBaseHalfMarkdownRichTransferableUpdate
} from '../../common/basehalfMarkdownRichWebviewProtocol.js';

suite('BaseHalfMarkdownRichWebviewProtocol', () => {
	test('recognizes valid host messages and rejects incomplete envelopes', () => {
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.init',
			key: 'workspace\u0000doc.md',
			resource: 'file:///workspace/doc.md',
			content: '# Doc\n',
			editable: true
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.applyYjsUpdate',
			key: 'workspace\u0000doc.md',
			update: new ArrayBuffer(2)
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.save',
			key: 'workspace\u0000doc.md',
			requestId: 'save-1',
			forceSerialize: true,
			forceWrite: false
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.saveResult',
			key: 'workspace\u0000doc.md',
			requestId: 'save-1',
			result: 'blockedByConflict',
			disk: 'External edits\n',
			message: 'External edits'
		}), true);

		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: '' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'other.init', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.save', key: 'workspace\u0000doc.md', requestId: 'save-1', forceSerialize: true }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.saveResult', key: 'workspace\u0000doc.md', requestId: 'save-1', result: 'maybe' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.saveResult', key: 'workspace\u0000doc.md', requestId: 'save-1', result: 'saved', message: 1 }), false);
	});

	test('recognizes valid webview messages and validates byte payloads', () => {
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.ready',
			key: 'workspace\u0000doc.md'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.yjsUpdate',
			key: 'workspace\u0000doc.md',
			update: [0, 1, 255]
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.saveRequested',
			key: 'workspace\u0000doc.md',
			requestId: 'save-1',
			content: '# Edited\n',
			previousContent: '# Before\n',
			forceWrite: false
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.dirtyChanged',
			key: 'workspace\u0000doc.md',
			dirty: true
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { visible_blocks: { start: 2 }, cursor: { line: 4, column: 1, line_precision: 'exact', block: 2 } }
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.error',
			key: 'workspace\u0000doc.md',
			message: 'render failed'
		}), true);

		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.yjsUpdate',
			key: 'workspace\u0000doc.md',
			update: [256]
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.saveRequested',
			key: 'workspace\u0000doc.md',
			requestId: 'save-1',
			content: '# Edited\n',
			previousContent: '# Before\n'
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.dirtyChanged',
			key: 'workspace\u0000doc.md',
			dirty: 'yes'
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.error',
			key: 'workspace\u0000doc.md'
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.error',
			key: 'workspace\u0000doc.md',
			message: 'render failed',
			stack: 1
		}), false);
	});

	test('rejects malformed focus mirror payloads from webviews', () => {
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { visible_lines: { start: 0 } }
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { visible_blocks: { start: 1.5 } }
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { cursor: { line: 4, column: 1, line_precision: 'unknown' } }
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { cursor: { line: 4, column: 0, line_precision: 'exact' } }
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { cursor: { line: 4, column: 1, line_precision: 'exact', block: -1 } }
		}), false);
	});

	test('copies YJS updates into exact transferable buffers', () => {
		const backing = new Uint8Array([9, 8, 7, 6, 5]);
		const sliced = backing.subarray(1, 4);
		const transferable = toBaseHalfMarkdownRichTransferableUpdate(sliced);

		assert.strictEqual(transferable.update.byteLength, 3);
		assert.deepStrictEqual([...new Uint8Array(transferable.update)], [8, 7, 6]);
		assert.deepStrictEqual(transferable.transfer, [transferable.update]);
		assert.notStrictEqual(transferable.update, backing.buffer);
	});

	test('decodes supported YJS update payload shapes', () => {
		const fromBuffer = baseHalfMarkdownRichUpdateFromPayload(new Uint8Array([1, 2, 3]).buffer);
		assert.deepStrictEqual([...fromBuffer], [1, 2, 3]);

		const typed = new Uint8Array([4, 5]);
		assert.strictEqual(baseHalfMarkdownRichUpdateFromPayload(typed), typed);
		assert.deepStrictEqual([...baseHalfMarkdownRichUpdateFromPayload([6, 7])], [6, 7]);

		assert.throws(() => baseHalfMarkdownRichUpdateFromPayload('bad' as never), /Unsupported/);
	});
});
