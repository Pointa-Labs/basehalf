/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import {
	baseHalfCanvasSceneVideoSelectionActions,
	IBaseHalfCanvasSceneViewport,
	BaseHalfCanvasSceneVideoAction,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
	BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP,
	BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT
} from '../../common/basehalfCanvasScene.js';
import { BaseHalfVideoPanelSide, IBaseHalfVideoPanelLayout, resolveBaseHalfVideoPanelPlacement } from '../../../video/common/basehalfVideoNodePanelPlacement.js';
const SELECTION_TOOLBAR_SCREEN_GAP = 10;
const SELECTION_TOOLBAR_SCREEN_HEIGHT = 36;
const SELECTION_TOOLBAR_SCREEN_MARGIN = 8;
export const NOTE_CONTROLS_SCREEN_MARGIN = 8;
const NOTE_CONTROLS_SCREEN_GAP = 10;
const NOTE_TOOLBAR_SCREEN_WIDTH = 392;
export const NOTE_TOOLBAR_SCREEN_HEIGHT = 36;
const VIDEO_UPLOAD_TOOLBAR_SCREEN_WIDTH = 112;
/** The padding of the video toolbar and the gap between its buttons, in screen pixels. */
const VIDEO_TOOLBAR_SCREEN_PADDING = 3;
const VIDEO_TOOLBAR_SCREEN_BUTTON_GAP = 2;
/** Capture Frame carries a chevron for its menu beside its icon. */
const VIDEO_TOOLBAR_CAPTURE_BUTTON_WIDTH = 42;
const VIDEO_TOOLBAR_BUTTON_WIDTH = 28;

export interface IBaseHalfCanvasSelectionToolbarPlacement {
	readonly left: number;
	readonly top: number;
	readonly side: 'above' | 'below';
}

export function resolveBaseHalfCanvasSelectionToolbarPlacement(options: {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly viewport: IBaseHalfCanvasSceneViewport;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly toolbarWidth: number;
}): IBaseHalfCanvasSelectionToolbarPlacement {
	const zoom = Math.max(0.2, options.viewport.zoom);
	const centerScreen = ((options.left + options.right) / 2) * zoom + options.viewport.x;
	const halfToolbar = options.toolbarWidth / 2;
	const minimumCenter = SELECTION_TOOLBAR_SCREEN_MARGIN + halfToolbar;
	const maximumCenter = Math.max(minimumCenter, options.viewportWidth - SELECTION_TOOLBAR_SCREEN_MARGIN - halfToolbar);
	const clampedCenter = Math.min(maximumCenter, Math.max(minimumCenter, centerScreen));
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const bottomScreen = options.bottom * zoom + options.viewport.y;
	const required = SELECTION_TOOLBAR_SCREEN_HEIGHT + SELECTION_TOOLBAR_SCREEN_GAP + SELECTION_TOOLBAR_SCREEN_MARGIN;
	const aboveSpace = topScreen;
	const belowSpace = options.viewportHeight - bottomScreen;
	const side = aboveSpace >= required || aboveSpace >= belowSpace ? 'above' : 'below';
	const unclampedAnchor = side === 'above' ? topScreen : bottomScreen;
	const anchorScreen = side === 'above'
		? Math.max(SELECTION_TOOLBAR_SCREEN_HEIGHT + SELECTION_TOOLBAR_SCREEN_GAP, unclampedAnchor)
		: Math.min(options.viewportHeight - SELECTION_TOOLBAR_SCREEN_HEIGHT - SELECTION_TOOLBAR_SCREEN_GAP, unclampedAnchor);
	return {
		left: (clampedCenter - options.viewport.x) / zoom,
		top: (anchorScreen - options.viewport.y) / zoom,
		side
	};
}

export interface IBaseHalfCanvasNoteSelectionPlacement {
	readonly visible: boolean;
	readonly side: 'above' | 'below';
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

interface IBaseHalfCanvasAnchoredToolbarPlacementOptions {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly viewport: IBaseHalfCanvasSceneViewport;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
}

function resolveBaseHalfCanvasAnchoredToolbarPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions,
	requestedWidth: number,
	toolbarHeight: number
): IBaseHalfCanvasNoteSelectionPlacement {
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const viewportWidth = Math.max(0, options.viewportWidth);
	const viewportHeight = Math.max(0, options.viewportHeight);
	const leftScreen = options.left * zoom + options.viewport.x;
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const rightScreen = options.right * zoom + options.viewport.x;
	const bottomScreen = options.bottom * zoom + options.viewport.y;
	const visible = rightScreen >= 0
		&& leftScreen <= viewportWidth
		&& bottomScreen >= 0
		&& topScreen <= viewportHeight
		&& viewportWidth > NOTE_CONTROLS_SCREEN_MARGIN * 2
		&& viewportHeight > NOTE_CONTROLS_SCREEN_MARGIN * 2;
	const toolbarWidth = Math.max(0, Math.min(requestedWidth, viewportWidth - NOTE_CONTROLS_SCREEN_MARGIN * 2));
	const halfToolbar = toolbarWidth / 2;
	const minimumCenter = NOTE_CONTROLS_SCREEN_MARGIN + halfToolbar;
	const maximumCenter = Math.max(minimumCenter, viewportWidth - NOTE_CONTROLS_SCREEN_MARGIN - halfToolbar);
	const nodeCenterScreen = (leftScreen + rightScreen) / 2;
	const centerScreen = Math.min(maximumCenter, Math.max(minimumCenter, nodeCenterScreen));
	const aboveSpace = topScreen - NOTE_CONTROLS_SCREEN_MARGIN;
	const belowSpace = viewportHeight - bottomScreen - NOTE_CONTROLS_SCREEN_MARGIN;
	const requiredSpace = NOTE_CONTROLS_SCREEN_GAP + toolbarHeight;
	const side: IBaseHalfCanvasNoteSelectionPlacement['side'] = aboveSpace >= requiredSpace || aboveSpace >= belowSpace ? 'above' : 'below';
	const unclampedTop = side === 'above'
		? topScreen - NOTE_CONTROLS_SCREEN_GAP - toolbarHeight
		: bottomScreen + NOTE_CONTROLS_SCREEN_GAP;
	const maximumTop = Math.max(NOTE_CONTROLS_SCREEN_MARGIN, viewportHeight - NOTE_CONTROLS_SCREEN_MARGIN - toolbarHeight);
	const toolbarTopScreen = Math.min(maximumTop, Math.max(NOTE_CONTROLS_SCREEN_MARGIN, unclampedTop));
	const toFlowX = (screen: number): number => (screen - options.viewport.x) / zoom;
	const toFlowY = (screen: number): number => (screen - options.viewport.y) / zoom;
	return {
		visible,
		side,
		left: toFlowX(centerScreen - toolbarWidth / 2),
		top: toFlowY(toolbarTopScreen),
		width: toolbarWidth,
		height: toolbarHeight
	};
}

export function resolveBaseHalfCanvasNoteSelectionPlacement(options: IBaseHalfCanvasAnchoredToolbarPlacementOptions): IBaseHalfCanvasNoteSelectionPlacement {
	return resolveBaseHalfCanvasAnchoredToolbarPlacement(options, NOTE_TOOLBAR_SCREEN_WIDTH, NOTE_TOOLBAR_SCREEN_HEIGHT);
}

export function resolveBaseHalfCanvasVideoSelectionPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions & { readonly toolbarWidth: number }
): IBaseHalfCanvasNoteSelectionPlacement {
	const placement = resolveBaseHalfCanvasAnchoredToolbarPlacement(options, options.toolbarWidth, BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT);
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const topScreen = (options.top - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom + options.viewport.y;
	const hasUnobstructedSpaceAbove = topScreen - NOTE_CONTROLS_SCREEN_MARGIN
		>= BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP + BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT;
	return {
		...placement,
		visible: placement.visible && hasUnobstructedSpaceAbove,
		side: 'above'
	};
}

export function baseHalfCanvasVideoToolbarWidth(actions: readonly BaseHalfCanvasSceneVideoAction[]): number {
	const canonicalActions = baseHalfCanvasSceneVideoSelectionActions(actions);
	if (canonicalActions.length === 0) {
		return 0;
	}
	if (canonicalActions.length === 1 && canonicalActions[0] === 'importResult') {
		return VIDEO_UPLOAD_TOOLBAR_SCREEN_WIDTH;
	}
	return VIDEO_TOOLBAR_SCREEN_PADDING * 2
		+ canonicalActions.reduce((width, action) => width + (action === 'captureFrame' ? VIDEO_TOOLBAR_CAPTURE_BUTTON_WIDTH : VIDEO_TOOLBAR_BUTTON_WIDTH), 0)
		+ (canonicalActions.length - 1) * VIDEO_TOOLBAR_SCREEN_BUTTON_GAP;
}

export interface IBaseHalfCanvasVideoPanelPlacement extends IBaseHalfVideoPanelLayout {
	/** The panel's top left corner in canvas coordinates, where the scene's portal puts it. */
	readonly flowLeft: number;
	readonly flowTop: number;
}

/**
 * Places the panel of a selected Video card in screen space by
 * {@link resolveBaseHalfVideoPanelPlacement} and adds its position in canvas
 * coordinates. The card's name, and the toolbar when it shows, are above the
 * card, so a panel above the card goes above them.
 */
export function resolveBaseHalfCanvasVideoPanelPlacement(
	options: IBaseHalfCanvasAnchoredToolbarPlacementOptions & {
		readonly height: number;
		readonly toolbarShown: boolean;
		readonly keepSide?: BaseHalfVideoPanelSide;
	}
): IBaseHalfCanvasVideoPanelPlacement {
	const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, options.viewport.zoom);
	const card = {
		left: options.left * zoom + options.viewport.x,
		top: options.top * zoom + options.viewport.y,
		right: options.right * zoom + options.viewport.x,
		bottom: options.bottom * zoom + options.viewport.y
	};
	const aboveClearance = (BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * zoom
		+ (options.toolbarShown ? BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP + BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT : 0);
	const layout = resolveBaseHalfVideoPanelPlacement(card, { width: options.viewportWidth, height: options.viewportHeight }, {
		height: options.height,
		aboveClearance,
		...(options.keepSide ? { keepSide: options.keepSide } : {})
	});
	return {
		...layout,
		flowLeft: (layout.left - options.viewport.x) / zoom,
		flowTop: (layout.top - options.viewport.y) / zoom
	};
}