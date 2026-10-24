/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { IAction, Separator, toAction } from '../../../../../base/common/actions.js';
import { basename } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { IFileStat } from '../../../../../platform/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasChildPath,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	baseHalfCanvasGenerationCardSize,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasItem,
	IBaseHalfCanvasItemRelationships,
	isBaseHalfCanvasEntry
} from '../../common/basehalfCanvasModel.js';
import { BaseHalfGenerationKind } from '../../../video/common/basehalfGenerationInfo.js';
import { baseHalfGenerationGeneratingInputsRefusal, baseHalfGenerationMadeInputsRefusal, IBaseHalfGenerationInputChange } from '../../../video/common/basehalfVideoGeneration.js';
import { baseHalfCanvasResolveSiblingUpstream } from '../../../references/common/basehalfCanvasUpstream.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../../workspace/common/basehalfLegacyCleanup.js';
import { IBaseHalfReferenceEditResult } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexState, IBaseHalfUpstreamView } from '../../../references/common/basehalfReferenceIndex.js';
import { baseHalfUpstreamStoreKind } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfUpstreamActionContext, IBaseHalfUpstreamActionNode } from '../../../references/browser/basehalfUpstreamActions.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import {
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneConnectionDrop,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneReconnect,
	baseHalfCanvasConnectionTargetOrigin,
	baseHalfCanvasOppositeAnchor
} from '../../common/basehalfCanvasScene.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';

/**
 * Connections on the canvas: reading them from the reference graph,
 * connecting, reconnecting, and disconnecting cards as reference operations
 * with undo, the anchors kept in the layout, and Create from Connection.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasConnections {

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/**
	 * Reads the connections of a folder's cards from the reference index (D37).
	 * While the index is building, the canvas shows cards without edges. Cards
	 * whose badge face is open read their own store directly, so their Upstream
	 * list never depends on enumeration.
	 */
	async readCanvasConnections(folder: IBaseHalfCanvasFolderState, stat: IFileStat): Promise<{
		readonly state: BaseHalfReferenceIndexState | undefined;
		readonly relationships: ReadonlyMap<string, IBaseHalfCanvasItemRelationships>;
		readonly views: ReadonlyMap<string, IBaseHalfUpstreamView>;
		readonly refusals: ReadonlyMap<string, string>;
	}> {
		const state = this.view.referenceIndexService.getState(folder.workspaceFolder);
		const relationships = new Map<string, IBaseHalfCanvasItemRelationships>();
		const views = new Map<string, IBaseHalfUpstreamView>();
		const refusals = new Map<string, string>();
		const rootLevel = folder.relativePath.length === 0;
		const children = (stat.children ?? []).filter(child => isBaseHalfCanvasEntry(child, rootLevel));
		const siblingPaths = children.map(child => baseHalfCanvasChildPath(folder.relativePath, basename(child.resource)));
		const marked = await baseHalfIsWorkspaceFolderMarked(this.view.fileService, folder.workspaceFolder);
		const identity = this.view.upstreamIdentity(folder.workspaceFolder);
		const misplaced = state === undefined || state === 'building'
			? new Set<string>()
			: new Set(this.view.referenceIndexService.getStores(folder.workspaceFolder)
				.filter(store => store.sidecarState === 'wrongOwner')
				.map(store => identity.key(store.node.relativePath)));
		await Promise.all(children.map(async (child, index) => {
			const path = siblingPaths[index];
			const node = this.view.workspaceNode(folder.workspaceFolder, path, child.isDirectory ? 'folder' : 'file');
			const refusal = this.canvasUpstreamRefusal(node, basename(child.resource), marked);
			if (refusal) {
				refusals.set(path, refusal);
			}
			const building = state === undefined || state === 'building';
			if (building && !this.view.openBadgeFaces.has(path)) {
				return;
			}
			let view: IBaseHalfUpstreamView | undefined;
			try {
				if (this.view.openBadgeFaces.has(path)) {
					view = await this.view.referenceIndexService.readUpstream(node);
				} else {
					const store = this.view.referenceIndexService.getStore(node);
					if ((store && (store.read.items.length > 0 || store.read.issue || !store.read.readable)) || misplaced.has(identity.key(path))) {
						view = await this.view.referenceIndexService.resolveUpstream(node);
					}
				}
			} catch (error) {
				this.view.logService.warn(`[BaseHalf] upstream list of ${path} could not be read`, error);
			}
			if (view) {
				views.set(path, view);
			}
			if (building) {
				// No edges or counts until the index is ready.
				return;
			}
			const upstream = view
				? baseHalfCanvasResolveSiblingUpstream(
					view.entries.flatMap(entry => entry.status === 'valid' && entry.path !== undefined ? [entry.path] : []),
					siblingPaths,
					identity
				)
				: [];
			const downstream = this.view.referenceIndexService.getDownstream(node).map(entry => entry.node.relativePath);
			relationships.set(path, { upstream, downstream, issueCount: view?.issueCount ?? 0 });
		}));
		return { state, relationships, views, refusals };
	}

	/** Why a card can never receive a connection right now, if it cannot. */
	private canvasUpstreamRefusal(node: IBaseHalfUpstreamActionNode, name: string, marked: boolean): string | undefined {
		if (marked && baseHalfUpstreamStoreKind(node.relativePath, node.kind === 'folder') === 'sidecar') {
			return localize('basehalf.canvas.connect.markedFolder', "{0} is in a folder BaseHalf is set to leave alone.", name);
		}
		return undefined;
	}

	/**
	 * Why the scene refuses every connection into a card before it draws an
	 * edge: the refusal of its folder (`refusals`), or a generation card whose
	 * inputs do not change now (D67, generation cards, "What is connected is
	 * sent"): one with its file, which was made from them, and a draft while it
	 * generates.
	 */
	sceneUpstreamRefusal(item: IBaseHalfCanvasItem, refusals: ReadonlyMap<string, string>): string | undefined {
		const refusal = refusals.get(item.path);
		if (refusal || !item.generation) {
			return refusal;
		}
		if (!item.generation.draft) {
			return baseHalfGenerationMadeInputsRefusal(item.name);
		}
		return this.view.videoGenerationService.isGenerating(item.stat.resource) ? baseHalfGenerationGeneratingInputsRefusal(item.name) : undefined;
	}

	/**
	 * Why the inputs of the card at `path` cannot change so, for a generation
	 * card (D67): a card with its file and a draft that generates take no
	 * change, and a draft takes no input its model cannot use. Any other card
	 * takes every change.
	 */
	private async inputRefusal(node: IBaseHalfUpstreamActionNode, change: IBaseHalfGenerationInputChange): Promise<string | undefined> {
		if (node.kind === 'folder') {
			return undefined;
		}
		try {
			return await this.view.generationCardActions.inputRefusal(node.resource, change);
		} catch (error) {
			// The card could not be read: the reference operation says what is wrong with it, if anything is.
			this.view.logService.warn(`[BaseHalf] could not tell whether the inputs of ${node.relativePath} can change`, error);
			return undefined;
		}
	}

	/** Says why a connection did not change, and draws the canvas again without the edge the gesture showed. */
	private refuseConnection(refusal: string): void {
		this.view.queueCanvasWarning(refusal);
		this.view.requestRender();
	}

	/** The index state as the canvas shows it: loading, or partial with unscanned files. */
	renderCanvasConnectionsStatus(state: BaseHalfReferenceIndexState | undefined): void {
		if (state !== 'building' && state !== 'partial') {
			return;
		}
		const status = append(this.view.canvasOverlay, $('.basehalf-canvas-connections-status'));
		status.setAttribute('role', 'status');
		status.setAttribute('data-testid', 'canvas-connections-status');
		status.setAttribute('data-index-state', state);
		status.textContent = state === 'building'
			? localize('basehalf.canvas.connections.building', "Loading connections…")
			: localize('basehalf.canvas.connections.partial', "Some files weren't scanned, so connections may be missing.");
	}

	/** The reference operation context of the current canvas: its undo stack and re-render. */
	upstreamActionContext(folder: IBaseHalfCanvasFolderState | undefined, onDidChange: () => void): IBaseHalfUpstreamActionContext {
		return {
			canvasCardPaths: [...this.view.renderedItemsByPath.keys()],
			...(folder ? { undoResources: [this.view.canvasMirrorService.canvasResource(folder)] } : {}),
			onDidChange
		};
	}

	/**
	 * Runs one canvas reference operation (connect, disconnect, reconnect) and
	 * pushes its single canvas undo step. A refusal is shown with its reason
	 * and resolves `undefined`: the scene's optimistic edge is then reconciled
	 * by the next render.
	 */
	private async runCanvasReferenceOperation(
		folder: IBaseHalfCanvasFolderState,
		node: IBaseHalfUpstreamActionNode,
		label: string,
		operation: () => Promise<IBaseHalfReferenceEditResult>
	): Promise<IBaseHalfReferenceEditResult | undefined> {
		return this.view.upstreamActions.run(label, node, this.upstreamActionContext(folder, () => this.view.renderer.scheduleBackgroundRender()), operation);
	}

	/**
	 * `canvas.yaml` edge rows are anchor memory only (D37): a connect or
	 * reconnect upserts the row of its pair so undo or a later reconnect
	 * restores the anchors. In a folder marked with the source-tree marker
	 * nothing is written under `.bh/`; the edge uses default anchors.
	 */
	private async rememberCanvasEdgeAnchors(folder: IBaseHalfCanvasFolderState, sceneKey: string, structuralEpoch: number, edge: IBaseHalfCanvasEdge): Promise<void> {
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.view.fileService, folder.workspaceFolder)) {
				return;
			}
			await this.view.workspaceMutationCoordinator.runSceneMutation(
				folder.workspaceFolder,
				this.view.sceneMutationStamp(folder, structuralEpoch),
				async lease => {
					this.view.folderForSceneMutation(sceneKey);
					await this.view.canvasMirrorService.upsertCanvasEdge(folder, edge, lease);
				}
			);
		} catch (error) {
			// The connection itself is saved; its anchors fall back to defaults.
			this.view.logService.warn(`[BaseHalf] could not remember the anchors of ${edge.from} -> ${edge.to}`, error);
		}
	}

	/**
	 * Create from Connection: a drop on empty canvas opens the create menu at
	 * the release point. Every item creates a node that lists the source as its
	 * upstream before it exists (D37): a note in its first bytes, and a draft in
	 * its `upstream.yaml`, written before its `generation.yaml`. Closing the
	 * menu writes nothing.
	 */
	async showConnectionCreateMenu(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop
	): Promise<boolean> {
		const queuedFolder = this.view.folderForSceneMutation(sceneKey);
		const stamp = this.view.sceneMutationStamp(queuedFolder, structuralEpoch);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp)) {
			return false;
		}
		this.view.markCanvasUserInteraction();

		// Resolves once the menu is closed: `true` after a chosen node was
		// created. The scene keeps the released line until then.
		return new Promise<boolean>(resolve => {
			let chosen: Promise<void> | undefined;
			const run = (create: () => Promise<void>) => () => {
				chosen = create().then(() => resolve(true), error => {
					this.view.reportCanvasMutationError(error);
					resolve(false);
				});
			};
			// An image, a video, or an audio draft takes any source as its first
			// input; the panel says how a generation uses it (reference graph,
			// "Creating connected nodes").
			const actions: IAction[] = [
				toAction({
					id: 'basehalf.canvas.createFromConnection.note',
					label: localize('basehalf.canvas.createFromConnection.note', "Note"),
					run: run(() => this.createNoteFromConnection(sceneKey, structuralEpoch, drop))
				}),
				new Separator(),
				toAction({
					id: 'basehalf.canvas.createFromConnection.image',
					label: localize('basehalf.canvas.createFromConnection.image', "Image"),
					run: run(() => this.createDraftFromConnection(sceneKey, structuralEpoch, drop, 'image'))
				}),
				toAction({
					id: 'basehalf.canvas.createFromConnection.video',
					label: localize('basehalf.canvas.createFromConnection.video', "Video"),
					run: run(() => this.createDraftFromConnection(sceneKey, structuralEpoch, drop, 'video'))
				}),
				toAction({
					id: 'basehalf.canvas.createFromConnection.audio',
					label: localize('basehalf.canvas.createFromConnection.audio', "Audio"),
					run: run(() => this.createDraftFromConnection(sceneKey, structuralEpoch, drop, 'audio'))
				})
			];

			mainWindow.setTimeout(() => {
				if (this.view.disposed || !this.view.isCurrentSceneKey(sceneKey)
					|| !this.view.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp)) {
					resolve(false);
					return;
				}
				this.view.lastCanvasContextMenu = undefined;
				this.view.contextMenuService.showContextMenu({
					getAnchor: () => drop.anchor,
					getActions: () => actions,
					onHide: wasCancelled => {
						if (wasCancelled) {
							this.view.cards.focus({ preventScroll: true });
							resolve(false);
							return;
						}
						// Both menus run a chosen action synchronously right after
						// hiding, and the native menu reports a dismissal as not
						// cancelled. Settle in the same task, so the kept line goes
						// away with the menu.
						queueMicrotask(() => {
							if (!chosen) {
								resolve(false);
							}
						});
					}
				});
			}, 0);
		});
	}

	/** Note from Connection: an untitled note whose only content is the
	 *  frontmatter that lists the source, opened for inline editing. */
	private async createNoteFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop
	): Promise<void> {
		const folder = this.view.folderForSceneMutation(sceneKey);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const createOwner = this.view.captureCanvasPostCreateOwner();
		const createFocusOrigin = this.view.root.ownerDocument.activeElement;
		const context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
		const toAnchor = baseHalfCanvasOppositeAnchor(drop.fromAnchor);
		// The user pointed: the card is where the line was released. It is not
		// moved for other cards or for the edge of the window, and neither is
		// the view (canvas card placement).
		const canvasPosition = baseHalfCanvasConnectionTargetOrigin(drop.position, toAnchor, {
			width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
			height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT
		});
		await this.view.creation.createUntitledNote(folder, context, canvasPosition, createOwner, createFocusOrigin, undefined, {
			from: drop.from,
			fromAnchor: drop.fromAnchor,
			toAnchor
		});
	}

	/**
	 * Image, Video, or Audio from Connection: a draft named `image`, `video`,
	 * or `audio` that lists the source as its first input, at the point where
	 * the line was released and not moved from there, selected with its prompt
	 * focused. Making it is one step of the canvas undo stack, which removes the
	 * draft with its card information, its card, and its edge together.
	 */
	private async createDraftFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop,
		kind: BaseHalfGenerationKind
	): Promise<void> {
		const folder = this.view.folderForSceneMutation(sceneKey);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch)) || !this.view.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const createOwner = this.view.captureCanvasPostCreateOwner();
		await this.view.resolveLiveCanvasNodes(sceneKey, folder, [{ path: drop.from, kind: drop.fromKind }]);
		const draft = await this.view.generationCardActions.createDraft(folder.resource, kind, [drop.from]);
		const path = baseHalfCanvasChildPath(folder.relativePath, basename(draft));
		const toAnchor = baseHalfCanvasOppositeAnchor(drop.fromAnchor);
		// The shape of the ratio the new draft's values choose, and the size of a file card for a sound (canvas card placement).
		const size = baseHalfCanvasGenerationCardSize(kind, this.view.generationCardActions.newDraftRatio(kind));
		// The user pointed: the side the line enters is centered on the release point.
		const canvasPosition = baseHalfCanvasConnectionTargetOrigin(drop.position, toAnchor, size);
		await this.view.creation.placeCreatedCard(folder, path, canvasPosition, size, {
			edge: { from: drop.from, from_anchor: drop.fromAnchor, to: path, to_anchor: toAnchor }
		});
		this.view.creation.selectCreatedDraft(folder, path, createOwner);
	}

	/**
	 * Connect on the canvas (D37): lists `from` in `to`'s own upstream store
	 * (Markdown frontmatter, or its sidecar `upstream.yaml`) through the
	 * reference edit service, then remembers the gesture's anchors in the
	 * `canvas.yaml` row of the pair. The reference write is one canvas undo
	 * step; the anchor row is not part of undo.
	 */
	async connectSceneEdge(sceneKey: string, structuralEpoch: number, connection: IBaseHalfCanvasSceneConnection): Promise<void> {
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const folder = this.view.folderForSceneMutation(sceneKey);
		await this.view.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: connection.from, kind: connection.fromKind },
			{ path: connection.to, kind: connection.toKind }
		]);
		const target = this.view.workspaceNode(folder.workspaceFolder, connection.to, connection.toKind);
		const refusal = await this.inputRefusal(target, { add: connection.from });
		if (refusal) {
			this.refuseConnection(refusal);
			return;
		}
		this.view.folderForSceneMutation(sceneKey);
		const label = localize('basehalf.canvas.connect.undo', "Connect canvas nodes");
		const result = await this.runCanvasReferenceOperation(folder, target, label, () => this.view.referenceEditService.add(target, connection.from, { label }));
		if (result) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, {
				from: connection.from,
				from_anchor: connection.fromAnchor,
				to: connection.to,
				to_anchor: connection.toAnchor
			});
		}
		this.view.requestRender();
	}

	/**
	 * Reconnect on the canvas (D37):
	 * - anchors only: upserts the anchor row;
	 * - source end: replaces the entry in place in the target's store;
	 * - target end: moves the entry to the new target's store (added there
	 *   before it is removed from the old one).
	 * Each is one canvas undo step, and the new pair's anchors are remembered.
	 */
	async reconnectSceneEdge(sceneKey: string, structuralEpoch: number, intent: IBaseHalfCanvasSceneReconnect): Promise<void> {
		const { previous, next: connection } = intent;
		if (connection.from === connection.to) {
			throw new Error('A node cannot provide context to itself.');
		}
		const folder = this.view.folderForSceneMutation(sceneKey);
		const next: IBaseHalfCanvasEdge = {
			from: connection.from,
			from_anchor: connection.fromAnchor,
			to: connection.to,
			to_anchor: connection.toAnchor
		};
		if (previous.from === next.from && previous.to === next.to) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, next);
			this.view.requestRender();
			return;
		}
		await this.view.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: previous.from, kind: previous.fromKind },
			{ path: previous.to, kind: previous.toKind },
			{ path: connection.from, kind: connection.fromKind },
			{ path: connection.to, kind: connection.toKind }
		]);
		const previousTarget = this.view.workspaceNode(folder.workspaceFolder, previous.to, previous.toKind);
		const nextTarget = this.view.workspaceNode(folder.workspaceFolder, connection.to, connection.toKind);
		// The input changes in place for a source-end reconnect; otherwise one card loses it and another gains it.
		const refusal = previous.to === next.to
			? await this.inputRefusal(nextTarget, { add: next.from, remove: previous.from })
			: await this.inputRefusal(previousTarget, { remove: previous.from }) ?? await this.inputRefusal(nextTarget, { add: next.from });
		if (refusal) {
			this.refuseConnection(refusal);
			return;
		}
		const label = localize('basehalf.canvas.reconnect.undo', "Reconnect canvas nodes");
		// A source-end reconnect replaces the entry in place, so a generation
		// card's input keeps its place in the order; a target-end reconnect moves it.
		const operation: () => Promise<IBaseHalfReferenceEditResult> = previous.to === next.to
			? () => this.view.referenceEditService.replace(previousTarget, previous.from, next.from, { label })
			: previous.from === next.from
				? () => this.view.referenceEditService.move(next.from, previousTarget, nextTarget, { label })
				: () => this.view.referenceEditService.apply([
					{ node: nextTarget, operation: { kind: 'add', entry: next.from } },
					{ node: previousTarget, operation: { kind: 'remove', entry: previous.from } }
				], { label });
		this.view.folderForSceneMutation(sceneKey);
		const result = await this.runCanvasReferenceOperation(folder, nextTarget, label, operation);
		if (result) {
			await this.rememberCanvasEdgeAnchors(folder, sceneKey, structuralEpoch, next);
		}
		this.view.requestRender();
	}

	/** Disconnect on the canvas: removes `from` from `to`'s store. The anchor row is kept. */
	async removeEdgeFromScene(sceneKey: string, _structuralEpoch: number, edge: IBaseHalfCanvasSceneEdge): Promise<void> {
		const folder = this.view.folderForSceneMutation(sceneKey);
		await this.view.resolveLiveCanvasNodes(sceneKey, folder, [
			{ path: edge.from, kind: edge.fromKind },
			{ path: edge.to, kind: edge.toKind }
		]);
		const target = this.view.workspaceNode(folder.workspaceFolder, edge.to, edge.toKind);
		const refusal = await this.inputRefusal(target, { remove: edge.from });
		if (refusal) {
			this.refuseConnection(refusal);
			return;
		}
		const label = localize('basehalf.canvas.disconnect.undo', "Disconnect canvas nodes");
		await this.runCanvasReferenceOperation(folder, target, label, () => this.view.referenceEditService.remove(target, edge.from, { label }));
		this.view.requestRender();
	}
}
