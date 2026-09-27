/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import {
	BASEHALF_CANVAS_VIEWPORTS_MAX_ENTRIES,
	BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY,
	BaseHalfCanvasViewportPersister,
	BaseHalfCanvasViewportStateService,
	baseHalfOpenCanvasViewport,
	IBaseHalfCanvasViewport,
	parseBaseHalfCanvasViewport
} from '../../common/basehalfCanvasViewportState.js';
import { baseHalfForgetCanvasViewportsForStructuralChange } from '../../common/basehalfMirrorCascadeOperation.js';

suite('BaseHalfCanvasViewportState', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspace = URI.file('/work');
	const folder = (path: string) => URI.joinPath(workspace, ...path.split('/').filter(Boolean));
	const user = (x: number, y: number, zoom = 1): IBaseHalfCanvasViewport => ({ x, y, zoom, source: 'user' });

	function create(storage: IStorageService = disposables.add(new InMemoryStorageService())): { readonly service: BaseHalfCanvasViewportStateService; readonly storage: IStorageService } {
		const fileService = {
			onDidChangeFileSystemProviderRegistrations: Event.None,
			onDidChangeFileSystemProviderCapabilities: Event.None,
			hasProvider: () => true,
			hasCapability: () => true
		} as Partial<IFileService> as IFileService;
		const uriIdentityService = disposables.add(new UriIdentityService(fileService));
		return { service: disposables.add(new BaseHalfCanvasViewportStateService(storage, uriIdentityService)), storage };
	}

	function stored(storage: IStorageService): unknown {
		const raw = storage.get(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, StorageScope.WORKSPACE);
		return raw === undefined ? undefined : JSON.parse(raw);
	}

	test('stores per-folder viewports as per-machine workspace state that survives reopening', () => {
		const storage = disposables.add(new InMemoryStorageService());
		const first = create(storage).service;
		first.set(folder('notes'), user(10, -20, 1.5));
		first.set(workspace, { x: 0, y: 0, zoom: 0.5, source: 'auto' });

		assert.deepStrictEqual(stored(storage), {
			[folder('notes').toString()]: { x: 10, y: -20, zoom: 1.5, source: 'user' },
			[workspace.toString()]: { x: 0, y: 0, zoom: 0.5, source: 'auto' }
		});
		assert.deepStrictEqual(storage.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE).includes(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY), true);

		// Reopening the folder (a new window) reads the same workspace storage.
		const reopened = create(storage).service;
		assert.deepStrictEqual(reopened.get(folder('notes')), user(10, -20, 1.5));
		assert.deepStrictEqual(reopened.get(workspace), { x: 0, y: 0, zoom: 0.5, source: 'auto' });
		assert.strictEqual(reopened.get(folder('other')), undefined);
	});

	test('ignores invalid stored values and keeps the valid ones', () => {
		const storage = disposables.add(new InMemoryStorageService());
		storage.store(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, JSON.stringify({
			[folder('ok').toString()]: { x: 1, y: 2, zoom: 1, source: 'import' },
			[folder('zero-zoom').toString()]: { x: 1, y: 2, zoom: 0, source: 'user' },
			[folder('nan').toString()]: { x: 'a', y: 2, zoom: 1, source: 'user' },
			[folder('source').toString()]: { x: 1, y: 2, zoom: 1, source: 'agent' },
			[folder('far').toString()]: { x: 1e9, y: 2, zoom: 1, source: 'user' },
			'not a uri': { x: 1, y: 2, zoom: 1, source: 'user' }
		}), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const { service } = create(storage);

		assert.deepStrictEqual(
			['ok', 'zero-zoom', 'nan', 'source', 'far'].map(path => service.get(folder(path))),
			[{ x: 1, y: 2, zoom: 1, source: 'import' }, undefined, undefined, undefined, undefined]
		);
		assert.strictEqual(parseBaseHalfCanvasViewport([1, 2]), undefined);
		assert.strictEqual(parseBaseHalfCanvasViewport({ x: 1, y: 2, zoom: -1, source: 'user' }), undefined);

		storage.store(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, '{not json', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const corrupt = create(storage).service;
		assert.strictEqual(corrupt.get(folder('ok')), undefined);
		corrupt.set(folder('ok'), user(3, 4));
		assert.deepStrictEqual(stored(storage), { [folder('ok').toString()]: user(3, 4) });

		// Invalid writes are ignored.
		corrupt.set(folder('bad'), { x: Number.NaN, y: 0, zoom: 1, source: 'user' });
		assert.strictEqual(corrupt.get(folder('bad')), undefined);
	});

	test('evicts the least recently used folder beyond the cap', () => {
		const { service, storage } = create();
		for (let index = 0; index < BASEHALF_CANVAS_VIEWPORTS_MAX_ENTRIES; index++) {
			service.set(folder(`f${index}`), user(index, index));
		}
		// Reading f0 makes it the most recently used entry.
		assert.deepStrictEqual(service.get(folder('f0')), user(0, 0));
		service.set(folder('new'), user(1, 1));

		const keys = Object.keys(stored(storage) as object);
		assert.strictEqual(keys.length, BASEHALF_CANVAS_VIEWPORTS_MAX_ENTRIES);
		assert.deepStrictEqual({
			f0: service.get(folder('f0')),
			f1: service.get(folder('f1')),
			f2: service.get(folder('f2')),
			newest: keys[keys.length - 1]
		}, {
			f0: user(0, 0),
			f1: undefined,
			f2: user(2, 2),
			newest: folder('new').toString()
		});
	});

	test('forgets a moved or deleted folder and every folder below it, never a sibling prefix', () => {
		const { service } = create();
		for (const path of ['docs', 'docs/a', 'docs/a/b', 'docs-2', 'other']) {
			service.set(folder(path), user(1, 1));
		}

		service.forgetSubtree(folder('docs'));

		assert.deepStrictEqual(
			['docs', 'docs/a', 'docs/a/b', 'docs-2', 'other'].map(path => service.get(folder(path)) !== undefined),
			[false, false, false, true, true]
		);
	});

	test('imports legacy viewports only over missing or automatic ones', () => {
		const { service } = create();
		service.set(folder('fitted'), { x: 0, y: 0, zoom: 1, source: 'auto' });
		service.set(folder('panned'), user(5, 5, 2));
		const fired: string[][] = [];
		disposables.add(service.onDidImport(folders => fired.push(folders.map(resource => resource.path))));

		const imported = service.importLegacy([
			{ folder: folder('fitted'), x: 10, y: 20, zoom: 0.8 },
			{ folder: folder('panned'), x: 10, y: 20, zoom: 0.8 },
			{ folder: folder('missing'), x: -3, y: 4, zoom: 1.25 },
			{ folder: folder('invalid'), x: 0, y: 0, zoom: 0 }
		]);

		assert.deepStrictEqual({
			imported: imported.map(resource => resource.path),
			fired,
			fitted: service.get(folder('fitted')),
			panned: service.get(folder('panned')),
			missing: service.get(folder('missing')),
			invalid: service.get(folder('invalid'))
		}, {
			imported: ['/work/fitted', '/work/missing'],
			fired: [['/work/fitted', '/work/missing']],
			fitted: { x: 10, y: 20, zoom: 0.8, source: 'import' },
			panned: user(5, 5, 2),
			missing: { x: -3, y: 4, zoom: 1.25, source: 'import' },
			invalid: undefined
		});

		// A later automatic fit never replaces the imported viewport.
		service.set(folder('fitted'), { x: 0, y: 0, zoom: 1, source: 'auto' });
		assert.deepStrictEqual(service.get(folder('fitted')), { x: 10, y: 20, zoom: 0.8, source: 'import' });
	});

	test('persists recency changes when the storage service saves state', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { service } = create(storage);
		service.set(folder('a'), user(1, 1));
		service.set(folder('b'), user(2, 2));
		service.get(folder('a'));
		assert.deepStrictEqual(Object.keys(stored(storage) as object), [folder('a').toString(), folder('b').toString()]);

		await storage.flush(WillSaveStateReason.SHUTDOWN);

		assert.deepStrictEqual(Object.keys(stored(storage) as object), [folder('b').toString(), folder('a').toString()]);
	});

	test('waits at most once and briefly for the legacy import of a workspace folder', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { service } = create();
		const settled: string[] = [];

		const first = service.whenLegacyImportSettled(workspace).then(() => settled.push('first'));
		service.settleLegacyImport(workspace);
		await first;
		await service.whenLegacyImportSettled(workspace).then(() => settled.push('after settle'));

		const other = URI.file('/other');
		const started = Date.now();
		await service.whenLegacyImportSettled(other).then(() => settled.push('timed out'));
		const waited = Date.now() - started;
		await service.whenLegacyImportSettled(other).then(() => settled.push('no second wait'));

		assert.deepStrictEqual({ settled, waited, secondWaitImmediate: Date.now() - started === waited }, {
			settled: ['first', 'after settle', 'timed out', 'no second wait'],
			waited: 500,
			secondWaitImmediate: true
		});
	}));

	test('drops its cache when workspace storage is replaced', () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { service } = create(storage);
		service.set(folder('a'), user(1, 1));

		storage.store(BASEHALF_CANVAS_VIEWPORTS_STORAGE_KEY, JSON.stringify({ [folder('b').toString()]: user(2, 2) }), StorageScope.WORKSPACE, StorageTarget.MACHINE);

		assert.deepStrictEqual([service.get(folder('a')), service.get(folder('b'))], [undefined, user(2, 2)]);
	});
	test('forgets viewports of a workbench folder move or delete, including the move destination', () => {
		const { service } = create();
		for (const path of ['a', 'a/child', 'b', 'c', 'c/deep', 'keep']) {
			service.set(folder(path), user(1, 1));
		}

		baseHalfForgetCanvasViewportsForStructuralChange(service, FileOperation.MOVE, [{ source: folder('a'), target: folder('b') }]);
		baseHalfForgetCanvasViewportsForStructuralChange(service, FileOperation.DELETE, [{ target: folder('c') }]);

		assert.deepStrictEqual(
			['a', 'a/child', 'b', 'c', 'c/deep', 'keep'].map(path => service.get(folder(path)) !== undefined),
			[false, false, false, false, false, true]
		);
	});

	test('flushes a pending settled viewport on dispose instead of dropping it', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { service } = create(storage);
		const persister = new BaseHalfCanvasViewportPersister(service, storage);

		persister.schedule(200, { folder: folder('notes'), viewport: user(7, 8), isCurrent: () => true });
		assert.strictEqual(service.get(folder('notes')), undefined);
		persister.dispose();

		assert.deepStrictEqual(create(storage).service.get(folder('notes')), user(7, 8));
	}));

	test('flushes a pending settled viewport when storage saves state', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const { service } = create(storage);
		const persister = disposables.add(new BaseHalfCanvasViewportPersister(service, storage));

		persister.schedule(200, { folder: folder('notes'), viewport: user(1, 2), isCurrent: () => true });
		await storage.flush(WillSaveStateReason.SHUTDOWN);

		assert.deepStrictEqual(service.get(folder('notes')), user(1, 2));
	}));

	test('writes after the debounce and drops a write whose scene is no longer current', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { service, storage } = create();
		const persister = disposables.add(new BaseHalfCanvasViewportPersister(service, storage));
		let current = true;

		persister.schedule(200, { folder: folder('a'), viewport: user(1, 1), isCurrent: () => current });
		await new Promise(resolve => setTimeout(resolve, 250));
		persister.schedule(200, { folder: folder('moved'), viewport: user(2, 2), isCurrent: () => current });
		current = false;
		persister.flush();

		assert.deepStrictEqual([service.get(folder('a')), service.get(folder('moved'))], [user(1, 1), undefined]);
	}));

	test('a canvas opens at its stored viewport, otherwise fits and records the fit as auto, and does neither once it is no longer current', async () => {
		const { service } = create();
		service.settleLegacyImport(workspace);
		service.set(folder('stored'), user(3, 4, 2));
		const steps: string[] = [];
		const open = (path: string, current: { before: boolean; afterFit: boolean }) => {
			let fitted = false;
			return baseHalfOpenCanvasViewport(service, folder(path), workspace, {
				isCurrent: () => fitted ? current.afterFit : current.before,
				restore: async viewport => { steps.push(`restore ${path} ${viewport.x},${viewport.y}@${viewport.zoom}`); },
				fit: async () => { fitted = true; steps.push(`fit ${path}`); },
				persistFit: () => { steps.push(`persist ${path}`); service.set(folder(path), { x: 0, y: 0, zoom: 1, source: 'auto' }); }
			});
		};

		const outcomes = [
			await open('stored', { before: true, afterFit: true }),
			await open('fresh', { before: true, afterFit: true }),
			await open('left-during-fit', { before: true, afterFit: false }),
			await open('left-before', { before: false, afterFit: false })
		];

		assert.deepStrictEqual({
			outcomes,
			steps,
			stored: ['stored', 'fresh', 'left-during-fit', 'left-before'].map(path => service.get(folder(path))?.source)
		}, {
			outcomes: ['restored', 'fitted', 'fitted', 'stale'],
			steps: ['restore stored 3,4@2', 'fit fresh', 'persist fresh', 'fit left-during-fit'],
			stored: ['user', 'auto', undefined, undefined]
		});
	});
});
