/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { ICodeEditor, IDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

/** What a surface says of the text editor it shows. */
export interface IBaseHalfShownTextEditor {
	readonly control: ICodeEditor | IDiffEditor;
	/** What the status bar and its pickers read and change the file through. */
	readonly input?: EditorInput;
}

/**
 * The text editor that Card Detail or a card shows. Neither is an editor pane, so VS
 * Code's editor service knows nothing of it, while it is the window's text editor as
 * an editor in a tab is (code cards, rule 27): Go to Line, the palette, the status bar,
 * and the marks of changed lines read it from here when no pane has one. A module of
 * its own, so that VS Code's files need one import and nothing of the canvas.
 */
class BaseHalfShownTextEditors {
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private owner: object | undefined;
	private shown: IBaseHalfShownTextEditor | undefined;

	get current(): IBaseHalfShownTextEditor | undefined {
		return this.shown;
	}

	/** `owner` shows this editor. What it replaces is told by its own `clear`, which then does nothing. */
	set(owner: object, shown: IBaseHalfShownTextEditor): void {
		if (this.owner === owner && this.shown?.control === shown.control && this.shown.input === shown.input) {
			return;
		}
		this.owner = owner;
		this.shown = shown;
		this._onDidChange.fire();
	}

	clear(owner: object): void {
		if (this.owner !== owner) {
			return;
		}
		this.owner = undefined;
		this.shown = undefined;
		this._onDidChange.fire();
	}
}

export const baseHalfShownTextEditors = new BaseHalfShownTextEditors();
