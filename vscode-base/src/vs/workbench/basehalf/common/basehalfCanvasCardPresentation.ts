/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type BaseHalfCanvasCardPresentation = 'shell' | 'preview' | 'interactive';

export const BASEHALF_CANVAS_CARD_SHELL_ENTER_ZOOM = 0.35;
export const BASEHALF_CANVAS_CARD_SHELL_EXIT_ZOOM = 0.45;
export const BASEHALF_CANVAS_CARD_SHELL_ENTER_SCREEN_HEIGHT = 72;
export const BASEHALF_CANVAS_CARD_SHELL_EXIT_SCREEN_HEIGHT = 96;

/**
 * Keep one continuous card design while making unreadable far-away content
 * cheap. The gap between enter and exit thresholds prevents small wheel or
 * trackpad reversals from repeatedly rebuilding the preview near the boundary.
 */
export function baseHalfCanvasCardPresentation(
	height: number,
	zoom: number,
	interactive: boolean,
	previous: BaseHalfCanvasCardPresentation = 'shell'
): BaseHalfCanvasCardPresentation {
	if (interactive) {
		return 'interactive';
	}

	const projectedHeight = height * zoom;
	if (previous === 'shell') {
		return zoom > BASEHALF_CANVAS_CARD_SHELL_EXIT_ZOOM
			&& projectedHeight > BASEHALF_CANVAS_CARD_SHELL_EXIT_SCREEN_HEIGHT
			? 'preview'
			: 'shell';
	}

	return zoom < BASEHALF_CANVAS_CARD_SHELL_ENTER_ZOOM
		|| projectedHeight < BASEHALF_CANVAS_CARD_SHELL_ENTER_SCREEN_HEIGHT
		? 'shell'
		: 'preview';
}
