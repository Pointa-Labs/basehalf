/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileStatWithPartialMetadata } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfCanvasActionContextService, IBaseHalfCanvasResourceSnapshot, sameBaseHalfCanvasResourceSnapshot } from '../../common/basehalfCanvasActionContext.js';

suite('BaseHalfCanvasActionContext', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('an action on a draft knows it is one, holds while it stays one, and refuses once it is gone or got its file', async () => {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		const workspace = URI.file('/workspace');
		const draft = URI.file('/workspace/shots/video.mp4');
		const info = URI.file('/workspace/.bh/mirror/shots/video.mp4/generation.yaml');
		await fileService.createFolder(URI.file('/workspace/shots'));
		await fileService.writeFile(info, VSBuffer.fromString('prompt: ""\n'));
		const service = new BaseHalfCanvasActionContextService(fileService, new BaseHalfWorkspaceMutationCoordinator());
		const context = await service.capture(draft, workspace, 'shots/video.mp4');
		const current = await service.assertCurrent(context);
		await fileService.writeFile(draft, VSBuffer.fromString('the file arrived'));
		await assert.rejects(service.assertCurrent(context), /changed while the canvas action was open/);
		await fileService.del(draft);
		await fileService.del(info);
		await assert.rejects(service.assertCurrent(context), /changed while the canvas action was open/);
		await assert.rejects(service.capture(draft, workspace, 'shots/video.mp4'));
		assert.deepStrictEqual({ draft: context.snapshot.draft, isFile: current.isFile, isDirectory: current.isDirectory }, { draft: true, isFile: false, isDirectory: false });
	});

	test('accepts the same resource identity', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat()), true);
	});

	test('rejects resources replaced at the same path', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat({ mtime: 11, etag: 'changed' })), false);
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot(), stat({ isFile: false, isDirectory: true })), false);
	});

	test('compares only metadata captured by the provider', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(snapshot({ mtime: undefined, ctime: undefined, size: undefined, etag: undefined }), stat({ mtime: 99, ctime: 88, size: 77, etag: 'later' })), true);
	});

	test('keeps a folder action current when only its child listing changes', () => {
		assert.strictEqual(sameBaseHalfCanvasResourceSnapshot(
			snapshot({ isFile: false, isDirectory: true, mtime: 10, ctime: 5, size: 2, etag: 'two-children' }),
			stat({ isFile: false, isDirectory: true, mtime: 11, ctime: 6, size: 4, etag: 'four-children' })
		), true);
	});
});

function snapshot(overrides: Partial<IBaseHalfCanvasResourceSnapshot> = {}): IBaseHalfCanvasResourceSnapshot {
	return {
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: 10,
		ctime: 5,
		size: 100,
		etag: 'stable',
		...overrides
	};
}

function stat(overrides: Partial<IFileStatWithPartialMetadata> = {}): IFileStatWithPartialMetadata {
	return {
		resource: URI.file('/workspace/note.md'),
		name: 'note.md',
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
		mtime: 10,
		ctime: 5,
		size: 100,
		etag: 'stable',
		readonly: false,
		locked: false,
		executable: false,
		...overrides
	};
}
