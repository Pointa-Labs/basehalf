/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TextFileEditorModel } from '../../../textfile/common/textFileEditorModel.js';
import { TextFileEditorModelManager } from '../../../textfile/common/textFileEditorModelManager.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ensureNoDisposablesAreLeakedInTestSuite, toResource } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService, TestServiceAccessor, ITestTextFileEditorModelManager } from '../../../../test/browser/workbenchTestServices.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileOperation } from '../../../../../platform/files/common/files.js';
import { TestWorkingCopy } from '../../../../test/common/workbenchTestServices.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ICopyOperation, SourceTargetPair } from '../../common/workingCopyFileService.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { UndoRedoGroup } from '../../../../../platform/undoRedo/common/undoRedo.js';

suite('WorkingCopyFileService', () => {

	const disposables = new DisposableStore();
	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		accessor = instantiationService.createInstance(TestServiceAccessor);
		disposables.add(<TextFileEditorModelManager>accessor.textFileService.files);
	});

	teardown(() => {
		disposables.clear();
	});

	test('create - dirty file', async function () {
		await testCreate(toResource.call(this, '/path/file.txt'), VSBuffer.fromString('Hello World'));
	});

	test('delete - dirty file', async function () {
		await testDelete([toResource.call(this, '/path/file.txt')]);
	});

	test('delete multiple - dirty files', async function () {
		await testDelete([
			toResource.call(this, '/path/file1.txt'),
			toResource.call(this, '/path/file2.txt'),
			toResource.call(this, '/path/file3.txt'),
			toResource.call(this, '/path/file4.txt')]);
	});

	test('move - dirty file', async function () {
		await testMoveOrCopy([{ source: toResource.call(this, '/path/file.txt'), target: toResource.call(this, '/path/file_target.txt') }], true);
	});

	test('move - source identical to target', async function () {
		const sourceModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel.resource, sourceModel);

		const eventCounter = await testEventsMoveOrCopy([{ file: { source: sourceModel.resource, target: sourceModel.resource }, overwrite: true }], true);

		sourceModel.dispose();
		assert.strictEqual(eventCounter, 3);
	});

	test('move - one source == target and another source != target', async function () {
		const sourceModel1: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file1.txt'), 'utf8', undefined);
		const sourceModel2: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file2.txt'), 'utf8', undefined);
		const targetModel2: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file_target2.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel1.resource, sourceModel1);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel2.resource, sourceModel2);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(targetModel2.resource, targetModel2);

		const eventCounter = await testEventsMoveOrCopy([
			{ file: { source: sourceModel1.resource, target: sourceModel1.resource }, overwrite: true },
			{ file: { source: sourceModel2.resource, target: targetModel2.resource }, overwrite: true }
		], true);

		sourceModel1.dispose();
		sourceModel2.dispose();
		targetModel2.dispose();
		assert.strictEqual(eventCounter, 3);
	});

	test('move multiple - dirty file', async function () {
		await testMoveOrCopy([
			{ source: toResource.call(this, '/path/file1.txt'), target: toResource.call(this, '/path/file1_target.txt') },
			{ source: toResource.call(this, '/path/file2.txt'), target: toResource.call(this, '/path/file2_target.txt') }],
			true);
	});

	test('move failure reports the exact completed prefix', async function () {
		const first = { source: toResource.call(this, '/path/first.txt'), target: toResource.call(this, '/path/first-moved.txt') };
		const second = { source: toResource.call(this, '/path/second.txt'), target: toResource.call(this, '/path/second-moved.txt') };
		const originalMove = accessor.fileService.move;
		let calls = 0;
		accessor.fileService.move = async (source, target, overwrite) => {
			if (calls++ === 1) {
				throw new Error('second move failed');
			}
			return originalMove.call(accessor.fileService, source, target, overwrite);
		};
		let completed: readonly { readonly source?: URI; readonly target: URI }[] | undefined;
		let willSnapshotLength = -1;
		let willSnapshot: SourceTargetPair[] | undefined;
		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.MOVE) {
				willSnapshotLength = event.completedFiles.length;
				willSnapshot = event.completedFiles as SourceTargetPair[];
				// A hostile/stale listener can mutate its own phase snapshot, but it
				// must not corrupt the service's durable-prefix accounting.
				willSnapshot.push(second);
			}
		}));
		disposables.add(accessor.workingCopyFileService.onDidFailWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.MOVE) {
				completed = [...event.completedFiles];
			}
		}));

		await assert.rejects(accessor.workingCopyFileService.move([
			{ file: first },
			{ file: second }
		], CancellationToken.None));
		assert.strictEqual(willSnapshotLength, 0);
		assert.deepStrictEqual(completed?.map(file => [file.source?.toString(), file.target.toString()]), [[first.source.toString(), first.target.toString()]]);
	});

	test('hard preconditions run after ordinary participants and before will/IO', async function () {
		const source = toResource.call(this, '/path/precondition.txt');
		const target = toResource.call(this, '/path/precondition-moved.txt');
		const order: string[] = [];
		let guarded = false;
		const originalMove = accessor.fileService.move;
		accessor.fileService.move = async (from, to, overwrite) => {
			assert.strictEqual(guarded, true);
			order.push('io');
			return originalMove.call(accessor.fileService, from, to, overwrite);
		};
		disposables.add(accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async () => { order.push('participant'); }
		}));
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async () => {
				guarded = true;
				order.push('precondition');
				return { dispose: () => { guarded = false; order.push('release'); } };
			}
		}));
		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(() => { assert.strictEqual(guarded, true); order.push('will'); }));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			assert.strictEqual(guarded, true);
			order.push('did');
			event.waitUntil(Promise.resolve().then(() => { assert.strictEqual(guarded, true); order.push('did:wait'); }));
		}));

		await accessor.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None);
		assert.strictEqual(guarded, false);
		assert.deepStrictEqual(order, ['participant', 'precondition', 'will', 'io', 'did', 'did:wait', 'release']);
	});

	test('passes the caller owned undo group object to hard preconditions', async function () {
		const source = toResource.call(this, '/path/group-source.txt');
		const target = toResource.call(this, '/path/group-target.txt');
		await accessor.fileService.createFile(source);
		const group = new UndoRedoGroup();
		let observed = false;
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation, undoInfo) => {
				if (operation === FileOperation.MOVE) {
					assert.strictEqual(undoInfo?.undoRedoGroupId, group.id);
					assert.strictEqual(undoInfo?.undoRedoGroup, group);
					observed = true;
				}
				return { dispose: () => undefined };
			}
		}));

		await accessor.workingCopyFileService.move(
			[{ file: { source, target } }],
			CancellationToken.None,
			{ undoRedoGroupId: group.id, undoRedoGroup: group }
		);
		assert.strictEqual(observed, true);
	});

	test('hard precondition rejection prevents move and delete IO', async function () {
		const source = toResource.call(this, '/path/veto.txt');
		const target = toResource.call(this, '/path/veto-moved.txt');
		let ioCalls = 0;
		let willCalls = 0;
		let guardReleases = 0;
		accessor.fileService.move = async () => {
			ioCalls++;
			throw new Error('move IO must not run');
		};
		accessor.fileService.del = async () => {
			ioCalls++;
		};
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async () => ({ dispose: () => guardReleases++ })
		}));
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async () => { throw new Error('save refused'); }
		}));
		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(() => { willCalls++; }));

		await assert.rejects(accessor.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None), /save refused/);
		await assert.rejects(accessor.workingCopyFileService.delete([{ resource: source }], CancellationToken.None), /save refused/);
		assert.strictEqual(ioCalls, 0);
		assert.strictEqual(willCalls, 0);
		assert.strictEqual(guardReleases, 2);
	});

	test('hard precondition guard spans failure event and always releases', async function () {
		const source = toResource.call(this, '/path/guard-failure.txt');
		const target = toResource.call(this, '/path/guard-failure-moved.txt');
		let guarded = false;
		let operationSucceeded: boolean | undefined;
		accessor.fileService.move = async () => { throw new Error('disk failed'); };
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async () => {
				guarded = true;
				return {
					afterPublicEvents: async succeeded => { operationSucceeded = succeeded; },
					dispose: () => { guarded = false; }
				};
			}
		}));
		disposables.add(accessor.workingCopyFileService.onDidFailWorkingCopyFileOperation(event => {
			event.waitUntil(Promise.resolve().then(() => assert.strictEqual(guarded, true)));
		}));

		await assert.rejects(accessor.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None), /disk failed/);
		assert.strictEqual(operationSucceeded, false);
		assert.strictEqual(guarded, false);
	});

	test('precondition transaction finalizes before public did listeners and permits nested overlapping IO', async function () {
		const source = toResource.call(this, '/path/finalizer-source.txt');
		const target = toResource.call(this, '/path/finalizer-target.txt');
		await accessor.fileService.createFile(source);
		const order: string[] = [];
		const deleted: string[] = [];
		const originalDelete = accessor.fileService.del;
		accessor.fileService.del = async (resource, options) => {
			deleted.push(resource.toString());
			return originalDelete.call(accessor.fileService, resource, options);
		};
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation) => operation === FileOperation.MOVE ? {
				didRun: async completedFiles => {
					assert.deepStrictEqual(completedFiles.map(file => file.target.toString()), [target.toString()]);
					order.push('internal-finalizer');
				},
				afterPublicEvents: async operationSucceeded => { assert.strictEqual(operationSucceeded, true); order.push('after-public-barrier'); },
				dispose: () => { order.push('guard-dispose'); }
			} : { dispose: () => undefined }
		}));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			if (event.operation !== FileOperation.MOVE) {
				return;
			}
			event.waitUntil((async () => {
				order.push('public-did-start');
				await accessor.workingCopyFileService.delete([{ resource: target }], CancellationToken.None);
				order.push('nested-delete-complete');
			})());
		}));

		await accessor.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None);

		assert.deepStrictEqual(order, ['internal-finalizer', 'public-did-start', 'nested-delete-complete', 'after-public-barrier', 'guard-dispose']);
		assert.deepStrictEqual(deleted, [target.toString()]);
	});

	test('reports a successful-IO finalizer failure after public listeners run', async function () {
		const source = toResource.call(this, '/path/finalizer-error-source.txt');
		const target = toResource.call(this, '/path/finalizer-error-target.txt');
		await accessor.fileService.createFile(source);
		const order: string[] = [];
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation) => operation === FileOperation.COPY ? {
				didRun: async () => {
					order.push('finalizer');
					throw new Error('identity finalization failed');
				},
				afterPublicEvents: async operationSucceeded => { assert.strictEqual(operationSucceeded, false); order.push('after-public'); },
				dispose: () => { order.push('dispose'); }
			} : undefined
		}));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.COPY) {
				order.push('public-did');
			}
		}));

		await assert.rejects(
			accessor.workingCopyFileService.copy([{ file: { source, target } }], CancellationToken.None),
			/identity finalization failed/
		);
		assert.deepStrictEqual(order, ['finalizer', 'public-did', 'after-public', 'dispose']);
	});

	test('reports an after-public finalizer failure after successful IO', async function () {
		const source = toResource.call(this, '/path/after-public-error-source.txt');
		const target = toResource.call(this, '/path/after-public-error-target.txt');
		await accessor.fileService.createFile(source);
		const order: string[] = [];
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation) => operation === FileOperation.MOVE ? {
				didRun: async () => { order.push('finalizer'); },
				afterPublicEvents: async operationSucceeded => {
					assert.strictEqual(operationSucceeded, true);
					order.push('after-public');
					throw new Error('retained surface publication failed');
				},
				dispose: () => { order.push('dispose'); }
			} : undefined
		}));
		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.MOVE) {
				order.push('public-did');
			}
		}));

		await assert.rejects(
			accessor.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None),
			/retained surface publication failed/
		);
		assert.strictEqual(await accessor.fileService.exists(target), true);
		assert.deepStrictEqual(order, ['finalizer', 'public-did', 'after-public', 'dispose']);
	});

	test('reports both the original IO failure and a hard failure finalizer error', async function () {
		const source = toResource.call(this, '/path/failure-finalizer-source.txt');
		const target = toResource.call(this, '/path/failure-finalizer-target.txt');
		await accessor.fileService.createFile(source);
		accessor.fileService.copy = async () => { throw new Error('copy IO failed'); };
		const order: string[] = [];
		disposables.add(accessor.workingCopyFileService.addFileOperationPrecondition({
			prepare: async (_files, operation) => operation === FileOperation.COPY ? {
				didFail: async completedFiles => {
					assert.deepStrictEqual(completedFiles, []);
					order.push('failure-finalizer');
					throw new Error('copy recovery failed');
				},
				afterPublicEvents: async operationSucceeded => { assert.strictEqual(operationSucceeded, false); order.push('after-public'); },
				dispose: () => { order.push('dispose'); }
			} : undefined
		}));
		disposables.add(accessor.workingCopyFileService.onDidFailWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.COPY) {
				order.push('public-failure');
			}
		}));

		await assert.rejects(
			accessor.workingCopyFileService.copy([{ file: { source, target } }], CancellationToken.None),
			(error: unknown) => error instanceof AggregateError
				&& error.errors.some(candidate => candidate instanceof Error && candidate.message === 'copy IO failed')
				&& error.errors.some(candidate => candidate instanceof Error && candidate.message === 'copy recovery failed')
		);
		assert.deepStrictEqual(order, ['failure-finalizer', 'public-failure', 'after-public', 'dispose']);
	});

	test('move - dirty file (target exists and is dirty)', async function () {
		await testMoveOrCopy([{ source: toResource.call(this, '/path/file.txt'), target: toResource.call(this, '/path/file_target.txt') }], true, true);
	});

	test('copy - dirty file', async function () {
		await testMoveOrCopy([{ source: toResource.call(this, '/path/file.txt'), target: toResource.call(this, '/path/file_target.txt') }], false);
	});

	test('copy - source identical to target', async function () {
		const sourceModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel.resource, sourceModel);

		const eventCounter = await testEventsMoveOrCopy([{ file: { source: sourceModel.resource, target: sourceModel.resource }, overwrite: true }]);

		sourceModel.dispose();
		assert.strictEqual(eventCounter, 3);
	});

	test('copy - one source == target and another source != target', async function () {
		const sourceModel1: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file1.txt'), 'utf8', undefined);
		const sourceModel2: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file2.txt'), 'utf8', undefined);
		const targetModel2: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file_target2.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel1.resource, sourceModel1);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel2.resource, sourceModel2);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(targetModel2.resource, targetModel2);

		const eventCounter = await testEventsMoveOrCopy([
			{ file: { source: sourceModel1.resource, target: sourceModel1.resource }, overwrite: true },
			{ file: { source: sourceModel2.resource, target: targetModel2.resource }, overwrite: true }
		]);

		sourceModel1.dispose();
		sourceModel2.dispose();
		targetModel2.dispose();
		assert.strictEqual(eventCounter, 3);
	});

	test('copy multiple - dirty file', async function () {
		await testMoveOrCopy([
			{ source: toResource.call(this, '/path/file1.txt'), target: toResource.call(this, '/path/file_target1.txt') },
			{ source: toResource.call(this, '/path/file2.txt'), target: toResource.call(this, '/path/file_target2.txt') },
			{ source: toResource.call(this, '/path/file3.txt'), target: toResource.call(this, '/path/file_target3.txt') }],
			false);
	});

	test('copy - dirty file (target exists and is dirty)', async function () {
		await testMoveOrCopy([{ source: toResource.call(this, '/path/file.txt'), target: toResource.call(this, '/path/file_target.txt') }], false, true);
	});

	test('delete failure reports the exact completed prefix', async function () {
		const first = toResource.call(this, '/path/first-delete.txt');
		const second = toResource.call(this, '/path/second-delete.txt');
		const originalDelete = accessor.fileService.del;
		let calls = 0;
		accessor.fileService.del = async (resource, options) => {
			if (calls++ === 1) {
				throw new Error('second delete failed');
			}
			return originalDelete.call(accessor.fileService, resource, options);
		};
		let completed: readonly { readonly target: URI }[] | undefined;
		disposables.add(accessor.workingCopyFileService.onDidFailWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.DELETE) {
				completed = [...event.completedFiles];
			}
		}));

		await assert.rejects(accessor.workingCopyFileService.delete([
			{ resource: first },
			{ resource: second }
		], CancellationToken.None));
		assert.deepStrictEqual(completed?.map(file => file.target.toString()), [first.toString()]);
	});

	test('getDirty', async function () {
		const model1 = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file-1.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(model1.resource, model1);

		const model2 = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file-2.txt'), 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(model2.resource, model2);

		let dirty = accessor.workingCopyFileService.getDirty(model1.resource);
		assert.strictEqual(dirty.length, 0);

		await model1.resolve();
		model1.textEditorModel!.setValue('foo');

		dirty = accessor.workingCopyFileService.getDirty(model1.resource);
		assert.strictEqual(dirty.length, 1);
		assert.strictEqual(dirty[0], model1);

		dirty = accessor.workingCopyFileService.getDirty(toResource.call(this, '/path'));
		assert.strictEqual(dirty.length, 1);
		assert.strictEqual(dirty[0], model1);

		await model2.resolve();
		model2.textEditorModel!.setValue('bar');

		dirty = accessor.workingCopyFileService.getDirty(toResource.call(this, '/path'));
		assert.strictEqual(dirty.length, 2);

		model1.dispose();
		model2.dispose();
	});

	test('registerWorkingCopyProvider', async function () {
		const model1: TextFileEditorModel = disposables.add(instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file-1.txt'), 'utf8', undefined));
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(model1.resource, model1);
		await model1.resolve();
		model1.textEditorModel!.setValue('foo');

		const testWorkingCopy: TestWorkingCopy = disposables.add(new TestWorkingCopy(toResource.call(this, '/path/file-2.txt'), true));
		const registration = accessor.workingCopyFileService.registerWorkingCopyProvider(() => {
			return [model1, testWorkingCopy];
		});

		let dirty = accessor.workingCopyFileService.getDirty(model1.resource);
		assert.strictEqual(dirty.length, 2, 'Should return default working copy + working copy from provider');
		assert.strictEqual(dirty[0], model1);
		assert.strictEqual(dirty[1], testWorkingCopy);

		registration.dispose();

		dirty = accessor.workingCopyFileService.getDirty(model1.resource);
		assert.strictEqual(dirty.length, 1, 'Should have unregistered our provider');
		assert.strictEqual(dirty[0], model1);
	});

	test('createFolder', async function () {
		let eventCounter = 0;
		let correlationId: number | undefined = undefined;

		const resource = toResource.call(this, '/path/folder');

		disposables.add(accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async (files, operation) => {
				assert.strictEqual(files.length, 1);
				const file = files[0];
				assert.strictEqual(file.target.toString(), resource.toString());
				assert.strictEqual(operation, FileOperation.CREATE);
				eventCounter++;
			}
		}));

		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => {
			assert.strictEqual(e.files.length, 1);
			const file = e.files[0];
			assert.strictEqual(file.target.toString(), resource.toString());
			assert.strictEqual(e.operation, FileOperation.CREATE);
			correlationId = e.correlationId;
			eventCounter++;
		}));

		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			assert.strictEqual(e.files.length, 1);
			const file = e.files[0];
			assert.strictEqual(file.target.toString(), resource.toString());
			assert.strictEqual(e.operation, FileOperation.CREATE);
			assert.strictEqual(e.correlationId, correlationId);
			eventCounter++;
		}));

		await accessor.workingCopyFileService.createFolder([{ resource }], CancellationToken.None);

		assert.strictEqual(eventCounter, 3);
	});

	test('cancellation of participants', async function () {
		const resource = toResource.call(this, '/path/folder');

		let canceled = false;
		disposables.add(accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async (files, operation, info, t, token) => {
				await timeout(0);
				canceled = token.isCancellationRequested;
			}
		}));

		// Create
		let cts = new CancellationTokenSource();
		let promise: Promise<unknown> = accessor.workingCopyFileService.create([{ resource }], cts.token);
		cts.cancel();
		await promise;
		assert.strictEqual(canceled, true);
		canceled = false;

		// Create Folder
		cts = new CancellationTokenSource();
		promise = accessor.workingCopyFileService.createFolder([{ resource }], cts.token);
		cts.cancel();
		await promise;
		assert.strictEqual(canceled, true);
		canceled = false;

		// Move
		cts = new CancellationTokenSource();
		promise = accessor.workingCopyFileService.move([{ file: { source: resource, target: resource } }], cts.token);
		cts.cancel();
		await promise;
		assert.strictEqual(canceled, true);
		canceled = false;

		// Copy
		cts = new CancellationTokenSource();
		promise = accessor.workingCopyFileService.copy([{ file: { source: resource, target: resource } }], cts.token);
		cts.cancel();
		await promise;
		assert.strictEqual(canceled, true);
		canceled = false;

		// Delete
		cts = new CancellationTokenSource();
		promise = accessor.workingCopyFileService.delete([{ resource }], cts.token);
		cts.cancel();
		await promise;
		assert.strictEqual(canceled, true);
		canceled = false;
	});

	async function testEventsMoveOrCopy(files: ICopyOperation[], move?: boolean): Promise<number> {
		let eventCounter = 0;

		const participant = accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async files => {
				eventCounter++;
			}
		});

		const listener1 = accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => {
			eventCounter++;
		});

		const listener2 = accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			eventCounter++;
		});

		if (move) {
			await accessor.workingCopyFileService.move(files, CancellationToken.None);
		} else {
			await accessor.workingCopyFileService.copy(files, CancellationToken.None);
		}

		participant.dispose();
		listener1.dispose();
		listener2.dispose();
		return eventCounter;
	}

	async function testMoveOrCopy(files: { source: URI; target: URI }[], move: boolean, targetDirty?: boolean): Promise<void> {

		let eventCounter = 0;
		const models = await Promise.all(files.map(async ({ source, target }, i) => {
			const sourceModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, source, 'utf8', undefined);
			const targetModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, target, 'utf8', undefined);
			(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(sourceModel.resource, sourceModel);
			(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(targetModel.resource, targetModel);

			await sourceModel.resolve();
			sourceModel.textEditorModel!.setValue('foo' + i);
			assert.ok(accessor.textFileService.isDirty(sourceModel.resource));
			if (targetDirty) {
				await targetModel.resolve();
				targetModel.textEditorModel!.setValue('bar' + i);
				assert.ok(accessor.textFileService.isDirty(targetModel.resource));
			}

			return { sourceModel, targetModel };
		}));

		const participant = accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async (files, operation) => {
				for (let i = 0; i < files.length; i++) {
					const { target, source } = files[i];
					const { targetModel, sourceModel } = models[i];

					assert.strictEqual(target.toString(), targetModel.resource.toString());
					assert.strictEqual(source?.toString(), sourceModel.resource.toString());
				}

				eventCounter++;

				assert.strictEqual(operation, move ? FileOperation.MOVE : FileOperation.COPY);
			}
		});

		let correlationId: number;

		const listener1 = accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => {
			for (let i = 0; i < e.files.length; i++) {
				const { target, source } = files[i];
				const { targetModel, sourceModel } = models[i];

				assert.strictEqual(target.toString(), targetModel.resource.toString());
				assert.strictEqual(source?.toString(), sourceModel.resource.toString());
			}

			eventCounter++;

			correlationId = e.correlationId;
			assert.strictEqual(e.operation, move ? FileOperation.MOVE : FileOperation.COPY);
		});

		const listener2 = accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			for (let i = 0; i < e.files.length; i++) {
				const { target, source } = files[i];
				const { targetModel, sourceModel } = models[i];
				assert.strictEqual(target.toString(), targetModel.resource.toString());
				assert.strictEqual(source?.toString(), sourceModel.resource.toString());
			}

			eventCounter++;

			assert.strictEqual(e.operation, move ? FileOperation.MOVE : FileOperation.COPY);
			assert.strictEqual(e.correlationId, correlationId);
		});

		if (move) {
			await accessor.workingCopyFileService.move(models.map(model => ({ file: { source: model.sourceModel.resource, target: model.targetModel.resource }, options: { overwrite: true } })), CancellationToken.None);
		} else {
			await accessor.workingCopyFileService.copy(models.map(model => ({ file: { source: model.sourceModel.resource, target: model.targetModel.resource }, options: { overwrite: true } })), CancellationToken.None);
		}

		for (let i = 0; i < models.length; i++) {
			const { sourceModel, targetModel } = models[i];

			assert.strictEqual(targetModel.textEditorModel!.getValue(), 'foo' + i);

			if (move) {
				assert.ok(!accessor.textFileService.isDirty(sourceModel.resource));
			} else {
				assert.ok(accessor.textFileService.isDirty(sourceModel.resource));
			}
			assert.ok(accessor.textFileService.isDirty(targetModel.resource));

			sourceModel.dispose();
			targetModel.dispose();
		}
		assert.strictEqual(eventCounter, 3);

		participant.dispose();
		listener1.dispose();
		listener2.dispose();
	}

	async function testDelete(resources: URI[]) {

		const models = await Promise.all(resources.map(async resource => {
			const model = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8', undefined);
			(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(model.resource, model);

			await model.resolve();
			model.textEditorModel!.setValue('foo');
			assert.ok(accessor.workingCopyService.isDirty(model.resource));
			return model;
		}));

		let eventCounter = 0;
		let correlationId: number | undefined = undefined;

		const participant = accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async (files, operation) => {
				for (let i = 0; i < models.length; i++) {
					const model = models[i];
					const file = files[i];
					assert.strictEqual(file.target.toString(), model.resource.toString());
				}
				assert.strictEqual(operation, FileOperation.DELETE);
				eventCounter++;
			}
		});

		const listener1 = accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => {
			for (let i = 0; i < models.length; i++) {
				const model = models[i];
				const file = e.files[i];
				assert.strictEqual(file.target.toString(), model.resource.toString());
			}
			assert.strictEqual(e.operation, FileOperation.DELETE);
			correlationId = e.correlationId;
			eventCounter++;
		});

		const listener2 = accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			for (let i = 0; i < models.length; i++) {
				const model = models[i];
				const file = e.files[i];
				assert.strictEqual(file.target.toString(), model.resource.toString());
			}
			assert.strictEqual(e.operation, FileOperation.DELETE);
			assert.strictEqual(e.correlationId, correlationId);
			eventCounter++;
		});

		await accessor.workingCopyFileService.delete(models.map(model => ({ resource: model.resource })), CancellationToken.None);
		for (const model of models) {
			assert.ok(!accessor.workingCopyService.isDirty(model.resource));
			model.dispose();
		}

		assert.strictEqual(eventCounter, 3);

		participant.dispose();
		listener1.dispose();
		listener2.dispose();
	}

	async function testCreate(resource: URI, contents: VSBuffer) {
		const model = instantiationService.createInstance(TextFileEditorModel, resource, 'utf8', undefined);
		(<ITestTextFileEditorModelManager>accessor.textFileService.files).add(model.resource, model);

		await model.resolve();
		model.textEditorModel!.setValue('foo');
		assert.ok(accessor.workingCopyService.isDirty(model.resource));

		let eventCounter = 0;
		let correlationId: number | undefined = undefined;

		disposables.add(accessor.workingCopyFileService.addFileOperationParticipant({
			participate: async (files, operation) => {
				assert.strictEqual(files.length, 1);
				const file = files[0];
				assert.strictEqual(file.target.toString(), model.resource.toString());
				assert.strictEqual(operation, FileOperation.CREATE);
				eventCounter++;
			}
		}));

		disposables.add(accessor.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => {
			assert.strictEqual(e.files.length, 1);
			const file = e.files[0];
			assert.strictEqual(file.target.toString(), model.resource.toString());
			assert.strictEqual(e.operation, FileOperation.CREATE);
			correlationId = e.correlationId;
			eventCounter++;
		}));

		disposables.add(accessor.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			assert.strictEqual(e.files.length, 1);
			const file = e.files[0];
			assert.strictEqual(file.target.toString(), model.resource.toString());
			assert.strictEqual(e.operation, FileOperation.CREATE);
			assert.strictEqual(e.correlationId, correlationId);
			eventCounter++;
		}));

		await accessor.workingCopyFileService.create([{ resource, contents }], CancellationToken.None);
		assert.ok(!accessor.workingCopyService.isDirty(model.resource));
		model.dispose();

		assert.strictEqual(eventCounter, 3);
	}

	ensureNoDisposablesAreLeakedInTestSuite();
});
