/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities, FileType, IStat } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { BaseHalfNodeRunLeaseStore, baseHalfNodeRunLeaseResource } from '../../browser/basehalfNodeRunLease.js';

suite('BaseHalfNodeRunLeaseStore', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses exclusive claims and never lets an old owner release a replacement', async () => {
		const disposables = new DisposableStore();
		const workspace = URI.from({ scheme: 'basehalf-lease-test', path: '/workspace' });
		const fileService = disposables.add(new FileService(new NullLogService()));
		const provider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(fileService.registerProvider(workspace.scheme, provider));
		await fileService.createFolder(workspace);
		const store = new BaseHalfNodeRunLeaseStore(fileService, 30_000);
		try {
			const first = await store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-a', 'run-a', undefined);
			assert.strictEqual(first.kind, 'acquired');
			if (first.kind !== 'acquired') {
				throw new Error('Expected the first owner to acquire the lease.');
			}
			const busy = await store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-b', 'run-b', undefined);
			assert.strictEqual(busy.kind, 'busy');

			const leaseResource = baseHalfNodeRunLeaseResource(workspace, 'node-1');
			const stale = JSON.parse((await fileService.readFile(leaseResource)).value.toString()) as Record<string, unknown>;
			stale.heartbeatAt = '2000-01-01T00:00:00.000Z';
			await fileService.writeFile(leaseResource, VSBuffer.fromString(`${JSON.stringify(stale, null, '\t')}\n`));
			const recovery = await store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-b', 'run-b', 'run-a');
			assert.strictEqual(recovery.kind, 'recovery');
			if (recovery.kind !== 'recovery') {
				throw new Error('Expected the stale owner to be claimed for recovery.');
			}
			const replacement = await store.activateRecovered(recovery.handle, 'run-b');
			assert.ok(replacement);
			assert.strictEqual(await store.release(first.handle), false);
			assert.strictEqual((await store.inspect(workspace, 'node-1'))?.runId, 'run-b');
			assert.strictEqual(await store.release(replacement!), true);
			assert.strictEqual((await store.inspect(workspace, 'node-1'))?.state, 'released');
		} finally {
			disposables.dispose();
		}
	});

	test('rebinds a released lease after a real move without accepting a duplicate live path', async () => {
		const disposables = new DisposableStore();
		const workspace = URI.from({ scheme: 'basehalf-lease-test', path: '/workspace' });
		const fileService = disposables.add(new FileService(new NullLogService()));
		const provider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(fileService.registerProvider(workspace.scheme, provider));
		await fileService.createFolder(workspace);
		const original = URI.joinPath(workspace, 'frame.bhnode');
		const moved = URI.joinPath(workspace, 'archive', 'frame.bhnode');
		await fileService.createFile(original, VSBuffer.fromString('{}'));
		const store = new BaseHalfNodeRunLeaseStore(fileService, 30_000);
		try {
			const first = await store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-a', 'move-a', undefined);
			assert.strictEqual(first.kind, 'acquired');
			if (first.kind !== 'acquired') {
				throw new Error('Expected the original path to acquire the lease.');
			}
			assert.strictEqual(await store.release(first.handle), true);
			await fileService.createFolder(URI.joinPath(workspace, 'archive'));
			await fileService.move(original, moved);

			const rebound = await store.acquire(workspace, 'node-1', 'archive/frame.bhnode', 'owner-b', 'run-b', undefined);
			assert.strictEqual(rebound.kind, 'acquired');
			if (rebound.kind !== 'acquired') {
				throw new Error('Expected the moved path to acquire the released lease.');
			}
			assert.strictEqual(rebound.handle.record.nodePath, 'archive/frame.bhnode');
			assert.strictEqual(await store.release(rebound.handle), true);

			await fileService.createFile(original, VSBuffer.fromString('{}'));
			await assert.rejects(
				() => store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-c', 'run-c', undefined),
				/does not match this node/
			);
			assert.strictEqual((await store.inspect(workspace, 'node-1'))?.nodePath, 'archive/frame.bhnode');
		} finally {
			disposables.dispose();
		}
	});

	test('rejects a symbolic-link ancestor before creating the lease directory', async () => {
		const disposables = new DisposableStore();
		const workspace = URI.from({ scheme: 'basehalf-lease-symlink-test', path: '/workspace' });
		const fileService = disposables.add(new FileService(new NullLogService()));
		const provider = disposables.add(new SymlinkAwareFileSystemProvider());
		disposables.add(fileService.registerProvider(workspace.scheme, provider));
		await fileService.createFolder(workspace);
		const privateDirectory = URI.joinPath(workspace, '.bh');
		await fileService.createFolder(privateDirectory);
		provider.markSymbolicLink(privateDirectory, URI.from({ scheme: workspace.scheme, path: '/outside' }));
		const store = new BaseHalfNodeRunLeaseStore(fileService, 30_000);
		try {
			await assert.rejects(
				() => store.acquire(workspace, 'node-1', 'frame.bhnode', 'owner-a', 'run-a', undefined),
				/symbolic-link component/
			);
			assert.strictEqual(await fileService.exists(URI.joinPath(privateDirectory, 'cache')), false);
			assert.strictEqual(await fileService.exists(baseHalfNodeRunLeaseResource(workspace, 'node-1')), false);
		} finally {
			disposables.dispose();
		}
	});
});

class SymlinkAwareFileSystemProvider extends InMemoryFileSystemProvider {
	private readonly symbolicLinks = new Set<string>();
	private readonly resolvedPaths = new Map<string, string>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.FileRealpath;
	}

	override async stat(resource: URI): Promise<IStat> {
		const stat = await super.stat(resource);
		return this.symbolicLinks.has(resource.toString())
			? { ...stat, type: stat.type | FileType.SymbolicLink }
			: stat;
	}

	async realpath(resource: URI): Promise<string> {
		return this.resolvedPaths.get(resource.toString()) ?? resource.path;
	}

	markSymbolicLink(resource: URI, target: URI): void {
		this.symbolicLinks.add(resource.toString());
		this.resolvedPaths.set(resource.toString(), target.path);
	}
}
