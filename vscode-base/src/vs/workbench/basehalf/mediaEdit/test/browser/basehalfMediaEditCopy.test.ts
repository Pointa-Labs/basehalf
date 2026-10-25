/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { copyBaseHalfMediaEdits } from '../../browser/basehalfMediaEditCopy.js';

const WORKSPACE = URI.file('/workspace');
const RECORD = 'original: "original.mp4"\nresult:\n  size: 9\n  hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"\nkeep:\n  - start: 1\n    end: 2\n';

suite('BaseHalfMediaEditCopy', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function setUp(files: Record<string, string>) {
		const store = disposables.add(new DisposableStore());
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		for (const [path, text] of Object.entries(files)) {
			await fileService.writeFile(joinPath(WORKSPACE, ...path.split('/')), VSBuffer.fromString(text));
		}
		const cloned: string[] = [];
		const fileClonesService: IBaseHalfFileClonesService = {
			_serviceBrand: undefined,
			clone: async (source, target) => {
				cloned.push(target.path.slice(WORKSPACE.path.length + 1));
				await fileService.copy(source, target, false);
			}
		};
		const services = {
			fileService,
			fileClonesService,
			workspaceContextService: new TestContextService(testWorkspace(WORKSPACE)),
			uriIdentityService: store.add(new UriIdentityService(fileService)),
			logService: new NullLogService()
		};
		const text = async (path: string) => (await fileService.readFile(joinPath(WORKSPACE, ...path.split('/'))).catch(() => undefined))?.value.toString();
		return { services, cloned, text };
	}

	const pair = (source: string, target: string) => ({ source: joinPath(WORKSPACE, ...source.split('/')), target: joinPath(WORKSPACE, ...target.split('/')) });

	test('a copy of an edited file, alone or in a copied folder, gets a clone of the original and the record; a copy with a record keeps it (D84)', async () => {
		const { services, cloned, text } = await setUp({
			'.bh/mirror/shots/shot.mp4/edit.yaml': RECORD,
			'.bh/mirror/shots/shot.mp4/original.mp4': 'the video',
			'.bh/mirror/shots/take.mp4/edit.yaml': '<<<<<<< HEAD\n',
			'.bh/mirror/kept/shot.mp4/edit.yaml': 'original: "original.mp4"\n'
		});
		const failed = await copyBaseHalfMediaEdits(services, [pair('shots', 'shots copy'), pair('shots/shot.mp4', 'shots/shot copy.mp4'), pair('shots/shot.mp4', 'kept/shot.mp4')]);
		assert.deepStrictEqual({
			failed,
			cloned,
			copy: [await text('.bh/mirror/shots/shot copy.mp4/edit.yaml'), await text('.bh/mirror/shots/shot copy.mp4/original.mp4')],
			inFolder: [await text('.bh/mirror/shots copy/shot.mp4/edit.yaml'), await text('.bh/mirror/shots copy/shot.mp4/original.mp4')],
			// A record that cannot be read is of no edit a copy could revert; a record already there stays.
			unreadable: await text('.bh/mirror/shots copy/take.mp4/edit.yaml'),
			kept: [await text('.bh/mirror/kept/shot.mp4/edit.yaml'), await text('.bh/mirror/kept/shot.mp4/original.mp4')]
		}, {
			failed: [],
			cloned: ['.bh/mirror/shots copy/shot.mp4/original.mp4', '.bh/mirror/shots/shot copy.mp4/original.mp4'],
			copy: [RECORD, 'the video'],
			inFolder: [RECORD, 'the video'],
			unreadable: undefined,
			kept: ['original: "original.mp4"\n', undefined]
		});
	});
});
