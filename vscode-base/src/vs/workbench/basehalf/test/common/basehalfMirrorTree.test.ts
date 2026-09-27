/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { createFileSystemProviderError, FileOperationError, FileOperationResult, FileSystemProviderErrorCode, IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { BaseHalfMirrorSymbolicLinkError, baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfPruneEmptyMirrorDirectories, baseHalfWalkMirror } from '../../common/basehalfMirrorTree.js';

suite('BaseHalfMirrorTree', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/work');
	const target = URI.file('/work/.bh/mirror/docs/canvas.yaml');

	test('prunes empty mirror directories bottom-up and up the emptied ancestors, and keeps any directory that holds a file', async () => {
		const disposables = new DisposableStore();
		try {
			const fileService = disposables.add(new FileService(new NullLogService()));
			disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
			const mirror = (path: string) => URI.joinPath(workspaceFolder, '.bh', 'mirror', ...path.split('/').filter(Boolean));
			for (const path of ['a/b/old/x', 'a/b/old/y/z', 'a/sibling', 'keep/old']) {
				await fileService.createFolder(mirror(path));
			}
			await fileService.writeFile(mirror('a/sibling/badge.yaml'), VSBuffer.fromString('path: "a/sibling"\n'));
			await fileService.writeFile(mirror('keep/old/upstream.yaml'), VSBuffer.fromString('upstream: []\n'));
			await fileService.createFolder(mirror('keep/old/empty'));

			const removed = await baseHalfPruneEmptyMirrorDirectories(fileService, workspaceFolder, 'a/b/old');
			const kept = await baseHalfPruneEmptyMirrorDirectories(fileService, workspaceFolder, 'keep/old');
			const missing = await baseHalfPruneEmptyMirrorDirectories(fileService, workspaceFolder, 'never/there');
			const root = await baseHalfPruneEmptyMirrorDirectories(fileService, workspaceFolder, '');
			const exists = async (path: string) => fileService.exists(mirror(path));
			assert.deepStrictEqual({
				removed: removed.map(resource => resource.path).sort(),
				kept: kept.map(resource => resource.path),
				missing: missing.length,
				root: root.length,
				state: [await exists('a'), await exists('a/sibling/badge.yaml'), await exists('a/b'), await exists('keep/old/upstream.yaml'), await exists('keep/old/empty'), await exists('')]
			}, {
				removed: ['/work/.bh/mirror/a/b', '/work/.bh/mirror/a/b/old', '/work/.bh/mirror/a/b/old/x', '/work/.bh/mirror/a/b/old/y', '/work/.bh/mirror/a/b/old/y/z'],
				kept: ['/work/.bh/mirror/keep/old/empty'],
				missing: 0,
				root: 0,
				state: [true, true, false, true, false, true]
			});
		} finally {
			disposables.dispose();
		}
	});

	test('never follows or removes a symbolic link while pruning', async () => {
		const link = URI.file('/work/.bh/mirror/old/link');
		const deleted: string[] = [];
		const service = {
			stat: async (resource: URI) => ({ isSymbolicLink: resource.path === link.path }),
			resolve: async (resource: URI) => resource.path === '/work/.bh/mirror/old'
				? { isDirectory: true, isSymbolicLink: false, children: [{ resource: link, name: 'link', isDirectory: true, isSymbolicLink: true }] }
				: { isDirectory: true, isSymbolicLink: false, children: [] },
			del: async (resource: URI) => { deleted.push(resource.path); }
		} as unknown as IFileService;
		assert.deepStrictEqual([await baseHalfPruneEmptyMirrorDirectories(service, workspaceFolder, 'old'), deleted], [[], []]);
	});

	test('accepts a regular existing component chain', async () => {
		const service = resolvingFileService(new Set([
			'/work/.bh',
			'/work/.bh/mirror',
			'/work/.bh/mirror/docs',
			'/work/.bh/mirror/docs/canvas.yaml'
		]));

		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(service, workspaceFolder, target);
	});

	test('a missing suffix is safe for a later guarded create', async () => {
		const service = resolvingFileService(new Set([
			'/work/.bh',
			'/work/.bh/mirror'
		]));

		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(service, workspaceFolder, target);
	});

	test('a provider-level missing suffix is safe for a later guarded create', async () => {
		const service = {
			stat: async (resource: URI) => {
				if (resource.fsPath === '/work/.bh' || resource.fsPath === '/work/.bh/mirror') {
					return { isSymbolicLink: false };
				}
				throw createFileSystemProviderError('missing', FileSystemProviderErrorCode.FileNotFound);
			}
		} as unknown as IFileService;

		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(service, workspaceFolder, target);
	});

	test('rejects a symbolic-link YAML leaf', async () => {
		const service = resolvingFileService(new Set([
			'/work/.bh',
			'/work/.bh/mirror',
			'/work/.bh/mirror/docs',
			'/work/.bh/mirror/docs/canvas.yaml'
		]), new Set(['/work/.bh/mirror/docs/canvas.yaml']));

		await assert.rejects(
			() => baseHalfAssertMirrorPathComponentsNotSymbolicLink(service, workspaceFolder, target),
			error => error instanceof BaseHalfMirrorSymbolicLinkError
				&& error.symbolicLink.fsPath === '/work/.bh/mirror/docs/canvas.yaml'
		);
	});

	test('rejects a symbolic-link ancestor before touching the leaf', async () => {
		const visited: string[] = [];
		const service = resolvingFileService(new Set([
			'/work/.bh',
			'/work/.bh/mirror',
			'/work/.bh/mirror/docs',
			'/work/.bh/mirror/docs/canvas.yaml'
		]), new Set(['/work/.bh/mirror/docs']), visited);

		await assert.rejects(
			() => baseHalfAssertMirrorPathComponentsNotSymbolicLink(service, workspaceFolder, target),
			error => error instanceof BaseHalfMirrorSymbolicLinkError
				&& error.symbolicLink.fsPath === '/work/.bh/mirror/docs'
		);
		assert.deepStrictEqual(visited, ['/work/.bh', '/work/.bh/mirror', '/work/.bh/mirror/docs']);
	});

	test('walker refuses a symbolic-link mirror root before enumerating it', async () => {
		let resolves = 0;
		const service = {
			stat: async (resource: URI) => {
				if (resource.fsPath === '/work/.bh') {
					return { isSymbolicLink: false };
				}
				if (resource.fsPath === '/work/.bh/mirror') {
					return { isSymbolicLink: true };
				}
				throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
			},
			resolve: async () => {
				resolves++;
				return { children: [] };
			}
		} as unknown as IFileService;

		await assert.rejects(
			() => baseHalfWalkMirror(service, workspaceFolder, 'canvas.yaml'),
			error => error instanceof BaseHalfMirrorSymbolicLinkError
				&& error.symbolicLink.fsPath === '/work/.bh/mirror'
		);
		assert.strictEqual(resolves, 0);
	});
});

function resolvingFileService(existing: ReadonlySet<string>, symbolicLinks: ReadonlySet<string> = new Set(), visited: string[] = []): IFileService {
	return {
		stat: async (resource: URI) => {
			visited.push(resource.fsPath);
			if (!existing.has(resource.fsPath)) {
				throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
			}
			return { isSymbolicLink: symbolicLinks.has(resource.fsPath) };
		}
	} as unknown as IFileService;
}
