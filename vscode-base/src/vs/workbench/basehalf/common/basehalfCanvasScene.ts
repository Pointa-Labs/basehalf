/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasBounds, IBaseHalfCanvasEdge, BaseHalfCanvasItemKind } from './basehalfCanvasModel.js';
import type { BaseHalfCanvasCardPresentation } from './basehalfCanvasCardPresentation.js';

export interface IBaseHalfCanvasSceneCardPresentation {
	readonly level: BaseHalfCanvasCardPresentation;
	readonly height: number;
	readonly zoom: number;
	readonly selected: boolean;
}

/**
 * The narrow, service-free protocol between BaseHalf's VS Code workbench
 * controller and the in-document React Flow renderer island.
 *
 * The badge graph and canvas mirror remain persisted truth. These DTOs describe
 * only the live scene projection and user intents emitted from it.
 */
export interface IBaseHalfCanvasSceneCard extends IBaseHalfCanvasBounds {
	readonly path: string;
	readonly kind: BaseHalfCanvasItemKind;
	/** The visible card title is stored inside this resource, so the structural
	 *  rename action changes only its filename. */
	readonly renameChangesPathOnly?: true;
	/** Product card contents are still authored by the workbench. React Flow owns
	 *  the node wrapper, geometry, selection, handles, and resize interaction. */
	readonly element: HTMLElement;
	/** The scene reports only meaningful presentation changes. The workbench
	 *  keeps one card body alive at a time and owns its resource lifecycle. */
	readonly updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => void;
	/** An open in-card editor remains interactive even before selection catches
	 *  up with a replacement scene snapshot. */
	readonly forceInteractive?: true;
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
	readonly position: { readonly x: number; readonly y: number };
}

/** Resolves the only connection completion that may open a create menu. A
 *  cancelled gesture or any gesture ending on a node has no persistent intent. */
export function resolveBaseHalfCanvasSceneConnectionDrop(
	source: Omit<IBaseHalfCanvasSceneConnectionDrop, 'position'> | undefined,
	targetPresent: boolean,
	position: { readonly x: number; readonly y: number }
): IBaseHalfCanvasSceneConnectionDrop | undefined {
	if (!source || targetPresent) {
		return undefined;
	}
	return Object.freeze({ ...source, position: Object.freeze({ x: position.x, y: position.y }) });
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
 * node-local Run, recipe, model, or history controls into a bulk toolbar.
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
	createFromConnection(sceneKey: string, structuralEpoch: number, drop: IBaseHalfCanvasSceneConnectionDrop): Promise<void>;
	reconnect(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void>;
	removeEdge(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void>;
	performSelectionAction(sceneKey: string, structuralEpoch: number, action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]): Promise<void>;
	activateCard(sceneKey: string, structuralEpoch: number, path: string): void;
	openCard(sceneKey: string, structuralEpoch: number, path: string): void;
	showCreateMenu(sceneKey: string, structuralEpoch: number, position: { readonly x: number; readonly y: number }): void;
	showContextMenu(sceneKey: string, structuralEpoch: number, request: BaseHalfCanvasSceneContextMenuRequest): void;
	reportViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void;
	didStartViewportInteraction(): void;
	didEndInteraction(): void;
	reportError(error: unknown): void;
}

export interface IBaseHalfCanvasSceneRenderer {
	update(snapshot: IBaseHalfCanvasSceneSnapshot): void;
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
