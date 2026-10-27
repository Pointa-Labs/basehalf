/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerBaseHalfEditorOfTextUndo } from './basehalfEditorUndo.js';

/**
 * Keeps the undo of the code editors to their own text (exact undo, "Undo in
 * an editor of text"), from the window's start.
 */
class BaseHalfEditorOfTextUndoContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfEditorOfTextUndo';

	constructor(
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IUndoRedoService undoRedoService: IUndoRedoService
	) {
		super();
		this._register(registerBaseHalfEditorOfTextUndo(codeEditorService, undoRedoService));
	}
}

registerWorkbenchContribution2(BaseHalfEditorOfTextUndoContribution.ID, BaseHalfEditorOfTextUndoContribution, WorkbenchPhase.BlockRestore);
