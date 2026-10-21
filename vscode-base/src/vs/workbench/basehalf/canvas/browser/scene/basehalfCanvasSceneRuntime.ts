/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_CANVAS_MAX_ZOOM, BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import { IBaseHalfCanvasSnapGuide } from '../../common/basehalfCanvasSnap.js';
import {
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneVideoPanelSurface,
	IBaseHalfCanvasSceneViewport,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP,
	BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT
} from '../../common/basehalfCanvasScene.js';
import type { ReactFlowInstance, Viewport } from '@xyflow/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import { BaseHalfCanvasFlowEdge, BaseHalfCanvasFlowNode, IBaseHalfCanvasSceneEnvironment, IBaseHalfCanvasSceneRuntime } from './basehalfCanvasSceneShared.js';

/**
 * What the canvas view may ask of the mounted scene
 * (IBaseHalfCanvasSceneRuntime): a new snapshot, the selection, the Video
 * panel, snapping, and the viewport. Commands that move the viewport run one
 * at a time and report where the viewport ended.
 */
export function useBaseHalfCanvasSceneRuntime(environment: IBaseHalfCanvasSceneEnvironment, scene: {
	readonly ready: (runtime: IBaseHalfCanvasSceneRuntime) => void;
	readonly sceneKeyRef: RefObject<string>;
	readonly viewportRef: RefObject<IBaseHalfCanvasSceneViewport>;
	readonly flowRef: RefObject<ReactFlowInstance<BaseHalfCanvasFlowNode, BaseHalfCanvasFlowEdge> | undefined>;
	readonly viewportCommandKey: RefObject<string | undefined>;
	readonly viewportCommandQueue: RefObject<Promise<void>>;
	readonly interacting: RefObject<boolean>;
	readonly snapEnabledRef: RefObject<boolean>;
	readonly setGuides: Dispatch<SetStateAction<readonly IBaseHalfCanvasSnapGuide[]>>;
	readonly setVideoPanelSurfaceState: Dispatch<SetStateAction<IBaseHalfCanvasSceneVideoPanelSurface | undefined>>;
	readonly nodesRef: RefObject<BaseHalfCanvasFlowNode[]>;
	readonly requestSelection: (selection: IBaseHalfCanvasSceneSelection) => Promise<boolean>;
	readonly updateSnapshot: (snapshot: IBaseHalfCanvasSceneSnapshot) => void;
	readonly reportViewport: (sceneKey: string, viewport: Viewport, final: boolean) => void;
}) {
	const { vendor, host } = environment;
	const {
		ready, sceneKeyRef, viewportRef, flowRef, viewportCommandKey, viewportCommandQueue,
		interacting, snapEnabledRef, setGuides, setVideoPanelSurfaceState, nodesRef,
		requestSelection, updateSnapshot, reportViewport
	} = scene;

	const runViewportCommand = vendor.useCallback(async (operation: () => Promise<void>): Promise<void> => {
		const operationKey = sceneKeyRef.current;
		const queued = viewportCommandQueue.current.catch(() => undefined).then(async () => {
			if (sceneKeyRef.current !== operationKey) {
				return;
			}
			viewportCommandKey.current = operationKey;
			try {
				await operation();
				await new Promise<void>(resolve => host.ownerDocument.defaultView?.setTimeout(resolve, 0) ?? resolve());
				const flow = flowRef.current;
				if (flow && sceneKeyRef.current === operationKey) {
					// React Flow can deliver the null-event onMove/onMoveEnd pair after
					// an imperative command's promise settles. Publish the authoritative
					// viewport before releasing its owner so the workbench always
					// receives the final geometry.
					reportViewport(operationKey, flow.getViewport(), true);
				}
			} finally {
				if (viewportCommandKey.current === operationKey) {
					viewportCommandKey.current = undefined;
				}
			}
		});
		viewportCommandQueue.current = queued;
		await queued;
	}, [reportViewport]);

	const runtime = vendor.useMemo<IBaseHalfCanvasSceneRuntime>(() => ({
		update: updateSnapshot,
		setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void {
			setVideoPanelSurfaceState(surface);
		},
		clearVideoPanelSurface(element: HTMLElement): void {
			setVideoPanelSurfaceState(current => current?.element === element ? undefined : current);
		},
		setSnapEnabled(enabled: boolean): void {
			snapEnabledRef.current = enabled;
			if (!enabled) {
				setGuides(current => current.length === 0 ? current : []);
			}
		},
		async setZoom(zoom: number): Promise<void> {
			await runViewportCommand(async () => {
				const flow = flowRef.current;
				if (!flow) {
					return;
				}
				const rect = host.getBoundingClientRect();
				const center = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
				await flow.setCenter(center.x, center.y, { zoom, duration: 0 });
			});
		},
		async zoomBy(factor: number): Promise<void> {
			await this.setZoom(viewportRef.current.zoom * factor);
		},
		async setViewportCenter(x: number, y: number, zoom?: number): Promise<void> {
			await runViewportCommand(async () => {
				await flowRef.current?.setCenter(x, y, { zoom: zoom ?? viewportRef.current.zoom, duration: 0 });
			});
		},
		async fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void> {
			const flow = flowRef.current;
			if (!flow) {
				return;
			}
			const wanted = paths ? new Set(paths) : undefined;
			const fitNodes = wanted ? nodesRef.current.filter(node => wanted.has(node.id)) : nodesRef.current;
			if (fitNodes.length === 0) {
				return;
			}
			const bounds = vendor.getNodesBounds(fitNodes);
			const visualBounds = {
				...bounds,
				y: bounds.y - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
				height: bounds.height + BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT
			};
			const viewport = vendor.getViewportForBounds(
				visualBounds,
				host.clientWidth,
				host.clientHeight,
				BASEHALF_CANVAS_MIN_ZOOM,
				options?.maxZoom ?? BASEHALF_CANVAS_MAX_ZOOM,
				options?.padding ?? 0.12
			);
			await runViewportCommand(async () => {
				await flow.setViewport(viewport, { duration: 0 });
			});
		},
		async reveal(path: string): Promise<void> {
			const node = nodesRef.current.find(candidate => candidate.id === path);
			if (node) {
				const bounds = vendor.getNodesBounds([node]);
				const visualBounds = {
					...bounds,
					y: bounds.y - BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP - BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT,
					height: bounds.height + BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT
				};
				const viewport = vendor.getViewportForBounds(
					visualBounds,
					host.clientWidth,
					host.clientHeight,
					BASEHALF_CANVAS_MIN_ZOOM,
					viewportRef.current.zoom,
					0.18
				);
				await runViewportCommand(async () => {
					await flowRef.current?.setViewport(viewport, { duration: 0 });
				});
			}
		},
		screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number } {
			return flowRef.current?.screenToFlowPosition({ x, y }) ?? { x, y };
		},
		select(selection: IBaseHalfCanvasSceneSelection): void {
			void requestSelection(selection);
		},
		getViewport: () => viewportRef.current,
		isInteracting: () => interacting.current
	}), [requestSelection, runViewportCommand, updateSnapshot]);

	vendor.useEffect(() => ready(runtime), [runtime]);
}
