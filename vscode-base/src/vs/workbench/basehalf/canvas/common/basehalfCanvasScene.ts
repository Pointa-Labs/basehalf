/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasBounds, IBaseHalfCanvasEdge, BaseHalfCanvasItemKind } from './basehalfCanvasModel.js';
import type { BaseHalfCanvasCardPresentation } from './basehalfCanvasCardPresentation.js';
import type { BaseHalfMarkdownFormatCommand, IBaseHalfMarkdownFormatState } from '../../markdown/common/basehalfMarkdownFormatting.js';

export const BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT = 'basehalf-note-toolbar-focus';
export const BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT = 'basehalf-note-format-state';
export const BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP = 8;
export const BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT = 24;
/** Mirrors `--bh-card-radius`; the corner resize targets follow this arc. */
export const BASEHALF_CANVAS_CARD_CORNER_RADIUS = 22;
/** Dispatched on the element of the Video panel each time the scene places it; see {@link IBaseHalfCanvasSceneVideoPanelLayout}. */
export const BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT = 'basehalf-video-panel-layout';
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

/**
 * The actions of the toolbar above a selected generation card with its file
 * (generation cards, "The toolbar"): Reveal and Open, and Capture Frame for a
 * video. A draft has no toolbar (D71).
 */
export type BaseHalfCanvasSceneVideoAction = 'captureFrame' | 'revealVideo' | 'openFullPreview';

/** The frame that Capture Frame takes: the first, the one the card's player shows, or the last. */
export type BaseHalfCanvasSceneVideoFrame = 'first' | 'current' | 'last';

const BASEHALF_CANVAS_VIDEO_RESULT_ACTION_ORDER: readonly BaseHalfCanvasSceneVideoAction[] = Object.freeze([
	'captureFrame',
	'revealVideo',
	'openFullPreview'
]);

/** The actions of the toolbar of a selected generation card, each once, in the toolbar's order. */
export function baseHalfCanvasSceneVideoSelectionActions(
	actions: readonly BaseHalfCanvasSceneVideoAction[]
): readonly BaseHalfCanvasSceneVideoAction[] {
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
		/** A generation card, of an image, a video, or a sound: the panel goes beside it. */
		readonly kind: 'video';
		readonly actions: readonly BaseHalfCanvasSceneVideoAction[];
		/** What the card makes, so that its toolbar is named for an image, a video, or a sound. A video when absent. */
		readonly media?: 'image' | 'video' | 'audio';
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
	/** The card of an image, a video, or a sound: it keeps its shape and has no
	 *  resize controls (canvas card resize, "Which cards resize"). */
	readonly keepsShape?: true;
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
 * The panel under a selected Video card (D58). The workbench builds the
 * element and owns every interaction inside it; the scene owns only mounting,
 * visibility, and its place on the screen. Publishing a surface again with the
 * same element (for a new height) moves it without mounting it again, so the
 * prompt keeps its text, selection, and input method state.
 */
export interface IBaseHalfCanvasSceneVideoPanelSurface {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly path: string;
	readonly element: HTMLElement;
	/** The panel's height in screen pixels. Its width is fixed. */
	readonly screenHeight: number;
}

/**
 * The detail of {@link BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT}: where the
 * scene put the panel. Offsets are screen pixels from the canvas's top left
 * corner, so the panel can keep its menus inside the canvas.
 */
export interface IBaseHalfCanvasSceneVideoPanelLayout {
	readonly placement: 'below' | 'above' | 'clamped';
	readonly visible: boolean;
	/** The card is being moved or resized and the panel follows it. */
	readonly following: boolean;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
	readonly canvasWidth: number;
	readonly canvasHeight: number;
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
	readonly selectedEdgeIds?: readonly string[];
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

/** Cards or connections, never both (docs/specs/canvas-selection-and-arrangement.md). */
export interface IBaseHalfCanvasSceneSelection {
	readonly cardPaths?: readonly string[];
	readonly edgeIds?: readonly string[];
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
		/** The selected connections, the one under the pointer among them. */
		readonly edges: readonly IBaseHalfCanvasSceneEdge[];
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

/** What changed the places that the scene commits, when it was not a move or a resize by the user's hand. */
export type BaseHalfCanvasSceneGeometryReason = 'arrange';

export interface IBaseHalfCanvasSceneDelegate {
	commitGeometry(sceneKey: string, structuralEpoch: number, geometries: readonly IBaseHalfCanvasSceneGeometry[], reason?: BaseHalfCanvasSceneGeometryReason): Promise<void>;
	connect(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void>;
	/** Opens the Create from Connection menu at the drop's release point.
	 *  Resolves when the menu has closed: `true` once a chosen node was
	 *  created, `false` when the menu was dismissed or nothing was created. */
	showConnectionCreateMenu(sceneKey: string, structuralEpoch: number, drop: IBaseHalfCanvasSceneConnectionDrop): Promise<boolean>;
	reconnect(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void>;
	/** Disconnects every one of `edges` as one step of undo. */
	removeEdges(sceneKey: string, structuralEpoch: number, edges: readonly IBaseHalfCanvasSceneEdge[]): Promise<void>;
	performSelectionAction(sceneKey: string, structuralEpoch: number, action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]): Promise<void>;
	cancelPendingCardOpen(): void;
	prepareSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean>;
	/** The selected cards after the selection changed, whatever changed it:
	 *  a click, a marquee, the workbench, or cards that are gone. */
	didChangeSelection(sceneKey: string, structuralEpoch: number, paths: readonly string[]): void;
	focusNoteEditor(sceneKey: string, structuralEpoch: number, path: string): void;
	editNote(sceneKey: string, structuralEpoch: number, path: string, point?: IBaseHalfCanvasNoteEditPoint): Promise<void>;
	rememberNoteEditPoint(sceneKey: string, structuralEpoch: number, path: string, point: IBaseHalfCanvasNoteEditPoint): void;
	formatNote(sceneKey: string, structuralEpoch: number, path: string, command: BaseHalfMarkdownFormatCommand): Promise<void>;
	copyNote(sceneKey: string, structuralEpoch: number, path: string): Promise<void>;
	setNoteBackground(sceneKey: string, structuralEpoch: number, path: string, background: BaseHalfCanvasNoteBackground): Promise<void>;
	openCard(sceneKey: string, structuralEpoch: number, path: string): Promise<void>;
	/** Runs a toolbar action of a selected Video card. Capture Frame names the frame it takes. */
	invokeVideoAction(sceneKey: string, structuralEpoch: number, path: string, action: BaseHalfCanvasSceneVideoAction, anchor: HTMLElement, frame?: BaseHalfCanvasSceneVideoFrame): Promise<void>;
	showCreateMenu(sceneKey: string, structuralEpoch: number, position: { readonly x: number; readonly y: number }): void;
	showContextMenu(sceneKey: string, structuralEpoch: number, request: BaseHalfCanvasSceneContextMenuRequest): void;
	reportViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void;
	didStartViewportInteraction(): void;
	/** The content that the scene scrolls for a wheel gesture on a card (canvas
	 *  wheel gestures), if this element of a card holds any. The element may be
	 *  one that the card has since replaced and that is still on screen. */
	cardScrollableContent(card: HTMLElement): HTMLElement | undefined;
	didEndInteraction(): void;
	reportError(error: unknown): void;
}

export interface IBaseHalfCanvasSceneRenderer {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
	/** Shows the panel of the selected Video card, or moves it to a new height. */
	setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void;
	/** Clears only the surface that owns this exact element. This identity guard
	 *  prevents a late close from an older panel hiding a replacement panel. */
	clearVideoPanelSurface(element: HTMLElement): void;
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
