/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ResourceFileEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IExplorerBulkEditOptions, IExplorerService } from '../../../contrib/files/browser/files.js';
import { BaseHalfCanvasResourceDeletionService } from '../../browser/basehalfCanvasResourceDeletion.js';

suite('BaseHalfCanvasResourceDeletionService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('delegates canvas deletion to the shared file-operation transaction', async () => {
		const one = URI.file('/workspace/one.bhnode');
		const folder = URI.file('/workspace/shots');
		let deleteGroup: UndoRedoGroup | undefined;
		const explorer = new class extends mock<IExplorerService>() {
			override async applyBulkEdit(edits: ResourceFileEdit[], options: IExplorerBulkEditOptions): Promise<void> {
				assert.deepStrictEqual(edits.map(edit => ({
					resource: edit.oldResource?.toString(),
					recursive: edit.options?.recursive,
					folder: edit.options?.folder,
					skipTrashBin: edit.options?.skipTrashBin,
					maxSize: edit.options?.maxSize
				})), [{
					resource: one.toString(),
					recursive: true,
					folder: false,
					skipTrashBin: false,
					maxSize: 100
				}, {
					resource: folder.toString(),
					recursive: true,
					folder: true,
					skipTrashBin: false,
					maxSize: 200
				}]);
				assert.strictEqual(options.undoLabel, 'Delete selection');
				assert.strictEqual(options.progressLabel, 'Deleting selection');
				assert.strictEqual(options.confirmBeforeUndo, true);
				deleteGroup = options.undoRedoGroup;
			}
		};
		const service = new BaseHalfCanvasResourceDeletionService(explorer);

		await service.delete([
			{ resource: one, folder: false, maxSize: 100 },
			{ resource: folder, folder: true, maxSize: 200 }
		], {
			permanently: false,
			undoLabel: 'Delete selection',
			progressLabel: 'Deleting selection',
			confirmBeforeUndo: true
		});

		assert.ok(deleteGroup, 'the generic file precondition must receive one real undo group');
	});

	test('rejects duplicate resources before starting deletion', async () => {
		let called = false;
		const service = new BaseHalfCanvasResourceDeletionService(new class extends mock<IExplorerService>() {
			override async applyBulkEdit(): Promise<void> { called = true; }
		});
		const resource = URI.file('/workspace/one.bhnode');

		await assert.rejects(service.delete([
			{ resource, folder: false, maxSize: 100 },
			{ resource, folder: false, maxSize: 100 }
		], {
			permanently: true,
			undoLabel: 'Delete',
			progressLabel: 'Deleting',
			confirmBeforeUndo: false
		}), /cannot be deleted twice/);
		assert.strictEqual(called, false);
	});

	test('reports cancellation before starting deletion', async () => {
		let called = false;
		const service = new BaseHalfCanvasResourceDeletionService(new class extends mock<IExplorerService>() {
			override async applyBulkEdit(): Promise<void> { called = true; }
		});
		const source = new CancellationTokenSource();
		source.cancel();

		await assert.rejects(service.delete(
			[{ resource: URI.file('/workspace/one.bhnode'), folder: false, maxSize: 100 }],
			{ permanently: true, undoLabel: 'Delete', progressLabel: 'Deleting', confirmBeforeUndo: false },
			source.token
		), error => isCancellationError(error));
		assert.strictEqual(called, false);
		source.dispose();
	});
});
