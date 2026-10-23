/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_WINDOW_MEDIA_FILE_EXTENSIONS } from '../../../../../platform/protocol/common/basehalfMediaFiles.js';
import { BASEHALF_RENDERABLE_CONTENT_EXTENSIONS, baseHalfRenderableContentKind, isBaseHalfRenderableContentResource } from '../../common/basehalfContentRendering.js';

suite('BaseHalfContentRendering', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies the direct-render content matrix', () => {
		assert.deepStrictEqual(
			['diagram.SVG', 'textbook.pdf', 'interview.flac', 'take.wav', 'demo.webm', 'take.mov', 'take.M4V', 'take.mkv', 'notes.md']
				.map(name => baseHalfRenderableContentKind(URI.file(`/workspace/${name}`))),
			['image', 'pdf', 'audio', 'audio', 'video', 'video', 'video', 'video', undefined]
		);
	});

	test('the window loads every image, sound, and video that a card and Card Detail show; a PDF draws in a page of its own', () => {
		assert.deepStrictEqual(BASEHALF_RENDERABLE_CONTENT_EXTENSIONS.filter(extension => !BASEHALF_WINDOW_MEDIA_FILE_EXTENSIONS.includes(extension)), ['.pdf']);
	});

	test('keeps the exported selector and classifier in lockstep', () => {
		assert.strictEqual(BASEHALF_RENDERABLE_CONTENT_EXTENSIONS.includes('.pdf'), true);
		for (const extension of BASEHALF_RENDERABLE_CONTENT_EXTENSIONS) {
			assert.strictEqual(isBaseHalfRenderableContentResource(URI.file(`/workspace/file${extension}`)), true);
		}
	});
});
