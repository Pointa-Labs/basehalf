/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Undo of a note in Rich (exact undo): the collaboration undo manager that
// Rich owns, apart from the editor, so that Rich's bundle test runs the same
// undo as Card Detail.

import type { EditorView } from '@tiptap/pm/view';
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { UndoManager, type XmlFragment } from 'yjs';

/** What undo needs of the editor: its view, and its own Undo and Redo. */
export interface IBaseHalfNoteUndoEditor {
	readonly prosemirrorView?: EditorView;
	undo(): boolean;
	redo(): boolean;
}

export interface IBaseHalfNoteUndo {
	/**
	 * The undo manager of the editor's undo plugin, made live first when the
	 * plugin still holds one that a plugin-view teardown destroyed. Undefined
	 * while the editor has no collaboration plugins.
	 */
	ensure(): UndoManager | undefined;
	/** The manager that {@link ensure} made live last, also while the editor has no view. */
	readonly current: UndoManager | undefined;
	/** Undo as the Undo command runs it: one step, with typing before and after it kept out of that step. */
	undo(): boolean;
	/** Redo as the Redo command runs it, fenced as {@link undo} is. */
	redo(): boolean;
	/** Keeps the next shared transaction from carrying a selection that an undo would restore. */
	discardSelectionForNextSharedTransaction(): void;
}

export function createBaseHalfNoteUndo(editor: IBaseHalfNoteUndoEditor): IBaseHalfNoteUndo {
	let live: UndoManager | undefined;

	// y-prosemirror creates the collaboration undo manager in plugin state but
	// destroys it from plugin-view teardown, and plugin state survives that
	// teardown. This webview goes through plugin-view destroy/create cycles at
	// startup (an editor unmount/remount plus a plugin reconfiguration), after
	// which the plugin state still holds the destroyed manager and no local
	// edit is ever captured again — undo stays permanently empty. Own the
	// manager lifecycle instead: swap in a manager whose destroy survives
	// plugin-view churn (document teardown clears its doc listener) and mirror
	// the plugin's selection-restore listeners.
	const ensure = (): UndoManager | undefined => {
		const view = editor.prosemirrorView;
		if (!view) {
			return undefined;
		}
		const syncState = ySyncPluginKey.getState(view.state) as { type?: XmlFragment } | undefined;
		const undoState = yUndoPluginKey.getState(view.state) as { undoManager: UndoManager; prevSel?: unknown } | undefined;
		if (!syncState?.type || !undoState?.undoManager) {
			return undefined;
		}
		if (undoState.undoManager === live) {
			return undoState.undoManager;
		}

		// Truly dispose whatever is being replaced — instance destroy may be
		// our own no-op override, so go through the prototype.
		const replaced = undoState.undoManager;
		UndoManager.prototype.destroy.call(replaced);
		if (live && live !== replaced) {
			UndoManager.prototype.destroy.call(live);
		}
		const manager = new UndoManager(syncState.type, {
			trackedOrigins: new Set([ySyncPluginKey]),
			deleteFilter: item => defaultDeleteFilter(item, defaultProtectedNodes),
			captureTransaction: transaction => transaction.meta.get('addToHistory') !== false,
		});
		manager.destroy = () => { /* must outlive plugin-view teardown */ };
		manager.on('stack-item-added', ({ stackItem }) => {
			const state = editor.prosemirrorView?.state;
			const binding = state ? (ySyncPluginKey.getState(state) as { binding?: object } | undefined)?.binding : undefined;
			if (binding && state) {
				stackItem.meta.set(binding, (yUndoPluginKey.getState(state) as { prevSel?: unknown } | undefined)?.prevSel ?? null);
			}
		});
		manager.on('stack-item-popped', ({ stackItem }) => {
			const state = editor.prosemirrorView?.state;
			const binding = state
				? (ySyncPluginKey.getState(state) as { binding?: { beforeTransactionSelection: unknown } } | undefined)?.binding
				: undefined;
			if (binding) {
				binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
			}
		});
		// Preserve any history the replaced manager still held (e.g. a stack
		// restored by a fork merge) so the swap is lossless.
		manager.undoStack = replaced.undoStack;
		manager.redoStack = replaced.redoStack;
		undoState.undoManager = manager;
		live = manager;
		return manager;
	};

	return {
		ensure,
		get current() {
			return live;
		},
		undo: () => {
			const undoManager = ensure();
			undoManager?.stopCapturing();
			const handled = editor.undo();
			undoManager?.stopCapturing();
			return handled;
		},
		redo: () => {
			const undoManager = ensure();
			undoManager?.stopCapturing();
			const handled = editor.redo();
			undoManager?.stopCapturing();
			return handled;
		},
		discardSelectionForNextSharedTransaction: () => {
			const viewState = editor.prosemirrorView?.state;
			const binding = viewState
				? (ySyncPluginKey.getState(viewState) as {
					binding?: { beforeTransactionSelection: unknown };
				} | undefined)?.binding
				: undefined;
			if (binding) {
				binding.beforeTransactionSelection = { type: 'text', anchor: null, head: null };
			}
		},
	};
}
