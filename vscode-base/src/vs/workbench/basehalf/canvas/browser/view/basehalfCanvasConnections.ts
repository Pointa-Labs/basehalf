/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IAction, Separator, toAction } from '../../../../../base/common/actions.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileStat } from '../../../../../platform/files/common/files.js';
import { UndoRedoElementType } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasChildPath,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasItemRelationships,
	isBaseHalfCanvasEntry
} from '../../common/basehalfCanvasModel.js';
import { baseHalfCanvasResolveSiblingUpstream } from '../../../references/common/basehalfCanvasUpstream.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../../workspace/common/basehalfLegacyCleanup.js';
import { IBaseHalfReferenceEditResult } from '../../../references/common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexState, IBaseHalfUpstreamView } from '../../../references/common/basehalfReferenceIndex.js';
import { baseHalfUpstreamStoreKind } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfUpstreamActionContext, IBaseHalfUpstreamActionNode } from '../../../references/browser/basehalfUpstreamActions.js';
import { IBaseHalfCanvasStateTransition } from '../../common/basehalfCanvasMirror.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfMirrorResource } from '../../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BaseHalfNodeKind,
	createBaseHalfNodeDocument,
	serializeBaseHalfNodeDocument
} from '../../../video/common/basehalfNodeDocument.js';
import {
	IBaseHalfCanvasSceneConnection,
	IBaseHalfCanvasSceneConnectionDrop,
	IBaseHalfCanvasSceneEdge,
	IBaseHalfCanvasSceneReconnect,
	baseHalfCanvasConnectionTargetOrigin,
	baseHalfCanvasOppositeAnchor
} from '../../common/basehalfCanvasScene.js';
import { IBaseHalfWorkspaceMutationLease } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT, BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, IBaseHalfCanvasNodeDocumentTransition, IBaseHalfCanvasUndoNode, canvasResultNodeKindLabel, reverseCanvasStateTransition, roundCanvasPosition, uniqueUris } from './basehalfCanvasViewShared.js';

/**
 * A canvas change that undo replays by exact states: card and anchor rows of
 * `canvas.yaml` and whole `.bhnode` documents (whose `upstream` list travels
 * inside the document bytes). Reference operations on other
 * stores use the reference edit service's own undo element instead.
 */
interface IBaseHalfCanvasConnectionTransition {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly nodes: readonly IBaseHalfCanvasUndoNode[];
	readonly canvas: IBaseHalfCanvasStateTransition;
	readonly documents: readonly IBaseHalfCanvasNodeDocumentTransition[];
}

interface IBaseHalfCanvasCreatedNodeTransition {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly targetPath: string;
	readonly targetResource: URI;
	readonly contents: VSBuffer;
	readonly stashResource: URI;
	readonly connection: IBaseHalfCanvasConnectionTransition;
}

/**
 * Runs every step whose condition holds, in order, also after one fails, and
 * returns every failure so none hides the first one.
 */
async function settleEveryStep(steps: readonly (readonly [boolean, () => Promise<void>])[]): Promise<readonly unknown[]> {
	const errors: unknown[] = [];
	for (const [applies, step] of steps) {
		if (!applies) {
			continue;
		}
		try {
			await step();
		} catch (error) {
			errors.push(error);
		}
	}
	return errors;
}

function reverseDocumentTransitions(
	transitions: readonly IBaseHalfCanvasNodeDocumentTransition[],
	reverse: boolean
): readonly IBaseHalfCanvasNodeDocumentTransition[] {
	return reverse
		? transitions.map(transition => ({ ...transition, expected: transition.next, next: transition.expected }))
		: transitions;
}

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
		if (this.view.referenceIndexService.getUpstreamOnlyReason(node)) {
			return localize('basehalf.canvas.connect.upstreamOnly', "{0} can't receive upstream context.", name);
		}
		if (marked && baseHalfUpstreamStoreKind(node.relativePath, node.kind === 'folder') === 'sidecar') {
			return localize('basehalf.canvas.connect.markedFolder', "{0} is in a folder BaseHalf is set to leave alone.", name);
		}
		return undefined;
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

	private async applyCanvasConnectionTransition(
		transition: IBaseHalfCanvasConnectionTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		const canvas = reverseCanvasStateTransition(transition.canvas, reverse);
		const documents = reverseDocumentTransitions(transition.documents, reverse);
		await this.view.resolveLiveWorkspaceNodes(transition.folder.workspaceFolder, transition.nodes);

		for (const document of documents) {
			if (this.view.workingCopyService.isDirty(document.resource)) {
				throw new Error(`Save '${basename(document.resource)}' before changing this connection.`);
			}
			const current = await this.view.fileService.readFile(document.resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
			if (!current.value.equals(document.expected)) {
				throw new Error(`'${basename(document.resource)}' changed before this connection update could be applied.`);
			}
		}

		let canvasApplied = false;
		const written: IBaseHalfCanvasNodeDocumentTransition[] = [];
		try {
			await this.view.canvasMirrorService.transitionCanvasState(transition.folder, canvas, lease);
			canvasApplied = true;
			for (const document of documents) {
				await this.view.fileService.writeFileWithExpectedContents(
					document.resource,
					document.next,
					document.expected,
					{ atomic: { postfix: '.basehalf-canvas-undo-tmp' } }
				);
				written.push(document);
			}
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			for (const document of written.reverse()) {
				try {
					await this.view.fileService.writeFileWithExpectedContents(
						document.resource,
						document.expected,
						document.next,
						{ atomic: { postfix: '.basehalf-canvas-undo-rollback-tmp' } }
					);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (canvasApplied) {
				try {
					await this.view.canvasMirrorService.transitionCanvasState(transition.folder, reverseCanvasStateTransition(canvas, true), lease);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError([error, ...rollbackErrors], 'The canvas connection and its safe rollback both failed. Reopen the project before continuing.');
			}
			throw error;
		}
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
	 * the release point. Every item creates a node whose first bytes list the
	 * source as upstream (D37); closing the menu writes nothing.
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
			// Every kind takes any source as its first input: a Video node uses
			// it by its kind, and the other kinds keep it as context (D58).
			const nodeAction = (kind: BaseHalfNodeKind): IAction => toAction({
				id: `basehalf.canvas.createFromConnection.${kind}`,
				label: canvasResultNodeKindLabel(kind),
				run: run(() => this.createNodeFromConnection(sceneKey, structuralEpoch, drop, kind))
			});
			const actions: IAction[] = [
				toAction({
					id: 'basehalf.canvas.createFromConnection.note',
					label: localize('basehalf.canvas.createFromConnection.note', "Note"),
					run: run(() => this.createNoteFromConnection(sceneKey, structuralEpoch, drop))
				}),
				new Separator(),
				...(['image', 'video', 'audio'] as const).map(nodeAction),
				new Separator(),
				...(['file', 'pdf', 'presentation'] as const).map(nodeAction)
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

	private async createNodeFromConnection(
		sceneKey: string,
		structuralEpoch: number,
		drop: IBaseHalfCanvasSceneConnectionDrop,
		kind: BaseHalfNodeKind
	): Promise<void> {
		const queuedFolder = this.view.folderForSceneMutation(sceneKey);
		const stamp = this.view.sceneMutationStamp(queuedFolder, structuralEpoch);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(queuedFolder.workspaceFolder, stamp) || !this.view.isCurrentSceneKey(sceneKey)) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const postCreateOwner = this.view.captureCanvasPostCreateOwner();

		const name = await this.findAvailableConnectedNodeName(queuedFolder, kind);
		const targetPath = baseHalfCanvasChildPath(queuedFolder.relativePath, name);
		const targetResource = joinPath(queuedFolder.workspaceFolder, ...targetPath.split('/'));
		// The source is the node's only upstream entry in its first bytes (D37):
		// creating the file is the connection.
		const generation = kind === 'video' ? this.view.creation.initialVideoGeneration() : undefined;
		const document = createBaseHalfNodeDocument({
			id: generateUuid(),
			kind,
			title: canvasResultNodeKindLabel(kind),
			upstream: [drop.from],
			...(generation ? { generation } : {})
		});
		if (kind === 'video') {
			this.view.createdNodeFocusPath = targetPath;
		}
		const targetSize = kind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
		const contents = VSBuffer.fromString(serializeBaseHalfNodeDocument(document));
		const edge: IBaseHalfCanvasEdge = {
			from: drop.from,
			from_anchor: drop.fromAnchor,
			to: targetPath,
			to_anchor: baseHalfCanvasOppositeAnchor(drop.fromAnchor)
		};
		const stashResource = joinPath(
			queuedFolder.workspaceFolder,
			'.bh',
			'cache',
			'canvas-node-undo',
			generateUuid(),
			name
		);

		const reservation = this.view.workspaceMutationCoordinator.reserveStructural(queuedFolder.workspaceFolder, [{
			workspace: queuedFolder.workspaceFolder,
			relativePath: targetPath
		}]);
		const marked = await baseHalfIsWorkspaceFolderMarked(this.view.fileService, queuedFolder.workspaceFolder);
		let committed: IBaseHalfCanvasCreatedNodeTransition | undefined;
		let failure: unknown;
		await reservation.finish(async lease => {
			let fileCreated = false;
			let canvasApplied = false;
			let canvasTransition: IBaseHalfCanvasStateTransition | undefined;
			try {
				this.view.folderForSceneMutation(sceneKey);
				const currentCanvas = await this.view.canvasMirrorService.readCanvas(queuedFolder);
				if (await this.view.fileService.exists(baseHalfMirrorResource(queuedFolder.workspaceFolder, targetPath, 'badge.yaml'))
					|| currentCanvas?.cards.some(candidate => candidate.path === targetPath)) {
					throw new Error(`Project metadata for '${targetPath}' already exists.`);
				}
				// Edge rows are anchor memory: a stale row for this pair is replaced.
				const staleEdge = currentCanvas?.edges.find(candidate => candidate.from === edge.from && candidate.to === edge.to) ?? null;
				// The user pointed: the card is where the line was released.
				const canvasPosition = baseHalfCanvasConnectionTargetOrigin(drop.position, edge.to_anchor, targetSize);
				const card: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number]['next'] = {
					path: targetPath,
					kind: 'file',
					x: roundCanvasPosition(canvasPosition.x),
					y: roundCanvasPosition(canvasPosition.y),
					width: targetSize.width,
					height: targetSize.height
				};
				canvasTransition = {
					cards: [{ path: targetPath, expected: null, next: card }],
					edges: marked ? [] : [{ from: edge.from, to: edge.to, expected: staleEdge, next: edge }]
				};
				await this.view.fileService.writeFileWithExpectedContents(
					targetResource,
					contents,
					null,
					{ atomic: { postfix: '.basehalf-node-create-tmp' } }
				);
				fileCreated = true;
				await this.view.resolveLiveWorkspaceNodes(queuedFolder.workspaceFolder, [
					{ path: drop.from, kind: drop.fromKind },
					{ path: targetPath, kind: 'file' }
				]);
				await this.view.canvasMirrorService.transitionCanvasState(queuedFolder, canvasTransition, lease);
				canvasApplied = true;
				const connection: IBaseHalfCanvasConnectionTransition = {
					folder: queuedFolder,
					nodes: [
						{ path: drop.from, kind: drop.fromKind },
						{ path: targetPath, kind: 'file' }
					],
					canvas: canvasTransition,
					documents: []
				};
				committed = { folder: queuedFolder, targetPath, targetResource, contents, stashResource, connection };
			} catch (error) {
				// The initial file is discarded rather than kept as undo state: no
				// user-visible operation was committed.
				const rollbackErrors = await settleEveryStep([
					[canvasApplied, async () => {
						if (canvasTransition) {
							await this.view.canvasMirrorService.transitionCanvasState(queuedFolder, reverseCanvasStateTransition(canvasTransition, true), lease);
						}
					}],
					[fileCreated, () => this.discardExactCanvasNodeFile(targetResource, contents)]
				]);
				failure = rollbackErrors.length > 0
					? new AggregateError([error, ...rollbackErrors], `The result node could not be created and its safe cleanup did not fully complete. '${targetPath}' was not overwritten or deleted.`)
					: error;
			}
		});
		if (failure) {
			throw failure;
		}
		if (!committed) {
			throw new Error('The result node transaction completed without a committed state.');
		}
		// Show the new connection now instead of after the file watcher event.
		this.view.referenceIndexService.acceptSavedContent(
			{ resource: targetResource, workspaceFolder: queuedFolder.workspaceFolder, relativePath: targetPath },
			'node',
			contents.toString()
		);

		this.pushCanvasCreatedNodeUndo(committed);
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(queuedFolder), [targetPath], postCreateOwner);
		this.view.requestRender();
	}

	private async findAvailableConnectedNodeName(folder: IBaseHalfCanvasFolderState, kind: BaseHalfNodeKind): Promise<string> {
		const canvas = await this.view.canvasMirrorService.readCanvas(folder);
		for (let index = 0; index < 1000; index++) {
			const name = `${kind}${index === 0 ? '' : `-${index + 1}`}${BASEHALF_NODE_DOCUMENT_EXTENSION}`;
			const path = baseHalfCanvasChildPath(folder.relativePath, name);
			if (await this.view.fileService.exists(joinPath(folder.workspaceFolder, ...path.split('/')))
				|| await this.view.fileService.exists(baseHalfMirrorResource(folder.workspaceFolder, path, 'badge.yaml'))
				|| canvas?.cards.some(card => card.path === path)
				|| canvas?.edges.some(edge => edge.from === path || edge.to === path)) {
				continue;
			}
			return name;
		}
		throw new Error(`Too many ${kind} result nodes already use the default name.`);
	}

	private pushCanvasCreatedNodeUndo(transition: IBaseHalfCanvasCreatedNodeTransition): void {
		const source = transition.connection.nodes[0];
		const run = async (reverse: boolean): Promise<void> => {
			const reservation = this.view.workspaceMutationCoordinator.reserveStructural(transition.folder.workspaceFolder, [{
				workspace: transition.folder.workspaceFolder,
				relativePath: transition.targetPath
			}]);
			await reservation.finish(lease => this.applyCanvasCreatedNodeTransition(transition, reverse, lease));
			this.view.renderer.scheduleBackgroundRender();
		};
		this.view.undoRedoService.pushElement({
			type: UndoRedoElementType.Workspace,
			resources: uniqueUris([
				this.view.canvasMirrorService.canvasResource(transition.folder),
				joinPath(transition.folder.workspaceFolder, ...source.path.split('/')),
				transition.targetResource
			]),
			label: localize('basehalf.canvas.createFromConnection.undo', "Create connected result node"),
			code: 'basehalf.canvas.createFromConnection',
			undo: () => run(true),
			redo: () => run(false)
		}, undefined, this.view.canvasUndoRedoSource);
	}

	private async applyCanvasCreatedNodeTransition(
		transition: IBaseHalfCanvasCreatedNodeTransition,
		reverse: boolean,
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		if (reverse) {
			await this.assertExactCanvasNodeFile(transition.targetResource, transition.contents);
			await this.applyCanvasConnectionTransition(transition.connection, true, lease);
			try {
				await this.moveExactCanvasNodeToStash(transition.folder.workspaceFolder, transition.targetResource, transition.contents, transition.stashResource);
			} catch (error) {
				try {
					await this.applyCanvasConnectionTransition(transition.connection, false, lease);
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], 'Undo could not remove the new node and could not restore its canvas connection. Reopen the project before continuing.');
				}
				throw error;
			}
			return;
		}

		await this.restoreExactCanvasNodeFromStash(transition.targetResource, transition.contents, transition.stashResource);
		try {
			await this.applyCanvasConnectionTransition(transition.connection, false, lease);
		} catch (error) {
			try {
				await this.moveExactCanvasNodeToStash(transition.folder.workspaceFolder, transition.targetResource, transition.contents, transition.stashResource);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `Redo could not restore the connection and '${transition.targetPath}' changed before safe cleanup. The file was preserved.`);
			}
			throw error;
		}
	}

	private async assertExactCanvasNodeFile(resource: URI, expected: VSBuffer): Promise<void> {
		if (this.view.workingCopyService.isDirty(resource)) {
			throw new Error(`Save '${basename(resource)}' before changing this node.`);
		}
		const current = await this.view.fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		if (!current.value.equals(expected)) {
			throw new Error(`'${basename(resource)}' changed after it was created. Its file, connection, and canvas card were preserved.`);
		}
	}

	private async moveExactCanvasNodeToStash(workspaceFolder: URI, resource: URI, expected: VSBuffer, stash: URI): Promise<void> {
		await this.assertExactCanvasNodeFile(resource, expected);
		if (await this.view.fileService.exists(stash)) {
			throw new Error(`The private undo copy for '${basename(resource)}' already exists.`);
		}
		// An undo copy is a working file: git must not show it.
		await baseHalfEnsureMirrorIgnoreFile(this.view.fileService, workspaceFolder);
		await this.view.fileService.createFolder(dirname(stash));
		await this.view.fileService.move(resource, stash, false);
		const moved = await this.view.fileService.readFile(stash, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		if (moved.value.equals(expected)) {
			return;
		}
		const restoreErrors: unknown[] = [];
		try {
			if (await this.view.fileService.exists(resource)) {
				throw new Error(`'${basename(resource)}' was recreated while its undo was being prepared.`);
			}
			await this.view.fileService.move(stash, resource, false);
		} catch (error) {
			restoreErrors.push(error);
		}
		throw restoreErrors.length > 0
			? new AggregateError(restoreErrors, `'${basename(resource)}' changed during safe removal. Its changed contents were preserved.`)
			: new Error(`'${basename(resource)}' changed during safe removal and was restored.`);
	}

	private async discardExactCanvasNodeFile(resource: URI, expected: VSBuffer): Promise<void> {
		await this.assertExactCanvasNodeFile(resource, expected);
		await this.view.fileService.del(resource, {
			atomic: { postfix: `.basehalf-node-rollback-${generateUuid()}` }
		});
	}

	private async restoreExactCanvasNodeFromStash(resource: URI, expected: VSBuffer, stash: URI): Promise<void> {
		if (await this.view.fileService.exists(resource)) {
			throw new Error(`'${basename(resource)}' already exists. Redo did not replace it.`);
		}
		if (await this.view.fileService.exists(stash)) {
			const stashed = await this.view.fileService.readFile(stash, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			if (!stashed.value.equals(expected)) {
				throw new Error(`The private undo copy for '${basename(resource)}' changed. Redo did not use it.`);
			}
			await this.view.fileService.move(stash, resource, false);
			await this.assertExactCanvasNodeFile(resource, expected);
			return;
		}
		await this.view.fileService.writeFileWithExpectedContents(
			resource,
			expected,
			null,
			{ atomic: { postfix: '.basehalf-node-redo-tmp' } }
		);
	}

	/**
	 * Connect on the canvas (D37): lists `from` in `to`'s own upstream store
	 * (Markdown frontmatter, `.bhnode` `upstream`, or its sidecar) through the
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
		const label = localize('basehalf.canvas.reconnect.undo', "Reconnect canvas nodes");
		// A source-end reconnect replaces the entry in place, so a Video node's
		// input keeps its place in the order; a target-end reconnect moves it.
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
		const label = localize('basehalf.canvas.disconnect.undo', "Disconnect canvas nodes");
		await this.runCanvasReferenceOperation(folder, target, label, () => this.view.referenceEditService.remove(target, edge.from, { label }));
		this.view.requestRender();
	}
}
