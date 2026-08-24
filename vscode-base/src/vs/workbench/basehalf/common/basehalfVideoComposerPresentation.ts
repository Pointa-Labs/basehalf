/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export const BASEHALF_VIDEO_COMPOSER_WIDTH = 512;
export const BASEHALF_VIDEO_COMPOSER_HEIGHT = 160;
export const BASEHALF_VIDEO_COMPOSER_GAP = 10;
export const BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN = 12;
export const BASEHALF_VIDEO_COMPOSER_RESPONSIVE_THRESHOLD = 536;
export const BASEHALF_VIDEO_COMPOSER_MIN_ANCHOR_INTERSECTION = 24;
export const BASEHALF_VIDEO_COMPOSER_FIRST_MOUNT_PAN_LIMIT = 96;

export type BaseHalfVideoComposerPlacement = 'below' | 'above' | 'clamped-below' | 'clamped-above';
export type BaseHalfVideoComposerDirectManipulation = 'node-move' | 'node-resize' | 'keyboard-geometry';
export type BaseHalfVideoComposerVisibility = 'visible' | 'manipulating' | 'anchor-offscreen';

export interface IBaseHalfVideoComposerRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface IBaseHalfVideoComposerViewport {
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfVideoComposerLayout {
	readonly placement: BaseHalfVideoComposerPlacement;
	readonly visibility: BaseHalfVideoComposerVisibility;
	readonly visible: boolean;
	readonly left: number;
	readonly top: number;
	readonly screenWidth: number;
	readonly screenHeight: number;
}

export interface IBaseHalfVideoComposerManipulationLock {
	readonly placement: BaseHalfVideoComposerPlacement;
	readonly leftFromAnchor: number;
	readonly topFromAnchor: number;
	readonly screenWidth: number;
	readonly screenHeight: number;
}

export interface IBaseHalfVideoComposerFirstMountPan {
	readonly x: number;
	readonly y: number;
}

export type BaseHalfVideoComposerFooterControl = 'primary' | 'status' | 'model' | 'settings' | 'attempts' | 'metadata';

export interface IBaseHalfVideoComposerFooterPresentation {
	readonly density: 'canonical' | 'compact' | 'narrow';
	readonly controls: readonly BaseHalfVideoComposerFooterControl[];
	readonly modelMaximumWidth: number;
	readonly labelsTruncate: true;
}

function finite(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return minimum > maximum ? minimum : Math.min(maximum, Math.max(minimum, value));
}

function composerScreenSize(viewport: IBaseHalfVideoComposerViewport): { readonly width: number; readonly height: number } {
	const width = Math.max(0, finite(viewport.width));
	const height = Math.max(0, finite(viewport.height));
	return {
		width: Math.min(BASEHALF_VIDEO_COMPOSER_WIDTH, Math.max(0, width - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN * 2)),
		height: Math.min(BASEHALF_VIDEO_COMPOSER_HEIGHT, Math.max(0, height - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN * 2))
	};
}

export function baseHalfVideoComposerAnchorIntersection(
	anchor: IBaseHalfVideoComposerRect,
	viewport: IBaseHalfVideoComposerViewport
): { readonly width: number; readonly height: number } {
	const viewportWidth = Math.max(0, finite(viewport.width));
	const viewportHeight = Math.max(0, finite(viewport.height));
	return {
		width: Math.max(0, Math.min(finite(anchor.right), viewportWidth) - Math.max(finite(anchor.left), 0)),
		height: Math.max(0, Math.min(finite(anchor.bottom), viewportHeight) - Math.max(finite(anchor.top), 0))
	};
}

export function baseHalfVideoComposerAnchorIsVisible(
	anchor: IBaseHalfVideoComposerRect,
	viewport: IBaseHalfVideoComposerViewport
): boolean {
	const intersection = baseHalfVideoComposerAnchorIntersection(anchor, viewport);
	return intersection.width >= BASEHALF_VIDEO_COMPOSER_MIN_ANCHOR_INTERSECTION
		&& intersection.height >= BASEHALF_VIDEO_COMPOSER_MIN_ANCHOR_INTERSECTION;
}

export function resolveBaseHalfVideoComposerPlacement(
	anchor: IBaseHalfVideoComposerRect,
	viewport: IBaseHalfVideoComposerViewport
): IBaseHalfVideoComposerLayout {
	const viewportWidth = Math.max(0, finite(viewport.width));
	const viewportHeight = Math.max(0, finite(viewport.height));
	const size = composerScreenSize(viewport);
	const desiredLeft = (finite(anchor.left) + finite(anchor.right) - size.width) / 2;
	const left = clamp(
		desiredLeft,
		BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN,
		viewportWidth - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - size.width
	);
	const belowTop = finite(anchor.bottom) + BASEHALF_VIDEO_COMPOSER_GAP;
	const aboveTop = finite(anchor.top) - BASEHALF_VIDEO_COMPOSER_GAP - size.height;
	const belowFits = belowTop >= BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
		&& belowTop + size.height <= viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN;
	const aboveFits = aboveTop >= BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
		&& aboveTop + size.height <= viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN;
	let placement: BaseHalfVideoComposerPlacement;
	let top: number;
	if (belowFits) {
		placement = 'below';
		top = belowTop;
	} else if (aboveFits) {
		placement = 'above';
		top = aboveTop;
	} else {
		const usableBelow = Math.max(0, viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - finite(anchor.bottom));
		const usableAbove = Math.max(0, finite(anchor.top) - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN);
		const below = usableBelow >= usableAbove;
		placement = below ? 'clamped-below' : 'clamped-above';
		top = clamp(
			below ? belowTop : aboveTop,
			BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN,
			viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - size.height
		);
	}
	const visible = size.width > 0 && size.height > 0 && baseHalfVideoComposerAnchorIsVisible(anchor, viewport);
	return Object.freeze({
		placement,
		visibility: visible ? 'visible' : 'anchor-offscreen',
		visible,
		left,
		top,
		screenWidth: size.width,
		screenHeight: size.height
	});
}

export function createBaseHalfVideoComposerManipulationLock(
	anchor: IBaseHalfVideoComposerRect,
	layout: Pick<IBaseHalfVideoComposerLayout, 'placement' | 'left' | 'top' | 'screenWidth' | 'screenHeight'>
): IBaseHalfVideoComposerManipulationLock {
	return Object.freeze({
		placement: layout.placement,
		leftFromAnchor: layout.left - finite(anchor.left),
		topFromAnchor: layout.top - finite(anchor.top),
		screenWidth: layout.screenWidth,
		screenHeight: layout.screenHeight
	});
}

export function followBaseHalfVideoComposerManipulation(
	anchor: IBaseHalfVideoComposerRect,
	lock: IBaseHalfVideoComposerManipulationLock
): IBaseHalfVideoComposerLayout {
	return Object.freeze({
		placement: lock.placement,
		visibility: 'manipulating',
		visible: true,
		left: finite(anchor.left) + lock.leftFromAnchor,
		top: finite(anchor.top) + lock.topFromAnchor,
		screenWidth: lock.screenWidth,
		screenHeight: lock.screenHeight
	});
}

/**
 * Returns the smallest screen-space viewport translation that makes the card
 * and canonical below-Composer pair reachable. A translation is rejected as a
 * whole when either axis exceeds its independent cap or when the pair cannot
 * fit without resizing.
 */
export function resolveBaseHalfVideoComposerFirstMountPan(
	anchor: IBaseHalfVideoComposerRect,
	viewport: IBaseHalfVideoComposerViewport
): IBaseHalfVideoComposerFirstMountPan {
	const viewportWidth = Math.max(0, finite(viewport.width));
	const viewportHeight = Math.max(0, finite(viewport.height));
	const size = composerScreenSize(viewport);
	const composerLeft = (finite(anchor.left) + finite(anchor.right) - size.width) / 2;
	const pairLeft = Math.min(finite(anchor.left), composerLeft);
	const pairRight = Math.max(finite(anchor.right), composerLeft + size.width);
	const pairTop = finite(anchor.top);
	const pairBottom = finite(anchor.bottom) + BASEHALF_VIDEO_COMPOSER_GAP + size.height;
	const availableWidth = viewportWidth - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN * 2;
	const availableHeight = viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN * 2;
	if (pairRight - pairLeft > availableWidth || pairBottom - pairTop > availableHeight) {
		return Object.freeze({ x: 0, y: 0 });
	}
	const x = pairLeft < BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
		? BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - pairLeft
		: pairRight > viewportWidth - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
			? viewportWidth - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - pairRight
			: 0;
	const y = pairTop < BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
		? BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - pairTop
		: pairBottom > viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN
			? viewportHeight - BASEHALF_VIDEO_COMPOSER_VIEWPORT_MARGIN - pairBottom
			: 0;
	const xLimit = Math.min(BASEHALF_VIDEO_COMPOSER_FIRST_MOUNT_PAN_LIMIT, viewportWidth * 0.25);
	const yLimit = Math.min(BASEHALF_VIDEO_COMPOSER_FIRST_MOUNT_PAN_LIMIT, viewportHeight * 0.25);
	if (Math.abs(x) > xLimit || Math.abs(y) > yLimit) {
		return Object.freeze({ x: 0, y: 0 });
	}
	return Object.freeze({ x, y });
}

export function createBaseHalfVideoComposerFooterPresentation(availableWidth: number): IBaseHalfVideoComposerFooterPresentation {
	const width = Math.max(0, finite(availableWidth));
	return Object.freeze({
		density: width >= BASEHALF_VIDEO_COMPOSER_WIDTH ? 'canonical' : width >= 400 ? 'compact' : 'narrow',
		controls: Object.freeze<BaseHalfVideoComposerFooterControl[]>([
			'primary',
			'status',
			'model',
			'settings',
			'attempts',
			'metadata'
		]),
		modelMaximumWidth: width >= BASEHALF_VIDEO_COMPOSER_WIDTH ? 152 : width >= 400 ? 128 : 92,
		labelsTruncate: true
	});
}
