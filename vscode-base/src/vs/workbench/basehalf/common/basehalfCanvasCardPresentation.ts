/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type BaseHalfCanvasCardPresentation = 'shell' | 'preview' | 'interactive';

export interface IBaseHalfCanvasCardPresentationContext {
	readonly forceInteractive: boolean;
	readonly nearViewport: boolean;
	readonly selected: boolean;
	readonly selectionSize: number;
}

/**
 * Visible cards retain one static preview at every zoom. Only explicit
 * single-card interaction promotes that preview to its live controls.
 */
export function baseHalfCanvasCardPresentation(
	context: IBaseHalfCanvasCardPresentationContext
): BaseHalfCanvasCardPresentation {
	if (context.forceInteractive) {
		return 'interactive';
	}
	if (!context.nearViewport) {
		return 'shell';
	}
	if (context.selected && context.selectionSize === 1) {
		return 'interactive';
	}
	return 'preview';
}
