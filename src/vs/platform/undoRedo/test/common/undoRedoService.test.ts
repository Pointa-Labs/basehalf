/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IDialogService, IPrompt } from '../../../dialogs/common/dialogs.js';
import { TestDialogService } from '../../../dialogs/test/common/testDialogService.js';
import { TestNotificationService } from '../../../notification/test/common/testNotificationService.js';
import { IUndoRedoElement, UndoRedoElementType, UndoRedoGroup, UndoRedoSource } from '../../common/undoRedo.js';
import { UndoRedoService } from '../../common/undoRedoService.js';

suite('UndoRedoService', () => {

	function createUndoRedoService(dialogService: IDialogService = new TestDialogService()): UndoRedoService {
		const notificationService = new TestNotificationService();
		return new UndoRedoService(dialogService, notificationService);
	}

	test('simple single resource elements', () => {
		const resource = URI.file('test.txt');
		const service = createUndoRedoService();

		assert.strictEqual(service.canUndo(resource), false);
		assert.strictEqual(service.canRedo(resource), false);
		assert.strictEqual(service.hasElements(resource), false);
		assert.ok(service.getLastElement(resource) === null);

		let undoCall1 = 0;
		let redoCall1 = 0;
		const element1: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 1',
			code: 'typing',
			undo: () => { undoCall1++; },
			redo: () => { redoCall1++; }
		};
		service.pushElement(element1);

		assert.strictEqual(undoCall1, 0);
		assert.strictEqual(redoCall1, 0);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), false);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element1);

		service.undo(resource);
		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 0);
		assert.strictEqual(service.canUndo(resource), false);
		assert.strictEqual(service.canRedo(resource), true);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);

		service.redo(resource);
		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), false);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element1);

		let undoCall2 = 0;
		let redoCall2 = 0;
		const element2: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 2',
			code: 'typing',
			undo: () => { undoCall2++; },
			redo: () => { redoCall2++; }
		};
		service.pushElement(element2);

		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(undoCall2, 0);
		assert.strictEqual(redoCall2, 0);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), false);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element2);

		service.undo(resource);

		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(undoCall2, 1);
		assert.strictEqual(redoCall2, 0);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), true);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);

		let undoCall3 = 0;
		let redoCall3 = 0;
		const element3: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 2',
			code: 'typing',
			undo: () => { undoCall3++; },
			redo: () => { redoCall3++; }
		};
		service.pushElement(element3);

		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(undoCall2, 1);
		assert.strictEqual(redoCall2, 0);
		assert.strictEqual(undoCall3, 0);
		assert.strictEqual(redoCall3, 0);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), false);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element3);

		service.undo(resource);

		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(undoCall2, 1);
		assert.strictEqual(redoCall2, 0);
		assert.strictEqual(undoCall3, 1);
		assert.strictEqual(redoCall3, 0);
		assert.strictEqual(service.canUndo(resource), true);
		assert.strictEqual(service.canRedo(resource), true);
		assert.strictEqual(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);
	});

	test('multi resource elements', async () => {
		const resource1 = URI.file('test1.txt');
		const resource2 = URI.file('test2.txt');
		const service = createUndoRedoService(new class extends mock<IDialogService>() {
			override async prompt<T = any>(prompt: IPrompt<any>) {
				const result = prompt.buttons?.[0].run({ checkboxChecked: false });

				return { result };
			}
			override async confirm() {
				return {
					confirmed: true // confirm!
				};
			}
		});

		let undoCall1 = 0, undoCall11 = 0, undoCall12 = 0;
		let redoCall1 = 0, redoCall11 = 0, redoCall12 = 0;
		const element1: IUndoRedoElement = {
			type: UndoRedoElementType.Workspace,
			resources: [resource1, resource2],
			label: 'typing 1',
			code: 'typing',
			undo: () => { undoCall1++; },
			redo: () => { redoCall1++; },
			split: () => {
				return [
					{
						type: UndoRedoElementType.Resource,
						resource: resource1,
						label: 'typing 1.1',
						code: 'typing',
						undo: () => { undoCall11++; },
						redo: () => { redoCall11++; }
					},
					{
						type: UndoRedoElementType.Resource,
						resource: resource2,
						label: 'typing 1.2',
						code: 'typing',
						undo: () => { undoCall12++; },
						redo: () => { redoCall12++; }
					}
				];
			}
		};
		service.pushElement(element1);

		assert.strictEqual(service.canUndo(resource1), true);
		assert.strictEqual(service.canRedo(resource1), false);
		assert.strictEqual(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === element1);
		assert.strictEqual(service.canUndo(resource2), true);
		assert.strictEqual(service.canRedo(resource2), false);
		assert.strictEqual(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === element1);

		await service.undo(resource1);

		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 0);
		assert.strictEqual(service.canUndo(resource1), false);
		assert.strictEqual(service.canRedo(resource1), true);
		assert.strictEqual(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === null);
		assert.strictEqual(service.canUndo(resource2), false);
		assert.strictEqual(service.canRedo(resource2), true);
		assert.strictEqual(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === null);

		await service.redo(resource2);
		assert.strictEqual(undoCall1, 1);
		assert.strictEqual(redoCall1, 1);
		assert.strictEqual(undoCall11, 0);
		assert.strictEqual(redoCall11, 0);
		assert.strictEqual(undoCall12, 0);
		assert.strictEqual(redoCall12, 0);
		assert.strictEqual(service.canUndo(resource1), true);
		assert.strictEqual(service.canRedo(resource1), false);
		assert.strictEqual(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === element1);
		assert.strictEqual(service.canUndo(resource2), true);
		assert.strictEqual(service.canRedo(resource2), false);
		assert.strictEqual(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === element1);

	});

	test('a new element of a source discards that source\'s undone elements in every stack', async () => {
		const source = new UndoRedoSource();
		const otherSource = new UndoRedoSource();
		const service = createUndoRedoService();
		const calls: string[] = [];
		const element = (label: string, ...files: string[]): IUndoRedoElement => ({
			type: UndoRedoElementType.Workspace,
			resources: files.map(file => URI.file(file)),
			label,
			code: 'test',
			undo: () => { calls.push(`undo ${label}`); },
			redo: () => { calls.push(`redo ${label}`); }
		});

		service.pushElement(element('create card', 'canvas-a.yaml', 'clip.mp4'), undefined, source);
		service.pushElement(element('other source', 'other.txt'), undefined, otherSource);
		await service.undo(source);
		await service.undo(otherSource);
		service.pushElement(element('resize card', 'canvas-b.yaml'), undefined, source);
		await service.undo(source);
		await service.redo(source);

		assert.deepStrictEqual({
			calls,
			sourceCanRedo: service.canRedo(source),
			cardCanRedo: service.canRedo(URI.file('clip.mp4')),
			otherSourceCanRedo: service.canRedo(otherSource)
		}, {
			calls: ['undo create card', 'undo other source', 'undo resize card', 'redo resize card'],
			sourceCanRedo: false,
			cardCanRedo: false,
			otherSourceCanRedo: true
		});
	});

	test('one undo of a source undoes a group of that source without asking', async () => {
		const source = new UndoRedoSource();
		const group = new UndoRedoGroup();
		let questions = 0;
		const service = createUndoRedoService(new class extends mock<IDialogService>() {
			override async confirm() {
				questions++;
				return { confirmed: false };
			}
		});
		const calls: string[] = [];
		const element = (label: string, file: string): IUndoRedoElement => ({
			type: UndoRedoElementType.Workspace,
			resources: [URI.file(file)],
			label,
			code: 'test',
			undo: () => { calls.push(`undo ${label}`); },
			redo: () => { calls.push(`redo ${label}`); }
		});

		service.pushElement(element('delete draft', 'draft/generation.yaml'), group, source);
		service.pushElement(element('delete files', 'note.md'), group, source);
		await service.undo(source);
		await service.redo(source);

		assert.deepStrictEqual({ calls, questions }, {
			calls: ['undo delete files', 'undo delete draft', 'redo delete draft', 'redo delete files'],
			questions: 0
		});
	});

	test('BaseHalf: an undo or a redo by resource leaves an element of a source, and asks nothing', async () => {
		const source = new UndoRedoSource();
		let questions = 0;
		const service = createUndoRedoService(new class extends mock<IDialogService>() {
			override async confirm() {
				questions++;
				return { confirmed: true };
			}
		});
		const calls: string[] = [];
		const note = URI.file('note.md');
		service.pushElement({ type: UndoRedoElementType.Resource, resource: note, label: 'typing', code: 'test', undo: () => { calls.push('undo typing'); }, redo: () => { calls.push('redo typing'); } });
		service.pushElement({ type: UndoRedoElementType.Workspace, resources: [note, URI.file('renamed.md')], label: 'rename', code: 'test', undo: () => { calls.push('undo rename'); }, redo: () => { calls.push('redo rename'); } }, undefined, source);

		const editorCanUndo = service.canUndo(note);
		await service.undo(note);
		await service.undo(source);
		await service.undo(note);
		await service.redo(note);
		const editorCanRedo = service.canRedo(note);
		await service.redo(note);
		await service.redo(source);

		assert.deepStrictEqual({ calls, questions, editorCanUndo, editorCanRedo }, {
			calls: ['undo rename', 'undo typing', 'redo typing', 'redo rename'],
			questions: 0,
			editorCanUndo: false,
			editorCanRedo: false
		});
	});

	test('BaseHalf: an undo by resource of an element that can be split takes it back in every file, and asks nothing', async () => {
		let questions = 0;
		const service = createUndoRedoService(new class extends mock<IDialogService>() {
			override async prompt<T = any>(prompt: IPrompt<any>) {
				questions++;
				return { result: prompt.buttons?.[1].run({ checkboxChecked: false }) };
			}
		});
		const calls: string[] = [];
		const note = URI.file('note.md');
		const other = URI.file('other.md');
		service.pushElement({
			type: UndoRedoElementType.Workspace,
			resources: [note, other],
			label: 'rename heading',
			code: 'test',
			undo: () => { calls.push('undo rename heading'); },
			redo: () => { calls.push('redo rename heading'); },
			split: () => [note, other].map(resource => ({ type: UndoRedoElementType.Resource, resource, label: 'part', code: 'test', undo: () => { calls.push('undo part'); }, redo: () => { calls.push('redo part'); } }))
		});

		await service.undo(note);
		await service.redo(note);

		assert.deepStrictEqual({ calls, questions }, {
			calls: ['undo rename heading', 'redo rename heading'],
			questions: 0
		});
	});

	test('UndoRedoGroup.None uses id 0', () => {
		assert.strictEqual(UndoRedoGroup.None.id, 0);
		assert.strictEqual(UndoRedoGroup.None.nextOrder(), 0);
		assert.strictEqual(UndoRedoGroup.None.nextOrder(), 0);
	});

	test('restoreSnapshot preserves elements that match the snapshot', () => {
		const resource = URI.file('test.txt');
		const service = createUndoRedoService();

		// Push three elements
		const element1: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 1',
			code: 'typing',
			undo: () => { },
			redo: () => { }
		};
		const element2: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 2',
			code: 'typing',
			undo: () => { },
			redo: () => { }
		};
		const element3: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 3',
			code: 'typing',
			undo: () => { },
			redo: () => { }
		};
		service.pushElement(element1);
		service.pushElement(element2);
		service.pushElement(element3);

		// Create snapshot after 3 elements: [element1, element2, element3]
		const snapshot = service.createSnapshot(resource);

		// Push more elements after the snapshot
		const element4: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 4',
			code: 'typing',
			undo: () => { },
			redo: () => { }
		};
		const element5: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 5',
			code: 'typing',
			undo: () => { },
			redo: () => { }
		};
		service.pushElement(element4);
		service.pushElement(element5);

		// Verify we have 5 elements now
		let elements = service.getElements(resource);
		assert.strictEqual(elements.past.length, 5);
		assert.strictEqual(elements.future.length, 0);

		// Restore snapshot - should remove element4 and element5, but keep element1, element2, element3
		service.restoreSnapshot(snapshot);

		// Verify that elements matching the snapshot are preserved
		elements = service.getElements(resource);
		assert.strictEqual(elements.past.length, 3, 'Should have 3 past elements after restore');
		assert.strictEqual(elements.future.length, 0, 'Should have 0 future elements after restore');
		assert.strictEqual(elements.past[0], element1, 'First element should be element1');
		assert.strictEqual(elements.past[1], element2, 'Second element should be element2');
		assert.strictEqual(elements.past[2], element3, 'Third element should be element3');
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
