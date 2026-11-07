/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
// The code editor's own undo and redo, which Command+Z and Shift+Command+Z run.
import '../../../../../editor/browser/coreCommands.js';
import { RedoCommand, UndoCommand } from '../../../../../editor/browser/editorExtensions.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { withAsyncTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { IConfirmation, IConfirmationResult, IDialogService, IPrompt } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IUndoRedoService, UndoRedoElementType, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';

/** A dialog service that says yes, and keeps every question it was asked. */
class AnsweringDialogService extends TestDialogService {
	readonly questions: string[] = [];

	constructor() {
		super();
		const prompt = this.prompt.bind(this);
		this.prompt = (async (question: IPrompt<unknown>) => {
			this.questions.push(String(question.message));
			return prompt(question);
		}) as TestDialogService['prompt'];
	}

	override async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.questions.push(String(confirmation.message));
		return { confirmed: true };
	}
}

/** Command+Z or Shift+Command+Z in the code editor that has the keyboard. */
function press(instantiationService: TestInstantiationService, command: typeof UndoCommand) {
	return instantiationService.invokeFunction(accessor => command.runCommand(accessor, undefined));
}

/** Typing in the editor: one edit of its text. */
function type(model: ITextModel, text: string): void {
	model.pushStackElement();
	model.pushEditOperations([], [{ range: new Range(1, model.getLineMaxColumn(1), 1, model.getLineMaxColumn(1)), text }], () => null);
	model.pushStackElement();
}

suite('BaseHalf undo in an editor of text', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Command+Z and Shift+Command+Z in a code editor leave a rename on the canvas, ask nothing, and still undo the text', async () => {
		const dialogService = new AnsweringDialogService();
		await withAsyncTestCodeEditor('note', { serviceCollection: new ServiceCollection([IDialogService, dialogService]) }, async (editor, _viewModel, instantiationService) => {
			const undoRedoService = instantiationService.get(IUndoRedoService);
			const model = editor.getModel()!;
			type(model, ' typed');
			// A rename on the canvas: a step of a place with an undo of its own.
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

			await press(instantiationService, UndoCommand);
			const atTheStep = { questions: [...dialogService.questions], runs: [...runs], text: model.getValue() };
			// The canvas undoes its own step; the editor's keys then reach the text.
			await undoRedoService.undo(canvasSource);
			await press(instantiationService, UndoCommand);
			const textUndone = model.getValue();
			await press(instantiationService, RedoCommand);
			const textRedone = model.getValue();
			// The rename is the next one to redo: Shift+Command+Z leaves it too.
			await press(instantiationService, RedoCommand);

			assert.deepStrictEqual({ atTheStep, textUndone, textRedone, questions: dialogService.questions, runs }, {
				atTheStep: { questions: [], runs: [], text: 'note typed' },
				textUndone: 'note',
				textRedone: 'note typed',
				questions: [],
				runs: ['undo']
			});
		});
	});

	test('Command+Z and Shift+Command+Z in a code editor undo and redo an edit across files that the editor made, and ask nothing', async () => {
		const dialogService = new AnsweringDialogService();
		await withAsyncTestCodeEditor('# Plan', { serviceCollection: new ServiceCollection([IDialogService, dialogService]) }, async (editor, _viewModel, instantiationService) => {
			const undoRedoService = instantiationService.get(IUndoRedoService);
			const model = editor.getModel()!;
			type(model, ' for spring');
			// A rename of a heading across notes, made with the editor's own
			// command: an edit of several files with no source.
			const other = URI.file('/workspace/links.md');
			const runs: string[] = [];
			undoRedoService.pushElement({
				type: UndoRedoElementType.Workspace,
				resources: [model.uri, other],
				label: 'Rename heading',
				code: 'test.renameSymbol',
				undo: () => { runs.push('undo'); },
				redo: () => { runs.push('redo'); },
				split: () => [model.uri, other].map(resource => ({ type: UndoRedoElementType.Resource, resource, label: 'Rename heading', code: 'test.renameSymbol', undo: () => { runs.push('undo one file'); }, redo: () => { runs.push('redo one file'); } }))
			});

			await press(instantiationService, UndoCommand);
			await press(instantiationService, RedoCommand);
			// The typing before it is still the editor's to undo.
			await press(instantiationService, UndoCommand);
			await press(instantiationService, UndoCommand);

			assert.deepStrictEqual({ questions: dialogService.questions, runs, text: model.getValue() }, {
				questions: [],
				runs: ['undo', 'redo', 'undo'],
				text: '# Plan'
			});
		});
	});
});
