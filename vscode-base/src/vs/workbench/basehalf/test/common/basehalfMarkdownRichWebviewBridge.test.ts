/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Doc as YDoc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfMarkdownRichHostMessage } from '../../common/basehalfMarkdownRichWebviewProtocol.js';
import { BaseHalfMarkdownRichWebviewBridge, IBaseHalfMarkdownRichWebviewTransport } from '../../common/basehalfMarkdownRichWebviewBridge.js';

suite('BaseHalfMarkdownRichWebviewBridge', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('sends init, editable, save, and save result host messages', async () => {
		const host = new YDoc();
		const transport = new TestTransport();
		const bridge = disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, transport));

		assert.strictEqual(await bridge.sendInit('file:///workspace/doc.md', '# Doc\n', true), true);
		assert.strictEqual(await bridge.sendEditable(false), true);
		assert.strictEqual(await bridge.sendSave('save-1', { forceSerialize: true, forceWrite: false }), true);
		assert.strictEqual(await bridge.sendSaveResult('save-1', 'blockedByConflict', { disk: 'Disk changed\n', message: 'Disk changed' }), true);

		assert.deepStrictEqual(transport.messages.map(entry => entry.message), [
			{
				type: 'basehalf.markdownRich.init',
				key: 'workspace\u0000doc.md',
				resource: 'file:///workspace/doc.md',
				content: '# Doc\n',
				editable: true
			},
			{
				type: 'basehalf.markdownRich.setEditable',
				key: 'workspace\u0000doc.md',
				editable: false
			},
			{
				type: 'basehalf.markdownRich.save',
				key: 'workspace\u0000doc.md',
				requestId: 'save-1',
				forceSerialize: true,
				forceWrite: false
			},
			{
				type: 'basehalf.markdownRich.saveResult',
				key: 'workspace\u0000doc.md',
				requestId: 'save-1',
				result: 'blockedByConflict',
				disk: 'Disk changed\n',
				message: 'Disk changed'
			}
		]);
	});

	test('sends the current YJS state when the webview becomes ready', async () => {
		const host = new YDoc();
		host.getText('body').insert(0, 'host text');
		const transport = new TestTransport();
		const bridge = disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, transport));

		assert.strictEqual(await bridge.handleWebviewMessage({
			type: 'basehalf.markdownRich.ready',
			key: 'workspace\u0000doc.md'
		}), true);

		assert.strictEqual(transport.messages.length, 1);
		const update = transport.messages[0].message;
		assert.strictEqual(update.type, 'basehalf.markdownRich.applyYjsUpdate');
		assert.deepStrictEqual(transport.messages[0].transfer, [update.update]);

		const mirror = new YDoc();
		applyUpdate(mirror, new Uint8Array(update.update));
		assert.strictEqual(mirror.getText('body').toString(), 'host text');
	});

	test('applies incoming webview updates to the host doc without echoing to the sender', async () => {
		const host = new YDoc();
		const senderTransport = new TestTransport();
		const siblingTransport = new TestTransport();
		const senderBridge = disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, senderTransport));
		disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, siblingTransport));

		const webview = new YDoc();
		webview.getText('body').insert(0, 'from webview');
		assert.strictEqual(await senderBridge.handleWebviewMessage({
			type: 'basehalf.markdownRich.yjsUpdate',
			key: 'workspace\u0000doc.md',
			update: encodeStateAsUpdate(webview)
		}), true);

		assert.strictEqual(host.getText('body').toString(), 'from webview');
		assert.strictEqual(senderTransport.messages.length, 0);
		assert.strictEqual(siblingTransport.messages.length, 1);

		const siblingMirror = new YDoc();
		const update = siblingTransport.messages[0].message;
		assert.strictEqual(update.type, 'basehalf.markdownRich.applyYjsUpdate');
		applyUpdate(siblingMirror, new Uint8Array(update.update));
		assert.strictEqual(siblingMirror.getText('body').toString(), 'from webview');
	});

	test('broadcasts host-side YJS edits to every attached webview bridge', () => {
		const host = new YDoc();
		const firstTransport = new TestTransport();
		const secondTransport = new TestTransport();
		disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, firstTransport));
		disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, secondTransport));

		host.getText('body').insert(0, 'host edit');

		assert.strictEqual(firstTransport.messages.length, 1);
		assert.strictEqual(secondTransport.messages.length, 1);
		const firstMirror = new YDoc();
		const firstUpdate = firstTransport.messages[0].message;
		assert.strictEqual(firstUpdate.type, 'basehalf.markdownRich.applyYjsUpdate');
		applyUpdate(firstMirror, new Uint8Array(firstUpdate.update));
		assert.strictEqual(firstMirror.getText('body').toString(), 'host edit');
	});

	test('ignores invalid and wrong-key webview messages', async () => {
		const host = new YDoc();
		const bridge = disposables.add(new BaseHalfMarkdownRichWebviewBridge('workspace\u0000doc.md', host, new TestTransport()));

		assert.strictEqual(await bridge.handleWebviewMessage({ type: 'basehalf.markdownRich.ready', key: 'other\u0000doc.md' }), false);
		assert.strictEqual(await bridge.handleWebviewMessage({ type: 'basehalf.markdownRich.yjsUpdate', key: 'workspace\u0000doc.md', update: [999] }), false);
		assert.strictEqual(host.getText('body').toString(), '');
	});
});

class TestTransport implements IBaseHalfMarkdownRichWebviewTransport {
	readonly messages: Array<{ readonly message: BaseHalfMarkdownRichHostMessage; readonly transfer: readonly ArrayBuffer[] | undefined }> = [];

	async postMessage(message: BaseHalfMarkdownRichHostMessage, transfer?: readonly ArrayBuffer[]): Promise<boolean> {
		this.messages.push({ message, transfer });
		return true;
	}
}
