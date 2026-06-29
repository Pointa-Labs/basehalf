/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BaseHalfMarkdownRichSaveRequestedMessage, BaseHalfMarkdownRichWebviewSaveCoordinator, IBaseHalfMarkdownRichSaveSender } from '../../common/basehalfMarkdownRichWebviewSaveCoordinator.js';
import { IBaseHalfMarkdownRichDisk } from '../../common/basehalfMarkdownRichSession.js';

suite('BaseHalfMarkdownRichWebviewSaveCoordinator', () => {
	test('writes changed rich content and allows navigation to continue', async () => {
		const disk = new TestDisk('Alpha\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			content: 'Beta\n',
			previousContent: 'Alpha\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Beta\n' });
		assert.strictEqual(disk.content, 'Beta\n');
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'saved', options: { content: 'Beta\n' } }]);
	});

	test('reports noop when serialized rich content already matches the current working copy', async () => {
		const disk = new TestDisk('Alpha\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested(), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'noop', okToLeave: true, content: 'Alpha\n' });
		assert.deepStrictEqual(disk.writes, []);
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'noop', options: { content: 'Alpha\n' } }]);
	});

	test('blocks navigation when source-side working copy drifted under the rich editor', async () => {
		const disk = new TestDisk('Source unsaved\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			content: 'Rich local\n',
			previousContent: 'Alpha\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'blockedByConflict', okToLeave: false, disk: 'Source unsaved\n' });
		assert.strictEqual(disk.content, 'Source unsaved\n');
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'blockedByConflict', options: { disk: 'Source unsaved\n' } }]);
	});

	test('force writes local rich content over current source content', async () => {
		const disk = new TestDisk('Source unsaved\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			content: 'Rich local\n',
			previousContent: 'Alpha\n',
			forceWrite: true
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Rich local\n' });
		assert.strictEqual(disk.content, 'Rich local\n');
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'saved', options: { content: 'Rich local\n' } }]);
	});

	test('turns disk read failures into writeFailed save results', async () => {
		const disk = new TestDisk('Alpha\n');
		disk.readError = new Error('model disposed');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested(), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'writeFailed', okToLeave: false, message: 'model disposed' });
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'writeFailed', options: { message: 'model disposed' } }]);
	});

	test('turns disk write failures into writeFailed save results', async () => {
		const disk = new TestDisk('Alpha\n');
		disk.writeError = new Error('readonly');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			content: 'Beta\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'writeFailed', okToLeave: false, message: 'readonly' });
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'writeFailed', options: { message: 'readonly' } }]);
	});
});

function saveRequested(overrides: Partial<BaseHalfMarkdownRichSaveRequestedMessage> = {}): BaseHalfMarkdownRichSaveRequestedMessage {
	return {
		type: 'basehalf.markdownRich.saveRequested',
		key: 'workspace\u0000notes.md',
		requestId: 'save-1',
		content: 'Alpha\n',
		previousContent: 'Alpha\n',
		forceWrite: false,
		...overrides
	};
}

class TestDisk implements IBaseHalfMarkdownRichDisk {
	readonly writes: string[] = [];
	readError: Error | undefined;
	writeError: Error | undefined;

	constructor(public content: string) { }

	async read(): Promise<string> {
		if (this.readError) {
			throw this.readError;
		}
		return this.content;
	}

	async write(content: string): Promise<void> {
		if (this.writeError) {
			throw this.writeError;
		}
		this.content = content;
		this.writes.push(content);
	}
}

class TestSender implements IBaseHalfMarkdownRichSaveSender {
	readonly results: Array<{
		readonly requestId: string;
		readonly result: string;
		readonly options: { readonly content?: string; readonly disk?: string; readonly message?: string } | undefined;
	}> = [];

	async sendSaveResult(
		requestId: string,
		result: string,
		options?: { readonly content?: string; readonly disk?: string; readonly message?: string }
	): Promise<boolean> {
		this.results.push({ requestId, result, options });
		return true;
	}
}
