/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';

/**
 * Whether Command+Z (`undo`) or Shift+Command+Z (`redo`) in an editor of the
 * text of `resource` reaches an edit of that text. The next step of the file
 * that way can also be a step that changes files, a folder, or the layout,
 * which the canvas, Card Detail's header, or Files made. The editor leaves
 * that step to where it was made, and nothing asks (exact undo, "Undo in an
 * editor of text"); VS Code would ask whether to undo it.
 */
export function baseHalfEditorUndoReachesItsText(undoRedoService: Pick<IUndoRedoService, 'getElements'>, resource: URI, direction: 'undo' | 'redo'): boolean {
	const { past, future } = undoRedoService.getElements(resource);
	// The closest step of either history is the last of its list.
	const next = direction === 'undo' ? past[past.length - 1] : future[future.length - 1];
	return next === undefined || next.type === UndoRedoElementType.Resource;
}
