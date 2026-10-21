/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement, isSVGElement } from '../../../../../base/browser/dom.js';
import { BaseHalfCanvasAnchor } from '../../common/basehalfCanvasModel.js';
import { BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import { IBaseHalfCanvasArrangeCard } from '../../common/basehalfCanvasArrangement.js';
import {
	IBaseHalfCanvasSceneCard,
	IBaseHalfCanvasSceneDelegate,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneVideoPanelSurface,
	IBaseHalfCanvasSceneViewport
} from '../../common/basehalfCanvasScene.js';
import type { Connection, Edge, Node } from '@xyflow/react';
import type { ComponentType, Context, CSSProperties } from 'react';

/**
 * What each part of the scene is made with, once per mount (README.md in this
 * folder): React and React Flow as the scene loaded them, the element the scene
 * is drawn in, the canvas view that answers for the scene, and the contexts
 * that the parts share.
 */
export interface IBaseHalfCanvasSceneEnvironment {
	readonly vendor: BaseHalfCanvasReactVendor;
	/** `vendor.createElement`. */
	readonly h: BaseHalfCanvasReactVendor['createElement'];
	readonly host: HTMLElement;
	readonly delegate: IBaseHalfCanvasSceneDelegate;
	/** Hears every viewport the scene reports. */
	readonly onViewport: (viewport: IBaseHalfCanvasSceneViewport) => void;
	/** What a connection may do on the scene, given to each connection by the scene component. */
	readonly EdgeInteractionContext: Context<IBaseHalfCanvasEdgeInteraction | undefined>;
	/** How many cards are selected, so that a card shows its resize controls only alone. */
	readonly SelectionSizeContext: Context<number>;
}

interface IBaseHalfCanvasToolbarIconProps {
	readonly size?: number | string;
	readonly className?: string;
	readonly 'aria-hidden'?: boolean;
	readonly focusable?: boolean;
	readonly 'data-basehalf-icon'?: string;
}

type BaseHalfCanvasToolbarIcon = ComponentType<IBaseHalfCanvasToolbarIconProps>;

/** The icons of the Note toolbar, bundled with React. */
export interface IBaseHalfCanvasToolbarIcons {
	readonly heading1: BaseHalfCanvasToolbarIcon;
	readonly heading2: BaseHalfCanvasToolbarIcon;
	readonly heading3: BaseHalfCanvasToolbarIcon;
	readonly paragraph: BaseHalfCanvasToolbarIcon;
	readonly bold: BaseHalfCanvasToolbarIcon;
	readonly italic: BaseHalfCanvasToolbarIcon;
	readonly bulletList: BaseHalfCanvasToolbarIcon;
	readonly orderedList: BaseHalfCanvasToolbarIcon;
	readonly divider: BaseHalfCanvasToolbarIcon;
	readonly copy: BaseHalfCanvasToolbarIcon;
	readonly copied: BaseHalfCanvasToolbarIcon;
	readonly expand: BaseHalfCanvasToolbarIcon;
	readonly information: BaseHalfCanvasToolbarIcon;
	readonly more: BaseHalfCanvasToolbarIcon;
}

/**
 * React, React DOM, and React Flow as one module, with the icons of the Note
 * toolbar: what the scene loads when it mounts.
 */
export type BaseHalfCanvasReactVendor = typeof import('react') & typeof import('react-dom/client') & typeof import('@xyflow/react') & {
	readonly BaseHalfCanvasToolbarIcons: IBaseHalfCanvasToolbarIcons;
};

interface IBaseHalfCanvasFlowNodeData extends Record<string, unknown> {
	readonly card: IBaseHalfCanvasSceneCard;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly beginResize: () => void;
	readonly endResize: () => void;
}

interface IBaseHalfCanvasFlowEdgeData extends Record<string, unknown> {
	readonly edge: IBaseHalfCanvasSceneEdge;
	readonly sceneKey: string;
	readonly structuralEpoch: number;
}

/**
 * What the scene does through React Flow's store, which only a component
 * inside React Flow can reach (`ConnectionStoreBridge`).
 */
export interface IBaseHalfCanvasConnectionStoreController {
	cancel(): void;
	clearClickStart(): void;
	/** Moves the canvas by this many screen pixels. */
	panBy(x: number, y: number): void;
}

/**
 * A card as React Flow has it: the card of the snapshot, and the scene and
 * structure it was drawn for.
 */
export type BaseHalfCanvasFlowNode = Node<IBaseHalfCanvasFlowNodeData, 'basehalf-card'>;

/**
 * A connection as React Flow has it: the connection of the snapshot, and the
 * scene and structure it was drawn for.
 */
export type BaseHalfCanvasFlowEdge = Edge<IBaseHalfCanvasFlowEdgeData, 'basehalf-reference'>;

/**
 * What a connection may do on the scene. The scene component gives it to each
 * connection through `EdgeInteractionContext`.
 */
export interface IBaseHalfCanvasEdgeInteraction {
	begin(flowEdge: BaseHalfCanvasFlowEdge): boolean;
	end(): void;
	select(flowEdge: BaseHalfCanvasFlowEdge, preserveFocus?: boolean): void;
	reconnect(flowEdge: BaseHalfCanvasFlowEdge, connection: Connection): void;
	remove(flowEdge: BaseHalfCanvasFlowEdge): void;
}

/**
 * What the scene object asks of the mounted scene
 * (`useBaseHalfCanvasSceneRuntime`).
 */
export interface IBaseHalfCanvasSceneRuntime {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
	setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void;
	clearVideoPanelSurface(element: HTMLElement): void;
	setSnapEnabled(enabled: boolean): void;
	setZoom(zoom: number): Promise<void>;
	zoomBy(factor: number): Promise<void>;
	setViewportCenter(x: number, y: number, zoom?: number): Promise<void>;
	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void>;
	reveal(path: string): Promise<void>;
	screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number };
	select(selection: IBaseHalfCanvasSceneSelection): void;
	getViewport(): IBaseHalfCanvasSceneViewport;
	isInteracting(): boolean;
}

interface IBaseHalfCanvasScreenSpaceStyle extends CSSProperties {
	readonly '--basehalf-canvas-zoom': string;
	readonly '--basehalf-adjacent-chrome-travel': string;
}

/**
 * The style of a control beside a selection, which is drawn inside the zoomed
 * canvas. The zoom and the distance the control slides as it shows or hides
 * are CSS variables, so that its size and its slide stay the same on screen.
 */
export function screenSpaceCanvasStyle(zoom: number, style: CSSProperties): IBaseHalfCanvasScreenSpaceStyle {
	const safeZoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, zoom);
	return {
		...style,
		'--basehalf-canvas-zoom': String(safeZoom),
		'--basehalf-adjacent-chrome-travel': `${6 / safeZoom}px`
	};
}

/** Whether a card is a Note that is being edited on the canvas. */
export function baseHalfCanvasSceneCardIsNoteEditing(
	card: Pick<IBaseHalfCanvasSceneCard, 'controls' | 'noteEditing'>
): boolean {
	return card.controls?.kind === 'note' && card.noteEditing === true;
}

/**
 * What the user may do on the scene while picking a card for an input of a
 * Video node: move the canvas, but not move or resize cards.
 */
export function baseHalfCanvasSceneVideoInputPickGesturePolicy(videoInputPickActive: boolean): {
	readonly nodesDraggable: boolean;
	readonly nodesResizable: boolean;
	readonly viewportNavigationAllowed: boolean;
} {
	return Object.freeze({
		nodesDraggable: !videoInputPickActive,
		nodesResizable: !videoInputPickActive,
		viewportNavigationAllowed: true
	});
}

/**
 * Whether a key is an Escape that cancels what the user is doing. An Escape
 * that ends the composition of an input method is not.
 */
export function baseHalfCanvasInteractionOwnsEscape(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): boolean {
	return event.key === 'Escape' && !event.isComposing && event.keyCode !== 229;
}

/** The four sides of a card where a connection attaches. */
export const EDGE_RECONNECT_ANCHORS: readonly BaseHalfCanvasAnchor[] = ['north', 'east', 'south', 'west'];

/** Whether a target is an HTML or SVG element. */
export function isCanvasElement(target: unknown): target is Element {
	return isHTMLElement(target) || isSVGElement(target);
}

/** React Flow's position for the side of a card that an anchor names. */
export function flowPosition(vendor: BaseHalfCanvasReactVendor, anchor: BaseHalfCanvasAnchor) {
	switch (anchor) {
		case 'north': return vendor.Position.Top;
		case 'east': return vendor.Position.Right;
		case 'south': return vendor.Position.Bottom;
		case 'west': return vendor.Position.Left;
	}
}

/** The rectangle of a card as the scene has it now. */
export function flowNodeRect(node: BaseHalfCanvasFlowNode): IBaseHalfCanvasArrangeCard {
	return {
		path: node.id,
		x: node.position.x,
		y: node.position.y,
		width: node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width,
		height: node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height
	};
}

/**
 * The number of a style value given as a number or as a string such as
 * `120px`.
 */
export function numericStyle(value: string | number | undefined): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/** The card that the Video panel follows while the user moves or resizes it. */
export interface IBaseHalfCanvasVideoPanelFollow {
	readonly token: number;
	readonly path: string;
	readonly kind: 'node-move' | 'node-resize' | 'keyboard-geometry';
}