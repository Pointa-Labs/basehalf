/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { BaseHalfCardProjectionRegistryService, DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, defaultBaseHalfCardDetailProjection, isBaseHalfMarkdownResource, isBaseHalfMediaResource, normalizeBaseHalfCardDetailProjection } from '../../common/basehalfCardDetail.js';

suite('BaseHalfCardDetail', () => {
	test('uses source as the fallback projection for non-Markdown files', () => {
		assert.strictEqual(DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, 'source');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/app.ts')), 'source');
	});

	test('uses rich editing as the Markdown default projection', () => {
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/README.md')), 'rich');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/docs/guide.markdown')), 'rich');
	});

	test('uses media as the default for supported local media', () => {
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/shot-01.mp4')), 'media');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/concept.webp')), 'media');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/textbook.pdf')), 'media');
		assert.strictEqual(isBaseHalfMediaResource(URI.file('/workspace/voice.ogg')), true);
		assert.strictEqual(isBaseHalfMediaResource(URI.file('/workspace/edit.mov')), false);
	});

	test('normalizes Markdown-only projections to Markdown resources only', () => {
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/README.md'), 'rich'), 'rich');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/README.md'), 'preview'), 'preview');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), 'rich'), 'source');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), 'preview'), 'source');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), undefined), 'source');
	});

	test('recognizes Markdown resources for card detail projections', () => {
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/README.md')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.markdown')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.txt')), false);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/md')), false);
	});

	test('registers domain projections without widening a core union', () => {
		const registry = new BaseHalfCardProjectionRegistryService();
		let changes = 0;
		const listener = registry.onDidChangeProjections(() => changes++);
		const registration = registry.registerProjection({
			id: 'ai-video.storyboard',
			label: 'Storyboard',
			icon: 'codicon-layout',
			selector: { extensions: ['.story'] },
			order: 400,
			defaultPriority: 300
		});

		const resource = URI.file('/workspace/episode.story');
		assert.deepStrictEqual(registry.getProjections(resource).map(projection => projection.id), ['ai-video.storyboard', 'source']);
		assert.strictEqual(registry.defaultProjection(resource), 'ai-video.storyboard');
		assert.strictEqual(registry.normalizeProjection(resource, 'ai-video.storyboard'), 'ai-video.storyboard');
		assert.strictEqual(registry.normalizeProjection(URI.file('/workspace/episode.md'), 'ai-video.storyboard'), 'rich');
		assert.strictEqual(changes, 1);

		registration.dispose();
		assert.strictEqual(registry.defaultProjection(resource), 'source');
		assert.strictEqual(changes, 2);
		listener.dispose();
		registry.dispose();
	});

	test('rejects duplicate projection identifiers', () => {
		const registry = new BaseHalfCardProjectionRegistryService();
		assert.throws(() => registry.registerProjection({
			id: 'source',
			label: 'Other source',
			icon: 'codicon-code',
			order: 1
		}), /already registered/);
		registry.dispose();
	});
});
