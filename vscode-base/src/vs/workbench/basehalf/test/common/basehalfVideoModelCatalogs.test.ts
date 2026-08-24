/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BaseHalfVideoModelCatalogService } from '../../common/basehalfVideoModelCatalogs.js';

suite('BaseHalfVideoModelCatalogs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('aggregates admitted catalog resources and removes their models on dispose', () => {
		const service = new BaseHalfVideoModelCatalogService();
		try {
			const registration = service.registerCatalog('pointa.video', 'pointa.video.official', catalog('model-a'));
			assert.deepStrictEqual(service.getRegistry().models.map(model => model.key.modelId), ['model-a']);
			assert.strictEqual(service.getRegistry().resolve({
				provider: 'provider',
				deployment: 'deployment',
				region: 'global',
				modelId: 'model-a',
				revision: '2026-08-16',
				mode: 'text-to-video',
				inputs: { 'text-prompt': 1 }
			}).status, 'supported');
			registration.dispose();
			assert.deepStrictEqual(service.getRegistry().models, []);
		} finally {
			service.dispose();
		}
	});

	test('keeps duplicate reviewed models isolated by catalog owner', () => {
		const service = new BaseHalfVideoModelCatalogService();
		try {
			const first = service.registerCatalog('pointa.video', 'pointa.video.first', catalog('model-a'));
			const second = service.registerCatalog('community.video', 'community.video.second', catalog('model-a'));
			assert.deepStrictEqual(service.getRegistry().models.map(model => model.key.modelId), ['model-a']);
			assert.deepStrictEqual(service.getRegistry('pointa.video.first', 'pointa.video').models.map(model => model.key.modelId), ['model-a']);
			assert.deepStrictEqual(service.getRegistry('community.video.second', 'community.video').models.map(model => model.key.modelId), ['model-a']);
			first.dispose();
			assert.deepStrictEqual(service.getRegistry().models.map(model => model.key.modelId), ['model-a']);
			second.dispose();
			assert.deepStrictEqual(service.getRegistry().models, []);
		} finally {
			service.dispose();
		}
	});

	test('returns only an exact catalog whose owner matches', () => {
		const service = new BaseHalfVideoModelCatalogService();
		try {
			const first = service.registerCatalog('pointa.video', 'pointa.video.official', catalog('model-a'));
			const second = service.registerCatalog('community.video', 'community.video.official', catalog('model-b'));
			assert.deepStrictEqual(service.getRegistry().models.map(model => model.key.modelId), ['model-a', 'model-b']);
			assert.deepStrictEqual(service.getRegistry('pointa.video.official', 'pointa.video').models.map(model => model.key.modelId), ['model-a']);
			assert.deepStrictEqual(service.getRegistry('community.video.official', 'community.video').models.map(model => model.key.modelId), ['model-b']);
			assert.deepStrictEqual(service.getRegistry('pointa.video.official', 'community.video').models, []);
			assert.deepStrictEqual(service.getRegistry('pointa.video.missing', 'pointa.video').models, []);
			second.dispose();
			first.dispose();
		} finally {
			service.dispose();
		}
	});

	test('does not apply a per-catalog model limit to the host-global connection projection', () => {
		const service = new BaseHalfVideoModelCatalogService();
		try {
			const first = service.registerCatalog('pointa.video', 'pointa.video.large', catalogRange('pointa', 129));
			const second = service.registerCatalog('community.video', 'community.video.large', catalogRange('community', 129));
			assert.strictEqual(service.getRegistry().models.length, 258);
			assert.strictEqual(service.getRegistry('pointa.video.large', 'pointa.video').models.length, 129);
			assert.strictEqual(service.getRegistry('community.video.large', 'community.video').models.length, 129);
			second.dispose();
			first.dispose();
		} finally {
			service.dispose();
		}
	});
});

function catalog(modelId: string): unknown {
	return {
		schemaVersion: 1,
		models: [{
			key: {
				provider: 'provider',
				deployment: 'deployment',
				region: 'global',
				modelId,
				revision: '2026-08-16'
			},
			label: modelId,
			source: { url: 'https://example.com/models', verifiedAt: '2026-08-16' },
			modes: [{
				mode: 'text-to-video',
				inputs: [{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 16_000 }],
				parameters: []
			}]
		}]
	};
}

function catalogRange(prefix: string, count: number): unknown {
	return {
		schemaVersion: 1,
		models: Array.from({ length: count }, (_, index) => ({
			key: {
				provider: 'provider',
				deployment: 'deployment',
				region: 'global',
				modelId: `${prefix}-${index}`,
				revision: '2026-08-16'
			},
			label: `${prefix}-${index}`,
			source: { url: 'https://example.com/models', verifiedAt: '2026-08-16' },
			modes: [{
				mode: 'text-to-video',
				inputs: [{ kind: 'text-prompt', minItems: 1, maxItems: 1, maxCharacters: 16_000 }],
				parameters: []
			}]
		}))
	};
}
