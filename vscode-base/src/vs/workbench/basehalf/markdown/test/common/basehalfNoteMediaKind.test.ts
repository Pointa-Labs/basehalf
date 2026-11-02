/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../../platform/protocol/common/basehalfMediaFiles.js';
import { baseHalfNoteMediaKind } from '../../common/basehalfNoteMediaKind.js';

suite('BaseHalfNoteMediaKind', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the kind of a file by the one list of media files', () => {
		for (const [kind, extensions] of [['image', BASEHALF_MEDIA_FILE_EXTENSIONS.image], ['video', BASEHALF_MEDIA_FILE_EXTENSIONS.video], ['audio', BASEHALF_MEDIA_FILE_EXTENSIONS.audio]] as const) {
			for (const extension of extensions) {
				assert.strictEqual(baseHalfNoteMediaKind(`file${extension}`), kind, extension);
				assert.strictEqual(baseHalfNoteMediaKind(`folder/FILE${extension.toUpperCase()}`), kind, extension);
			}
		}
		// A PDF and a book are files of the list too, but a note shows none of them as media.
		for (const extension of [...BASEHALF_MEDIA_FILE_EXTENSIONS.pdf, ...BASEHALF_MEDIA_FILE_EXTENSIONS.book, '.txt', '.md', '.html']) {
			assert.strictEqual(baseHalfNoteMediaKind(`file${extension}`), undefined, extension);
		}
	});

	test('reads .ogg and .oga as sounds', () => {
		assert.deepStrictEqual(['s.ogg', 's.oga', 'S.OGG', 'notes/s.oga'].map(baseHalfNoteMediaKind), ['audio', 'audio', 'audio', 'audio']);
	});

	test('reads the extension without ? and #, once decoded, without regard to case', () => {
		assert.deepStrictEqual([
			'clip.MP4?x=1#t',
			'sub/clip.MP4?x=1#t',
			'my%20clip.webm',
			'.bh/attachments/n/a.m4a',
			'pic.png',
			'https://example.com/v/clip.webm?token=a.png',
			'clip.mp4#t=10',
			'%E4%B8%AD%E6%96%87.mp3',
			'中文.mp3',
			'clip%2Emp4',
			'a.png.mp4',
			'a.mp4.png',
			'bad%zz.mov',
			'bad%E4.m4v'
		].map(baseHalfNoteMediaKind), ['video', 'video', 'video', 'audio', 'image', 'video', 'video', 'audio', 'audio', 'video', 'video', 'image', 'video', 'video']);
	});

	test('gives no kind to an address without a media extension', () => {
		assert.deepStrictEqual([
			'',
			'mp4',
			'.mp4',
			'folder/.mp4',
			'clip.mp4/',
			'clip.',
			'https://example.com/watch?v=clip.mp4',
			'clip.mp4%3Fx=1',
			'data:video/mp4;base64,AAAA',
			'notes.md'
		].map(baseHalfNoteMediaKind), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
	});
});
