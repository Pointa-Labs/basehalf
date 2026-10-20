/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Where the panel of a selected Video node goes, and where its menus open
 * (D58, video node specification, "Placement"). Pure: the canvas scene places
 * the panel by it and the panel places its menus by it. Every value is in
 * screen pixels, relative to the canvas: the panel keeps its size at every
 * zoom, and nothing here pans or zooms the canvas.
 */

export const BASEHALF_VIDEO_PANEL_WIDTH = 512;
/** The panel's height without an input row and with a prompt of three lines. */
export const BASEHALF_VIDEO_PANEL_MIN_HEIGHT = 132;
/** The panel's height with an input row, a prompt of five lines, and a reason line of two. */
export const BASEHALF_VIDEO_PANEL_MAX_HEIGHT = 260;
/** Between the card and the panel. */
export const BASEHALF_VIDEO_PANEL_GAP = 10;
/** The panel and its menus stay this far inside the canvas. */
export const BASEHALF_VIDEO_PANEL_CANVAS_MARGIN = 12;
/**
 * The panel and its menus stay this far above the canvas's bottom edge, clear
 * of the zoom controls there (16 px up, 28 px tall), which lie over the scene
 * and would cover the model button or a menu's last items.
 */
export const BASEHALF_VIDEO_PANEL_CANVAS_BOTTOM_MARGIN = 52;
/** A card counts as on the canvas while at least this much of it is in view, in both directions. */
export const BASEHALF_VIDEO_PANEL_MIN_CARD_IN_VIEW = 24;
/** Between a menu and the control that opened it. */
export const BASEHALF_VIDEO_PANEL_MENU_GAP = 6;

export interface IBaseHalfVideoPanelRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface IBaseHalfVideoPanelSize {
	readonly width: number;
	readonly height: number;
}

export type BaseHalfVideoPanelSide = 'below' | 'above';

/** `clamped`: neither below nor above the card has room, so the panel is kept inside the canvas. */
export type BaseHalfVideoPanelPlacement = BaseHalfVideoPanelSide | 'clamped';

export interface IBaseHalfVideoPanelLayout {
	readonly placement: BaseHalfVideoPanelPlacement;
	/** The side of the card the panel is on; a clamped panel is on the side with more room. */
	readonly side: BaseHalfVideoPanelSide;
	/** False while the card is off the canvas. */
	readonly visible: boolean;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfVideoPanelPlacementOptions {
	/** The height the panel reports now. */
	readonly height: number;
	/** Screen space right above the card that the card's name and its toolbar take. */
	readonly aboveClearance?: number;
	/**
	 * While the user moves or resizes the card, the panel keeps the side it was
	 * on and follows the card, so it never jumps to the other side under the
	 * user's hand.
	 */
	readonly keepSide?: BaseHalfVideoPanelSide;
}

function finite(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return minimum > maximum ? minimum : Math.min(maximum, Math.max(minimum, value));
}

/** Whether enough of the card is in view for the panel to belong to it. */
export function baseHalfVideoPanelCardInView(card: IBaseHalfVideoPanelRect, canvas: IBaseHalfVideoPanelSize): boolean {
	const width = Math.min(finite(card.right), finite(canvas.width)) - Math.max(finite(card.left), 0);
	const height = Math.min(finite(card.bottom), finite(canvas.height)) - Math.max(finite(card.top), 0);
	return width >= BASEHALF_VIDEO_PANEL_MIN_CARD_IN_VIEW && height >= BASEHALF_VIDEO_PANEL_MIN_CARD_IN_VIEW;
}

/**
 * The panel is 512 pixels wide (less only on a canvas narrower than that), 10
 * pixels below the card and centered on it; above the card, clear of its name
 * and toolbar, when there is no room below; and inside the canvas, clamped,
 * when there is room for neither. Room is measured for the tallest panel, so
 * a prompt that grows while the user types never moves the panel to the
 * other side. The panel is hidden while the card is off the canvas.
 */
export function resolveBaseHalfVideoPanelPlacement(
	card: IBaseHalfVideoPanelRect,
	canvas: IBaseHalfVideoPanelSize,
	options: IBaseHalfVideoPanelPlacementOptions
): IBaseHalfVideoPanelLayout {
	const margin = BASEHALF_VIDEO_PANEL_CANVAS_MARGIN;
	const canvasWidth = Math.max(0, finite(canvas.width));
	const canvasHeight = Math.max(0, finite(canvas.height));
	// The lowest a panel may end.
	const floor = canvasHeight - BASEHALF_VIDEO_PANEL_CANVAS_BOTTOM_MARGIN;
	const width = Math.min(BASEHALF_VIDEO_PANEL_WIDTH, Math.max(0, canvasWidth - margin * 2));
	const height = Math.max(0, finite(options.height));
	const room = Math.max(height, BASEHALF_VIDEO_PANEL_MAX_HEIGHT);
	const clearance = Math.max(0, finite(options.aboveClearance ?? 0));
	const left = clamp((finite(card.left) + finite(card.right) - width) / 2, margin, canvasWidth - margin - width);
	const belowTop = finite(card.bottom) + BASEHALF_VIDEO_PANEL_GAP;
	const aboveBottom = finite(card.top) - clearance - BASEHALF_VIDEO_PANEL_GAP;
	let placement: BaseHalfVideoPanelPlacement;
	let side: BaseHalfVideoPanelSide;
	let top: number;
	if (options.keepSide) {
		placement = options.keepSide;
		side = options.keepSide;
		top = side === 'below' ? belowTop : aboveBottom - height;
	} else if (belowTop >= margin && belowTop + room <= floor) {
		placement = side = 'below';
		top = belowTop;
	} else if (aboveBottom - room >= margin && aboveBottom <= floor) {
		placement = side = 'above';
		top = aboveBottom - height;
	} else {
		placement = 'clamped';
		const roomBelow = floor - finite(card.bottom);
		const roomAbove = finite(card.top) - clearance - margin;
		side = roomBelow >= roomAbove ? 'below' : 'above';
		top = clamp(side === 'below' ? belowTop : aboveBottom - height, margin, floor - height);
	}
	return Object.freeze({
		placement,
		side,
		visible: width > 0 && height > 0 && baseHalfVideoPanelCardInView(card, canvas),
		left,
		top,
		width,
		height
	});
}

export interface IBaseHalfVideoPanelMenuLayout {
	/** Below the control that opened it, or upward when there is no room below. */
	readonly side: BaseHalfVideoPanelSide;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	/** The menu scrolls inside itself beyond this height. */
	readonly maxHeight: number;
}

export interface IBaseHalfVideoPanelMenuOptions {
	/** `start` lines the menu up with the control's left edge, `end` with its right edge. */
	readonly align?: 'start' | 'end';
}

/**
 * Where a menu or popover of the panel opens: below its control when it fits
 * there or when below has more room, upward otherwise; always inside the
 * canvas, horizontally clamped, and no taller than the room on its side.
 * `trigger` and the result are relative to the canvas.
 */
export function resolveBaseHalfVideoPanelMenuPlacement(
	trigger: IBaseHalfVideoPanelRect,
	canvas: IBaseHalfVideoPanelSize,
	menu: IBaseHalfVideoPanelSize,
	options?: IBaseHalfVideoPanelMenuOptions
): IBaseHalfVideoPanelMenuLayout {
	const margin = BASEHALF_VIDEO_PANEL_CANVAS_MARGIN;
	const gap = BASEHALF_VIDEO_PANEL_MENU_GAP;
	const canvasWidth = Math.max(0, finite(canvas.width));
	const canvasHeight = Math.max(0, finite(canvas.height));
	const width = Math.min(Math.max(0, finite(menu.width)), Math.max(0, canvasWidth - margin * 2));
	const wanted = Math.max(0, finite(menu.height));
	const roomBelow = Math.max(0, canvasHeight - BASEHALF_VIDEO_PANEL_CANVAS_BOTTOM_MARGIN - (finite(trigger.bottom) + gap));
	const roomAbove = Math.max(0, finite(trigger.top) - gap - margin);
	const side: BaseHalfVideoPanelSide = wanted <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';
	const maxHeight = side === 'below' ? roomBelow : roomAbove;
	const height = Math.min(wanted, maxHeight);
	const desiredLeft = options?.align === 'end' ? finite(trigger.right) - width : finite(trigger.left);
	return Object.freeze({
		side,
		left: clamp(desiredLeft, margin, canvasWidth - margin - width),
		top: side === 'below' ? finite(trigger.bottom) + gap : finite(trigger.top) - gap - height,
		width,
		maxHeight
	});
}
