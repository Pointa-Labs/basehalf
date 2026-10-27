/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasMovedCard, IBaseHalfCanvasView, IBaseHalfCanvasViewScene, IBaseHalfCanvasViewSceneChange, IBaseHalfCanvasViewSelection } from '../../browser/basehalfCanvasExtensions.js';
import { IBaseHalfCanvasCardPick } from '../../common/basehalfCanvasCardPick.js';
import { BaseHalfCanvasCardPreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneEdge, IBaseHalfCanvasSceneGeometry, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';

/** A canvas view for the tests of canvas features: it records what a feature asks of it. */
export interface IBaseHalfTestCanvasView extends IBaseHalfCanvasView {
	/** What the feature asked of the canvas, in order, such as `setZoom 0.5`. */
	readonly calls: string[];
	/** The canvas reports a new zoom, as after a gesture. */
	reportZoom(zoom: number): void;
	/** The view controls are hidden, as when Card Detail opens. */
	hideViewControls(): void;
	/**
	 * The canvas draws a scene, as after a folder opened or its files changed,
	 * and says so: drawn from its folder unless `drawn` is false, with the
	 * selection the drawing applied.
	 */
	showScene(scene: IBaseHalfCanvasViewScene, options?: { readonly drawn?: boolean; readonly selection?: readonly string[] }): void;
	/** The user selects cards, and the canvas takes the change. */
	changeSelection(paths: readonly string[], sceneKey?: string): void;
	/** The item and the preview of a card, as the canvas read them last; no preview while it loads. */
	setItem(item: IBaseHalfCanvasItem, preview?: BaseHalfCanvasCardPreview): void;
	/** A key is pressed on the canvas. Returns the event, to see whether a feature took it. */
	pressKey(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent;
	/** Undoes (true) or does again (false) the last change of `moveCards`. */
	undoOrRedoLastMove(undone: boolean): void;
	/** What `closeNoteEditor` answers next. */
	noteEditorCloses: boolean;
	/** Makes the next `moveCards` fail with this error. */
	failNextMove(error: Error): void;
	/** The pick that `startCardPick` started, while it is on. */
	readonly cardPick: IBaseHalfCanvasCardPick | undefined;
	/** Whether a gesture of the pointer is going on. */
	interacting: boolean;
	/** The node that `takeCreatedNodeFocus` answers for once. */
	createdNodeFocusPath: string | undefined;
	/** The element of each card panel shown, by the path of its card. */
	readonly cardPanels: Map<string, HTMLElement>;
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

/** The folder of the test canvas: `folder` in the workspace `/workspace`. */
export const BASEHALF_TEST_CANVAS_FOLDER: IBaseHalfCanvasFolderState = {
	resource: URI.file('/workspace/folder'),
	workspaceFolder: URI.file('/workspace'),
	relativePath: 'folder',
	source: 'explorer'
};

/** An item of the test folder, a file unless it is a folder. */
export function baseHalfTestCanvasItem(path: string, isDirectory = false): IBaseHalfCanvasItem {
	const resource = URI.joinPath(BASEHALF_TEST_CANVAS_FOLDER.workspaceFolder, path);
	const name = path.slice(path.lastIndexOf('/') + 1);
	return {
		path,
		name,
		kind: isDirectory ? 'folder' : 'file',
		stat: { resource, name, isFile: !isDirectory, isDirectory, isSymbolicLink: false, children: undefined, etag: '', mtime: 0, ctime: 0, size: 0, readonly: false, locked: false, executable: false }
	};
}

export function createBaseHalfTestCanvasView(
	store: Pick<DisposableStore, 'add'>,
	options?: { readonly zoom?: number; readonly scene?: IBaseHalfCanvasViewScene; readonly viewport?: IBaseHalfCanvasSceneViewport; readonly folder?: IBaseHalfCanvasFolderState }
): IBaseHalfTestCanvasView {
	const onDidChangeZoom = store.add(new Emitter<number>());
	const onDidHideViewControls = store.add(new Emitter<void>());
	const onDidChangeScene = store.add(new Emitter<IBaseHalfCanvasViewSceneChange>());
	const onDidChangeSelection = store.add(new Emitter<IBaseHalfCanvasViewSelection>());
	const onKeyDown = store.add(new Emitter<KeyboardEvent>());
	const viewControlsCorner = mainWindow.document.createElement('div');
	const viewControls = mainWindow.document.createElement('div');
	viewControlsCorner.appendChild(viewControls);
	mainWindow.document.body.appendChild(viewControlsCorner);
	store.add(toDisposable(() => viewControlsCorner.remove()));
	const calls: string[] = [];
	const items = new Map<string, { readonly item: IBaseHalfCanvasItem; readonly preview: BaseHalfCanvasCardPreview | undefined }>();
	const folder = options?.folder ?? BASEHALF_TEST_CANVAS_FOLDER;
	let zoom = options?.zoom ?? 1;
	let scene: IBaseHalfCanvasViewScene = options?.scene ?? { key: 'folder', structuralEpoch: 1, cards: [], edges: [] };
	const viewport = options?.viewport ?? { x: 0, y: 0, zoom };
	let lastMoveUndoOrRedo: ((undone: boolean) => void) | undefined;
	let nextMoveError: Error | undefined;
	let cardPick: IBaseHalfCanvasCardPick | undefined;
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
		getFolder: () => folder,
		get scene() { return scene; },
		onDidChangeScene: onDidChangeScene.event,
		isCurrentScene: sceneKey => sceneKey === scene.key && sceneKey !== 'no-folder',
		getItem: path => items.get(path)?.item,
		getCardPreview: path => items.get(path)?.preview,
		requestRender: () => calls.push('requestRender'),
		onDidChangeSelection: onDidChangeSelection.event,
		select: paths => calls.push(`select ${paths.join(', ')}`),
		// The canvas selects the card once a drawing shows it, and its panel takes the focus.
		selectCreatedCard: path => {
			calls.push(`selectCreatedCard ${path}`);
			canvas.createdNodeFocusPath = path;
		},
		interacting: false,
		isInteracting: () => canvas.interacting,
		focusCard: path => calls.push(`focusCard ${path}`),
		get cardPick() { return cardPick; },
		startCardPick: pick => {
			calls.push(`startCardPick ${pick.title}`);
			cardPick = pick;
			return toDisposable(() => {
				if (cardPick === pick) {
					cardPick = undefined;
				}
			});
		},
		endCardPick: () => { cardPick = undefined; },
		takeFolderDrops: () => {
			calls.push('takeFolderDrops');
			return toDisposable(() => { });
		},
		cardPanels: new Map<string, HTMLElement>(),
		showCardPanel: (sceneKey, path, element, screenHeight) => {
			calls.push(`showCardPanel ${sceneKey} ${path} ${screenHeight}`);
			canvas.cardPanels.set(path, element);
		},
		clearCardPanel: element => {
			for (const [path, shown] of canvas.cardPanels) {
				if (shown === element) {
					canvas.cardPanels.delete(path);
					calls.push(`clearCardPanel ${path}`);
				}
			}
		},
		createdNodeFocusPath: undefined,
		takeCreatedNodeFocus: path => {
			if (canvas.createdNodeFocusPath !== path) {
				return false;
			}
			canvas.createdNodeFocusPath = undefined;
			return true;
		},
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
		showScene: (value, sceneOptions) => {
			scene = value;
			onDidChangeScene.fire({ scene: value, drawn: sceneOptions?.drawn ?? true, ...(sceneOptions?.selection ? { selection: sceneOptions.selection } : {}) });
		},
		changeSelection: (paths, sceneKey) => onDidChangeSelection.fire({ sceneKey: sceneKey ?? scene.key, paths }),
		setItem: (item, preview) => { items.set(item.path, { item, preview }); },
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
