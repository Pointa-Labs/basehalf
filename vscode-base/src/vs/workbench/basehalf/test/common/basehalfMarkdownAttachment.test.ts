/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
	baseHalfAttachmentNameWithSuffix,
	baseHalfMarkdownAttachmentHref,
	normalizeBaseHalfAttachmentsDirectory,
	sanitizeBaseHalfAttachmentName
} from '../../common/basehalfMarkdownAttachment.js';

suite('BaseHalfMarkdownAttachment', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes a workspace-owned relative attachment directory', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfAttachmentsDirectory('assets/notes'),
			normalizeBaseHalfAttachmentsDirectory('.\\media\\'),
			normalizeBaseHalfAttachmentsDirectory('../outside'),
			normalizeBaseHalfAttachmentsDirectory('/absolute'),
			normalizeBaseHalfAttachmentsDirectory('CON/assets'),
			normalizeBaseHalfAttachmentsDirectory('course:files'),
			normalizeBaseHalfAttachmentsDirectory('course./files'),
			normalizeBaseHalfAttachmentsDirectory('')
		], [
			'assets/notes',
			'media',
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
			BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY
		]);
	});

	test('sanitizes cross-platform names and adds collision suffixes', () => {
		assert.deepStrictEqual([
			sanitizeBaseHalfAttachmentName('  course:notes?.pdf  '),
			sanitizeBaseHalfAttachmentName('CON.txt'),
			sanitizeBaseHalfAttachmentName('..'),
			baseHalfAttachmentNameWithSuffix('diagram.final.png', 2)
		], ['course-notes-.pdf', '_CON.txt', 'attachment', 'diagram.final-2.png']);
	});

	test('returns a Markdown-safe document-relative href', () => {
		assert.strictEqual(
			baseHalfMarkdownAttachmentHref(
				URI.file('/workspace/notes/week-1.md'),
				URI.file('/workspace/notes/attachments/lecture #1.pdf')
			),
			'attachments/lecture%20%231.pdf'
		);
	});
});
