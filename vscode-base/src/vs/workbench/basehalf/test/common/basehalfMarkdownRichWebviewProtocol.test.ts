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
			editable: true,
			selection: {
				startLineNumber: 3,
				startColumn: 1,
				endLineNumber: 3,
				endColumn: 8
			}
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.applyYjsUpdate',
			key: 'workspace\u0000doc.md',
			update: new ArrayBuffer(2)
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.revealSelection',
			key: 'workspace\u0000doc.md',
			selection: {
				startLineNumber: 8,
				startColumn: 1,
				endLineNumber: 9,
				endColumn: 5
			}
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.command',
			key: 'workspace\u0000doc.md',
			command: 'undo'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.command',
			key: 'workspace\u0000doc.md',
			command: 'redo'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.fileSearchResult',
			key: 'workspace\u0000doc.md',
			requestId: 'files-1',
			files: [{ name: 'guide.md', path: 'docs/guide.md', href: '../docs/guide.md' }]
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.fileSearchResult',
			key: 'workspace\u0000doc.md',
			requestId: 'files-1',
			files: []
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
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.adhdState',
			key: 'workspace\u0000doc.md',
			readingModeEnabled: true,
			adhd: {
				path: 'doc.md',
				kind: 'file',
				highlight_keywords: ['Cost'],
				read_paragraphs: [[1, 2]]
			}
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({
			type: 'basehalf.markdownRich.adhdState',
			key: 'workspace\u0000doc.md',
			readingModeEnabled: false,
			error: 'ADHD metadata issue'
		}), true);

		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: 'workspace\u0000doc.md', resource: 'file:///workspace/doc.md', content: '# Doc\n', editable: true, selection: { startLineNumber: 0, startColumn: 1 } }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: 'workspace\u0000doc.md', resource: 'file:///workspace/doc.md', content: '# Doc\n', editable: true, selection: { startLineNumber: 1, startColumn: 'bad' } }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.init', key: '' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'other.init', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.revealSelection', key: 'workspace\u0000doc.md', selection: { startLineNumber: 0, startColumn: 1 } }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.revealSelection', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.command', key: 'workspace\u0000doc.md', command: 'selectAll' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.command', key: 'workspace\u0000doc.md' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.fileSearchResult', key: 'workspace\u0000doc.md', requestId: 'files-1', files: [{ name: 'guide.md', path: 'docs/guide.md' }] }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.fileSearchResult', key: 'workspace\u0000doc.md', files: [] }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.save', key: 'workspace\u0000doc.md', requestId: 'save-1', forceSerialize: true }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.saveResult', key: 'workspace\u0000doc.md', requestId: 'save-1', result: 'maybe' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.saveResult', key: 'workspace\u0000doc.md', requestId: 'save-1', result: 'saved', message: 1 }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.adhdState', key: 'workspace\u0000doc.md', adhd: { path: 'doc.md', kind: 'folder' } }), false);
		assert.strictEqual(isBaseHalfMarkdownRichHostMessage({ type: 'basehalf.markdownRich.adhdState', key: 'workspace\u0000doc.md', readingModeEnabled: 'yes' }), false);
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
			type: 'basehalf.markdownRich.editorActivated',
			key: 'workspace\u0000doc.md'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.focusChanged',
			key: 'workspace\u0000doc.md',
			fields: { visible_blocks: { start: 2 }, cursor: { line: 4, column: 1, line_precision: 'exact', block: 2 } }
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.workbenchCommand',
			key: 'workspace\u0000doc.md',
			command: 'quickOpen'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.workbenchCommand',
			key: 'workspace\u0000doc.md',
			command: 'showCommands'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.fileSearch',
			key: 'workspace\u0000doc.md',
			requestId: 'files-1',
			query: 'gui'
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.fileSearch',
			key: 'workspace\u0000doc.md',
			requestId: 'files-1',
			query: ''
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({ type: 'basehalf.markdownRich.fileSearch', key: 'workspace\u0000doc.md', query: 'gui' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({ type: 'basehalf.markdownRich.fileSearch', key: 'workspace\u0000doc.md', requestId: 'files-1' }), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: 'workspace\u0000doc.md',
			command: { command: 'addKeyword', keyword: 'Cost' }
		}), true);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: 'workspace\u0000doc.md',
			command: { command: 'markRead', start: 1, end: 2 }
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
			type: 'basehalf.markdownRich.workbenchCommand',
			key: 'workspace\u0000doc.md',
			command: 'unknown'
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: 'workspace\u0000doc.md',
			command: { command: 'addKeyword', keyword: '' }
		}), false);
		assert.strictEqual(isBaseHalfMarkdownRichWebviewMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: 'workspace\u0000doc.md',
			command: { command: 'markUnread', start: 3, end: 2 }
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
