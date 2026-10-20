/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IBaseHalfCanvasMovedCard, IBaseHalfCanvasView, IBaseHalfCanvasViewScene } from '../../browser/basehalfCanvasExtensions.js';
import { IBaseHalfCanvasCard } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneEdge, IBaseHalfCanvasSceneGeometry, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';

/** A canvas view for the tests of canvas features: it records what a feature asks of it. */
export interface IBaseHalfTestCanvasView extends IBaseHalfCanvasView {
	/** What the feature asked of the canvas, in order, such as `setZoom 0.5`. */
	readonly calls: string[];
	/** The canvas reports a new zoom, as after a gesture. */
	reportZoom(zoom: number): void;
	/** The view controls are hidden, as when Card Detail opens. */
	hideViewControls(): void;
	/** The canvas draws a scene, as after a folder opened or its files changed, and says so. */
	showScene(scene: IBaseHalfCanvasViewScene): void;
	/** A key is pressed on the canvas. Returns the event, to see whether a feature took it. */
	pressKey(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent;
	/** Undoes (true) or does again (false) the last change of `moveCards`. */
	undoOrRedoLastMove(undone: boolean): void;
	/** What `closeNoteEditor` answers next. */
	noteEditorCloses: boolean;
	/** Makes the next `moveCards` fail with this error. */
	failNextMove(error: Error): void;
}

/** A card of a test scene at a place, 200 by 100 unless sized. */
export function baseHalfTestSceneCard(path: string, x: number, y: number, size?: { readonly width: number; readonly height: number }): IBaseHalfCanvasSceneCard {
	return {
		path,
		kind: 'file',
		x,
		y,
		width: size?.width ?? 200,
		height: size?.height ?? 100,
		element: mainWindow.document.createElement('div'),
		updatePresentation: () => { },
	};
}

/** A connection of a test scene, from the east side of one card to the west side of another. */
export function baseHalfTestSceneEdge(from: string, to: string): IBaseHalfCanvasSceneEdge {
	return { id: `${from}->${to}`, from, from_anchor: 'east', to, to_anchor: 'west', fromKind: 'file', toKind: 'file' };
}

export function createBaseHalfTestCanvasView(
	store: Pick<DisposableStore, 'add'>,
	options?: { readonly zoom?: number; readonly scene?: IBaseHalfCanvasViewScene; readonly viewport?: IBaseHalfCanvasSceneViewport }
): IBaseHalfTestCanvasView {
	const onDidChangeZoom = store.add(new Emitter<number>());
	const onDidHideViewControls = store.add(new Emitter<void>());
	const onDidChangeScene = store.add(new Emitter<IBaseHalfCanvasViewScene>());
	const onKeyDown = store.add(new Emitter<KeyboardEvent>());
	const viewControlsCorner = mainWindow.document.createElement('div');
	const viewControls = mainWindow.document.createElement('div');
	viewControlsCorner.appendChild(viewControls);
	mainWindow.document.body.appendChild(viewControlsCorner);
	store.add(toDisposable(() => viewControlsCorner.remove()));
	const calls: string[] = [];
	let zoom = options?.zoom ?? 1;
	let scene: IBaseHalfCanvasViewScene = options?.scene ?? { key: 'folder', structuralEpoch: 1, cards: [], edges: [] };
	const viewport = options?.viewport ?? { x: 0, y: 0, zoom };
	let lastMoveUndoOrRedo: ((undone: boolean) => void) | undefined;
	let nextMoveError: Error | undefined;
	const canvas: IBaseHalfTestCanvasView = {
		calls,
		get zoom() { return zoom; },
		onDidChangeZoom: onDidChangeZoom.event,
		setZoom: value => calls.push(`setZoom ${value}`),
		zoomBy: direction => calls.push(`zoomBy ${direction}`),
		fitToScreen: () => calls.push('fitToScreen'),
		getViewport: () => viewport,
		setViewport: async (sceneKey, value) => { calls.push(`setViewport ${sceneKey} ${value.x},${value.y},${value.zoom}`); },
		setSnapEnabled: enabled => calls.push(`setSnapEnabled ${enabled}`),
		get scene() { return scene; },
		onDidChangeScene: onDidChangeScene.event,
		isCurrentScene: sceneKey => sceneKey === scene.key && sceneKey !== 'no-folder',
		whenDrawn: async () => { },
		moveCards: async (moving: IBaseHalfCanvasViewScene, places: readonly IBaseHalfCanvasSceneGeometry[], undoLabel: string, onUndoOrRedo?: (undone: boolean) => void): Promise<readonly IBaseHalfCanvasMovedCard[]> => {
			calls.push(`moveCards ${moving.key}@${moving.structuralEpoch} ${undoLabel}: ${places.map(place => `${place.path} ${place.x},${place.y}`).join('; ')}`);
			const error = nextMoveError;
			nextMoveError = undefined;
			if (error) {
				throw error;
			}
			lastMoveUndoOrRedo = onUndoOrRedo;
			const moved: IBaseHalfCanvasMovedCard[] = [];
			for (const place of places) {
				const card = moving.cards.find(candidate => candidate.path === place.path);
				if (card && (card.x !== place.x || card.y !== place.y)) {
					const before: IBaseHalfCanvasCard = { path: card.path, kind: card.kind, x: card.x, y: card.y, width: card.width, height: card.height };
					moved.push({ path: card.path, before, after: { ...before, x: place.x, y: place.y } });
				}
			}
			return moved;
		},
		restoreCardPlaces: async (sceneKey, rows, undoLabel) => {
			calls.push(`restoreCardPlaces ${sceneKey} ${undoLabel}: ${[...rows.values()].map(row => `${row.path} ${row.x},${row.y}`).join('; ')}`);
		},
		noteEditorCloses: true,
		closeNoteEditor: async () => {
			calls.push('closeNoteEditor');
			return canvas.noteEditorCloses;
		},
		focus: () => calls.push('focus'),
		onKeyDown: onKeyDown.event,
		reportError: error => calls.push(`reportError ${error instanceof Error ? error.message : String(error)}`),
		viewControls,
		viewControlsCorner,
		onDidHideViewControls: onDidHideViewControls.event,
		reportZoom: value => {
			zoom = value;
			onDidChangeZoom.fire(value);
		},
		hideViewControls: () => onDidHideViewControls.fire(),
		showScene: value => {
			scene = value;
			onDidChangeScene.fire(value);
		},
		pressKey: (init, target) => {
			const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
			if (target) {
				// The target is the element the key was pressed on.
				Object.defineProperty(event, 'target', { value: target });
			}
			onKeyDown.fire(event);
			return event;
		},
		undoOrRedoLastMove: undone => lastMoveUndoOrRedo?.(undone),
		failNextMove: error => { nextMoveError = error; },
	};
	return canvas;
}
