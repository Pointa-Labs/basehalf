/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfNoteLinkTarget, baseHalfNoteHeadingLine, baseHalfNoteLinkHref, resolveBaseHalfNoteLink } from '../../common/basehalfNoteLinks.js';

suite('BaseHalfNoteLinks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const note = URI.file('/ws/notes/note.md');
	const folders = [URI.file('/ws')];
	const resolve = (href: string): unknown => {
		const target: BaseHalfNoteLinkTarget = resolveBaseHalfNoteLink(note, folders, href);
		switch (target.kind) {
			case 'web':
				return { web: target.address };
			case 'file':
				return target.heading ? { file: target.uri.path, heading: target.heading } : { file: target.uri.path };
			case 'heading':
				return { heading: target.heading };
			default:
				return 'none';
		}
	};

	test('a path is read once from the note\'s folder (note formats, rule 55)', () => {
		assert.deepStrictEqual([
			'my%20file.md',
			'my file.md',
			'other.md#part-two',
			'other.md?x=1',
			'%E4%B8%AD.md',
			'中.md',
			'../x.md',
			'/ws/notes/x.md',
			'.bh/attachments/n/x%20y.pdf',
			'100%25.md',
			'100%.md',
			'file:///ws/notes/my%20file.md#top',
		].map(resolve), [
			{ file: '/ws/notes/my file.md' },
			{ file: '/ws/notes/my file.md' },
			{ file: '/ws/notes/other.md', heading: 'part-two' },
			{ file: '/ws/notes/other.md' },
			{ file: '/ws/notes/中.md' },
			{ file: '/ws/notes/中.md' },
			{ file: '/ws/x.md' },
			{ file: '/ws/notes/x.md' },
			{ file: '/ws/notes/.bh/attachments/n/x y.pdf' },
			{ file: '/ws/notes/100%.md' },
			{ file: '/ws/notes/100%.md' },
			{ file: '/ws/notes/my file.md', heading: 'top' },
		]);
	});

	test('web addresses are the web\'s, headings the note\'s, and anything else goes nowhere (rule 53)', () => {
		assert.deepStrictEqual([
			'https://example.com/a?b=c#d',
			'mailto:someone@example.com',
			'#setup',
			'note.md#setup',
			'command:workbench.action.quit',
			'javascript:alert(1)',
			'%2F..%2F..%2Fetc%2Fpasswd',
			'../../outside.md',
			'/etc/passwd',
			'',
			'   ',
			'?only',
		].map(resolve), [
			{ web: 'https://example.com/a?b=c#d' },
			{ web: 'mailto:someone@example.com' },
			{ heading: 'setup' },
			{ heading: 'setup' },
			'none',
			'none',
			'none',
			'none',
			'none',
			'none',
			'none',
			'none',
		]);
	});

	test('a drawn link holds the absolute address of what its path names, read once', () => {
		assert.deepStrictEqual([
			baseHalfNoteLinkHref(note, 'my%20file.md'),
			baseHalfNoteLinkHref(note, 'other.md#part'),
			baseHalfNoteLinkHref(note, 'https://example.com'),
			baseHalfNoteLinkHref(note, '#setup'),
			baseHalfNoteLinkHref(note, '#%E4%B8%AD'),
			baseHalfNoteLinkHref(note, '?only'),
		].map(href => href.startsWith('file:') ? URI.parse(href).path + (URI.parse(href).fragment ? `#${URI.parse(href).fragment}` : '') : href), [
			'/ws/notes/my file.md',
			'/ws/notes/other.md#part',
			'https://example.com',
			'/ws/notes/note.md#setup',
			'/ws/notes/note.md#中',
			'?only',
		]);
		// Read back by the resolver, a drawn address goes where the written one does.
		assert.deepStrictEqual(['my%20file.md', 'other.md#part', '#setup'].map(href => resolve(baseHalfNoteLinkHref(note, href))), [
			{ file: '/ws/notes/my file.md' },
			{ file: '/ws/notes/other.md', heading: 'part' },
			{ heading: 'setup' },
		]);
	});

	test('a heading is found by its slug, counted over the note\'s headings in order (rule 56)', () => {
		const content = '---\ntitle: x\n---\n# Setup\n\ntext\n\n## Setup\n\n### 中文 标题!\n\n## Set up\n';
		assert.deepStrictEqual([
			baseHalfNoteHeadingLine(content, 'setup'),
			baseHalfNoteHeadingLine(content, 'setup-1'),
			baseHalfNoteHeadingLine(content, '中文-标题'),
			baseHalfNoteHeadingLine(content, 'set-up'),
			baseHalfNoteHeadingLine(content, 'Setup'),
			baseHalfNoteHeadingLine(content, 'missing'),
		], [4, 8, 10, 12, 4, undefined]);
		// The slug is of the text the heading shows, without marks and addresses.
		const marked = '# **Bold** [part](other.md) `x` &amp; y\n';
		assert.deepStrictEqual([baseHalfNoteHeadingLine(marked, 'bold-part-x--y'), baseHalfNoteHeadingLine(marked, 'bold-partothermd-x-amp-y')], [1, undefined]);
	});
});
