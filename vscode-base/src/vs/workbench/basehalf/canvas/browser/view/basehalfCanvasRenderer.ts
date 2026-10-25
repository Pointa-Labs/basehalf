/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { FileChangesEvent, IFileStat } from '../../../../../platform/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	BASEHALF_CANVAS_DOCUMENT_CARD_RATIO,
	BASEHALF_CANVAS_PICTURE_DEFAULT_RATIO,
	baseHalfCanvasCardBuiltConnections,
	baseHalfCanvasCardResizes,
	baseHalfCanvasCardToggleConnections,
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasModelFromStat,
	baseHalfCanvasChildPath,
	baseHalfCanvasFolderWithDrafts,
	baseHalfCanvasPictureKind,
	baseHalfCanvasShowsDocument,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasGenerationCard,
	IBaseHalfCanvasItem,
	IBaseHalfCanvasItemRelationships
} from '../../common/basehalfCanvasModel.js';
import { baseHalfMirrorRoot } from '../../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BASEHALF_CANVAS_DEFAULT_ZOOM_MAX } from '../../../shell/common/basehalfConfiguration.js';
import { baseHalfUserFacingErrorMessage } from '../../../shell/common/basehalfPlainFailureReason.js';
import { IBaseHalfGenerationCardEntry } from '../../../video/common/basehalfVideoGeneration.js';
import { baseHalfVideoChoiceRatio, IBaseHalfVideoCatalog } from '../../../video/common/basehalfVideoCatalog.js';
import { IBaseHalfCanvasPicture } from '../basehalfCanvasPictureShapes.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneCardPresentation, IBaseHalfCanvasSceneEdge } from '../../common/basehalfCanvasScene.js';
import { BaseHalfCanvasCardPreview } from '../../common/basehalfCanvasCardPreview.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY, IBaseHalfCanvasCardRenderCacheEntry, baseHalfBadgeResourceIdentity, baseHalfCanvasLayoutNotice, baseHalfCanvasPendingSelectionIsReady, baseHalfCanvasRetainedCardChromeIsStale } from './basehalfCanvasViewShared.js';

/**
 * The longest the canvas waits with a redraw for items that are being
 * recognized at a new path. A safeguard: the wait ends when their card
 * information has followed. It is also the latest that a comparison starts
 * after the first file event (following moved items, "What the user sees").
 */
const BASEHALF_CANVAS_MOVED_ITEMS_HOLD_MS = 10_000;

/** After that limit, how long the canvas remembers that it already waited for a move that has not settled. */
const BASEHALF_CANVAS_MOVED_ITEMS_FORGET_MS = 120_000;

/** How long its first drawing waits for the comparison at open. */
const BASEHALF_CANVAS_MOVED_ITEMS_OPEN_HOLD_MS = 500;

/** How long a later redraw waits for the comparison at open: no change is on its way, the folder is only being read. */
const BASEHALF_CANVAS_MOVED_ITEMS_OPENING_HOLD_MS = 2000;

function edgeId(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

/** How long a drawing waits at most for the pictures of the cards that appear in it (canvas card placement). */
const PICTURES_APPEAR_WAIT_MS = 1000;

/**
 * Draws the canvas of the folder that is shown: reads the folder and its
 * layout, builds the scene, keeps cards that did not change, and holds a
 * drawing while a gesture or a move is going on.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasRenderer {
	private readonly cardListeners = this.view.register(new DisposableStore());
	/** When the canvas first held a redraw for an item that is being recognized at a new path. */
	private movedItemsHoldStarted: number | undefined;
	/** The folder the hold was started for. */
	private movedItemsHoldFolder: string | undefined;
	private movedItemsHoldWaiting = false;
	/** The first drawing waits for the comparison at open for a shorter time. */
	private firstRenderHeld = false;
	/** The canvas layout damage last written to the log, so a re-render does not repeat it. */
	private loggedCanvasDamage: string | undefined;
	/** Connections of the rendered cards, from the reference index. */
	private renderedRelationships: ReadonlyMap<string, IBaseHalfCanvasItemRelationships> = new Map();
	private renderQueuedBehindGesture = false;
	private canvasLayoutReconcileQueuedBehindGesture = false;
	/** The generation cards of the folder that was drawn last, as the card store listed them, and the folder. */
	private renderedGenerationCards: { readonly folder: string; readonly cards: readonly IBaseHalfGenerationCardEntry[] } | undefined;
	/** The ratios of the pictures of the last full drawing, which a layout change keeps. */
	private renderedPictureRatios: { readonly folder: string; readonly ratios: ReadonlyMap<string, number> } | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/**
	 * The generation cards of a folder, through the card store (generation
	 * cards, "Drafts and missing files"). The canvas draws the folder without
	 * them when they cannot be listed.
	 */
	private async listGenerationCards(folder: IBaseHalfCanvasFolderState): Promise<readonly IBaseHalfGenerationCardEntry[]> {
		try {
			return await this.view.generationCardStore.listCards(folder.resource);
		} catch (error) {
			this.view.logService.warn(`BaseHalf could not list the image and video cards of '${folder.relativePath}'`, error);
			return [];
		}
	}

	/**
	 * The ratio of the picture of each image and video of the folder whose
	 * ratio is known: a file's, which the window measures, and the one a
	 * draft's settings choose, its kind's when they choose none (canvas card
	 * placement, "The card of an image or a video has its picture's shape").
	 * A PDF or a book has the ratio of its card, 3:4, without measuring. It
	 * waits for the pictures of cards that appear, at most
	 * {@link PICTURES_APPEAR_WAIT_MS}, so that their places are chosen with
	 * their shape. A draft whose model the catalog cannot tell yet is left out,
	 * and keeps the size of its row.
	 */
	private async readPictureRatios(
		folder: IBaseHalfCanvasFolderState,
		stat: IFileStat,
		generationCards: ReadonlyMap<string, IBaseHalfCanvasGenerationCard>,
		canvas: IBaseHalfCanvasFile | null,
		waiting: ReadonlyMap<string, IBaseHalfCanvasCard> | undefined,
		pathKey: (path: string) => string
	): Promise<ReadonlyMap<string, number>> {
		const rows = new Set((canvas?.cards ?? []).map(card => pathKey(card.path)));
		const pictures: { readonly path: string; readonly picture: IBaseHalfCanvasPicture; readonly appears: boolean }[] = [];
		const drafts: { readonly path: string; readonly resource: URI; readonly kind: 'image' | 'video' }[] = [];
		const documents: string[] = [];
		for (const child of stat.children ?? []) {
			const path = baseHalfCanvasChildPath(folder.relativePath, basename(child.resource));
			const generation = generationCards.get(path);
			const shaped = { kind: child.isDirectory ? 'folder' as const : 'file' as const, stat: child, generation };
			const kind = baseHalfCanvasPictureKind(shaped);
			if (!kind) {
				if (baseHalfCanvasShowsDocument(shaped)) {
					documents.push(path);
				}
				continue;
			}
			if (generation?.draft) {
				drafts.push({ path, resource: child.resource, kind });
				continue;
			}
			pictures.push({
				path,
				picture: { resource: child.resource, version: `${child.mtime ?? 0}-${child.size ?? 0}`, kind },
				appears: !rows.has(pathKey(path)) && !waiting?.has(path)
			});
		}
		const ratios = new Map<string, number>(documents.map(path => [path, BASEHALF_CANVAS_DOCUMENT_CARD_RATIO]));
		const appearing = pictures.some(entry => entry.appears) || drafts.some(draft => !rows.has(pathKey(draft.path)));
		const [catalog] = await Promise.all([
			drafts.length > 0 ? this.catalogForDrafts(appearing ? PICTURES_APPEAR_WAIT_MS : 0) : Promise.resolve(undefined),
			this.view.pictureShapes.measure(pictures.map(entry => entry.picture), appearing ? PICTURES_APPEAR_WAIT_MS : 0)
		]);
		for (const { path, picture } of pictures) {
			const ratio = this.view.pictureShapes.ratioOf(picture);
			if (typeof ratio === 'number') {
				ratios.set(path, ratio);
			}
		}
		if (catalog) {
			await Promise.all(drafts.map(async draft => {
				const info = await this.view.generationCardStore.read(draft.resource).then(snapshot => snapshot.info, () => undefined);
				if (info) {
					ratios.set(draft.path, baseHalfVideoChoiceRatio(catalog, info) ?? BASEHALF_CANVAS_PICTURE_DEFAULT_RATIO[draft.kind]);
				}
			}));
		}
		return ratios;
	}

	/** The catalog, which tells the ratio of a draft's model, waiting at most `wait` for one that loads. */
	private async catalogForDrafts(wait: number): Promise<IBaseHalfVideoCatalog | undefined> {
		const state = this.view.videoCatalogService.state;
		if (state.kind === 'ready') {
			return state.catalog;
		}
		return state.kind === 'loading' && wait > 0 ? this.view.videoCatalogService.whenReady(wait).catch(() => undefined) : undefined;
	}

	/** The folder's stat with its drafts among its children, and the generation cards by path, for the model. */
	private withGenerationCards(folder: IBaseHalfCanvasFolderState, stat: IFileStat, cards: readonly IBaseHalfGenerationCardEntry[]): { readonly stat: IFileStat; readonly generationCards: ReadonlyMap<string, IBaseHalfCanvasGenerationCard> } {
		return {
			stat: baseHalfCanvasFolderWithDrafts(stat, cards.filter(card => !card.hasFile)),
			generationCards: new Map(cards.map(card => [baseHalfCanvasChildPath(folder.relativePath, card.name), Object.freeze({ kind: card.kind, draft: !card.hasFile })]))
		};
	}

	/**
	 * Render driven by disk activity rather than user navigation. Auto-save
	 * makes these frequent (one per typing pause), so they coalesce, and while
	 * a full-screen card detail covers the canvas the rebuild is skipped
	 * entirely — closing the detail changes navigation state, which always
	 * triggers a fresh full render. Only the detail header's badge zone is
	 * live while covered, so refresh just that.
	 */
	scheduleBackgroundRender(): void {
		if (this.view.backgroundRenderTimer !== undefined) {
			return;
		}
		this.view.backgroundRenderTimer = mainWindow.setTimeout(() => {
			this.view.backgroundRenderTimer = undefined;
			if (this.view.disposed) {
				return;
			}
			this.renderForDiskChange();
		}, 100);
	}

	/**
	 * A redraw for what happened on disk, not for what the user did on the
	 * canvas. It never replaces a description the user is typing, and it waits
	 * while an item of this folder is being recognized at a new path. Every
	 * such redraw goes through here, also the one that follows that wait:
	 * since every shown card is followed, the wait is common.
	 */
	private renderForDiskChange(): void {
		const cardDetail = this.view.canvasNavigationService.state.cardDetail;
		if (cardDetail) {
			void this.view.badgeEditor.renderDetailBadge(cardDetail);
			return;
		}
		if (this.view.badgeEditor.deferCanvasBadgeRefreshWhileFocused()) {
			return;
		}
		if (!this.holdRenderForMovedItems()) {
			this.view.requestRender(true);
		}
	}

	/**
	 * While an item of the folder that is shown is being recognized at a new
	 * path and its card information is on its way there, the canvas does not
	 * redraw for what happened on disk: the card would leave and come back. It
	 * waits until that is done, ten seconds at most, and then draws what is on
	 * disk. For the comparison at open its first drawing waits half a second
	 * and a later redraw two seconds. Navigation and the user's own edits are
	 * never held.
	 */
	holdRenderForMovedItems(): boolean {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.movedItemsService.isSettled(folder.workspaceFolder, folder.relativePath)) {
			this.movedItemsHoldStarted = undefined;
			this.firstRenderHeld = true;
			return false;
		}
		const now = Date.now();
		// Another folder is shown: what was waited for before says nothing about this one.
		const shown = folder.resource.toString();
		if (this.movedItemsHoldFolder !== shown) {
			this.movedItemsHoldFolder = shown;
			this.movedItemsHoldStarted = undefined;
		}
		this.movedItemsHoldStarted ??= now;
		const limit = !this.firstRenderHeld ? BASEHALF_CANVAS_MOVED_ITEMS_OPEN_HOLD_MS
			: this.view.movedItemsService.hasCompared(folder.workspaceFolder) ? BASEHALF_CANVAS_MOVED_ITEMS_HOLD_MS
				: BASEHALF_CANVAS_MOVED_ITEMS_OPENING_HOLD_MS;
		const remaining = limit - (now - this.movedItemsHoldStarted);
		if (remaining <= 0) {
			// The limit has passed: the canvas draws what is on disk, and is not
			// held again for the same move.
			this.firstRenderHeld = true;
			return false;
		}
		if (!this.movedItemsHoldWaiting) {
			this.movedItemsHoldWaiting = true;
			const started = this.movedItemsHoldStarted;
			const forget = () => {
				// The next change on disk starts a wait of its own.
				if (this.movedItemsHoldStarted === started && this.view.movedItemsService.isSettled(folder.workspaceFolder, folder.relativePath)) {
					this.movedItemsHoldStarted = undefined;
				}
			};
			void this.view.movedItemsService.whenSettled(folder.workspaceFolder, remaining, folder.relativePath).finally(() => {
				this.movedItemsHoldWaiting = false;
				if (this.view.disposed) {
					return;
				}
				forget();
				if (this.movedItemsHoldStarted === started) {
					// The limit ended the wait. Its start is forgotten once the move has
					// settled, however long that takes.
					void this.view.movedItemsService.whenSettled(folder.workspaceFolder, BASEHALF_CANVAS_MOVED_ITEMS_FORGET_MS, folder.relativePath).finally(forget);
				}
				// Still a redraw for what happened on disk: it keeps a description that is being typed.
				this.renderForDiskChange();
			});
		}
		return true;
	}

	async render(forDiskChange = false): Promise<void> {
		if (this.view.disposed) {
			return;
		}
		const navigatedDetail = this.view.canvasNavigationService.state.cardDetail;
		const inlineEditor = this.view.activeCanvasNoteEditor;
		if (navigatedDetail) {
			this.view.canvasNoteSurfacePath = undefined;
		}
		if (navigatedDetail && !inlineEditor) {
			this.view.noteEditing.cancelPendingCanvasNoteFormatCommands(pending => !pending.active);
		}
		if (navigatedDetail && inlineEditor) {
			// Navigation has already drained the shared editor flush barrier. Retire
			// the canvas author before the detail surface can acquire the document.
			await this.view.noteEditing.drainActiveCanvasNoteFormatCommands(inlineEditor);
			this.view.activeCanvasNoteEditor = undefined;
			this.view.canvasNoteSurfacePath = undefined;
			this.view.noteEditing.clearPendingCanvasNoteFocus(inlineEditor.path);
			this.view.noteEditing.releaseCanvasNoteFocusIntent(inlineEditor.focusIntent);
			this.view.canvasNavigationService.setActiveCanvasEditor(undefined);
			this.view.noteEditing.detachCanvasNoteEditorMount(inlineEditor);
		}
		// Card detail is navigation state, not scene data. It must react even if a
		// pointer gesture is still winding down on the canvas underneath.
		this.view.cardDetailHost.renderDetail();
		if (!this.view.canvasNavigationService.state.cardDetail && this.view.badgeInteractionRenderGate.defer()) {
			return;
		}

		// External file/mirror changes may arrive during a live scene transaction.
		// Reconcile after the gesture so a stale disk snapshot cannot overwrite the
		// controlled React Flow geometry under the pointer.
		if (this.deferRenderForSceneInteraction()) {
			return;
		}
		this.renderQueuedBehindGesture = false;

		const seq = ++this.view.renderSeq;
		const folder = this.view.getCurrentFolder();

		if (!folder) {
			this.view.noteEditing.cancelPendingCreatedCanvasNoteActivation();
			this.view.noteEditing.cancelPendingCanvasNoteFormatCommands();
			if (this.view.activeCanvasNoteEditor && !await this.view.noteEditing.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			clearNode(this.view.canvasOverlay);
			clearNode(this.view.inlineEditLayer);
			this.view.inlineEditListeners.clear();
			this.view.inlineEdit = undefined;
			this.view.creation.releaseEndedInlineRenameEditor();
			this.view.renderedBadges = new Map();
			this.view.renderedBadgeProblems = new Map();
			this.renderedRelationships = new Map();
			this.view.renderedUpstreamViews = new Map();
			this.view.renderedIndexState = undefined;
			this.view.renderedItemsByPath = new Map();
			this.view.renderedCardPreviewsByPath = new Map();
			this.view.renderedCardsByPath = new Map();
			this.view.renderedCardElementsByPath = new Map();
			this.view.renderedSceneCards = [];
			this.view.renderedSceneEdges = [];
			this.view.renderedSceneStructuralEpoch = 0;
			this.view.onDidChangeSceneEmitter.fire({ scene: this.view.canvasViewScene(BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY), drawn: false });
			this.view.badgeEditor.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.view.cardListenerStores.clear();
			this.view.canvasScene.update({ key: BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY, structuralEpoch: 0, revision: seq, cards: [], edges: [] });
			this.renderEmpty('No folder');
			return;
		}
		const structuralStamp = this.view.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return;
		}

		let stat: IFileStat;
		try {
			stat = await this.view.fileService.resolve(folder.resource, { resolveMetadata: true });
		} catch (error) {
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			this.renderedGenerationCards = undefined;
			if (this.view.activeCanvasNoteEditor && !await this.view.noteEditing.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			this.view.noteEditing.cancelPendingCanvasNoteFormatCommands(pending => pending.sceneKey === this.view.sceneKey(folder));
			if (!this.isRenderCurrent(seq)
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
			if (this.view.badgeInteractionRenderGate.defer() || this.deferRenderForSceneInteraction()) {
				return;
			}
			clearNode(this.view.canvasOverlay);
			clearNode(this.view.inlineEditLayer);
			this.view.inlineEditListeners.clear();
			this.view.renderedBadges = new Map();
			this.view.renderedBadgeProblems = new Map();
			this.renderedRelationships = new Map();
			this.view.renderedUpstreamViews = new Map();
			this.view.renderedIndexState = undefined;
			this.view.renderedItemsByPath = new Map();
			this.view.renderedCardPreviewsByPath = new Map();
			this.view.renderedCardsByPath = new Map();
			this.view.renderedCardElementsByPath = new Map();
			this.view.renderedSceneCards = [];
			this.view.renderedSceneEdges = [];
			this.view.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
			this.view.onDidChangeSceneEmitter.fire({ scene: this.view.canvasViewScene(this.view.sceneKey(folder)), drawn: false });
			this.view.badgeEditor.resetCanvasBadgeDeferredRefresh();
			this.cardListeners.clear();
			this.view.cardListenerStores.clear();
			if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
			this.view.canvasScene.update({ key: this.view.sceneKey(folder), structuralEpoch: structuralStamp.structuralEpoch, revision: seq, cards: [], edges: [] });
			this.renderEmpty(error instanceof Error ? error.message : String(error));
			return;
		}

		if (!this.isRenderCurrent(seq)) {
			return;
		}
		// A draft is an item of its folder: its card is drawn with the folder's files.
		const generationCards = await this.listGenerationCards(folder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const withCards = this.withGenerationCards(folder, stat, generationCards);
		stat = withCards.stat;

		// What waits for a write, as it is before the layout is read: a save that
		// lands while this drawing is prepared must not take a card out of it.
		const waitingPlaces = this.view.chosenCanvasPlaces.waitingFor(folder);
		let canvas: IBaseHalfCanvasFile | null = null;
		let canvasWarning: string | undefined;
		// BaseHalf saves the places it chooses only into a layout it could read in full.
		let canvasReadInFull = false;
		try {
			const read = await this.view.canvasMirrorService.inspectCanvas(folder);
			canvas = read.canvas;
			canvasReadInFull = read.damage === undefined;
			if (read.damage) {
				canvasWarning = baseHalfCanvasLayoutNotice(read.damage);
			}
			const damageKey = read.damage ? `${this.view.sceneKey(folder)}\0${read.damage.kind}\0${read.damage.reason}` : undefined;
			if (read.damage && damageKey !== this.loggedCanvasDamage) {
				this.view.logService.warn(`BaseHalf canvas layout of '${folder.relativePath}' is ${read.damage.kind === 'partial' ? 'partly unreadable' : 'unreadable'}: ${read.damage.reason}`);
			}
			this.loggedCanvasDamage = damageKey;
		} catch (error) {
			this.view.logService.warn(`BaseHalf canvas layout of '${folder.relativePath}' could not be loaded`, error);
			canvasWarning = localize('basehalf.canvas.layout.loadFailed', "The saved layout could not be loaded: {0}", baseHalfUserFacingErrorMessage(error));
		}
		if (!this.isRenderCurrent(seq)) {
			return;
		}

		// One sparse-mirror walk fetches every badge description in the
		// workspace, and the reference index supplies every card's connections
		// (D37): the model needs both BEFORE it builds items so the child cap can
		// keep annotated children and the edge set can derive from the
		// downstream nodes' upstream lists.
		const badgeRead = await this.view.badgeMirrorService.listBadges(folder.workspaceFolder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const connections = await this.view.connections.readCanvasConnections(folder, stat);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const appearanceMark = this.view.appearanceWrites.mark();
		const appearanceRead = await this.view.canvasAppearanceService.readAll(folder.workspaceFolder);
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		// A card whose appearance this window wrote while the files were read
		// keeps what it shows; the drawing after the write reads it.
		const backgrounds = new Map(appearanceRead.backgrounds);
		const hiddenCovers = new Set(appearanceRead.hiddenCovers);
		for (const path of this.view.appearanceWrites.unreadSince(appearanceMark)) {
			const background = this.view.renderedNoteBackgrounds.get(path);
			if (background) {
				backgrounds.set(path, background);
			} else {
				backgrounds.delete(path);
			}
			if (this.view.renderedHiddenCovers.has(path)) {
				hiddenCovers.add(path);
			} else {
				hiddenCovers.delete(path);
			}
		}
		this.view.renderedNoteBackgrounds = backgrounds;
		this.view.renderedHiddenCovers = hiddenCovers;
		for (const problem of appearanceRead.problems) {
			this.view.logService.warn(`BaseHalf card appearance issue for ${problem.relativePath}: ${problem.message}`);
		}

		// A card that appears gets its place in this drawing and keeps it (canvas
		// card placement). The place depends on its size, which for a generation
		// card is known from the card store.
		const pathKey = this.view.creation.canvasPathKey(folder);
		const childPaths = (stat.children ?? []).map(child => baseHalfCanvasChildPath(folder.relativePath, basename(child.resource)));
		// This listing can be ahead of the file events for the same change. What
		// it shows of the cards that were here is told to following moved items,
		// so that a renamed file is not taken for a deleted one and a new one.
		const sameItem = pathKey ?? ((path: string) => path);
		const listed = new Set(childPaths.map(sameItem));
		const missingRows = (canvas?.cards ?? []).filter(card => !listed.has(sameItem(card.path))).map(card => ({ path: card.path, kind: card.kind }));
		if (missingRows.length > 0) {
			const rows = new Set((canvas?.cards ?? []).map(card => sameItem(card.path)));
			await this.view.movedItemsService.acceptListing(folder.workspaceFolder, missingRows, childPaths.filter(path => !rows.has(sameItem(path))));
			if (!this.isRenderCurrent(seq)) {
				return;
			}
			// A redraw for what happened on disk waits until the items are
			// recognized. Whether the folder is settled decides, and not whether
			// this drawing was the one that told: another drawing may have, and
			// have been overtaken by this one.
			if (forDiskChange && !this.view.userRenderOwed && this.holdRenderForMovedItems()) {
				return;
			}
		}
		const goneRows = canvasReadInFull ? await this.view.chosenCanvasPlaces.goneRows(folder, childPaths, canvas, pathKey) : [];
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		// The card of an image or a video has its picture's shape, known before a
		// card that appears is placed (canvas card placement).
		const pictureRatios = await this.readPictureRatios(folder, stat, withCards.generationCards, canvas, waitingPlaces, pathKey ?? (path => path));
		if (!this.isRenderCurrent(seq)) {
			return;
		}
		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas,
			badges: badgeRead.badges,
			relationships: connections.relationships,
			waiting: waitingPlaces,
			generationCards: withCards.generationCards,
			pictureRatios,
			pathKey,
			released: new Set(goneRows)
		});
		let badgeWarning: string | undefined;
		const folderPrefix = folder.relativePath.length === 0 ? '' : `${folder.relativePath}/`;
		const localProblems = badgeRead.problems.filter(problem => problem.relativePath.startsWith(folderPrefix));
		if (localProblems.length > 0) {
			badgeWarning = localProblems.length === 1
				? localize('basehalf.canvas.badge.oneNotLoaded', "1 description could not be loaded")
				: localize('basehalf.canvas.badge.someNotLoaded', "{0} descriptions could not be loaded", localProblems.length);
			for (const problem of localProblems) {
				this.view.logService.warn(`BaseHalf badge metadata issue for ${problem.relativePath}: ${problem.detail}`);
			}
		}
		const items = model.items;
		const currentSceneKey = this.view.sceneKey(folder);
		const activeNoteBeforeModelUpdate = this.view.activeCanvasNoteEditor;
		if (activeNoteBeforeModelUpdate && !items.some(item => item.path === activeNoteBeforeModelUpdate.path
			&& this.view.uriIdentityService.extUri.isEqual(item.stat.resource, activeNoteBeforeModelUpdate.state.resource))) {
			if (!await this.view.noteEditing.closeActiveCanvasNoteEditor(false)) {
				return;
			}
			if (!this.isRenderCurrent(seq)
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return;
			}
		}
		const previews = new Map<string, BaseHalfCanvasCardPreview>();
		for (const item of items) {
			previews.set(item.path, this.view.previews.cardPreviewWithoutFile(item) ?? this.reusableCardPreview(item) ?? { kind: 'loading', text: 'Loading preview…' });
		}
		if (this.view.badgeInteractionRenderGate.defer() || this.deferRenderForSceneInteraction()) {
			return;
		}
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return;
		}
		if (this.view.canvasNoteSurfacePath && !this.view.activeCanvasNoteEditor
			&& !items.some(item => item.path === this.view.canvasNoteSurfacePath && isBaseHalfMarkdownResource(item.stat.resource))) {
			const missingNotePath = this.view.canvasNoteSurfacePath;
			this.view.canvasNoteSurfacePath = undefined;
			this.view.noteEditing.clearPendingCanvasNoteFocus(missingNotePath);
		}
		// Promote the create intent only after this model has passed every render
		// deferral/staleness gate. From here to the scene update the new Note's
		// selection and editing projection are committed as one synchronous frame;
		// a render that exits early must leave the intent pending for its successor.
		this.view.noteEditing.promotePendingCreatedCanvasNoteActivation(currentSceneKey, items);
		const liveNoteKeys = new Set(items
			.filter(item => isBaseHalfMarkdownResource(item.stat.resource))
			.map(item => `${item.path}\0${this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource)}`));
		this.view.noteEditing.cancelPendingCanvasNoteFormatCommands(pending => pending.sceneKey !== currentSceneKey
			|| !liveNoteKeys.has(`${pending.path}\0${pending.resourceKey}`));
		if (this.view.pendingCanvasSelection
			&& (this.view.pendingCanvasSelection.sceneKey !== currentSceneKey
				|| !this.view.isCanvasPostCreateOwnerCurrent(this.view.pendingCanvasSelection.owner))) {
			this.view.pendingCanvasSelection = undefined;
		}
		const pendingSelectionRequest = this.view.pendingCanvasSelection;
		const pendingSelectionPaths = pendingSelectionRequest?.sceneKey === currentSceneKey
			? pendingSelectionRequest.paths
			: undefined;
		let pendingSelection = pendingSelectionPaths
			&& baseHalfCanvasPendingSelectionIsReady(pendingSelectionPaths, new Set(items.map(item => item.path)))
			? pendingSelectionPaths
			: undefined;
		const activeNote = this.view.activeCanvasNoteEditor;
		const changesNote = pendingSelection && this.view.canvasNoteSurfacePath
			&& !(pendingSelection.length === 1 && pendingSelection[0] === this.view.canvasNoteSurfacePath);
		if (changesNote) {
			if (activeNote) {
				const closed = await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false);
				if (!this.isRenderCurrent(seq)
					|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
					return;
				}
				if (!closed) {
					this.view.pendingCanvasSelection = undefined;
					pendingSelection = undefined;
				}
			} else {
				const notePath = this.view.canvasNoteSurfacePath;
				const noteItem = notePath ? items.find(item => item.path === notePath && isBaseHalfMarkdownResource(item.stat.resource)) : undefined;
				const resourceKey = noteItem ? this.view.uriIdentityService.extUri.getComparisonKey(noteItem.stat.resource) : undefined;
				const waitsForPreMountFormat = !!notePath && !!resourceKey
					&& this.view.pendingCanvasNoteFormatCommands.some(pending => pending.sceneKey === currentSceneKey
						&& pending.path === notePath
						&& pending.resourceKey === resourceKey);
				if (notePath && resourceKey && waitsForPreMountFormat) {
					this.view.noteEditing.deferPendingCanvasSelectionUntilCanvasNoteFormatsSettle(
						currentSceneKey,
						notePath,
						resourceKey
					);
					// Keep the current Note selected and force its inline projection to
					// mount in this render. The queued selection is replayed only after
					// every accepted formatting intent has reached a terminal outcome.
					pendingSelection = undefined;
				} else {
					this.view.canvasNoteSurfacePath = undefined;
				}
			}
		}
		clearNode(this.view.canvasOverlay);
		clearNode(this.view.inlineEditLayer);
		this.view.inlineEditListeners.clear();
		const previousRenderedCards = this.view.renderedCardsByPath;
		this.view.renderedBadges = badgeRead.badges;
		this.view.renderedBadgeProblems = new Map(badgeRead.problems.map(problem => [problem.relativePath, problem]));
		this.renderedRelationships = connections.relationships;
		this.view.renderedUpstreamViews = connections.views;
		this.view.renderedUpstreamRefusals = connections.refusals;
		this.view.renderedIndexState = connections.state;
		this.view.renderedItemsByPath = new Map(items.map(item => [item.path, item]));
		this.view.renderedCardPreviewsByPath = new Map(items.map(item => [
			item.path,
			{ item, preview: previews.get(item.path)! }
		]));
		this.view.renderedCardsByPath = new Map();
		this.view.renderedCardElementsByPath = new Map();
		if (this.view.inlineEdit?.kind === 'rename') {
			const editedItem = this.view.renderedItemsByPath.get(this.view.inlineEdit.path);
			if (!editedItem || !this.view.uriIdentityService.extUri.isEqual(editedItem.stat.resource, this.view.inlineEdit.resource)) {
				this.view.inlineEdit = undefined;
			}
		}
		this.view.creation.releaseEndedInlineRenameEditor();
		this.view.badgeEditor.resetCanvasBadgeDeferredRefresh();
		this.cardListeners.clear();
		const sceneCards = items.map((item, index) => {
			const preview = previews.get(item.path);
			const upstreamRefusal = this.view.connections.sceneUpstreamRefusal(item, connections.refusals);
			const bounds = this.view.cardRenderer.cardBoundsForPreview(item, index, items.length, preview);
			const badge = this.view.badgeEditor.badgeMetadataWithDraft(
				folder.workspaceFolder,
				item.path,
				item.badge,
				baseHalfBadgeResourceIdentity(item.stat)
			);
			const displayedItem = badge === item.badge ? item : { ...item, badge };
			const visualKey = this.cardVisualKey(displayedItem);
			const connectionsKey = baseHalfCanvasCardToggleConnections(displayedItem.relationships);
			const cached = previousRenderedCards.get(item.path);
			const reused = this.canReuseRenderedCard(cached, displayedItem, preview, visualKey, currentSceneKey);
			if (reused) {
				this.refreshReusedCard(cached, displayedItem, connectionsKey);
			}
			const element = reused
				? cached.element
				: this.view.cardRenderer.createCard(displayedItem, bounds, preview, currentSceneKey);
			const controls = this.view.cardRenderer.sceneCardControls(displayedItem, preview);
			const retainedActiveNote = this.view.activeCanvasNoteEditor;
			if (retainedActiveNote?.path === item.path && retainedActiveNote.card === element) {
				retainedActiveNote.chromeStale = baseHalfCanvasRetainedCardChromeIsStale(
					retainedActiveNote.mountedVisualKey,
					visualKey
				);
			}
			this.view.cardRenderer.applyNoteBackground(element, isBaseHalfMarkdownResource(item.stat.resource) ? this.view.renderedNoteBackgrounds.get(item.path) ?? 'default' : undefined);
			this.view.renderedCardElementsByPath.set(item.path, element);
			this.view.renderedCardsByPath.set(item.path, { item, preview, visualKey, connectionsKey, sceneKey: currentSceneKey, element });
			return {
				path: item.path,
				kind: item.kind,
				...(controls ? { controls } : {}),
				...bounds,
				element,
				updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => this.view.cardPresentationUpdaters.get(element)?.(presentation),
				didMountElement: () => this.view.cardRenderer.didMountCardElement(item.path, element),
				...(this.view.openBadgeFaces.has(item.path) || this.view.canvasNoteSurfacePath === item.path ? { forceInteractive: true as const } : {}),
				...(this.view.canvasNoteSurfacePath === item.path ? { noteEditing: true as const } : {}),
				...(baseHalfCanvasCardResizes(item) ? {} : { keepsShape: true as const }),
				...(upstreamRefusal ? { upstreamRefusal } : {})
			};
		});
		this.view.cardListenerStores.retain(new Set(items.map(item => item.path)));
		const sceneEdges = model.edges.map(edge => {
			const from = this.view.renderedItemsByPath.get(edge.from);
			const to = this.view.renderedItemsByPath.get(edge.to);
			if (!from || !to) {
				throw new Error(`Canvas edge endpoints are not part of the rendered scene: ${edge.from} -> ${edge.to}`);
			}
			return {
				...edge,
				id: edgeId(edge.from, edge.to),
				fromKind: from.kind,
				toKind: to.kind
			};
		});
		this.view.renderedSceneCards = Object.freeze(sceneCards);
		this.view.renderedSceneEdges = Object.freeze(sceneEdges);
		this.view.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
		this.renderedGenerationCards = { folder: currentSceneKey, cards: generationCards };
		if (pendingSelection && (!pendingSelectionRequest
			|| this.view.pendingCanvasSelection !== pendingSelectionRequest
			|| !this.view.isCanvasPostCreateOwnerCurrent(pendingSelectionRequest.owner))) {
			pendingSelection = undefined;
		}
		this.view.canvasScene.update({
			key: currentSceneKey,
			structuralEpoch: structuralStamp.structuralEpoch,
			revision: seq,
			cards: sceneCards,
			edges: sceneEdges,
			selectedCardPaths: pendingSelection
		});
		this.view.onDidChangeSceneEmitter.fire({ scene: this.view.canvasViewScene(currentSceneKey), drawn: true, ...(pendingSelection ? { selection: pendingSelection } : {}) });
		this.view.userRenderOwed = false;
		// The cards are drawn: the places BaseHalf chose for them are kept from
		// now on, and saved when the layout can take them.
		this.view.renderedLayoutRows = canvas?.cards ?? [];
		this.view.chosenCanvasPlaces.drawn(folder, model.appeared);
		this.renderedPictureRatios = { folder: currentSceneKey, ratios: pictureRatios };
		if (canvasReadInFull) {
			void this.view.chosenCanvasPlaces.save(folder, goneRows, model.respelled, model.reshaped);
		}
		if (this.view.canvasNoteSurfacePath && !this.view.noteEditing.tryMountCanvasNoteEditor(this.view.canvasNoteSurfacePath)) {
			// An editing intent is allowed to precede the first complete Markdown
			// preview (notably for a freshly created empty Note). Queue that source
			// read from the committed host snapshot itself; React presentation
			// callbacks are intentionally lazy and cannot be the sole wake-up edge.
			this.view.previews.scheduleCardPreviewHydration(this.view.canvasNoteSurfacePath, 2);
		}
		if (pendingSelection && this.view.pendingCanvasSelection === pendingSelectionRequest) {
			this.view.pendingCanvasSelection = undefined;
		}
		this.view.creation.renderInlineCreateEditor(folder);
		if (items.length === 0) {
			this.renderCanvasEmptyState(folder);
		} else {
			if (model.truncated > 0) {
				this.renderTruncated(model.truncated);
			}
		}
		if (canvasWarning) {
			this.renderCanvasWarning(canvasWarning);
		}
		if (badgeWarning) {
			this.renderCanvasWarning(badgeWarning);
		}
		this.view.connections.renderCanvasConnectionsStatus(connections.state);
		for (const warning of this.view.pendingCanvasWarnings.splice(0)) {
			this.renderCanvasWarning(warning);
		}

		this.view.creation.revealCreatedCanvasCards(currentSceneKey);
		if (this.view.pendingCanvasFit
			&& (!this.view.isCanvasPostCreateOwnerCurrent(this.view.pendingCanvasFit.owner)
				|| this.view.pendingCanvasFit.viewportGeneration !== this.view.viewportRestoreGeneration)) {
			this.view.pendingCanvasFit = undefined;
		}
		const pendingFit = this.view.pendingCanvasFit?.sceneKey === currentSceneKey && !this.view.canvasNavigationService.state.cardDetail
			? this.view.pendingCanvasFit
			: undefined;
		if (pendingFit) {
			this.view.pendingCanvasFit = undefined;
			mainWindow.requestAnimationFrame(() => {
				if (!this.view.isCurrentSceneKey(pendingFit.sceneKey)
					|| !this.view.isCanvasPostCreateOwnerCurrent(pendingFit.owner)
					|| pendingFit.viewportGeneration !== this.view.viewportRestoreGeneration
					|| this.view.canvasNavigationService.state.cardDetail) {
					return;
				}
				void this.view.canvasScene.fit(pendingFit.paths, {
					maxZoom: Math.min(BASEHALF_CANVAS_DEFAULT_ZOOM_MAX, this.view.geometry.defaultCanvasZoom(folder)),
					padding: 0.16
				}).then(() => {
					if (this.view.isCurrentSceneKey(pendingFit.sceneKey)
						&& this.view.isCanvasPostCreateOwnerCurrent(pendingFit.owner)
						&& pendingFit.viewportGeneration === this.view.viewportRestoreGeneration
						&& !this.view.canvasNavigationService.state.cardDetail) {
						// Framing cards the user just created is a user change.
						this.view.geometry.scheduleViewportPersist(0, 'user');
					}
				}).catch(error => this.view.logService.error(error));
			});
		} else {
			this.view.geometry.restoreFolderViewport(folder);
		}
	}

	resetCardPreviewHydrationScene(): void {
		const folder = this.view.getCurrentFolder();
		this.view.cardPreviewHydrationQueue.resetScene(folder ? this.view.sceneKey(folder) : 'no-folder');
		if (this.view.cardPreviewHydrationTimer !== undefined) {
			mainWindow.clearTimeout(this.view.cardPreviewHydrationTimer);
			this.view.cardPreviewHydrationTimer = undefined;
		}
	}

	isRenderCurrent(seq: number): boolean {
		return !this.view.disposed && seq === this.view.renderSeq;
	}

	/**
	 * Whether every change is under `.bh/cache/`: BaseHalf's working files,
	 * such as the record of the selection agents can see, which no card shows.
	 * The canvas of a workspace folder holds `.bh/`, so without this each
	 * write of the record would draw that canvas again.
	 */
	isWorkingFilesOnlyChange(event: FileChangesEvent, folder: IBaseHalfCanvasFolderState): boolean {
		const cache = joinPath(folder.workspaceFolder, '.bh', 'cache');
		const resources = [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted];
		return resources.length > 0 && resources.every(resource => isEqualOrParent(resource, cache));
	}

	isCurrentCanvasLayoutOnlyChange(event: FileChangesEvent, folder: IBaseHalfCanvasFolderState): boolean {
		const mirrorRoot = baseHalfMirrorRoot(folder.workspaceFolder);
		const canvasResource = this.view.canvasMirrorService.canvasResource(folder);
		const canvasParent = dirname(canvasResource);
		const canvasName = basename(canvasResource);
		let sawRelevantChange = false;
		for (const resource of [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted]) {
			if (!isEqualOrParent(resource, folder.resource) && !isEqualOrParent(resource, mirrorRoot)) {
				continue;
			}
			sawRelevantChange = true;
			const isCanvasFile = this.view.uriIdentityService.extUri.isEqual(resource, canvasResource);
			const isAtomicCanvasTemporary = this.view.uriIdentityService.extUri.isEqual(dirname(resource), canvasParent)
				&& basename(resource).replace(/^\./, '').startsWith(`${canvasName}.basehalf-tmp`);
			const isCanvasAncestor = isEqualOrParent(canvasResource, resource)
				&& isEqualOrParent(resource, mirrorRoot);
			if (!isCanvasFile && !isAtomicCanvasTemporary && !isCanvasAncestor) {
				return false;
			}
		}
		return sawRelevantChange;
	}

	private reusableCardPreview(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		const cached = this.view.renderedCardPreviewsByPath.get(item.path);
		if (!cached || cached.preview.kind === 'unavailable' || !baseHalfCanvasItemsSharePreviewVersion(cached.item, item)) {
			return undefined;
		}
		// The last complete preview of a file that did not change: a playing video,
		// or another media element, is not replaced with a loading face. A
		// generation card's information is no part of it, so a prompt the panel
		// saves keeps the card as it is (generation cards, "The card").
		return cached.preview;
	}

	cardVisualKey(item: IBaseHalfCanvasItem): string {
		const ownProblem = this.view.renderedBadgeProblems.get(item.path);
		// Whether the card shows the rename editor. What is typed there is the
		// editor's own state and rebuilds nothing.
		const inlineRename = this.view.inlineEdit?.kind === 'rename' && this.view.inlineEdit.path === item.path
			? true
			: undefined;
		const badgeOpen = this.view.openBadgeFaces.has(item.path);
		const view = badgeOpen ? this.view.renderedUpstreamViews.get(item.path) : undefined;
		return JSON.stringify({
			badge: item.badge ? { description: item.badge.description, orphan: item.badge.orphan } : undefined,
			badgeOpen,
			// The card of a PDF or a book whose cover another window hid or showed is drawn again.
			coverHidden: this.view.renderedHiddenCovers.has(item.path) ? true : undefined,
			inlineRename,
			relationships: baseHalfCanvasCardBuiltConnections(item.relationships, badgeOpen),
			indexState: this.view.renderedIndexState,
			// An open face renders the full Upstream and Downstream lists.
			upstream: view ? {
				storeKind: view.storeKind,
				problem: view.problem,
				storeIssue: view.storeIssue,
				misplaced: !!view.misplacedSidecar,
				entries: view.entries.map(entry => [entry.index, entry.text, entry.status, entry.problem, entry.workspacePath, entry.target?.relativePath])
			} : undefined,
			ownProblem: ownProblem ? {
				relativePath: ownProblem.relativePath,
				message: ownProblem.message
			} : undefined
		});
	}

	/**
	 * A card drawn again with the element it had: its badge toggle says the
	 * connections it has now (canvas card interaction continuity, "A change
	 * of connections").
	 */
	refreshReusedCard(cached: IBaseHalfCanvasCardRenderCacheEntry, item: IBaseHalfCanvasItem, connectionsKey: string): void {
		if (cached.connectionsKey !== connectionsKey) {
			this.view.cardRenderer.refreshBadgeToggle(cached.element, item);
		}
	}

	canReuseRenderedCard(
		cached: IBaseHalfCanvasCardRenderCacheEntry | undefined,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		visualKey: string,
		sceneKey: string
	): cached is IBaseHalfCanvasCardRenderCacheEntry {
		const activeNote = this.view.activeCanvasNoteEditor;
		const renaming = this.view.inlineEdit?.kind === 'rename' && this.view.inlineEdit.path === item.path;
		// A card that shows the live rename editor is kept as any other card is.
		// A card that was built for the editor and has not taken it yet is not.
		const renameEditor = this.view.inlineRenameEditor;
		const renameKeepsElement = !renaming
			|| (!!cached && !!renameEditor && renameEditor.edit === this.view.inlineEdit && cached.element.contains(renameEditor.host));
		if (cached
			&& activeNote?.path === item.path
			&& activeNote.card === cached.element
			&& cached.sceneKey === sceneKey
			&& this.view.uriIdentityService.extUri.isEqual(activeNote.state.resource, item.stat.resource)
			&& !this.view.openBadgeFaces.has(item.path)
			&& !renaming) {
			// The selected Note owns a live inline editor. Preserve its exact DOM identity
			// across autosave-driven preview refreshes; selection teardown performs a
			// stable flush before the card may return to its static preview.
			return true;
		}
		const retainedNote = cached ? this.view.canvasNotePreviewMounts.get(cached.element) : undefined;
		const retainedNoteMatches = !!cached
			&& !!retainedNote
			&& cached.sceneKey === sceneKey
			&& cached.visualKey === visualKey
			&& retainedNote.path === item.path
			&& retainedNote.resourceKey === this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource)
			&& !this.view.openBadgeFaces.has(item.path)
			&& renameKeepsElement
			&& (preview?.kind === 'loading'
				|| ((preview?.kind === 'markdown' || preview?.kind === 'richRequired')
					&& preview.kind === retainedNote.preview.kind
					&& preview.text === retainedNote.preview.text));
		if (retainedNoteMatches) {
			// A Note fallback may already contain the exact saved TextModel snapshot
			// while the file watcher briefly reports loading and then hydrates the
			// same bytes. Reuse that DOM; rebuilding it would expose a second flash
			// after the atomic editor-to-preview handoff.
			return true;
		}
		// A preview that did not change is the cached object itself.
		return !!cached
			&& cached.sceneKey === sceneKey
			&& !this.view.openBadgeFaces.has(item.path)
			&& renameKeepsElement
			&& cached.preview === preview
			&& cached.visualKey === visualKey
			&& baseHalfCanvasItemsSharePreviewVersion(cached.item, item);
	}

	/**
	 * A change the user made on this canvas writes its layout, and the places
	 * that wait are saved with it. When that fails it is logged: the user's own
	 * change is reported by its own write.
	 */
	async saveWaitingCanvasPlacesWithUserChange(folder: IBaseHalfCanvasFolderState): Promise<void> {
		try {
			await this.view.chosenCanvasPlaces.saveWithUserChange(folder);
		} catch (error) {
			this.view.logService.warn(error);
		}
	}

	scheduleCanvasLayoutReconciliation(): void {
		if (this.view.canvasNavigationService.state.cardDetail) {
			// Card detail covers the scene. Closing it always performs a fresh
			// render, so there is no hidden layout work to do here.
			return;
		}
		if (this.view.canvasScene.isInteracting()) {
			this.canvasLayoutReconcileQueuedBehindGesture = true;
			return;
		}
		// A layout that changes on disk while an item of this folder, or the
		// folder itself, is being recognized at a new path is drawn with it.
		if (this.holdRenderForMovedItems()) {
			return;
		}
		const generation = ++this.view.canvasLayoutReconcileGeneration;
		void this.reconcileCurrentCanvasLayout(generation).then(reconciled => {
			if (!reconciled && !this.view.disposed) {
				this.renderForDiskChange();
			}
		}).catch(error => {
			if (!this.view.disposed) {
				this.view.logService.warn(error);
				// The folder may be gone because it was just moved: that is not drawn as an error.
				this.renderForDiskChange();
			}
		});
	}

	/**
	 * canvas.yaml owns layout only. Reconcile that projection directly into
	 * React Flow while retaining every authored card HTMLElement and listener.
	 * A full render is reserved for actual item, content, Badge, or node-state
	 * changes; replacing the card DOM after a drag makes its visual state flash.
	 */
	private async reconcileCurrentCanvasLayout(generation: number): Promise<boolean> {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.canvasNavigationService.state.cardDetail) {
			return true;
		}
		const sceneKey = this.view.sceneKey(folder);
		const renderSeq = this.view.renderSeq;
		const structuralStamp = this.view.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		// Taken before the layout is read, as in a full drawing.
		const waitingPlaces = this.view.chosenCanvasPlaces.waitingFor(folder);
		// A layout change changes no draft: the drafts of the last drawing are the folder's.
		const lastCards = this.renderedGenerationCards?.folder === sceneKey ? this.renderedGenerationCards.cards : [];
		const withCards = this.withGenerationCards(folder, await this.view.fileService.resolve(folder.resource, { resolveMetadata: true }), lastCards);
		const stat = withCards.stat;
		const canvas = await this.view.canvasMirrorService.readCanvas(folder);
		if (this.view.disposed
			|| this.view.canvasLayoutReconcileGeneration !== generation
			|| this.view.renderSeq !== renderSeq
			|| !this.view.isCurrentSceneKey(sceneKey)
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
			return true;
		}
		if (this.view.canvasScene.isInteracting()) {
			this.canvasLayoutReconcileQueuedBehindGesture = true;
			return true;
		}

		const model = baseHalfCanvasModelFromStat(stat, {
			rootLevel: folder.relativePath.length === 0,
			folderRelativePath: folder.relativePath,
			canvas,
			badges: this.view.renderedBadges,
			relationships: this.renderedRelationships,
			// A card whose place is not saved yet stays where it was drawn.
			waiting: waitingPlaces,
			generationCards: withCards.generationCards,
			// A layout change changes no picture.
			pictureRatios: this.renderedPictureRatios?.folder === sceneKey ? this.renderedPictureRatios.ratios : undefined,
			pathKey: this.view.creation.canvasPathKey(folder)
		});
		this.view.renderedLayoutRows = canvas?.cards ?? [];
		if (model.items.length !== this.view.renderedItemsByPath.size
			|| model.items.some(item => {
				const rendered = this.view.renderedItemsByPath.get(item.path);
				return !rendered || !baseHalfCanvasItemsSharePreviewVersion(rendered, item);
			})) {
			return false;
		}

		const currentCards = new Map(this.view.renderedSceneCards.map(card => [card.path, card]));
		const nextCards: IBaseHalfCanvasSceneCard[] = [];
		for (let index = 0; index < model.items.length; index++) {
			const item = model.items[index];
			const current = currentCards.get(item.path);
			if (!current || current.kind !== item.kind) {
				return false;
			}
			const preview = this.view.renderedCardPreviewsByPath.get(item.path)?.preview;
			nextCards.push({
				...current,
				...this.view.cardRenderer.cardBoundsForPreview(item, index, model.items.length, preview)
			});
		}
		const nextItems = new Map(model.items.map(item => [item.path, item]));
		const nextEdges: IBaseHalfCanvasSceneEdge[] = [];
		for (const edge of model.edges) {
			const from = nextItems.get(edge.from);
			const to = nextItems.get(edge.to);
			if (!from || !to) {
				return false;
			}
			nextEdges.push({
				...edge,
				id: edgeId(edge.from, edge.to),
				fromKind: from.kind,
				toKind: to.kind
			});
		}

		const previousPreviews = this.view.renderedCardPreviewsByPath;
		const previousRenderedCards = this.view.renderedCardsByPath;
		this.view.renderedItemsByPath = nextItems;
		this.view.renderedCardPreviewsByPath = new Map(model.items.flatMap(item => {
			const cached = previousPreviews.get(item.path);
			return cached ? [[item.path, { item, preview: cached.preview }] as const] : [];
		}));
		this.view.renderedCardsByPath = new Map(model.items.flatMap(item => {
			const cached = previousRenderedCards.get(item.path);
			return cached ? [[item.path, { ...cached, item }] as const] : [];
		}));
		this.view.renderedSceneCards = Object.freeze(nextCards);
		this.view.renderedSceneEdges = Object.freeze(nextEdges);
		this.view.canvasScene.update({
			key: sceneKey,
			structuralEpoch: structuralStamp.structuralEpoch,
			revision: renderSeq,
			cards: nextCards,
			edges: nextEdges
		});
		// A picture's card that took the room a card left is saved with its size.
		if (model.reshaped.length > 0) {
			void this.view.chosenCanvasPlaces.save(folder, [], [], model.reshaped);
		}
		return true;
	}

	private renderTruncated(heldBack: number): void {
		const truncated = append(this.view.canvasOverlay, $('.basehalf-canvas-truncated'));
		truncated.textContent = `+${heldBack} more`;
	}

	renderCanvasWarning(message: string): void {
		const warnings = [...this.view.canvasOverlay.querySelectorAll<HTMLElement>('.basehalf-canvas-warning')];
		const duplicate = warnings.some(warning => warning.textContent === message);
		if (duplicate) {
			return;
		}
		// Below the warning before it, however many lines that one takes.
		const last = warnings.at(-1);
		const warning = append(this.view.canvasOverlay, $('.basehalf-canvas-warning'));
		warning.style.top = `${last ? last.offsetTop + last.offsetHeight + 4 : 58}px`;
		warning.textContent = message;
	}

	private renderEmpty(message: string): void {
		const empty = append(this.view.canvasOverlay, $('.basehalf-canvas-empty'));
		empty.textContent = message;
	}

	private renderCanvasEmptyState(folder: IBaseHalfCanvasFolderState): void {
		const empty = append(this.view.canvasOverlay, $('.basehalf-canvas-empty-state'));
		const title = append(empty, $('span.basehalf-canvas-empty-title'));
		title.textContent = localize('basehalf.canvas.empty.title', "No content cards yet");
		const actions = append(empty, $('.basehalf-canvas-empty-actions'));
		const note = append(actions, $('button.basehalf-canvas-empty-note')) as HTMLButtonElement;
		note.type = 'button';
		const noteIcon = append(note, $('span.codicon.codicon-new-file'));
		noteIcon.setAttribute('aria-hidden', 'true');
		const noteLabel = append(note, $('span.basehalf-canvas-empty-note-label'));
		noteLabel.textContent = localize('basehalf.canvas.empty.createNote', "Create a note");
		this.cardListeners.add(this.view.addDisposableListener(note, 'click', () => void this.view.canvasEditingService.requestCreate(undefined, 'note').catch(error => this.view.reportCanvasMutationError(error))));

		const importButton = append(actions, $('button.basehalf-canvas-empty-import')) as HTMLButtonElement;
		importButton.type = 'button';
		const importIcon = append(importButton, $('span.codicon.codicon-folder-opened'));
		importIcon.setAttribute('aria-hidden', 'true');
		const importLabel = append(importButton, $('span'));
		importLabel.textContent = localize('basehalf.canvas.empty.import', "Import files...");
		this.cardListeners.add(this.view.addDisposableListener(importButton, 'click', () => void (async () => {
			try {
				const current = this.view.getCurrentFolder();
				if (!current || !this.view.uriIdentityService.extUri.isEqual(current.resource, folder.resource)) {
					return;
				}
				const context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
				await this.view.canvasEditingService.requestImport(context);
			} catch (error) {
				this.view.reportCanvasMutationError(error);
			}
		})()));
	}

	flushRenderQueuedBehindGesture(): void {
		for (const resolve of this.view.canvasInteractionEndWaiters) {
			resolve();
		}
		this.view.canvasInteractionEndWaiters.clear();
		if (this.canvasLayoutReconcileQueuedBehindGesture) {
			this.canvasLayoutReconcileQueuedBehindGesture = false;
			this.scheduleCanvasLayoutReconciliation();
		}
		if (this.renderQueuedBehindGesture) {
			this.renderQueuedBehindGesture = false;
			this.view.requestRender();
		}
	}

	waitForCanvasSceneInteractionEnd(): Promise<void> {
		if (!this.view.canvasScene.isInteracting() || this.view.disposed) {
			return Promise.resolve();
		}
		return new Promise(resolve => {
			const finish = () => {
				this.view.canvasInteractionEndWaiters.delete(finish);
				resolve();
			};
			this.view.canvasInteractionEndWaiters.add(finish);
		});
	}

	private deferRenderForSceneInteraction(): boolean {
		if (!this.view.canvasScene.isInteracting()) {
			return false;
		}
		this.renderQueuedBehindGesture = true;
		return true;
	}
}
