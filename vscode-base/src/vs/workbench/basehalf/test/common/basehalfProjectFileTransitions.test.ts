/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoGroup, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BaseHalfProjectFileTransitionService } from '../../common/basehalfProjectFileTransitions.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease, IBaseHalfWorkspaceResourceMutationStamp } from '../../common/basehalfWorkspaceMutation.js';

suite('BaseHalfProjectFileTransitionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('commits exact bytes and keeps undo and redo CAS guarded', async () => {
		const resource = URI.file('/workspace/sequence.json');
		const files = new TestFileService(resource, 'before');
		const undo = new TestUndoRedoService();
		const service = createService(files, undo);

		await service.apply({
			resource,
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Reorder clips'
		});
		assert.strictEqual(files.contents.toString(), 'after');
		assert.strictEqual(undo.element?.label, 'Reorder clips');

		await undo.element?.undo();
		assert.strictEqual(files.contents.toString(), 'before');
		await undo.element?.redo();
		assert.strictEqual(files.contents.toString(), 'after');
	});

	test('rejects stale bytes without adding an undo step', async () => {
		const resource = URI.file('/workspace/sequence.json');
		const files = new TestFileService(resource, 'newer');
		const undo = new TestUndoRedoService();
		const service = createService(files, undo);
		await assert.rejects(service.apply({
			resource,
			expected: VSBuffer.fromString('older'),
			next: VSBuffer.fromString('next'),
			label: 'Reorder clips'
		}), /changed/);
		assert.strictEqual(files.contents.toString(), 'newer');
		assert.strictEqual(undo.element, undefined);
	});

	test('rejects a symbolic link in any path entry before the target', async () => {
		const resource = URI.file('/workspace/linked/sequence.json');
		const files = new TestFileService(resource, 'before', new Set(['/workspace/linked']));
		const undo = new TestUndoRedoService();
		const service = createService(files, undo);
		await assert.rejects(service.apply({
			resource,
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Reorder clips'
		}), /symbolic links/);
		assert.strictEqual(files.contents.toString(), 'before');
		assert.strictEqual(undo.element, undefined);
	});

	test('rechecks dirty state after entering the mutation lease', async () => {
		const resource = URI.file('/workspace/sequence.json');
		const files = new TestFileService(resource, 'before');
		const undo = new TestUndoRedoService();
		const workingCopies = new TestWorkingCopyService();
		const coordinator = new TestMutationCoordinator(() => { workingCopies.dirty = true; });
		const service = createService(files, undo, workingCopies, coordinator);

		await assert.rejects(service.apply({
			resource,
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Reorder clips'
		}), /Save 'sequence.json'/);
		assert.strictEqual(files.contents.toString(), 'before');
		assert.strictEqual(undo.element, undefined);
	});

	test('rechecks path safety after entering the mutation lease', async () => {
		const resource = URI.file('/workspace/sequence.json');
		const files = new TestFileService(resource, 'before');
		const undo = new TestUndoRedoService();
		const coordinator = new TestMutationCoordinator(() => { files.symbolicLinks.add('/workspace'); });
		const service = createService(files, undo, new TestWorkingCopyService(), coordinator);

		await assert.rejects(service.apply({
			resource,
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Reorder clips'
		}), /symbolic links/);
		assert.strictEqual(files.contents.toString(), 'before');
		assert.strictEqual(undo.element, undefined);
	});

	test('staged rollback preserves a later BaseHalf undo element', async () => {
		const cleanupResource = URI.file('/workspace/sequence.json');
		const unrelatedResource = URI.file('/workspace/notes.json');
		const cleanupFiles = new TestFileService(cleanupResource, 'before cleanup');
		const unrelatedFiles = new TestFileService(unrelatedResource, 'before edit');
		const undo = new TestUndoRedoService();
		const cleanupService = createService(cleanupFiles, undo);
		const unrelatedService = createService(unrelatedFiles, undo);

		const cleanupTransaction = await cleanupService.stage({
			resource: cleanupResource,
			expected: VSBuffer.fromString('before cleanup'),
			next: VSBuffer.fromString('after cleanup'),
			label: 'Update Sequence'
		});
		await unrelatedService.apply({
			resource: unrelatedResource,
			expected: VSBuffer.fromString('before edit'),
			next: VSBuffer.fromString('after edit'),
			label: 'Edit notes'
		});

		await cleanupTransaction.rollback();
		assert.strictEqual(cleanupFiles.contents.toString(), 'before cleanup');
		assert.strictEqual(unrelatedFiles.contents.toString(), 'after edit');
		assert.strictEqual(undo.elements.length, 1);
		assert.strictEqual(undo.element?.label, 'Edit notes');

		await undo.element?.undo();
		assert.strictEqual(unrelatedFiles.contents.toString(), 'before edit');
	});

	test('accepts staged bytes without creating a misleading undo entry', async () => {
		const resource = URI.file('/workspace/sequence.json');
		const files = new TestFileService(resource, 'before');
		const undo = new TestUndoRedoService();
		const transaction = await createService(files, undo).stage({
			resource,
			expected: VSBuffer.fromString('before'),
			next: VSBuffer.fromString('after'),
			label: 'Update Sequence'
		});

		transaction.accept();
		assert.strictEqual(files.contents.toString(), 'after');
		assert.deepStrictEqual(undo.elements, []);
		await assert.rejects(() => transaction.rollback(), /already been completed/);
	});

	test('stages under an owned structural lease and replays in the caller undo group', async () => {
		const resource = URI.file('/workspace/node.bhnode');
		const files = new TestFileService(resource, 'with binding');
		const undo = new TestUndoRedoService();
		const coordinator = new BaseHalfWorkspaceMutationCoordinator();
		const service = createService(files, undo, new TestWorkingCopyService(), coordinator);
		const reservation = coordinator.reserveStructural(URI.file('/workspace'), [{
			workspace: URI.file('/workspace'),
			relativePath: 'input.md'
		}]);
		const staged = await reservation.runPrepared(lease => service.stage({
			resource,
			expected: VSBuffer.fromString('with binding'),
			next: VSBuffer.fromString('without binding'),
			label: 'Update node inputs'
		}, lease));
		await reservation.finish(async () => undefined);
		const group = new UndoRedoGroup();
		staged.commit(group);

		assert.strictEqual(files.contents.toString(), 'without binding');
		assert.strictEqual(undo.groups[0], group);
		await undo.element?.undo();
		assert.strictEqual(files.contents.toString(), 'with binding');
		await undo.element?.redo();
		assert.strictEqual(files.contents.toString(), 'without binding');
	});
});

function createService(
	files: TestFileService,
	undo: TestUndoRedoService,
	workingCopies: TestWorkingCopyService = new TestWorkingCopyService(),
	coordinator: BaseHalfWorkspaceMutationCoordinator = new BaseHalfWorkspaceMutationCoordinator()
): BaseHalfProjectFileTransitionService {
	const workspaceContext = new class extends mock<IWorkspaceContextService>() {
		override getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
			return resource.path.startsWith('/workspace/')
				? { uri: URI.file('/workspace'), name: 'workspace', index: 0, toResource: path => URI.joinPath(URI.file('/workspace'), path) }
				: null;
		}
	};
	return new BaseHalfProjectFileTransitionService(
		files,
		workspaceContext,
		workingCopies,
		coordinator,
		undo
	);
}

class TestWorkingCopyService extends mock<IWorkingCopyService>() {
	dirty = false;
	override isDirty(): boolean { return this.dirty; }
}

class TestMutationCoordinator extends BaseHalfWorkspaceMutationCoordinator {
	constructor(private readonly beforeTask: () => void) {
		super();
	}

	override runResourceMutation<T>(
		workspace: URI,
		stamp: IBaseHalfWorkspaceResourceMutationStamp | readonly IBaseHalfWorkspaceResourceMutationStamp[],
		task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>
	): Promise<T> {
		return super.runResourceMutation(workspace, stamp, lease => {
			this.beforeTask();
			return task(lease);
		});
	}
}

class TestFileService extends mock<IFileService>() {
	contents: VSBuffer;

	constructor(private readonly resource: URI, source: string, readonly symbolicLinks = new Set<string>()) {
		super();
		this.contents = VSBuffer.fromString(source);
	}

	override realpath(resource: URI): Promise<URI> { return Promise.resolve(resource); }
	override stat(resource: URI): Promise<IFileStatWithMetadata> {
		return Promise.resolve({
			resource,
			name: resource.path.split('/').at(-1)!,
			isFile: resource.toString() === this.resource.toString(),
			isDirectory: resource.toString() !== this.resource.toString(),
			isSymbolicLink: this.symbolicLinks.has(resource.fsPath),
			mtime: 1,
			ctime: 1,
			etag: '1',
			size: this.contents.byteLength,
			readonly: false,
			locked: false,
			executable: false,
			children: undefined
		});
	}
	override writeFileWithExpectedContents(resource: URI, contents: VSBuffer, expected: VSBuffer): Promise<IFileStatWithMetadata> {
		assert.strictEqual(resource.toString(), this.resource.toString());
		if (!this.contents.equals(expected)) {
			return Promise.reject(new Error('The file changed before the transition could be committed.'));
		}
		this.contents = contents.clone();
		return this.stat(resource);
	}
}

class TestUndoRedoService extends mock<IUndoRedoService>() {
	readonly elements: IUndoRedoElement[] = [];
	readonly groups: (UndoRedoGroup | undefined)[] = [];
	get element(): IUndoRedoElement | undefined { return this.elements.at(-1); }
	override pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, _source?: UndoRedoSource): void {
		this.elements.push(element);
		this.groups.push(group);
	}
}
