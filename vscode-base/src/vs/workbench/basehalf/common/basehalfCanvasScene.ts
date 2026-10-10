/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasBounds, IBaseHalfCanvasEdge, BaseHalfCanvasItemKind } from './basehalfCanvasModel.js';
import type { BaseHalfCanvasCardPresentation } from './basehalfCanvasCardPresentation.js';
import type { BaseHalfMarkdownFormatCommand, IBaseHalfMarkdownFormatState } from './basehalfMarkdownFormatting.js';

export const BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT = 'basehalf-note-toolbar-focus';
export const BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT = 'basehalf-note-format-state';
export const BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP = 8;
export const BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT = 24;
/** Mirrors `--bh-card-radius`; the corner resize targets follow this arc. */
export const BASEHALF_CANVAS_CARD_CORNER_RADIUS = 22;
export const BASEHALF_CANVAS_VIDEO_COMPOSER_LAYOUT_EVENT = 'basehalf-video-composer-layout';
export const BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_GAP = 10;
export const BASEHALF_CANVAS_VIDEO_TOOLBAR_SCREEN_HEIGHT = 36;

export type IBaseHalfCanvasNoteFormatState = IBaseHalfMarkdownFormatState;

export const BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE: IBaseHalfCanvasNoteFormatState = Object.freeze({
	ready: false,
	editable: false,
	blockType: 'paragraph',
	bold: false,
	italic: false,
});

export type BaseHalfCanvasNoteBackground = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple';

/** A pointer location measured in the unscaled body of a Markdown card. */
export interface IBaseHalfCanvasNoteEditPoint {
	readonly x: number;
	readonly y: number;
}

export interface IBaseHalfCanvasSceneCardPresentation {
	readonly level: BaseHalfCanvasCardPresentation;
	readonly height: number;
}

export type BaseHalfCanvasSceneVideoAction = 'importResult' | 'openFullPreview' | 'copySettings' | 'showDetails' | 'more';

const BASEHALF_CANVAS_VIDEO_RESULT_ACTION_ORDER: readonly BaseHalfCanvasSceneVideoAction[] = Object.freeze([
	'copySettings',
	'showDetails',
	'more',
	'openFullPreview'
]);

/**
 * Keeps the selected-video surface state-specific. Import belongs exclusively
 * to an empty Draft; a malformed projection must never mix that write action
 * with sealed-Result actions in one toolbar.
 */
export function baseHalfCanvasSceneVideoSelectionActions(
	actions: readonly BaseHalfCanvasSceneVideoAction[]
): readonly BaseHalfCanvasSceneVideoAction[] {
	if (actions.includes('importResult')) {
		return Object.freeze<BaseHalfCanvasSceneVideoAction[]>(['importResult']);
	}
	const advertised = new Set(actions);
	return Object.freeze(BASEHALF_CANVAS_VIDEO_RESULT_ACTION_ORDER.filter(action => advertised.has(action)));
}

export type BaseHalfCanvasSceneCardControls =
	| {
		readonly kind: 'pending';
	}
	| {
		readonly kind: 'note';
		readonly formatState?: IBaseHalfCanvasNoteFormatState;
		readonly background?: BaseHalfCanvasNoteBackground;
	}
	| {
		readonly kind: 'video';
		readonly actions: readonly BaseHalfCanvasSceneVideoAction[];
	};

export type BaseHalfCanvasSceneSelectionSurface = 'none' | 'pending' | 'structural' | 'note' | 'video';

export function baseHalfCanvasSceneSelectionSurface(
	cards: readonly Pick<IBaseHalfCanvasSceneCard, 'controls'>[]
): BaseHalfCanvasSceneSelectionSurface {
	if (cards.length === 0) {
		return 'none';
	}
	if (cards.length === 1) {
		const controls = cards[0].controls;
		if (controls?.kind === 'pending' || controls?.kind === 'note' || controls?.kind === 'video') {
			return controls.kind;
		}
	}
	return 'structural';
}

/**
 * The narrow, service-free protocol between BaseHalf's VS Code workbench
 * controller and the in-document React Flow renderer island.
 *
 * The downstream nodes' upstream lists (read through the reference index) and
 * the canvas mirror remain persisted truth; `canvas.yaml` edge rows are anchor
 * memory only. These DTOs describe only the live scene projection and user
 * intents emitted from it.
 */
export interface IBaseHalfCanvasSceneCard extends IBaseHalfCanvasBounds {
	readonly path: string;
	readonly kind: BaseHalfCanvasItemKind;
	/** Selection chrome is an explicit product projection. The renderer never
	 *  infers a file type from a path or from authored card DOM. */
	readonly controls?: BaseHalfCanvasSceneCardControls;
	/** The visible card title is stored inside this resource, so the structural
	 *  rename action changes only its filename. */
	readonly renameChangesPathOnly?: true;
	/** Product card contents are still authored by the workbench. React Flow owns
	 *  the node wrapper, geometry, selection, handles, and resize interaction. */
	readonly element: HTMLElement;
	/** The scene reports only meaningful presentation changes. The workbench
	 *  keeps one card body alive at a time and owns its resource lifecycle. */
	readonly updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => void;
	/** The scene calls this once it has put `element` into the document in
	 *  place of the card's previous element. Until then the previous element
	 *  is the one on screen, so the workbench keeps its listeners. */
	readonly didMountElement?: () => void;
	/** An explicitly open in-card surface (for example a Badge face or editor)
	 *  stays mounted while selection catches up with a replacement snapshot. */
	readonly forceInteractive?: true;
	/** Only the Markdown Note inline editor suppresses structural controls and
	 *  retains the static preview beneath its live editing overlay. */
	readonly noteEditing?: true;
	/** Set when this card can never receive a connection right now (an
	 *  upstream-only file, a running node, or a sidecar target in a folder where
	 *  BaseHalf writes no metadata). The renderer refuses a connection or a
	 *  target-end reconnect into it with this explanation instead of showing an
	 *  optimistic edge. */
	readonly upstreamRefusal?: string;
}

/**
 * Why a connection into `target` is refused before any optimistic edge is
 * shown, if it is. A reconnect that keeps its target (`previousTargetPath`)
 * is never refused here: it does not add a connection into that card.
 */
export function baseHalfCanvasSceneConnectionRefusal(
	target: Pick<IBaseHalfCanvasSceneCard, 'path' | 'upstreamRefusal'>,
	previousTargetPath?: string
): string | undefined {
	return target.path === previousTargetPath ? undefined : target.upstreamRefusal;
}

export interface IBaseHalfCanvasSceneEdge extends IBaseHalfCanvasEdge {
	readonly id: string;
	/** Endpoint kinds belong to the rendered scene snapshot, not to canvas.yaml.
	 *  They let the controller reject a gesture if a path was replaced by a
	 *  different filesystem kind before the intent commits. */
	readonly fromKind: BaseHalfCanvasItemKind;
	readonly toKind: BaseHalfCanvasItemKind;
}

export interface IBaseHalfCanvasSceneViewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

/**
 * Workbench-authored Video Composer content that the live scene positions next
 * to one card. The workbench owns the element and every product interaction
 * inside it; React Flow owns only mounting, visibility, and screen placement.
 */
export interface IBaseHalfCanvasSceneVideoComposerSurface {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly path: string;
	readonly element: HTMLElement;
	readonly screenWidth: number;
	readonly screenHeight: number;
}

export interface IBaseHalfCanvasSceneVideoComposerLayout {
	readonly placement: 'below';
	readonly visible: boolean;
	/** Screen-space offset from the live canvas host, not a document coordinate. */
	readonly left: number;
	/** Screen-space offset from the live canvas host, not a document coordinate. */
	readonly top: number;
	readonly screenWidth: number;
	readonly screenHeight: number;
}

export interface IBaseHalfCanvasSceneSnapshot {
	/** Workspace + folder identity. A key change replaces the whole scene. */
	readonly key: string;
	/** Workspace path-identity generation. A rename/delete invalidates every
	 *  gesture that began from an older structural snapshot. */
	readonly structuralEpoch: number;
	/** Monotonic controller revision within one key. */
	readonly revision: number;
	readonly cards: readonly IBaseHalfCanvasSceneCard[];
	readonly edges: readonly IBaseHalfCanvasSceneEdge[];
	readonly selectedCardPaths?: readonly string[];
	readonly selectedEdgeId?: string;
}

export interface IBaseHalfCanvasSceneGeometry extends IBaseHalfCanvasBounds {
	readonly path: string;
	readonly kind: BaseHalfCanvasItemKind;
}

export interface IBaseHalfCanvasSceneConnection {
	/** Directed context flow: the source card's context becomes available to
	 *  the target card. */
	readonly from: string;
	readonly fromKind: BaseHalfCanvasItemKind;
	readonly fromAnchor: IBaseHalfCanvasEdge['from_anchor'];
	readonly to: string;
	readonly toKind: BaseHalfCanvasItemKind;
	readonly toAnchor: IBaseHalfCanvasEdge['to_anchor'];
}

/** A completed source-handle gesture whose pointer landed on empty canvas.
 *  The controller may offer compatible result-producing operations, but no
 *  scene or file mutation has happened when this intent is emitted. */
export interface IBaseHalfCanvasSceneConnectionDrop {
	readonly from: string;
	readonly fromKind: BaseHalfCanvasItemKind;
	readonly fromAnchor: IBaseHalfCanvasEdge['from_anchor'];
	/** The release point in canvas coordinates. */
	readonly position: { readonly x: number; readonly y: number };
	/** The release point in client coordinates, where the create menu opens. */
	readonly anchor: { readonly x: number; readonly y: number };
}

/** Resolves the only connection completion that may open a create menu. A
 *  cancelled gesture or any gesture ending on a node has no persistent intent. */
export function resolveBaseHalfCanvasSceneConnectionDrop(
	source: Omit<IBaseHalfCanvasSceneConnectionDrop, 'position' | 'anchor'> | undefined,
	targetPresent: boolean,
	position: { readonly x: number; readonly y: number },
	anchor: { readonly x: number; readonly y: number }
): IBaseHalfCanvasSceneConnectionDrop | undefined {
	if (!source || targetPresent) {
		return undefined;
	}
	return Object.freeze({
		...source,
		position: Object.freeze({ x: position.x, y: position.y }),
		anchor: Object.freeze({ x: anchor.x, y: anchor.y })
	});
}

/** The side of a target card that faces a source anchor. */
export function baseHalfCanvasOppositeAnchor(anchor: IBaseHalfCanvasEdge['from_anchor']): IBaseHalfCanvasEdge['to_anchor'] {
	switch (anchor) {
		case 'north': return 'south';
		case 'east': return 'west';
		case 'south': return 'north';
		case 'west': return 'east';
	}
}

/** The largest capture-circle radius of a connection handle, in flow pixels:
 *  it stays on the straight part of its side, clear of the corner resize
 *  bands. The 24-screen-pixel target and the visible-circle floor are applied
 *  in CSS at the live zoom. */
export function baseHalfCanvasConnectHandleReachLimit(
	anchor: IBaseHalfCanvasEdge['from_anchor'],
	size: { readonly width: number; readonly height: number }
): number {
	const along = anchor === 'north' || anchor === 'south' ? size.width : size.height;
	return Math.max(0, along / 2 - BASEHALF_CANVAS_CARD_CORNER_RADIUS);
}

/** The top-left corner of a card created from a connection drop: the side the
 *  edge enters is centered on the release point. */
export function baseHalfCanvasConnectionTargetOrigin(
	position: { readonly x: number; readonly y: number },
	toAnchor: IBaseHalfCanvasEdge['to_anchor'],
	size: { readonly width: number; readonly height: number }
): { readonly x: number; readonly y: number } {
	switch (toAnchor) {
		case 'west': return { x: position.x, y: position.y - size.height / 2 };
		case 'east': return { x: position.x - size.width, y: position.y - size.height / 2 };
		case 'north': return { x: position.x - size.width / 2, y: position.y };
		case 'south': return { x: position.x - size.width / 2, y: position.y - size.height };
	}
}

export interface IBaseHalfCanvasSceneReconnect {
	readonly previous: IBaseHalfCanvasSceneEdge;
	readonly next: IBaseHalfCanvasSceneConnection;
}

export interface IBaseHalfCanvasSceneSelection {
	readonly cardPaths?: readonly string[];
	readonly edgeId?: string;
}

export type BaseHalfCanvasSceneSelectionAction = 'rename' | 'duplicate' | 'delete' | 'copyReferences';

/**
 * The canvas selection surface is deliberately structural. It never mirrors
 * node-local Generate, recipe, model, Result, or Attempt controls into a bulk toolbar.
 */
export function baseHalfCanvasSceneSelectionActions(cardCount: number): readonly BaseHalfCanvasSceneSelectionAction[] {
	if (cardCount <= 0) {
		return [];
	}
	if (cardCount === 1) {
		return ['rename', 'duplicate', 'delete'];
	}
	return ['duplicate', 'copyReferences', 'delete'];
}

export type BaseHalfCanvasSceneContextMenuRequest =
	| {
		readonly kind: 'card';
		readonly path: string;
		readonly anchor: HTMLElement | { readonly x: number; readonly y: number };
	}
	| {
		readonly kind: 'edge';
		readonly edge: IBaseHalfCanvasSceneEdge;
		readonly anchor: HTMLElement | { readonly x: number; readonly y: number };
	}
	| {
		readonly kind: 'pane';
		readonly anchor: HTMLElement | { readonly x: number; readonly y: number };
	};

export interface IBaseHalfCanvasSceneFitOptions {
	readonly maxZoom?: number;
	readonly padding?: number;
}

export interface IBaseHalfCanvasSceneDelegate {
	commitGeometry(sceneKey: string, structuralEpoch: number, geometries: readonly IBaseHalfCanvasSceneGeometry[]): Promise<void>;
	connect(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void>;
	/** Opens the Create from Connection menu at the drop's release point.
	 *  Resolves when the menu has closed: `true` once a chosen node was
	 *  created, `false` when the menu was dismissed or nothing was created. */
	showConnectionCreateMenu(sceneKey: string, structuralEpoch: number, drop: IBaseHalfCanvasSceneConnectionDrop): Promise<boolean>;
	reconnect(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void>;
	removeEdge(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void>;
	performSelectionAction(sceneKey: string, structuralEpoch: number, action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]): Promise<void>;
	cancelPendingCardOpen(): void;
	prepareSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean>;
	focusNoteEditor(sceneKey: string, structuralEpoch: number, path: string): void;
	editNote(sceneKey: string, structuralEpoch: number, path: string, point?: IBaseHalfCanvasNoteEditPoint): Promise<void>;
	rememberNoteEditPoint(sceneKey: string, structuralEpoch: number, path: string, point: IBaseHalfCanvasNoteEditPoint): void;
	formatNote(sceneKey: string, structuralEpoch: number, path: string, command: BaseHalfMarkdownFormatCommand): Promise<void>;
	copyNote(sceneKey: string, structuralEpoch: number, path: string): Promise<void>;
	setNoteBackground(sceneKey: string, structuralEpoch: number, path: string, background: BaseHalfCanvasNoteBackground): Promise<void>;
	openCard(sceneKey: string, structuralEpoch: number, path: string): Promise<void>;
	invokeVideoAction(sceneKey: string, structuralEpoch: number, path: string, action: BaseHalfCanvasSceneVideoAction, anchor: HTMLElement): Promise<void>;
	showCreateMenu(sceneKey: string, structuralEpoch: number, position: { readonly x: number; readonly y: number }): void;
	showContextMenu(sceneKey: string, structuralEpoch: number, request: BaseHalfCanvasSceneContextMenuRequest): void;
	reportViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void;
	didStartViewportInteraction(): void;
	didEndInteraction(): void;
	reportError(error: unknown): void;
}

export interface IBaseHalfCanvasSceneRenderer {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
	setVideoComposerSurface(surface: IBaseHalfCanvasSceneVideoComposerSurface): void;
	/** Clears only the surface that owns this exact element. This identity guard
	 *  prevents a late close from an older session hiding a replacement surface. */
	clearVideoComposerSurface(element: HTMLElement): void;
	setZoom(zoom: number): Promise<void>;
	zoomBy(factor: number): Promise<void>;
	setViewportCenter(x: number, y: number, zoom?: number): Promise<void>;
	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void>;
	reveal(path: string): Promise<void>;
	screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number };
	select(selection: IBaseHalfCanvasSceneSelection): void;
	getViewport(): IBaseHalfCanvasSceneViewport;
	isInteracting(): boolean;
	dispose(): void;
}
