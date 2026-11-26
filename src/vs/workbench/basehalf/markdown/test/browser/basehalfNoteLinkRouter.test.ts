/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfOpenResourceOptions } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { openBaseHalfNoteLink } from '../../browser/basehalfNoteLinkRouter.js';

suite('BaseHalfNoteLinkRouter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a note\'s own file opens in its viewer over the note\'s canvas, or in the system\'s application for a kind without one', async () => {
		const opened: string[] = [];
		const services = {
			opener: { open: async (target: URI, options: { readonly openExternal?: boolean }) => { opened.push(`external ${target.path} ${options.openExternal}`); return true; } } as unknown as IOpenerService,
			files: { exists: async () => true } as unknown as IFileService,
			navigation: {
				state: { canvasFolder: { resource: URI.file('/workspace/notes') }, cardDetail: undefined },
				openResource: async (resource: URI, options: IBaseHalfOpenResourceOptions) => {
					opened.push(`viewer ${resource.path} over ${options.canvasFolder?.path ?? 'its own folder'}`);
					return { handled: false, reason: 'superseded' };
				},
			} as unknown as IBaseHalfCanvasNavigationService,
			workspace: { getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] }) } as unknown as IWorkspaceContextService,
			log: new NullLogService(),
		};
		const note = URI.file('/workspace/notes/week 1.md');

		for (const href of ['../.bh/attachments/7k3f9q2m1x/clip%202.mp4', '../.bh/attachments/7k3f9q2m1x/report.docx', '../.bh/attachments/7k3f9q2m1x/notes.md', 'handout.pdf']) {
			await openBaseHalfNoteLink(services, note, href);
		}

		assert.deepStrictEqual(opened, [
			'viewer /workspace/.bh/attachments/7k3f9q2m1x/clip 2.mp4 over /workspace/notes',
			'external /workspace/.bh/attachments/7k3f9q2m1x/report.docx true',
			'external /workspace/.bh/attachments/7k3f9q2m1x/notes.md true',
			'viewer /workspace/notes/handout.pdf over its own folder'
		]);
	});

	test('a note of a subfolder\'s window opens its files from the store above the window\'s folder, and nothing above it but the stores (files in notes, rule 48)', async () => {
		const opened: string[] = [];
		const services = {
			opener: { open: async (target: URI) => { opened.push(`external ${target.path}`); return true; } } as unknown as IOpenerService,
			files: { exists: async () => true } as unknown as IFileService,
			navigation: {
				state: { canvasFolder: { resource: URI.file('/workspace/notes') }, cardDetail: undefined },
				openResource: async (resource: URI) => {
					opened.push(`viewer ${resource.path}`);
					return { handled: false, reason: 'superseded' };
				},
			} as unknown as IBaseHalfCanvasNavigationService,
			workspace: { getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/notes') }] }) } as unknown as IWorkspaceContextService,
			log: new NullLogService(),
		};
		const note = URI.file('/workspace/notes/week 1.md');

		for (const href of ['../.bh/attachments/7k3f9q2m1x/handout.pdf', '../.bh/attachments/7k3f9q2m1x/report.docx', '../other.pdf']) {
			await openBaseHalfNoteLink(services, note, href);
		}

		assert.deepStrictEqual(opened, [
			'viewer /workspace/.bh/attachments/7k3f9q2m1x/handout.pdf',
			'external /workspace/.bh/attachments/7k3f9q2m1x/report.docx',
		]);
	});
});
