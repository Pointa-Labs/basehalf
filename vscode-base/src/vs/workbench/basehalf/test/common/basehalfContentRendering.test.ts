/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { BASEHALF_RENDERABLE_CONTENT_EXTENSIONS, baseHalfRenderableContentKind, isBaseHalfRenderableContentResource } from '../../common/basehalfContentRendering.js';

suite('BaseHalfContentRendering', () => {
	test('classifies the direct-render content matrix', () => {
		assert.deepStrictEqual([
			baseHalfRenderableContentKind(URI.file('/workspace/diagram.SVG')),
			baseHalfRenderableContentKind(URI.file('/workspace/textbook.pdf')),
			baseHalfRenderableContentKind(URI.file('/workspace/interview.flac')),
			baseHalfRenderableContentKind(URI.file('/workspace/demo.webm')),
			baseHalfRenderableContentKind(URI.file('/workspace/notes.md'))
		], ['image', 'pdf', 'audio', 'video', undefined]);
	});

	test('keeps the exported selector and classifier in lockstep', () => {
		assert.strictEqual(BASEHALF_RENDERABLE_CONTENT_EXTENSIONS.includes('.pdf'), true);
		for (const extension of BASEHALF_RENDERABLE_CONTENT_EXTENSIONS) {
			assert.strictEqual(isBaseHalfRenderableContentResource(URI.file(`/workspace/file${extension}`)), true);
		}
	});
});
