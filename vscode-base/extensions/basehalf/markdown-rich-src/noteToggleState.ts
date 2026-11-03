/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { defaultToggledState } from '@blocknote/core';

/**
 * Whether each toggle of Rich shows open (note formats, rule 40). The file
 * keeps how a toggle first shows; folding a toggle is this view's alone: it
 * writes nothing, is no step of undo, and lasts while the note stays open.
 */
export interface IBaseHalfNoteToggleState {
	/** The ids of the toggles the file stores open. */
	initiallyOpen: ReadonlySet<string>;
	/** What the user folded or unfolded in this view, by id. */
	readonly folds: Map<string, boolean>;
}

export const baseHalfNoteToggleState: IBaseHalfNoteToggleState = { initiallyOpen: new Set(), folds: new Map() };

/**
 * Opens, through its own button, each toggle the file stores open that the
 * editor shows closed: a note read into blocks the editor already held was
 * drawn before the state had its toggles (rule 40).
 */
export function openBaseHalfNoteStoredOpenToggles(root: ParentNode): void {
	for (const id of baseHalfNoteToggleState.initiallyOpen) {
		if (!baseHalfNoteToggleState.folds.has(id)) {
			root.querySelector<HTMLButtonElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"] > .bn-block-content .bn-toggle-wrapper[data-show-children="false"] > .bn-toggle-button`)?.click();
		}
	}
}

/**
 * Makes the editor's toggles ask Rich's state instead of the browser's
 * storage. The editor reads the state when it draws a toggle, so a load
 * gives the state its toggles before it gives the editor its blocks. It
 * runs before the first load, from the bundle itself: the editor's own
 * modules hold the object it changes.
 */
export function installBaseHalfNoteToggleState(): void {
	// The editor asks also for a toggle it no longer holds, as undefined.
	defaultToggledState.get = block => !!block && (baseHalfNoteToggleState.folds.get(block.id) ?? baseHalfNoteToggleState.initiallyOpen.has(block.id));
	defaultToggledState.set = (block, open) => {
		if (block) {
			baseHalfNoteToggleState.folds.set(block.id, open);
		}
	};
	// What the editor kept in the browser's storage before Rich kept folding itself.
	try {
		for (let index = window.localStorage.length - 1; index >= 0; index--) {
			const key = window.localStorage.key(index);
			if (key?.startsWith('toggle-')) {
				window.localStorage.removeItem(key);
			}
		}
	} catch {
		// Without storage nothing was kept there.
	}
}
