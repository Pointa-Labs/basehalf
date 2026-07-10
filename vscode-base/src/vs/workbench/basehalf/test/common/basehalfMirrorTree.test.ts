/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { createFileSystemProviderError, FileOperationError, FileOperationResult, FileSystemProviderErrorCode, IFileService } from '../../../../platform/files/common/files.js';
import { BaseHalfMirrorSymbolicLinkError, baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfWalkMirror } from '../../common/basehalfMirrorTree.js';

suite('BaseHalfMirrorTree', () => {
	const workspaceFolder = URI.file('/work');
	const target = URI.file('/work/.bh/mirror/docs/canvas.yaml');

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
