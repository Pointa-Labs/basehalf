/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IBaseHalfCanvasNavigationService } from './basehalfCanvasNavigation.js';

// The shown place, for the parts of the workbench that follow the base's
// active editor (the shown place and the workbench): Files and Source Control,
// which reveal its file, and the title of the window, which names it. A folder
// is shown as a canvas and a file in Card Detail, and neither is an editor of
// the base, so such a part asks here when the base has no active editor.

/**
 * The file that Card Detail shows, or nothing while a canvas is shown or an
 * editor of the base covers the canvas.
 */
export function baseHalfShownFile(navigationService: IBaseHalfCanvasNavigationService): URI | undefined {
	return navigationService.isSurfaceActive ? navigationService.state.cardDetail?.resource : undefined;
}

/**
 * The folder whose canvas is shown, also under Card Detail, or nothing while
 * an editor of the base covers the canvas.
 */
export function baseHalfShownCanvasFolder(navigationService: IBaseHalfCanvasNavigationService): URI | undefined {
	return navigationService.isSurfaceActive ? navigationService.state.canvasFolder?.resource : undefined;
}

/** Fires when the shown place may be another: a canvas or Card Detail opened or closed, or an editor of the base came or went over the canvas. */
export function onDidChangeBaseHalfShownPlace(navigationService: IBaseHalfCanvasNavigationService): Event<void> {
	return Event.any(Event.signal(navigationService.onDidChangeState), Event.signal(navigationService.onDidChangeSurfaceActive));
}
