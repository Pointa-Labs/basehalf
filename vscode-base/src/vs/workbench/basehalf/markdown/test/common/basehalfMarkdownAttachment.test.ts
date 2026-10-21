/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY,
	baseHalfAttachmentNameWithSuffix,
	baseHalfMarkdownAttachmentHref,
	normalizeBaseHalfAttachmentsDirectory,
	parseBaseHalfAttachmentsDirectory,
	sanitizeBaseHalfAttachmentName
} from '../../common/basehalfMarkdownAttachment.js';
import { BASEHALF_ATTACHMENTS_DIRECTORY_PATTERN } from '../../../shell/common/basehalfConfiguration.js';

suite('BaseHalfMarkdownAttachment', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Settings refuses exactly the attachments folders that the rule does not take', () => {
		// Settings compiles a setting's pattern with the u flag.
		const pattern = new RegExp(BASEHALF_ATTACHMENTS_DIRECTORY_PATTERN, 'u');
		const long = 'a'.repeat(160);
		const values = [
			'attachments', 'assets/notes', 'media/images/', '  media  ', '.\\media\\', './media', 'a\\b/c', '.hidden', '..twice', 'my files', '附件', '图片/2026',
			'console', 'com0', 'lpt10', 'nul-files', 'CONx/y', long, `${long}/b`,
			'', '   ', '.', '..', './', '././media', '../outside', 'a/../b', 'a/./b', '/absolute', '\\server', 'C:/files', 'course:files', 'a//b', 'a\\\\b',
			'course./files', 'trailing ', 'trailing./', 'CON', 'con.txt', 'Com1/x', 'x/LPT9.log', 'a\u0007b', 'what?', 'a*b', 'a<b', 'a|b', 'a"b', `${long}a`, `b/${long}a`
		];
		assert.deepStrictEqual(values.filter(value => pattern.test(value) !== (parseBaseHalfAttachmentsDirectory(value) !== undefined)), []);
		assert.deepStrictEqual(['media/images', '附件', '../outside', '/absolute', 'C:/files', 'CON'].map(value => pattern.test(value)), [true, true, false, false, false, false]);
	});

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
