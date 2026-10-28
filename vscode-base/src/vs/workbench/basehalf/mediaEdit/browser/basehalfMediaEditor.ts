/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';

/**
 * What every editor of Card Detail offers it (editing media, "Editing in Card
 * Detail"): the choices it shows, each change as the user makes it, named for
 * what it did, and the choices that an undo, a redo, or Revert to Original
 * set in it.
 */
export interface IBaseHalfMediaEditor extends IDisposable {
	/** The choices as the editor shows them now, each field at its default left out. */
	readonly choices: IBaseHalfMediaChoices;
	/** A change was made and let go: its kind names its step of undo. */
	readonly onDidChange: Event<BaseHalfMediaChange>;
	/** Shows other choices, as an undo sets them; it is no change. */
	setChoices(choices: IBaseHalfMediaChoices): void;
	/** Takes the keyboard on the editor's first control. */
	focus(): void;
	/**
	 * Views the file as it is, or edits it (editing media, "Viewing and
	 * editing"): while viewing, the controls of editing do not show and take
	 * no keyboard and no pointer. An editor starts by viewing.
	 */
	setEditing(editing: boolean): void;
	/**
	 * Moves the playhead of a video or a sound by the keyboard, within the
	 * file while viewing and the original while editing (editing media, "The
	 * keyboard"). An image has none.
	 */
	movePlayhead?(move: BaseHalfPlayheadMove): void;
}

/** What a change did, which names its step: "Trim shot.mp4", "Cut take.wav", "Crop still.png". */
export type BaseHalfMediaChange = 'trim' | 'cut' | 'crop' | 'turn' | 'flip' | 'straighten';

/** A second or a frame back or on, as Left and Right move the playhead, with Shift for a frame; or to the start or the end, as Home and End do. */
export type BaseHalfPlayheadMove =
	| { readonly kind: 'step'; readonly by: 'second' | 'frame'; readonly direction: 1 | -1 }
	| { readonly kind: 'jump'; readonly to: 'start' | 'end' };
