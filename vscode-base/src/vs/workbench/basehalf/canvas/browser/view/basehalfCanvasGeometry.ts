/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { UndoRedoElementType } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IBaseHalfCanvasBounds, IBaseHalfCanvasCard } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasCardStateTransition, IBaseHalfCanvasEdgeStateTransition, IBaseHalfCanvasStateTransition } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasViewportSource, baseHalfOpenCanvasViewport, IBaseHalfCanvasViewport } from '../../common/basehalfCanvasViewportState.js';
import { baseHalfUserFacingErrorMessage } from '../../../shell/common/basehalfPlainFailureReason.js';
import { BASEHALF_CANVAS_DEFAULT_ZOOM_MAX, BaseHalfSetting, normalizeBaseHalfCanvasZoom } from '../../../shell/common/basehalfConfiguration.js';
import { BaseHalfCanvasSceneGeometryReason, IBaseHalfCanvasSceneGeometry, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';
import { IBaseHalfCanvasMovedCard, IBaseHalfCanvasViewScene } from '../basehalfCanvasExtensions.js';
import { IBaseHalfWorkspaceMutationLease } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { IBaseHalfCanvasUndoNode, reverseCanvasStateTransition, roundCanvasPosition, uniqueUris } from './basehalfCanvasViewShared.js';

/** How long a place the user gave a card waits for the move of that card's item before it is saved. */
const BASEHALF_CANVAS_MOVED_ITEMS_EDIT_HOLD_MS = 2000;

const BASEHALF_CANVAS_ZOOM_STEP = 0.1;

/** What has an undo of its own: a code editor, a field, an editable element, or an editor in a frame. */
const TEXT_EDITING_SELECTOR = '.monaco-editor, input, textarea, select, [contenteditable=""], [contenteditable="true"], iframe, webview';

function canvasStateTransitionChangesAnything(transition: IBaseHalfCanvasStateTransition): boolean {
	return (transition.cards ?? []).some(card => !canvasCardsEqual(card.expected, card.next))
		|| (transition.edges ?? []).some(edge => !canvasEdgesEqual(edge.expected, edge.next));
}

function canvasCardsEqual(left: IBaseHalfCanvasCardStateTransition['expected'], right: IBaseHalfCanvasCardStateTransition['next']): boolean {
	return left === right || !!left && !!right
		&& left.path === right.path
		&& left.kind === right.kind
		&& left.x === right.x
		&& left.y === right.y
		&& left.width === right.width
		&& left.height === right.height;
}

function canvasEdgesEqual(left: IBaseHalfCanvasEdgeStateTransition['expected'], right: IBaseHalfCanvasEdgeStateTransition['next']): boolean {
	return left === right || !!left && !!right
		&& left.from === right.from
		&& left.from_anchor === right.from_anchor
		&& left.to === right.to
		&& left.to_anchor === right.to_anchor;
}

function uniqueCanvasUndoNodes(nodes: readonly IBaseHalfCanvasUndoNode[]): readonly IBaseHalfCanvasUndoNode[] {
	const result = new Map<string, IBaseHalfCanvasUndoNode>();
	for (const node of nodes) {
		const existing = result.get(node.path);
		if (existing && existing.kind !== node.kind) {
			throw new Error(`Canvas node kind changed while preparing undo: ${node.path}`);
		}
		result.set(node.path, node);
	}
	return [...result.values()];
}

function normalizeCanvasZoom(value: number): number {
	return Number(normalizeBaseHalfCanvasZoom(value).toFixed(4));
}

/**
 * Places, sizes, and the view: saving moved and resized cards as steps of
 * undo, putting cards back, zoom, fitting, and the viewport each folder keeps.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasGeometry {
	private restoredViewportSceneKey: string | undefined;
	/** Scene whose restore or automatic fit is driving the viewport: its scene
	 *  reports are not user changes and are persisted explicitly (or not at all). */
	private programmaticViewportSceneKey: string | undefined;
	/** The last automatic first fit that no user change has replaced yet. */
	private autoFramedViewport: { readonly sceneKey: string; readonly generation: number } | undefined;
	/** The zoom the features of the canvas were last told about. */
	private reportedCanvasZoom: number | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/** Moves cards to new places and says which moved (IBaseHalfCanvasView.moveCards). */
	async moveCanvasCards(
		scene: IBaseHalfCanvasViewScene,
		places: readonly IBaseHalfCanvasSceneGeometry[],
		undoLabel: string,
		onUndoOrRedo?: (undone: boolean) => void
	): Promise<readonly IBaseHalfCanvasMovedCard[]> {
		const transition = await this.commitCanvasGeometry(scene.key, scene.structuralEpoch, places, undoLabel, onUndoOrRedo, true);
		const moved: IBaseHalfCanvasMovedCard[] = [];
		for (const card of transition?.cards ?? []) {
			if (card.expected && card.next && (card.expected.x !== card.next.x || card.expected.y !== card.next.y)) {
				moved.push({ path: card.path, before: card.expected, after: card.next });
			}
		}
		return moved;
	}

	isCanvasUndoRedoActive(): boolean {
		const active = this.view.root.ownerDocument.activeElement;
		if (!this.view.canvasNavigationService.isSurfaceActive || !active || !this.view.root.contains(active)) {
			return false;
		}
		// While Card Detail is open, its steps and the canvas's are one history:
		// they are undone unless the keyboard is in an editor of text, whose own
		// undo goes first (exact undo, "Undo while Card Detail is open").
		return !this.view.canvasNavigationService.state.cardDetail || !active.closest(TEXT_EDITING_SELECTOR);
	}

	private pushCanvasUndoElement(
		label: string,
		folder: IBaseHalfCanvasFolderState,
		nodes: readonly IBaseHalfCanvasUndoNode[],
		apply: (reverse: boolean, lease: IBaseHalfWorkspaceMutationLease) => Promise<void>
	): void {
		const uniqueNodes = uniqueCanvasUndoNodes(nodes);
		const stampPaths = [...new Set([folder.relativePath, ...uniqueNodes.map(node => node.path)])];
		const stamps = stampPaths.map(path => this.view.workspaceMutationCoordinator.captureResource(folder.workspaceFolder, path));
		const resources = uniqueUris([
			this.view.canvasMirrorService.canvasResource(folder),
			...uniqueNodes.map(node => joinPath(folder.workspaceFolder, ...node.path.split('/')))
		]);
		const run = async (reverse: boolean): Promise<void> => {
			await this.view.workspaceMutationCoordinator.runResourceMutation(folder.workspaceFolder, stamps, lease => apply(reverse, lease));
			this.view.renderer.scheduleBackgroundRender();
		};
		this.view.undoRedoService.pushElement({
			type: UndoRedoElementType.Workspace,
			resources,
			label,
			code: 'basehalf.canvas.mutation',
			undo: () => run(true),
			redo: () => run(false)
		}, undefined, this.view.canvasUndoRedoSource);
	}

	private async applyCanvasGeometryTransition(
		folder: IBaseHalfCanvasFolderState,
		nodes: readonly IBaseHalfCanvasUndoNode[],
		transition: IBaseHalfCanvasStateTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		await this.view.resolveLiveWorkspaceNodes(folder.workspaceFolder, nodes);
		await this.view.canvasMirrorService.transitionCanvasState(folder, reverseCanvasStateTransition(transition, reverse), lease);
	}

	async commitSceneGeometry(sceneKey: string, structuralEpoch: number, requested: readonly IBaseHalfCanvasSceneGeometry[], reason?: BaseHalfCanvasSceneGeometryReason): Promise<void> {
		await this.commitCanvasGeometry(sceneKey, structuralEpoch, requested, reason === 'arrange'
			? localize('basehalf.canvas.arrange.undo', "Arrange canvas cards")
			: localize('basehalf.canvas.geometry.undo', "Move or resize canvas cards"));
	}

	/**
	 * Saves the places and sizes of cards in one change of the layout and one
	 * step of undo, and gives the scene the result. Returns what changed.
	 *
	 * With `placesOnly` the sizes in the layout stay as they are, and the change
	 * holds only the cards whose place is new. The caller then need not know
	 * what the layout holds: what the canvas draws can be a moment behind it,
	 * for example right after an undo.
	 */
	private async commitCanvasGeometry(
		sceneKey: string,
		structuralEpoch: number,
		requested: readonly IBaseHalfCanvasSceneGeometry[],
		undoLabel: string,
		didApplyUndoOrRedo?: (reverse: boolean) => void,
		placesOnly = false
	): Promise<IBaseHalfCanvasStateTransition | undefined> {
		if (requested.length === 0) {
			return undefined;
		}
		const queuedFolder = this.view.folderForSceneMutation(sceneKey);
		// A card that is dragged while its item is being found at a new path is
		// saved under that path, once the item's card information is there. No
		// other card waits.
		if (requested.some(geometry => this.view.movedItemsService.isMoving(queuedFolder.workspaceFolder, geometry.path))) {
			await this.view.movedItemsService.whenSettled(queuedFolder.workspaceFolder, BASEHALF_CANVAS_MOVED_ITEMS_EDIT_HOLD_MS, queuedFolder.relativePath);
		}
		const geometries = requested.map(geometry => {
			const path = this.view.movedItemsService.resolveMovedPath(queuedFolder.workspaceFolder, geometry.path);
			return path === undefined ? geometry : { ...geometry, path };
		});
		let committedTransition: IBaseHalfCanvasStateTransition | undefined;
		let nodes = geometries.map(geometry => ({ path: geometry.path, kind: geometry.kind }));
		try {
			await this.view.workspaceMutationCoordinator.runSceneMutation(
				queuedFolder.workspaceFolder,
				this.view.sceneMutationStamp(queuedFolder, structuralEpoch),
				async lease => {
					const folder = this.view.folderForSceneMutation(sceneKey);
					await this.view.resolveLiveCanvasNodes(sceneKey, folder, geometries);
					// A change by the user writes the layout, and the places that wait are
					// saved with it: first, so that undo of this change puts the card back
					// at the place BaseHalf chose for it.
					await this.view.chosenCanvasPlaces.saveWithUserChange(folder, lease);
					const current = await this.view.canvasMirrorService.readCanvas(folder);
					const cards: IBaseHalfCanvasCardStateTransition[] = geometries.map(geometry => {
						const expected = current?.cards.find(card => card.path === geometry.path) ?? null;
						const width = placesOnly && expected ? expected.width : geometry.width;
						const height = placesOnly && expected ? expected.height : geometry.height;
						// A gesture that ends where it began changed nothing: a place
						// BaseHalf chose stays one BaseHalf chose.
						const unchanged = expected !== null && expected.kind === geometry.kind
							&& expected.x === geometry.x && expected.y === geometry.y
							&& expected.width === width && expected.height === height;
						return {
							path: geometry.path,
							expected,
							next: unchanged ? expected : {
								path: geometry.path,
								kind: geometry.kind,
								x: geometry.x,
								y: geometry.y,
								width,
								height
							}
						};
					});
					// A card whose row stays as it is takes no part in the change: undo
					// would otherwise refuse once such a card is moved afterwards.
					committedTransition = { cards: placesOnly ? cards.filter(card => card.next !== card.expected) : cards };
					await this.view.canvasMirrorService.transitionCanvasState(folder, committedTransition, lease);
					// Over a layout that could not be read in full they could not be saved
					// before. This write made it readable.
					await this.view.chosenCanvasPlaces.saveWithUserChange(folder, lease);
				}
			);
		} catch (error) {
			// The scene returns the cards to their saved positions; say why.
			// A storage error's own text names system error codes and files
			// under `.bh/`: the user gets the reason in plain words.
			throw new Error(localize('basehalf.canvas.geometry.saveFailed', "Couldn't save the card position: {0}", baseHalfUserFacingErrorMessage(error)), { cause: error });
		}
		if (committedTransition) {
			this.supersedeCanvasReadsBeforeGeometryCommit();
		}
		if (placesOnly && committedTransition) {
			const changed = new Set((committedTransition as IBaseHalfCanvasStateTransition).cards?.map(card => card.path));
			nodes = nodes.filter(node => changed.has(node.path));
		}
		if (committedTransition && canvasStateTransitionChangesAnything(committedTransition)) {
			this.pushCanvasUndoElement(
				undoLabel,
				queuedFolder,
				nodes,
				async (reverse, lease) => {
					await this.applyCanvasGeometryTransition(queuedFolder, nodes, committedTransition!, reverse, lease);
					didApplyUndoOrRedo?.(reverse);
				}
			);
		}
		if (this.view.isCurrentSceneKey(sceneKey) && this.view.renderedSceneStructuralEpoch === structuralEpoch) {
			// With `placesOnly` the scene gets the rows that were written, which
			// keep the sizes of the layout.
			const committedRows = placesOnly ? (committedTransition as IBaseHalfCanvasStateTransition | undefined)?.cards?.flatMap(card => card.next ? [card.next] : []) : undefined;
			const geometryByPath = new Map<string, Pick<IBaseHalfCanvasSceneGeometry, 'x' | 'y' | 'width' | 'height'>>((committedRows ?? geometries).map(geometry => [geometry.path, geometry]));
			this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(card => {
				const geometry = geometryByPath.get(card.path);
				return geometry ? { ...card, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height } : card;
			}));
			this.view.canvasScene.update({
				key: sceneKey,
				structuralEpoch,
				revision: this.view.renderSeq,
				cards: this.view.renderedSceneCards,
				edges: this.view.renderedSceneEdges
			});
		}
		// React Flow already owns the optimistic live geometry. Rebuilding every
		// card here used to replace hydrated contents with "Loading preview…"
		// until asynchronous file reads completed. The mirror file event still
		// provides canonical reconciliation, now with unchanged previews cached.
		return committedTransition;
	}

	/**
	 * A render or layout reconciliation still in flight may have read
	 * canvas.yaml before a geometry commit wrote it. Resolving after the
	 * commit's scene update, it would publish the old geometry and snap the
	 * moved or resized cards back until the next reconciliation. Supersede
	 * both: an in-flight reconciliation is dropped (the commit's own
	 * canvas.yaml change schedules a fresh one), and an in-flight render is
	 * replaced by a new render that reads the committed file.
	 */
	private supersedeCanvasReadsBeforeGeometryCommit(): void {
		this.view.canvasLayoutReconcileGeneration++;
		if (this.view.rendersInFlight > 0) {
			this.view.renderSeq++;
			this.view.requestRender();
		}
	}

	onSceneViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport, final: boolean): void {
		if (!this.view.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.view.canvasZoom = viewport.zoom;
		this.updateCanvasZoomChrome();
		if (final) {
			this.view.previews.scheduleOverscanCardPreviews(viewport);
			const folder = this.view.getCurrentFolder();
			if (folder && this.programmaticViewportSceneKey !== sceneKey) {
				this.scheduleViewportPersist(200, 'user', { folder, viewport });
			}
		}
	}

	/** The part of the canvas that the window shows, in canvas coordinates. */
	visibleCanvasBounds(): IBaseHalfCanvasBounds {
		const surface = this.view.surface.getBoundingClientRect();
		const start = this.view.canvasScene.screenToCanvasPosition(surface.left, surface.top);
		const end = this.view.canvasScene.screenToCanvasPosition(surface.right, surface.bottom);
		return { x: start.x, y: start.y, width: Math.max(0, end.x - start.x), height: Math.max(0, end.y - start.y) };
	}

	/**
	 * Puts cards back at the places of their rows, also a card that was moved
	 * again since, as one change of the layout and one step of undo. Only
	 * places go back: a size that changed since stays, a card that is gone is
	 * passed over, and a place that BaseHalf had chosen is again a chosen row
	 * (IBaseHalfCanvasView.restoreCardPlaces).
	 */
	async restoreCanvasCardPlaces(sceneKey: string, previous: ReadonlyMap<string, IBaseHalfCanvasCard>, undoLabel: string): Promise<void> {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.sceneKey(folder) !== sceneKey) {
			return;
		}
		const structuralEpoch = this.view.renderedSceneStructuralEpoch;
		const shown = new Set(this.view.renderedSceneCards.map(card => card.path));
		let reverted: IBaseHalfCanvasStateTransition | undefined;
		await this.view.workspaceMutationCoordinator.runSceneMutation(
			folder.workspaceFolder,
			this.view.sceneMutationStamp(folder, structuralEpoch),
			async lease => {
				await this.view.chosenCanvasPlaces.saveWithUserChange(folder, lease);
				const current = await this.view.canvasMirrorService.readCanvas(folder);
				const cards: IBaseHalfCanvasCardStateTransition[] = [];
				for (const [path, before] of previous) {
					const now = current?.cards.find(card => card.path === path);
					if (!now || !shown.has(path) || (now.x === before.x && now.y === before.y && now.auto === before.auto)) {
						continue;
					}
					// The row is again what it was: a place that BaseHalf had
					// chosen is again a chosen row.
					cards.push({
						path,
						expected: now,
						next: { path, kind: now.kind, x: before.x, y: before.y, width: now.width, height: now.height, ...(before.auto ? { auto: true as const } : {}) }
					});
				}
				if (cards.length > 0) {
					reverted = { cards };
					await this.view.canvasMirrorService.transitionCanvasState(folder, reverted, lease);
				}
			}
		);
		const transition = reverted;
		if (transition?.cards) {
			const rows = new Map(transition.cards.map(card => [card.path, card.next!]));
			const nodes = [...rows.values()].map(row => ({ path: row.path, kind: row.kind }));
			this.supersedeCanvasReadsBeforeGeometryCommit();
			this.pushCanvasUndoElement(
				undoLabel,
				folder,
				nodes,
				(reverse, lease) => this.applyCanvasGeometryTransition(folder, nodes, transition, reverse, lease)
			);
			if (this.view.isCurrentSceneKey(sceneKey) && this.view.renderedSceneStructuralEpoch === structuralEpoch) {
				this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(card => {
					const row = rows.get(card.path);
					return row ? { ...card, x: row.x, y: row.y } : card;
				}));
				this.view.canvasScene.update({
					key: sceneKey,
					structuralEpoch,
					revision: this.view.renderSeq,
					cards: this.view.renderedSceneCards,
					edges: this.view.renderedSceneEdges
				});
			}
		}
	}

	/** Shows the canvas of the scene at a viewport the user had, and saves it as theirs (IBaseHalfCanvasView.setViewport). */
	async showCanvasViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport): Promise<void> {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.sceneKey(folder) !== sceneKey) {
			return;
		}
		this.view.viewportRestoreGeneration++;
		const { x, y, zoom } = viewport;
		await this.view.canvasScene.setViewportCenter((this.view.cards.clientWidth / 2 - x) / zoom, (this.view.cards.clientHeight / 2 - y) / zoom, zoom);
		if (this.view.isCurrentSceneKey(sceneKey)) {
			this.scheduleViewportPersist(0, 'user', { folder, viewport: this.view.canvasScene.getViewport() });
		}
	}

	/**
	 * Shows the zoom on the canvas, whose sizes in screen pixels follow it, and
	 * tells the features of the canvas when it changed.
	 */
	updateCanvasZoomChrome(): void {
		const zoom = normalizeCanvasZoom(this.view.canvasZoom);
		this.view.canvasZoom = zoom;
		this.view.root.style.setProperty('--basehalf-canvas-zoom', String(zoom));
		this.view.root.dataset.zoom = String(zoom);
		if (zoom !== this.reportedCanvasZoom) {
			this.reportedCanvasZoom = zoom;
			this.view.onDidChangeZoomEmitter.fire(zoom);
		}
	}

	zoomBy(direction: -1 | 1): void {
		this.setCanvasZoom(this.view.canvasZoom + direction * BASEHALF_CANVAS_ZOOM_STEP);
	}

	fitCanvasToScreen(): void {
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		this.view.viewportRestoreGeneration++;
		const sceneKey = this.view.sceneKey(folder);
		void this.view.canvasScene.fit(undefined, {
			padding: 0.12,
			maxZoom: 1
		}).then(() => {
			if (this.view.isCurrentSceneKey(sceneKey)) {
				this.scheduleViewportPersist(0, 'user', { folder, viewport: this.view.canvasScene.getViewport() });
			}
		}).catch(error => this.view.logService.error(error));
	}

	onCanvasKeyDown(event: KeyboardEvent): void {
		if (this.view.canvasNavigationService.state.cardDetail || !(event.metaKey || event.ctrlKey) || event.altKey) {
			return;
		}

		if (event.key === '=' || event.key === '+') {
			event.preventDefault();
			event.stopPropagation();
			this.zoomBy(1);
		} else if (event.key === '-') {
			event.preventDefault();
			event.stopPropagation();
			this.zoomBy(-1);
		} else if (event.key === '0') {
			event.preventDefault();
			event.stopPropagation();
			this.setCanvasZoom(1);
		}
	}

	setCanvasZoom(value: number): void {
		const nextZoom = normalizeCanvasZoom(value);
		if (nextZoom === this.view.canvasZoom) {
			return;
		}
		this.view.viewportRestoreGeneration++;
		const folder = this.view.getCurrentFolder();
		const sceneKey = folder ? this.view.sceneKey(folder) : undefined;
		this.view.canvasZoom = nextZoom;
		this.updateCanvasZoomChrome();
		void this.view.canvasScene.setZoom(nextZoom).then(() => {
			if (folder && sceneKey && this.view.isCurrentSceneKey(sceneKey)) {
				this.scheduleViewportPersist(0, 'user', { folder, viewport: this.view.canvasScene.getViewport() });
			}
		}).catch(() => {
			if (sceneKey && this.view.isCurrentSceneKey(sceneKey) && this.view.canvasZoom === nextZoom) {
				this.view.canvasZoom = normalizeCanvasZoom(this.view.canvasScene.getViewport().zoom);
				this.updateCanvasZoomChrome();
			}
		});
	}

	/** Canvas-space center of the visible area, independent of window size.
	 *  Undefined while the canvas has no size: that center would be wrong. */
	private canvasViewportCenter(viewport: IBaseHalfCanvasSceneViewport): { x: number; y: number } | undefined {
		const width = this.view.root.clientWidth;
		const height = this.view.root.clientHeight;
		if (width <= 0 || height <= 0 || !(viewport.zoom > 0)) {
			return undefined;
		}
		return {
			x: roundCanvasPosition((width / 2 - viewport.x) / viewport.zoom),
			y: roundCanvasPosition((height / 2 - viewport.y) / viewport.zoom)
		};
	}

	scheduleViewportPersist(
		delay: number,
		source: BaseHalfCanvasViewportSource,
		context?: { readonly folder: IBaseHalfCanvasFolderState; readonly viewport: IBaseHalfCanvasSceneViewport }
	): void {
		const folder = context?.folder ?? this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		const viewport = context?.viewport ?? this.view.canvasScene.getViewport();
		const center = this.canvasViewportCenter(viewport);
		if (!center) {
			return;
		}
		if (source !== 'auto') {
			this.autoFramedViewport = undefined;
		}
		const sceneKey = this.view.sceneKey(folder);
		const structuralStamp = this.view.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		const settled: IBaseHalfCanvasViewport = { x: center.x, y: center.y, zoom: viewport.zoom, source };
		this.view.viewportPersister.schedule(delay, {
			folder: folder.resource,
			viewport: settled,
			// A write whose scene is no longer current, or whose workspace saw a
			// structural change (its folder may have moved), is dropped: it
			// would recreate a key the move forgot.
			isCurrent: () => this.view.isCurrentSceneKey(sceneKey)
				&& this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)
		});
	}

	/**
	 * Restore the folder's stored viewport once per scene, or fit its content
	 * when none is stored. The first restore of a workspace folder waits
	 * (bounded) for the legacy viewport import so an imported viewport is not
	 * missed by a race with cleanup.
	 */
	restoreFolderViewport(folder: IBaseHalfCanvasFolderState): void {
		if (this.view.canvasNavigationService.state.cardDetail) {
			return;
		}

		const sceneKey = this.view.sceneKey(folder);
		if (this.restoredViewportSceneKey === sceneKey) {
			return;
		}

		this.restoredViewportSceneKey = sceneKey;
		const generation = this.view.viewportRestoreGeneration;
		void (async () => {
			const outcome = await baseHalfOpenCanvasViewport(this.view.viewportStateService, folder.resource, folder.workspaceFolder, {
				isCurrent: () => this.isViewportRestoreCurrent(sceneKey, generation),
				restore: stored => this.applyStoredViewport(sceneKey, stored),
				fit: () => this.frameFreshFolderView(folder, sceneKey),
				persistFit: () => {
					this.scheduleViewportPersist(0, 'auto', { folder, viewport: this.view.canvasScene.getViewport() });
					this.autoFramedViewport = { sceneKey, generation };
				}
			});
			if (outcome === 'stale'
				&& !this.view.disposed
				&& this.restoredViewportSceneKey === sceneKey
				&& this.view.isCurrentSceneKey(sceneKey)
				&& generation === this.view.viewportRestoreGeneration) {
				// Only Card Detail blocked it: retry on the next canvas render.
				this.restoredViewportSceneKey = undefined;
			}
		})().catch(error => this.view.logService.error(error));
	}

	private isViewportRestoreCurrent(sceneKey: string, generation: number): boolean {
		return !this.view.disposed
			&& this.view.isCurrentSceneKey(sceneKey)
			&& generation === this.view.viewportRestoreGeneration
			&& !this.view.canvasNavigationService.state.cardDetail;
	}

	private async applyStoredViewport(sceneKey: string, stored: IBaseHalfCanvasViewport): Promise<void> {
		const zoom = normalizeCanvasZoom(stored.zoom);
		this.view.canvasZoom = zoom;
		this.updateCanvasZoomChrome();
		this.autoFramedViewport = undefined;
		this.programmaticViewportSceneKey = sceneKey;
		try {
			await this.view.canvasScene.setViewportCenter(stored.x, stored.y, zoom);
		} finally {
			if (this.programmaticViewportSceneKey === sceneKey) {
				this.programmaticViewportSceneKey = undefined;
			}
		}
	}

	private async frameFreshFolderView(folder: IBaseHalfCanvasFolderState, sceneKey: string): Promise<void> {
		const maxZoom = Math.min(BASEHALF_CANVAS_DEFAULT_ZOOM_MAX, this.defaultCanvasZoom(folder));
		this.programmaticViewportSceneKey = sceneKey;
		try {
			await this.view.canvasScene.fit(undefined, { maxZoom, padding: 0.12 });
		} finally {
			if (this.programmaticViewportSceneKey === sceneKey) {
				this.programmaticViewportSceneKey = undefined;
			}
		}
	}

	/** A legacy viewport imported after this scene's automatic first fit wins
	 *  over it, as long as the user has not changed the viewport since. */
	onDidImportViewports(folders: readonly URI[]): void {
		const auto = this.autoFramedViewport;
		const folder = this.view.getCurrentFolder();
		if (!auto || !folder || !this.isViewportRestoreCurrent(auto.sceneKey, auto.generation)) {
			return;
		}
		if (!folders.some(imported => this.view.uriIdentityService.extUri.isEqual(imported, folder.resource))) {
			return;
		}
		const stored = this.view.viewportStateService.get(folder.resource);
		if (stored?.source !== 'import') {
			return;
		}
		void this.applyStoredViewport(auto.sceneKey, stored).catch(error => this.view.logService.error(error));
	}

	defaultCanvasZoom(folder: IBaseHalfCanvasFolderState): number {
		return normalizeBaseHalfCanvasZoom(this.view.configurationService.getValue(BaseHalfSetting.CanvasDefaultZoom, { resource: folder.resource }));
	}
}
