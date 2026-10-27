/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
// The code editor's own undo, which the rule goes ahead of.
import '../../../../../editor/browser/coreCommands.js';
import { RedoCommand, UndoCommand } from '../../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { withAsyncTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { registerBaseHalfEditorOfTextUndo } from '../../browser/basehalfEditorUndo.js';
import { baseHalfEditorUndoReachesItsText } from '../../common/basehalfEditorUndo.js';

/** A dialog service that says yes, and keeps every question it was asked. */
class AnsweringDialogService extends TestDialogService {
	readonly questions: string[] = [];

	override async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.questions.push(String(confirmation.message));
		return { confirmed: true };
	}
}

suite('BaseHalf undo in an editor of text', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('Command+Z and Shift+Command+Z in a code editor leave a step of the canvas, ask nothing, and still undo the text', async () => {
		const dialogService = new AnsweringDialogService();
		await withAsyncTestCodeEditor('note', { serviceCollection: new ServiceCollection([IDialogService, dialogService]) }, async (editor, _viewModel, instantiationService) => {
			const undoRedoService = instantiationService.get(IUndoRedoService);
			disposables.add(registerBaseHalfEditorOfTextUndo(instantiationService.get(ICodeEditorService), undoRedoService));
			const model = editor.getModel()!;
			const press = (command: typeof UndoCommand) => instantiationService.invokeFunction(accessor => command.runCommand(accessor, undefined));

			// Typing in the editor, then a step of the canvas over the same file,
			// as a rename of the note on the canvas is.
			model.pushStackElement();
			model.pushEditOperations([], [{ range: new Range(1, 5, 1, 5), text: ' typed' }], () => null);
			model.pushStackElement();
			const canvasSource = new UndoRedoSource();
			const runs: string[] = [];
			undoRedoService.pushElement({
				type: UndoRedoElementType.Workspace,
				resources: [model.uri, URI.file('/workspace/renamed.md')],
				label: 'Rename note to renamed',
				code: 'test.canvasStep',
				undo: () => { runs.push('undo'); },
				redo: () => { runs.push('redo'); }
			}, undefined, canvasSource);

			// Command+Z in the editor: the step of the canvas is next.
			await press(UndoCommand);
			const atTheStep = { questions: [...dialogService.questions], runs: [...runs], text: model.getValue() };

			// The canvas undoes its own step; the editor's keys then reach the text.
			await undoRedoService.undo(canvasSource);
			await press(UndoCommand);
			const textUndone = model.getValue();
			await press(RedoCommand);
			const textRedone = model.getValue();
			// The step of the canvas is the next one to redo: Shift+Command+Z leaves it too.
			await press(RedoCommand);

			assert.deepStrictEqual({
				atTheStep,
				textUndone,
				textRedone,
				questions: dialogService.questions,
				runs
			}, {
				atTheStep: { questions: [], runs: [], text: 'note typed' },
				textUndone: 'note',
				textRedone: 'note typed',
				questions: [],
				runs: ['undo']
			});
		});
	});

	test('an edit of the text is reached both ways, and a step over files is not', () => {
		const resource = URI.file('/workspace/note.md');
		const textEdit: IUndoRedoElement = { type: UndoRedoElementType.Resource, resource, label: 'Typing', code: 'test.text', undo: () => { }, redo: () => { } };
		const step: IUndoRedoElement = { type: UndoRedoElementType.Workspace, resources: [resource, URI.file('/workspace/b.md')], label: 'Move', code: 'test.step', undo: () => { }, redo: () => { } };
		const elements = (past: IUndoRedoElement[], future: IUndoRedoElement[]) => ({ getElements: () => ({ past, future }) });
		assert.deepStrictEqual([
			baseHalfEditorUndoReachesItsText(elements([], []), resource, 'undo'),
			baseHalfEditorUndoReachesItsText(elements([step, textEdit], []), resource, 'undo'),
			baseHalfEditorUndoReachesItsText(elements([textEdit, step], []), resource, 'undo'),
			// The closest step to redo is the last of the future.
			baseHalfEditorUndoReachesItsText(elements([], [step, textEdit]), resource, 'redo'),
			baseHalfEditorUndoReachesItsText(elements([], [textEdit, step]), resource, 'redo')
		], [true, true, false, true, false]);
	});
});
