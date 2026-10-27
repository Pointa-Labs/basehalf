/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { combinedDisposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { baseHalfEditorUndoReachesItsText } from '../common/basehalfEditorUndo.js';

/** Ahead of the code editor's own undo (10000), which asks before a step of another place. */
const EDITOR_OF_TEXT_UNDO_PRIORITY = 10_050;

/**
 * Command+Z and Shift+Command+Z in a code editor, the editors of Card Detail
 * among them, do nothing when the next step of the editor's file is a step
 * of the canvas, Card Detail's header, or Files (exact undo, "Undo in an
 * editor of text"). The editor of a note on its card keeps the same rule in
 * its own undo.
 */
export function registerBaseHalfEditorOfTextUndo(codeEditorService: ICodeEditorService, undoRedoService: IUndoRedoService): IDisposable {
	const leavesStep = (direction: 'undo' | 'redo'): boolean => {
		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor?.hasTextFocus() || !editor.hasModel()) {
			return false;
		}
		// Taking the command keeps it from the code editor's own undo.
		return !baseHalfEditorUndoReachesItsText(undoRedoService, editor.getModel().uri, direction);
	};
	return combinedDisposable(
		UndoCommand.addImplementation(EDITOR_OF_TEXT_UNDO_PRIORITY, 'basehalfEditorOfText', () => leavesStep('undo')),
		RedoCommand.addImplementation(EDITOR_OF_TEXT_UNDO_PRIORITY, 'basehalfEditorOfText', () => leavesStep('redo'))
	);
}
