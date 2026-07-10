/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfEditorProjectionCanFlush, baseHalfStructuralEditorFlushOptions, BaseHalfEditorFlushFn, BaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';

suite('BaseHalfEditorFlushService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('structural flush serializes but never force-overwrites a newer disk edit', () => {
		assert.deepStrictEqual(baseHalfStructuralEditorFlushOptions('preview'), {
			forceSerialize: true,
			forceWrite: false,
			rejectOnError: true,
			activeProjection: 'preview'
		});
		assert.strictEqual(baseHalfEditorProjectionCanFlush('rich', true, baseHalfStructuralEditorFlushOptions('rich')), true);
		assert.strictEqual(baseHalfEditorProjectionCanFlush('rich', false, baseHalfStructuralEditorFlushOptions('source')), false);
		assert.strictEqual(baseHalfEditorProjectionCanFlush('source', false, baseHalfStructuralEditorFlushOptions('preview')), false);
		assert.strictEqual(baseHalfEditorProjectionCanFlush('preview', true, baseHalfStructuralEditorFlushOptions('preview')), true);
	});

	test('flushes a registered pane and unregisters it with disposal', async () => {
		const service = new BaseHalfEditorFlushService();
		const calls: unknown[] = [];
		const disposable = disposables.add(service.registerPaneFlusher('pane', async options => {
			calls.push(options);
			return true;
		}));

		assert.strictEqual(await service.flushPane('pane', { forceSerialize: true }), true);
		assert.deepStrictEqual(calls, [{ forceSerialize: true }]);

		disposable.dispose();
		assert.strictEqual(await service.flushPane('pane'), true);
		assert.deepStrictEqual(calls.length, 1);
	});

	test('a pane flush drains every registered surface', async () => {
		// The card detail retains one surface per projection of the open
		// document, so several flushers can be live on one pane at once.
		const service = new BaseHalfEditorFlushService();
		let firstCalls = 0;
		let secondCalls = 0;
		const first = service.registerPaneFlusher('pane', async () => {
			firstCalls++;
			return true;
		});
		const second = disposables.add(service.registerPaneFlusher('pane', async () => {
			secondCalls++;
			return true;
		}));

		assert.strictEqual(await service.flushPane('pane'), true);
		assert.strictEqual(firstCalls, 1);
		assert.strictEqual(secondCalls, 1);

		first.dispose();
		assert.strictEqual(await service.flushPane('pane'), true);
		assert.strictEqual(firstCalls, 1);
		assert.strictEqual(secondCalls, 2);

		second.dispose();
		assert.strictEqual(await service.flushPane('pane'), true);
		assert.strictEqual(secondCalls, 2);
	});

	test('cold Preview structural preflight owns shared TextModel save without hidden Source or Rich', async () => {
		const service = new BaseHalfEditorFlushService();
		const calls: string[] = [];
		disposables.add(service.registerPaneFlusher('pane', async options => {
			if (baseHalfEditorProjectionCanFlush('rich', false, options ?? {})) {
				calls.push('hidden-rich');
			}
			return true;
		}));
		disposables.add(service.registerPaneFlusher('pane', async options => {
			if (baseHalfEditorProjectionCanFlush('source', false, options ?? {})) {
				calls.push('hidden-source');
			}
			return true;
		}));
		disposables.add(service.registerPaneFlusher('pane', async options => {
			if (baseHalfEditorProjectionCanFlush('preview', true, options ?? {})) {
				calls.push('preview-shared-text-model-save');
			}
			return true;
		}));

		assert.strictEqual(await service.flushPane('pane', baseHalfStructuralEditorFlushOptions('preview')), true);
		assert.deepStrictEqual(calls, ['preview-shared-text-model-save']);
	});

	test('flushes every mounted view for a document and reports blockers', async () => {
		const service = new BaseHalfEditorFlushService();
		let ownerCalls = 0;
		let siblingCalls = 0;
		disposables.add(service.registerDocumentFlusher('doc', async () => {
			ownerCalls++;
			return true;
		}));
		disposables.add(service.registerDocumentFlusher('doc', async () => {
			siblingCalls++;
			return false;
		}));

		assert.strictEqual(await service.flushDocument('doc'), false);
		assert.strictEqual(ownerCalls, 1);
		assert.strictEqual(siblingCalls, 1);
		assert.strictEqual(await service.flushDocument('missing'), true);
	});

	test('flushAll runs unique flushers once across pane and document registries', async () => {
		const service = new BaseHalfEditorFlushService();
		let sharedCalls = 0;
		let docOnlyCalls = 0;
		const shared: BaseHalfEditorFlushFn = async options => {
			assert.deepStrictEqual(options, { forceWrite: true });
			sharedCalls++;
			return true;
		};
		disposables.add(service.registerPaneFlusher('pane', shared));
		disposables.add(service.registerDocumentFlusher('doc', shared));
		disposables.add(service.registerDocumentFlusher('doc', async options => {
			assert.deepStrictEqual(options, { forceWrite: true });
			docOnlyCalls++;
			return true;
		}));

		assert.strictEqual(await service.flushAll({ forceWrite: true }), true);
		assert.strictEqual(sharedCalls, 1);
		assert.strictEqual(docOnlyCalls, 1);
	});

	test('treats rejected flushers as torn-down non-blocking editors', async () => {
		const service = new BaseHalfEditorFlushService();
		disposables.add(service.registerPaneFlusher('pane', async () => {
			throw new Error('disposed');
		}));
		disposables.add(service.registerDocumentFlusher('doc', async () => {
			throw new Error('disposed');
		}));

		assert.strictEqual(await service.flushPane('pane'), true);
		assert.strictEqual(await service.flushDocument('doc'), true);
		assert.strictEqual(await service.flushAll(), true);
		assert.strictEqual(await service.flushPane('pane', { rejectOnError: true }), false);
		assert.strictEqual(await service.flushDocument('doc', { rejectOnError: true }), false);
	});
});
