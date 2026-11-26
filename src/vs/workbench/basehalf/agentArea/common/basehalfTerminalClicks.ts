/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What a secondary and a middle click do on the terminal of a session, as the base's settings of a terminal say
// (docs/specs/agent-area-terminal.md, Clicks).

/**
 * What a click does: show the session's menu, copy the selection and take it away, paste, give the terminal the
 * keyboard, or nothing, which leaves the click to the program.
 */
export type BaseHalfTerminalClickAction = 'menu' | 'copy' | 'paste' | 'focus' | 'none';

export interface IBaseHalfTerminalClick {
	readonly button: 'secondary' | 'middle';
	readonly shiftKey: boolean;
	/** The terminal has a selection when the click starts. */
	readonly hasSelection: boolean;
}

export interface IBaseHalfTerminalClickSettings {
	/** `terminal.integrated.rightClickBehavior` */
	readonly rightClickBehavior: unknown;
	/** `terminal.integrated.middleClickBehavior` */
	readonly middleClickBehavior: unknown;
}

export function baseHalfTerminalClickAction(click: IBaseHalfTerminalClick, settings: IBaseHalfTerminalClickSettings): BaseHalfTerminalClickAction {
	if (click.button === 'middle') {
		return settings.middleClickBehavior === 'paste' ? 'paste' : 'focus';
	}
	// Shift forces the menu, as in the base.
	if (click.shiftKey) {
		return 'menu';
	}
	switch (settings.rightClickBehavior) {
		case 'copyPaste':
			return click.hasSelection ? 'copy' : 'paste';
		case 'paste':
			return 'paste';
		case 'nothing':
			return 'none';
		default:
			// `default` and `selectWord`: the terminal selects the word itself.
			return 'menu';
	}
}
