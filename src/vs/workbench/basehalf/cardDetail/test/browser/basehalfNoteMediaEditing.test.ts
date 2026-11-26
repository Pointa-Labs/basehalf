/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfMirrorResource } from '../../../workspace/common/basehalfMirrorTree.js';
import { baseHalfNoteMediaFile } from '../../browser/basehalfNoteMediaEditing.js';

suite('BaseHalfNoteMediaEditing', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a picture of a note is edited as a file of its workspace folder, or of the store above a subfolder\'s window, with its record in that store\'s home (files in notes, rule 48)', () => {
		const shown = (folders: readonly URI[], note: URI, href: string) => {
			const file = baseHalfNoteMediaFile(folders, note, href);
			return file && {
				resource: file.resource.path,
				folder: file.workspaceFolder.path,
				path: file.relativePath,
				record: baseHalfMirrorResource(file.workspaceFolder, file.relativePath, 'edit.yaml').path,
			};
		};
		const workspace = URI.file('/notes');
		const subfolder = URI.file('/notes/reading');
		assert.deepStrictEqual({
			inTheWorkspace: shown([workspace], URI.file('/notes/reading/week 1.md'), '../.bh/attachments/7k3f9q2m1x/photo%202.png'),
			aboveTheWindow: shown([subfolder], URI.file('/notes/reading/week 1.md'), '../.bh/attachments/7k3f9q2m1x/photo%202.png'),
			besideTheStore: shown([subfolder], URI.file('/notes/reading/week 1.md'), '../photo.png'),
			onTheWeb: shown([subfolder], URI.file('/notes/reading/week 1.md'), 'https://example.com/photo.png'),
		}, {
			inTheWorkspace: {
				resource: '/notes/.bh/attachments/7k3f9q2m1x/photo 2.png',
				folder: '/notes',
				path: '.bh/attachments/7k3f9q2m1x/photo 2.png',
				record: '/notes/.bh/mirror/.bh/attachments/7k3f9q2m1x/photo 2.png/edit.yaml',
			},
			aboveTheWindow: {
				resource: '/notes/.bh/attachments/7k3f9q2m1x/photo 2.png',
				folder: '/notes',
				path: '.bh/attachments/7k3f9q2m1x/photo 2.png',
				record: '/notes/.bh/mirror/.bh/attachments/7k3f9q2m1x/photo 2.png/edit.yaml',
			},
			besideTheStore: undefined,
			onTheWeb: undefined,
		});
	});
});
