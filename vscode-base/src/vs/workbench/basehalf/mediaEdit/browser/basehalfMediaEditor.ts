/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IBaseHalfMediaChoices } from '../common/basehalfEditRecord.js';

/**
 * What every editor of Card Detail's edit mode offers it (editing media,
 * "Edit mode in Card Detail"): the choices it holds, the undo and redo of its
 * own changes, a state in which a save runs, and a line of status.
 */
export interface IBaseHalfMediaEditor extends IDisposable {
	/** The choices as the editor holds them now, each field at its default left out. */
	readonly choices: IBaseHalfMediaChoices;
	/** The choices changed. */
	readonly onDidChange: Event<void>;
	/** Enter on a control of the editor: Card Detail saves, as Done does. */
	readonly onDidRequestSave: Event<void>;
	/** Undoes the editor's last change; false when there is none. */
	undo(): boolean;
	redo(): boolean;
	/** While a save runs, the controls change nothing. */
	setBusy(busy: boolean): void;
	/** The line under the editor; it keeps its height while it is empty. */
	setStatus(status: IBaseHalfMediaEditStatus | undefined): void;
	/** Takes the keyboard on the editor's first control. */
	focus(): void;
}

export interface IBaseHalfMediaEditStatus {
	readonly text: string;
	readonly error?: boolean;
}
