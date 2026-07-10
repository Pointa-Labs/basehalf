/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileOperation, IFileDeleteOptions } from '../../../../platform/files/common/files.js';
import { workbenchInstantiationService, TestServiceAccessor } from '../../../test/browser/workbenchTestServices.js';
import { TestFileService } from '../../../test/common/workbenchTestServices.js';
import { MainThreadFileSystem } from '../../browser/mainThreadFileSystem.js';
import { AnyCallRPCProtocol } from '../common/testRPCProtocol.js';

class TrackingFileService extends TestFileService {

	lastMove: { source: URI; target: URI; overwrite: boolean | undefined } | undefined;
	lastDelete: { resource: URI; options: Partial<IFileDeleteOptions> | undefined } | undefined;

	override async move(source: URI, target: URI, overwrite?: boolean) {
		this.lastMove = { source, target, overwrite };
		return super.move(source, target, overwrite);
	}

	override async del(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<void> {
		this.lastDelete = { resource, options };
		return super.del(resource, options);
	}
}

suite('MainThreadFileSystem', () => {

	const disposables = new DisposableStore();
	let accessor: TestServiceAccessor;
	let fileService: TrackingFileService;
	let mainThreadFileSystem: MainThreadFileSystem;

	setup(() => {
		fileService = disposables.add(new TrackingFileService());
		const instantiationService = workbenchInstantiationService({ fileService: () => fileService }, disposables);
		accessor = instantiationService.createInstance(TestServiceAccessor);
		mainThreadFileSystem = disposables.add(instantiationService.createInstance(MainThreadFileSystem, AnyCallRPCProtocol()));
	});

	teardown(() => disposables.clear());

	ensureNoDisposablesAreLeakedInTestSuite();

	test('workspace.fs.rename runs through the working-copy file lifecycle', async () => {
		const source = URI.file('/workspace/source.md');
		const target = URI.file('/workspace/target.md');
		const phases: string[] = [];
		let willCorrelationId: number | undefined;

		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(event => {
			phases.push('will');
			willCorrelationId = event.correlationId;
			assert.strictEqual(event.operation, FileOperation.MOVE);
			assert.strictEqual(event.files[0].source?.toString(), source.toString());
			assert.strictEqual(event.files[0].target.toString(), target.toString());
		}));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			phases.push('did');
			assert.strictEqual(event.correlationId, willCorrelationId);
		}));

		await mainThreadFileSystem.$rename(source, target, { overwrite: true });

		assert.deepStrictEqual(phases, ['will', 'did']);
		assert.strictEqual(fileService.lastMove?.source.toString(), source.toString());
		assert.strictEqual(fileService.lastMove?.target.toString(), target.toString());
		assert.strictEqual(fileService.lastMove?.overwrite, true);
	});

	test('workspace.fs.delete runs through the working-copy file lifecycle', async () => {
		const resource = URI.file('/workspace/deleted');
		const phases: string[] = [];
		let willCorrelationId: number | undefined;

		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(event => {
			phases.push('will');
			willCorrelationId = event.correlationId;
			assert.strictEqual(event.operation, FileOperation.DELETE);
			assert.strictEqual(event.files[0].source, undefined);
			assert.strictEqual(event.files[0].target.toString(), resource.toString());
		}));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			phases.push('did');
			assert.strictEqual(event.correlationId, willCorrelationId);
		}));

		await mainThreadFileSystem.$delete(resource, { recursive: true, useTrash: false, atomic: { postfix: '.basehalf-delete' } });

		assert.deepStrictEqual(phases, ['will', 'did']);
		assert.strictEqual(fileService.lastDelete?.resource.toString(), resource.toString());
		assert.deepStrictEqual(fileService.lastDelete?.options, { recursive: true, useTrash: false, atomic: { postfix: '.basehalf-delete' } });
	});
});
