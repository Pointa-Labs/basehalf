/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfCanvasBounds, IBaseHalfCanvasEdge, BaseHalfCanvasItemKind } from './basehalfCanvasModel.js';

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
	/** Product card contents are still authored by the workbench. React Flow owns
	 *  the node wrapper, geometry, selection, handles, and resize interaction. */
	readonly element: HTMLElement;
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
	readonly from: string;
	readonly fromKind: BaseHalfCanvasItemKind;
	readonly fromAnchor: IBaseHalfCanvasEdge['from_anchor'];
	readonly to: string;
	readonly toKind: BaseHalfCanvasItemKind;
	readonly toAnchor: IBaseHalfCanvasEdge['to_anchor'];
}

export interface IBaseHalfCanvasSceneReconnect {
	readonly previous: IBaseHalfCanvasSceneEdge;
	readonly next: IBaseHalfCanvasSceneConnection;
}

export interface IBaseHalfCanvasSceneSelection {
	readonly cardPaths?: readonly string[];
	readonly edgeId?: string;
}

export interface IBaseHalfCanvasSceneFitOptions {
	readonly maxZoom?: number;
	readonly padding?: number;
}

export interface IBaseHalfCanvasSceneDelegate {
	commitGeometry(sceneKey: string, structuralEpoch: number, geometries: readonly IBaseHalfCanvasSceneGeometry[]): Promise<void>;
	connect(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void>;
	reconnect(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void>;
	removeEdge(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void>;
	editEdgeLabel(sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void>;
	openCard(sceneKey: string, structuralEpoch: number, path: string): void;
	reportViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void;
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
	select(selection: IBaseHalfCanvasSceneSelection): void;
	getViewport(): IBaseHalfCanvasSceneViewport;
	isInteracting(): boolean;
	dispose(): void;
}
