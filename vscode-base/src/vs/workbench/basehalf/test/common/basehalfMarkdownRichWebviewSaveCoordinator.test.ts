/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	BaseHalfMarkdownRichSaveRequestedMessage,
	BaseHalfMarkdownRichWebviewSaveCoordinator,
	IBaseHalfMarkdownRichSaveSender,
	planBaseHalfMarkdownRichProjectionHandoff
} from '../../common/basehalfMarkdownRichWebviewSaveCoordinator.js';
import {
	BaseHalfMarkdownRichDiskChangedError,
	IBaseHalfMarkdownRichDisk,
	IBaseHalfMarkdownRichDiskWriteOptions,
	joinBaseHalfMarkdownRichFrontmatter
} from '../../common/basehalfMarkdownRichSession.js';

const FRONTMATTER = '---\ntitle: Notes\n---\n';
const UPSTREAM_FRONTMATTER = '---\ntitle: Notes\nupstream:\n  - sources/book.pdf\n---\n';

suite('BaseHalfMarkdownRichWebviewSaveCoordinator', () => {
	test('writes changed rich content and allows navigation to continue', async () => {
		const disk = new TestDisk('Alpha\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Beta\n',
			previousContent: 'Alpha\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Beta\n' });
		assert.strictEqual(disk.content, 'Beta\n');
		assert.deepStrictEqual(disk.expected, ['Alpha\n']);
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
			body: 'Rich local\n',
			previousContent: 'Alpha\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'blockedByConflict', okToLeave: false, disk: 'Source unsaved\n' });
		assert.strictEqual(disk.content, 'Source unsaved\n');
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'blockedByConflict', options: { disk: 'Source unsaved\n' } }]);
	});

	test('structural serialization never treats rename/delete as consent to overwrite external content', async () => {
		const disk = new TestDisk('External edit\n');
		const sender = new TestSender();
		// forceSerialize is the host→webview command; the resulting save request
		// deliberately keeps forceWrite false so the operation precondition can
		// veto instead of destroying the external edit.
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Rich local\n',
			previousContent: 'Before external edit\n',
			forceWrite: false
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'blockedByConflict', okToLeave: false, disk: 'External edit\n' });
		assert.strictEqual(disk.content, 'External edit\n');
		assert.deepStrictEqual(disk.writes, []);
	});

	test('force writes local rich content over current source content', async () => {
		const disk = new TestDisk('Source unsaved\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Rich local\n',
			previousContent: 'Alpha\n',
			forceWrite: true
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Rich local\n' });
		assert.strictEqual(disk.content, 'Rich local\n');
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'saved', options: { content: 'Rich local\n' } }]);
	});

	test('a frontmatter-only change under a dirty rich editor is not a conflict and survives the save', async () => {
		// An agent or a reference operation added `upstream` while the rich
		// editor held unsaved body edits based on the old frontmatter.
		const disk = new TestDisk(`${UPSTREAM_FRONTMATTER}Alpha\n`);
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha typed\n',
			previousContent: `${FRONTMATTER}Alpha\n`
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: `${UPSTREAM_FRONTMATTER}Alpha typed\n` });
		assert.strictEqual(disk.content, `${UPSTREAM_FRONTMATTER}Alpha typed\n`);
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'saved', options: { content: `${UPSTREAM_FRONTMATTER}Alpha typed\n` } }]);
	});

	test('never writes the webview frontmatter: a clean save adopts the frontmatter the model holds', async () => {
		const disk = new TestDisk(`${UPSTREAM_FRONTMATTER}Alpha\n`);
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha\n',
			previousContent: `${FRONTMATTER}Alpha\n`
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'noop', okToLeave: true, content: `${UPSTREAM_FRONTMATTER}Alpha\n` });
		assert.deepStrictEqual(disk.writes, []);
	});

	test('a frontmatter removed outside the editor stays removed', async () => {
		const disk = new TestDisk('Alpha\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha typed\n',
			previousContent: `${UPSTREAM_FRONTMATTER}Alpha\n`
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Alpha typed\n' });
	});

	test('a body divergence still conflicts when the frontmatter also changed', async () => {
		const disk = new TestDisk(`${UPSTREAM_FRONTMATTER}Agent body\n`);
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha typed\n',
			previousContent: `${FRONTMATTER}Alpha\n`
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'blockedByConflict', okToLeave: false, disk: `${UPSTREAM_FRONTMATTER}Agent body\n` });
		assert.deepStrictEqual(disk.writes, []);
	});

	test('Keep my edits writes the local body under the model frontmatter', async () => {
		const disk = new TestDisk(`${UPSTREAM_FRONTMATTER}Agent body\n`);
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha typed\n',
			previousContent: `${FRONTMATTER}Alpha\n`,
			forceWrite: true
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: `${UPSTREAM_FRONTMATTER}Alpha typed\n` });
		assert.strictEqual(disk.content, `${UPSTREAM_FRONTMATTER}Alpha typed\n`);
	});

	test('joins a body after a closing fence that ends the file', async () => {
		const disk = new TestDisk('---\r\nupstream: a.md\r\n---');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Typed\r\n',
			previousContent: '---\r\nupstream: a.md\r\n---'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: '---\r\nupstream: a.md\r\n---\r\nTyped\r\n' });
		assert.strictEqual(joinBaseHalfMarkdownRichFrontmatter('---\nupstream: a.md\n---', ''), '---\nupstream: a.md\n---');
		assert.strictEqual(joinBaseHalfMarkdownRichFrontmatter('', 'Body\n'), 'Body\n');
	});

	test('plans again when the document changes between the read and the write', async () => {
		const disk = new TestDisk(`${FRONTMATTER}Alpha\n`);
		// A reference operation lands its frontmatter edit after the read.
		disk.beforeWrite = () => {
			disk.beforeWrite = undefined;
			disk.content = `${UPSTREAM_FRONTMATTER}Alpha\n`;
		};
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha typed\n',
			previousContent: `${FRONTMATTER}Alpha\n`
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: `${UPSTREAM_FRONTMATTER}Alpha typed\n` });
		assert.deepStrictEqual(disk.writes, [`${UPSTREAM_FRONTMATTER}Alpha typed\n`]);
		assert.deepStrictEqual(disk.expected, [`${FRONTMATTER}Alpha\n`, `${UPSTREAM_FRONTMATTER}Alpha\n`]);
	});

	test('reports the text the store holds after the write', async () => {
		const disk = new TestDisk('Alpha\r\n');
		disk.normalize = content => content.replace(/\r?\n/g, '\r\n');
		const sender = new TestSender();
		const outcome = await new BaseHalfMarkdownRichWebviewSaveCoordinator().handleSaveRequested(saveRequested({
			body: 'Alpha\nBeta\n',
			previousContent: 'Alpha\r\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'saved', okToLeave: true, content: 'Alpha\r\nBeta\r\n' });
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
			body: 'Beta\n'
		}), disk, sender);

		assert.deepStrictEqual(outcome, { result: 'writeFailed', okToLeave: false, message: 'readonly' });
		assert.deepStrictEqual(sender.results, [{ requestId: 'save-1', result: 'writeFailed', options: { message: 'readonly' } }]);
	});
});

suite('planBaseHalfMarkdownRichProjectionHandoff', () => {
	test('hands off the rich body under the model frontmatter when only the frontmatter changed', () => {
		assert.deepStrictEqual(
			planBaseHalfMarkdownRichProjectionHandoff(`${UPSTREAM_FRONTMATTER}Alpha\n`, {
				body: 'Alpha typed\n',
				previousContent: `${FRONTMATTER}Alpha\n`,
				forceWrite: false
			}, []),
			{ kind: 'apply', content: `${UPSTREAM_FRONTMATTER}Alpha typed\n`, changed: true }
		);
	});

	test('is unchanged when the model already holds the rich body', () => {
		assert.deepStrictEqual(
			planBaseHalfMarkdownRichProjectionHandoff(`${UPSTREAM_FRONTMATTER}Alpha\n`, {
				body: 'Alpha\n',
				previousContent: `${FRONTMATTER}Alpha\n`,
				forceWrite: false
			}, []),
			{ kind: 'apply', content: `${UPSTREAM_FRONTMATTER}Alpha\n`, changed: false }
		);
	});

	test('conflicts on a body divergence unless the body is one this editor wrote', () => {
		const current = `${UPSTREAM_FRONTMATTER}Saved by rich\n`;
		const message = { body: 'Saved by rich\nMore\n', previousContent: `${FRONTMATTER}Alpha\n`, forceWrite: false };

		assert.deepStrictEqual(
			planBaseHalfMarkdownRichProjectionHandoff(current, message, []),
			{ kind: 'conflict', disk: current }
		);
		// The handoff skipped waiting for an earlier save result, so its
		// baseline lags a body the host already accepted from this editor.
		assert.deepStrictEqual(
			planBaseHalfMarkdownRichProjectionHandoff(current, message, ['Saved by rich\n']),
			{ kind: 'apply', content: `${UPSTREAM_FRONTMATTER}Saved by rich\nMore\n`, changed: true }
		);
	});
});

function saveRequested(overrides: Partial<BaseHalfMarkdownRichSaveRequestedMessage> = {}): BaseHalfMarkdownRichSaveRequestedMessage {
	return {
		type: 'basehalf.markdownRich.saveRequested',
		key: 'workspace\u0000notes.md',
		requestId: 'save-1',
		body: 'Alpha\n',
		previousContent: 'Alpha\n',
		forceWrite: false,
		...overrides
	};
}

class TestDisk implements IBaseHalfMarkdownRichDisk {
	readonly writes: string[] = [];
	readonly expected: Array<string | undefined> = [];
	readError: Error | undefined;
	writeError: Error | undefined;
	beforeWrite: (() => void) | undefined;
	normalize: ((content: string) => string) | undefined;

	constructor(public content: string) { }

	async read(): Promise<string> {
		if (this.readError) {
			throw this.readError;
		}
		return this.content;
	}

	async write(content: string, options: IBaseHalfMarkdownRichDiskWriteOptions = {}): Promise<string> {
		this.expected.push(options.expected);
		this.beforeWrite?.();
		if (this.writeError) {
			throw this.writeError;
		}
		if (options.expected !== undefined && this.content !== options.expected) {
			throw new BaseHalfMarkdownRichDiskChangedError();
		}
		this.content = this.normalize?.(content) ?? content;
		this.writes.push(content);
		return this.content;
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
