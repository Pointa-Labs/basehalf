/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfModelConnectionNavigationService,
	completeCapturedBaseHalfModelConnectionRequest
} from '../../common/basehalfModelConnectionNavigation.js';

suite('BaseHalfModelConnectionNavigation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps one transient exact return intent and completes it only for its provider spec', () => {
		const service = new BaseHalfModelConnectionNavigationService();
		const changes: Array<string | undefined> = [];
		const completions: string[] = [];
		const changeListener = service.onDidChangeIntent(intent => changes.push(intent?.requestId));
		const completionListener = service.onDidComplete(completion => completions.push(completion.serviceId));
		const target = {
			kind: 'videoModel' as const,
			sceneKey: 'workspace:file:///project',
			nodePath: 'clip.bhnode',
			documentId: 'clip-document',
			recipeId: 'pointa.basehalf-ai-video.generate-video',
			catalogId: 'pointa.basehalf-ai-video.official-models',
			modelKey: {
				provider: 'byteplus',
				deployment: 'modelark',
				region: 'global',
				modelId: 'dreamina-seedance-2-0-mini-260615',
				revision: '2026-06-15'
			}
		};

		const intent = service.begin('  POINTA.BASEHALF-AI-VIDEO.BYTEPLUS-MODELARK  ', target);
		assert.strictEqual(intent.specId, 'pointa.basehalf-ai-video.byteplus-modelark');
		assert.notStrictEqual(intent.returnTarget, target);
		assert.ok(Object.isFrozen(intent));
		assert.ok(Object.isFrozen(intent.returnTarget));
		assert.ok(Object.isFrozen(intent.returnTarget?.modelKey));
		assert.strictEqual(service.completeRequest(intent.requestId, 'pointa.test.other', intent.specId), false);
		assert.strictEqual(service.completeRequest(intent.requestId, intent.specId, 'pointa.test.other'), false);
		assert.strictEqual(service.intent, intent);
		assert.strictEqual(service.completeRequest(intent.requestId, intent.specId, intent.specId), true);
		assert.strictEqual(service.intent, undefined);
		assert.deepStrictEqual(changes, [intent.requestId, undefined]);
		assert.deepStrictEqual(completions, [intent.specId]);

		completionListener.dispose();
		changeListener.dispose();
		service.dispose();
	});

	test('supersedes stale trips and lets only the current request cancel itself', () => {
		const service = new BaseHalfModelConnectionNavigationService();
		const first = service.begin('pointa.basehalf-ai-video.byteplus-modelark');
		const second = service.begin('pointa.basehalf-ai-video.minimax-international');
		assert.notStrictEqual(first.requestId, second.requestId);
		assert.strictEqual(service.cancel(first.requestId), false);
		assert.strictEqual(service.intent, second);
		assert.strictEqual(service.cancel(second.requestId), true);
		assert.strictEqual(service.intent, undefined);
		service.dispose();
	});

	test('rejects a stale completion when a same-provider trip supersedes it', () => {
		const service = new BaseHalfModelConnectionNavigationService();
		const first = service.begin('pointa.basehalf-ai-video.byteplus-modelark');
		const capturedRequestId = first.requestId;
		const second = service.begin('pointa.basehalf-ai-video.byteplus-modelark');
		assert.strictEqual(completeCapturedBaseHalfModelConnectionRequest(service, capturedRequestId, first.specId, first.specId), false);
		assert.strictEqual(service.intent, second);
		assert.strictEqual(completeCapturedBaseHalfModelConnectionRequest(service, undefined, second.specId, second.specId), false);
		assert.strictEqual(service.intent, second);
		assert.strictEqual(service.completeRequest(first.requestId, second.specId, second.specId), false);
		assert.strictEqual(service.intent, second);
		assert.strictEqual(completeCapturedBaseHalfModelConnectionRequest(service, second.requestId, second.specId, second.specId), true);
		assert.strictEqual(service.intent, undefined);
		service.dispose();
	});
});
