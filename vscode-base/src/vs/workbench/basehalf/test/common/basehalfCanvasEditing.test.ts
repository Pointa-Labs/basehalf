/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfCanvasEditingRequest, BaseHalfCanvasEditingService, baseHalfCanvasInlineEditKeyAction } from '../../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';

suite('BaseHalfCanvasEditing', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('maps ordinary commit and cancel keys', () => {
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Enter')), 'accept');
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Escape')), 'cancel');
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('a')), undefined);
	});

	test('leaves composition keys to the input method', () => {
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Enter', true)), undefined);
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction({ key: 'Enter', isComposing: false, keyCode: 229 }), undefined);
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction({ key: 'Escape', isComposing: true, keyCode: 229 }), undefined);
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction({ key: 'Escape', isComposing: false, keyCode: 229 }), undefined);
	});

	test('awaits distinct note, media-node, file, and folder creation intents', async () => {
		const service = new BaseHalfCanvasEditingService();
		const requests: BaseHalfCanvasEditingRequest[] = [];
		disposables.add(service.registerHandler(async request => { requests.push(request); }));
		const context = actionContext();

		await service.requestCreate(undefined, 'note');
		await service.requestCreate(context, 'resultNode');
		await service.requestCreate(context, 'file');
		await service.requestCreate(context, 'folder');

		assert.deepStrictEqual(requests, [
			{ kind: 'create', context: undefined, createKind: 'note' },
			{ kind: 'create', context, createKind: 'resultNode' },
			{ kind: 'create', context, createKind: 'file' },
			{ kind: 'create', context, createKind: 'folder' }
		]);
	});

	test('awaits paste, import, and selection intents', async () => {
		const service = new BaseHalfCanvasEditingService();
		const requests: BaseHalfCanvasEditingRequest[] = [];
		disposables.add(service.registerHandler(async request => { requests.push(request); }));
		const context = actionContext();

		await service.requestPaste(context);
		await service.requestImport(context);
		await service.requestSelection(URI.file('/work'), [URI.file('/work/new-folder')]);

		assert.deepStrictEqual(requests, [
			{ kind: 'paste', context },
			{ kind: 'import', context },
			{ kind: 'select', folder: URI.file('/work'), resources: [URI.file('/work/new-folder')] }
		]);
	});

	test('propagates handler completion and failures to command callers', async () => {
		const service = new BaseHalfCanvasEditingService();
		await assert.rejects(service.requestCreate(undefined, 'note'), /surface is not available/);

		let release!: () => void;
		const blocked = new Promise<void>(resolve => { release = resolve; });
		disposables.add(service.registerHandler(async () => blocked));
		let completed = false;
		const request = service.requestCreate(undefined, 'note').then(() => { completed = true; });
		await Promise.resolve();
		assert.strictEqual(completed, false);
		release();
		await request;
		assert.strictEqual(completed, true);
	});
});

function keyEvent(key: string, isComposing = false): { readonly key: string; readonly isComposing: boolean; readonly keyCode: number } {
	return { key, isComposing, keyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0 };
}

function actionContext(): IBaseHalfCanvasActionContext {
	return {
		resource: URI.file('/work'),
		workspaceFolder: URI.file('/work'),
		relativePath: '',
		stamp: { workspaceKey: URI.file('/work').toString(), relativePath: '', structuralEpoch: 1 },
		snapshot: {
			isFile: false,
			isDirectory: true,
			isSymbolicLink: false,
			mtime: 1,
			ctime: 1,
			size: 0,
			etag: '1'
		}
	};
}
