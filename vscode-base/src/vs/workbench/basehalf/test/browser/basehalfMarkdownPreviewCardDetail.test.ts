/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfMarkdownPreviewBody } from '../../browser/cardDetail/basehalfMarkdownPreviewCardDetail.js';

suite('BaseHalfMarkdownPreviewCardDetail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('renders only the body while preserving YAML frontmatter in the source document', () => {
		const source = [
			'---\r\n',
			'title: Hidden metadata\r\n',
			'tags:\r\n',
			'  - canvas\r\n',
			'---\r\n',
			'# Visible heading\r\n',
			'\r\n',
			'Visible body.\r\n'
		].join('');

		assert.strictEqual(baseHalfMarkdownPreviewBody(source), '# Visible heading\r\n\r\nVisible body.\r\n');
		assert.strictEqual(source.startsWith('---\r\ntitle: Hidden metadata'), true);
	});

	test('does not hide ordinary thematic breaks or invalid frontmatter', () => {
		const thematicBreaks = '---\nordinary prose\n---\nbody\n';
		const unterminated = '---\ntitle: Still Markdown\nbody\n';

		assert.strictEqual(baseHalfMarkdownPreviewBody(thematicBreaks), thematicBreaks);
		assert.strictEqual(baseHalfMarkdownPreviewBody(unterminated), unterminated);
	});
});
