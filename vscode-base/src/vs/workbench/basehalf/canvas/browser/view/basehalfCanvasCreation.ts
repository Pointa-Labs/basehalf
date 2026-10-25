/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasNameEditor.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { $, append, isHTMLElement } from '../../../../../base/browser/dom.js';
import { InputBox, MessageType } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { basename, dirname, extname, isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../../nls.js';
import { UndoRedoGroup } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { getPathForFile } from '../../../../../platform/dnd/browser/dnd.js';
import { defaultInputBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { clearExplorerFileClipboardCut, explorerFileClipboardShouldMove } from '../../../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../../../contrib/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasCenteredPlace,
	baseHalfCanvasItemBounds,
	baseHalfCanvasOpenPosition,
	BASEHALF_CANVAS_GRID_COLUMN_GAP,
	baseHalfCanvasChildPath,
	baseHalfCanvasTransferPlaces,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH,
	baseHalfCanvasGenerationCardSize,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasItem
} from '../../common/basehalfCanvasModel.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfPathHoldsDraft } from '../../../video/common/basehalfGenerationDraft.js';
import { BaseHalfGenerationKind, baseHalfGenerationKindOfPath, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts } from '../../../video/common/basehalfGenerationInfo.js';
import { planBaseHalfMarkdownUpstreamEdit } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasInlineEditKeyAction, BaseHalfCanvasCreateKind, BaseHalfCanvasEditingRequest, isBaseHalfCanvasDraftCreateKind } from '../../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';
import { baseHalfItemDisplayName, baseHalfNoteFileName, baseHalfNoteNameExtension } from '../../../cardDetail/common/basehalfCardDetail.js';
import { baseHalfDocumentBranchBaseName, baseHalfDocumentBranchMarkdown, IBaseHalfDocumentSelection } from '../../../documents/common/basehalfDocumentBranch.js';
import { baseHalfActiveEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID } from '../../../navigation/common/basehalfEditorFlush.js';
import { BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP, BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BaseHalfCanvasInlineEdit, IBaseHalfCanvasPostCreateOwner, baseHalfCanvasDraftNameProblem, baseHalfCanvasFreeTransferTarget, baseHalfCanvasGenerationCopyTarget } from './basehalfCanvasViewShared.js';

/**
 * Making things on the canvas: the inline editors that name a new item or
 * rename one, new notes, nodes, and PDF branches, where new cards go, and
 * files imported or dropped onto the canvas.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasCreation {

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	private isCanvasFileDrag(event: DragEvent): boolean {
		return !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
	}

	onCanvasFileDragEnter(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event) || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		this.view.fileDragDepth++;
		this.view.root.classList.add('basehalf-canvas-file-dragging');
	}

	onCanvasFileDragOver(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event) || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	}

	onCanvasFileDragLeave(event: DragEvent): void {
		if (!this.isCanvasFileDrag(event)) {
			return;
		}
		this.view.fileDragDepth = Math.max(0, this.view.fileDragDepth - 1);
		if (this.view.fileDragDepth === 0) {
			this.view.root.classList.remove('basehalf-canvas-file-dragging');
		}
	}

	async onCanvasFileDrop(event: DragEvent): Promise<void> {
		if (!this.isCanvasFileDrag(event) || !event.dataTransfer || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.view.fileDragDepth = 0;
		this.view.root.classList.remove('basehalf-canvas-file-dragging');
		const resources = [...event.dataTransfer.files]
			.map(file => getPathForFile(file))
			.filter((path): path is string => typeof path === 'string' && path.length > 0)
			.map(path => URI.file(path));
		if (resources.length === 0) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const postCreateOwner = this.view.captureCanvasPostCreateOwner();
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			const context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
			const canvasPosition = this.view.canvasScene.screenToCanvasPosition(event.clientX, event.clientY);
			await this.importCanvasResources(folder, context, resources, canvasPosition, 'copy', postCreateOwner);
		} catch (error) {
			this.view.reportCanvasMutationError(error);
		}
	}

	async beginCanvasInlineEdit(request: BaseHalfCanvasEditingRequest): Promise<void> {
		if (request.kind === 'select') {
			this.view.selectionActions.selectCanvasResources(request.folder, request.resources);
			return;
		}
		this.view.markCanvasUserInteraction();
		const requestOwner = this.view.captureCanvasPostCreateOwner();
		const requestFocusOrigin = this.view.root.ownerDocument.activeElement;
		this.view.selectionActions.cancelPendingNodeActivation();
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		const placementContext = request.kind === 'rename' ? undefined : request.context;
		let context = request.context;
		try {
			context ??= await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
			await this.view.canvasActionContextService.assertCurrent(context);
		} catch (error) {
			if (request.kind === 'rename' || (context && !this.view.uriIdentityService.extUri.isEqual(context.resource, folder.resource))) {
				this.view.queueCanvasWarning(error instanceof Error ? error.message : String(error));
				this.view.requestRender();
				return;
			}
			try {
				context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
				await this.view.canvasActionContextService.assertCurrent(context);
			} catch (refreshError) {
				this.view.queueCanvasWarning(refreshError instanceof Error ? refreshError.message : String(refreshError));
				this.view.requestRender();
				return;
			}
		}
		if (!this.view.uriIdentityService.extUri.isEqual(context.resource, folder.resource) && request.kind !== 'rename') {
			return;
		}

		if (request.kind === 'rename') {
			if (this.view.canvasNavigationService.state.cardDetail) {
				return;
			}
			const item = [...this.view.renderedItemsByPath.values()]
				.find(candidate => candidate.path === context.relativePath
					&& this.view.uriIdentityService.extUri.isEqual(candidate.stat.resource, context.resource));
			if (!item) {
				return;
			}
			if (this.view.activeCanvasNoteEditor?.path === item.path && !await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
				return;
			}
			const fileName = basename(item.stat.resource);
			const shownName = baseHalfItemDisplayName(fileName, item.kind === 'folder');
			this.view.inlineEdit = {
				kind: 'rename',
				context,
				resource: item.stat.resource,
				parent: dirname(item.stat.resource),
				path: item.path,
				extension: item.kind === 'folder' ? '' : baseHalfNoteNameExtension(fileName),
				...(item.generation?.draft ? { draft: item.generation.kind } : {}),
				initialValue: shownName,
				value: shownName,
				selectionPending: true
			};
			// Changing a name is not selecting a card: the toolbar of a selected
			// card would stand over the name that is being typed.
			this.view.canvasScene.select({ cardPaths: [] });
			this.view.requestRender();
			return;
		}

		const initialPlacement = this.canvasCreatePlacement(placementContext ?? context);
		// A point the user named is taken as it is: the card is not moved for
		// other cards or for the edge of the window, and neither is the view. A
		// place BaseHalf computed centers the card on the middle of the visible
		// part, or goes to the nearest open place, and the view goes to a card
		// that is out of sight there (canvas card placement, "A card the user
		// just created is shown").
		const computed = request.kind === 'create' && !initialPlacement.pointed;
		const placement = computed
			? this.computedCanvasCreatePlacement(initialPlacement, request.createKind)
			: initialPlacement;
		if (request.kind === 'paste') {
			const resources = await this.view.clipboardService.readResources();
			if (resources.length === 0) {
				this.view.queueCanvasWarning(localize('basehalf.canvas.paste.empty', "The clipboard does not contain files."));
				this.view.requestRender();
				return;
			}
			await this.importCanvasResources(folder, context, resources, placement.canvasPosition, explorerFileClipboardShouldMove() ? 'move' : 'copy', requestOwner);
			return;
		}
		if (request.kind === 'import') {
			const resources = await this.view.fileDialogService.showOpenDialog({
				title: localize('basehalf.canvas.import.title', "Import Files"),
				openLabel: localize('basehalf.canvas.import.openLabel', "Import"),
				defaultUri: folder.resource,
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: true
			});
			if (resources?.length) {
				this.view.markCanvasUserInteraction();
				const importOwner = this.view.captureCanvasPostCreateOwner();
				await this.importCanvasResources(folder, context, resources, placement.canvasPosition, 'copy', importOwner);
			}
			return;
		}
		if (request.createKind === 'note') {
			if (!this.view.isCanvasPostCreateOwnerCurrent(requestOwner)) {
				return;
			}
			await this.createUntitledNote(
				folder,
				context,
				placement.canvasPosition,
				requestOwner,
				requestFocusOrigin,
				requestOwner.navigationState.cardDetail,
				undefined,
				computed
			);
			return;
		}
		if (isBaseHalfCanvasDraftCreateKind(request.createKind)) {
			if (!this.view.isCanvasPostCreateOwnerCurrent(requestOwner)) {
				return;
			}
			await this.createDraftCard(folder, context, placement.canvasPosition, request.createKind, requestOwner, computed);
			return;
		}
		// A folder's card is shown where it is made: not behind Card Detail.
		if (this.view.canvasNavigationService.state.cardDetail || !this.view.isCanvasPostCreateOwnerCurrent(requestOwner)) {
			return;
		}
		await this.createUntitledFolder(folder, context, placement.canvasPosition, requestOwner, computed);
	}

	/**
	 * Brings the cards the user just created into view when one of them is not
	 * fully inside the visible part of the canvas. It waits until all of them
	 * are drawn, and does nothing for cards that are in sight already.
	 */
	revealCreatedCanvasCards(sceneKey: string): void {
		const reveal = this.view.pendingCanvasReveal;
		if (!reveal) {
			return;
		}
		if (reveal.sceneKey !== sceneKey || !this.view.isCanvasPostCreateOwnerCurrent(reveal.owner)) {
			this.view.pendingCanvasReveal = undefined;
			return;
		}
		const items = [...this.view.renderedItemsByPath.values()];
		const bounds = reveal.paths.map(path => {
			const index = items.findIndex(item => item.path === path);
			return index < 0 ? undefined : baseHalfCanvasItemBounds(items[index], index, items.length);
		});
		if (bounds.some(card => card === undefined)) {
			return;
		}
		this.view.pendingCanvasReveal = undefined;
		const visible = this.view.geometry.visibleCanvasBounds();
		const inSight = (card: IBaseHalfCanvasBounds) => card.x >= visible.x && card.y >= visible.y
			&& card.x + card.width <= visible.x + visible.width && card.y + card.height <= visible.y + visible.height;
		if (!this.view.pendingCanvasFit && bounds.some(card => !inSight(card!))) {
			this.view.pendingCanvasFit = { sceneKey, paths: reveal.paths, owner: reveal.owner, viewportGeneration: this.view.viewportRestoreGeneration };
		}
	}

	/**
	 * Where a card goes that is created now: the point the user named with the
	 * pointer when the create menu was opened there, and otherwise the middle of
	 * the visible canvas, on which BaseHalf centers the card (canvas card
	 * placement, "Pointing").
	 */
	private canvasCreatePlacement(context: IBaseHalfCanvasActionContext | undefined): {
		readonly canvasPosition: { readonly x: number; readonly y: number };
		readonly pointed: boolean;
	} {
		const menu = this.view.lastCanvasContextMenu;
		const surfaceRect = this.view.surface.getBoundingClientRect();
		const menuPosition = menu && context && menu.context === context && menu.request.kind === 'pane'
			? menu.createPosition ?? (!isHTMLElement(menu.request.anchor) ? menu.request.anchor : undefined)
			: undefined;
		const screenPosition = menuPosition ?? { x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 };
		return {
			canvasPosition: this.view.canvasScene.screenToCanvasPosition(screenPosition.x, screenPosition.y),
			pointed: menuPosition !== undefined && !menu?.createPositionComputed
		};
	}

	/**
	 * What two spellings of one path share on this folder's volume, so that a
	 * file renamed in letter case only keeps its row (canvas card placement).
	 */
	canvasPathKey(folder: IBaseHalfCanvasFolderState): ((path: string) => string) | undefined {
		// Asked once for the folder, not for every row: most volumes that ignore
		// letter case also ignore the Unicode form of a name.
		return this.view.uriIdentityService.extUri.ignorePathCasing(folder.workspaceFolder)
			? path => path.normalize('NFC').toLowerCase()
			: undefined;
	}

	/** The size of a card of a kind the user creates, a draft with the ratio its values will choose. */
	private createSize(kind: BaseHalfCanvasCreateKind): { readonly width: number; readonly height: number } {
		return canvasCreateSize(kind, isBaseHalfCanvasDraftCreateKind(kind) ? this.view.generationCardActions.newDraftRatio(kind) : undefined);
	}

	/**
	 * What a new card must stay clear of on the shown canvas: the cards that are
	 * drawn, and the rows of the layout whose items are gone, which keep their
	 * places (canvas card placement, "Taken").
	 */
	private takenCanvasPlaces(except?: ReadonlySet<string>): IBaseHalfCanvasBounds[] {
		const items = [...this.view.renderedItemsByPath.values()];
		return [
			...items.flatMap((item, index) => except?.has(item.path) ? [] : [baseHalfCanvasItemBounds(item, index, items.length)]),
			...this.view.renderedLayoutRows.filter(row => !this.view.renderedItemsByPath.has(row.path) && !except?.has(row.path))
		];
	}

	/**
	 * The place BaseHalf computes for a card the user creates without a point
	 * (canvas card placement, "Pointing" and "The nearest open place"): the
	 * card centered on `placement`, the middle of the visible part of the
	 * canvas, when it is open there and inside the visible part, and otherwise
	 * the nearest open place inside it, or the end of the canvas. The position
	 * is the card's top left corner.
	 */
	private computedCanvasCreatePlacement(
		placement: { readonly canvasPosition: { readonly x: number; readonly y: number } },
		kind: BaseHalfCanvasCreateKind
	): { readonly canvasPosition: { readonly x: number; readonly y: number } } {
		const size = this.createSize(kind);
		return this.avoidCanvasCreateOverlap({ canvasPosition: baseHalfCanvasCenteredPlace(placement.canvasPosition, size) }, kind, size);
	}

	/**
	 * The nearest open place inside the visible part of the canvas for a card
	 * whose top left corner BaseHalf would put at `placement`, or the end of
	 * the canvas when none is open (canvas card placement, "The nearest open
	 * place").
	 */
	private avoidCanvasCreateOverlap(
		placement: { readonly canvasPosition: { readonly x: number; readonly y: number } },
		kind: BaseHalfCanvasCreateKind,
		sizeOverride?: { readonly width: number; readonly height: number }
	): { readonly canvasPosition: { readonly x: number; readonly y: number } } {
		const occupied = this.takenCanvasPlaces();
		const size = sizeOverride ?? this.createSize(kind);
		const surface = this.view.surface.getBoundingClientRect();
		const captionScreenFootprint = (BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT) * this.view.canvasZoom;
		const viewportStart = this.view.canvasScene.screenToCanvasPosition(surface.left + 24, surface.top + 24 + captionScreenFootprint);
		const viewportEnd = this.view.canvasScene.screenToCanvasPosition(surface.right - 24, surface.bottom - 24);
		const viewport = {
			x: viewportStart.x,
			y: viewportStart.y,
			width: Math.max(0, viewportEnd.x - viewportStart.x),
			height: Math.max(0, viewportEnd.y - viewportStart.y)
		};
		return { canvasPosition: baseHalfCanvasOpenPosition(placement.canvasPosition, size, occupied, viewport) };
	}

	async createUntitledNote(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		createOwner: IBaseHalfCanvasPostCreateOwner,
		createFocusOrigin: Element | null,
		sourceDetail: IBaseHalfCardDetailState | undefined,
		connection?: {
			readonly from: string;
			readonly fromAnchor: IBaseHalfCanvasEdge['from_anchor'];
			readonly toAnchor: IBaseHalfCanvasEdge['to_anchor'];
		},
		reveal = false
	): Promise<void> {
		if (!this.view.isCanvasPostCreateOwnerCurrent(createOwner)) {
			return;
		}
		const createFocusReturnPath = sourceDetail?.relativePath ?? (isHTMLElement(createFocusOrigin)
			? createFocusOrigin.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
			: undefined);
		const projection = this.view.activeDetailProjection ?? sourceDetail?.projection;
		if (projection && !await this.view.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, baseHalfActiveEditorFlushOptions(projection))) {
			throw new Error(localize('basehalf.canvas.newNote.flushBlocked', "Save or resolve this file's changes before creating a new note."));
		}
		if (!sourceDetail && !await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
			throw new Error(localize('basehalf.canvas.newNote.inlineCloseBlocked', "Save or resolve this file's changes before creating a new note."));
		}
		if (!this.view.uriIdentityService.extUri.isEqual(this.view.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		await this.view.canvasActionContextService.assertCurrent(context);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = index === 0 ? 'untitled.md' : `untitled-${index}.md`;
			if (!await this.view.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.canvas.newNote.exhausted', "Too many untitled notes. Rename one before creating another."));
		}
		const path = baseHalfCanvasChildPath(folder.relativePath, name);
		// From a connection, the note's first bytes list the source (D37): the
		// create is the connection.
		let connected: { readonly contents: VSBuffer; readonly edge: IBaseHalfCanvasEdge } | undefined;
		if (connection) {
			const plan = planBaseHalfMarkdownUpstreamEdit('', { kind: 'add', entry: connection.from }, { nodePath: path });
			if (plan.kind !== 'edit') {
				throw new Error(`The new note could not list '${connection.from}' as upstream.`);
			}
			connected = {
				contents: VSBuffer.fromString(plan.text),
				edge: { from: connection.from, from_anchor: connection.fromAnchor, to: path, to_anchor: connection.toAnchor }
			};
		}
		const target = await this.createCanvasEntry(folder, context, name, 'file', canvasPosition, {
			select: false,
			postCreateOwner: createOwner,
			contents: connected?.contents,
			edge: connected?.edge
		});
		if (connected) {
			// Show the new connection now instead of after the file watcher event.
			this.view.referenceIndexService.acceptSavedContent(
				{ resource: target, workspaceFolder: folder.workspaceFolder, relativePath: path },
				'markdown',
				connected.contents.toString()
			);
		}
		if (!this.view.isCanvasPostCreateOwnerCurrent(createOwner)) {
			return;
		}
		let focusOrigin = createFocusOrigin;
		if (sourceDetail) {
			// Card Detail that has opened has the keyboard (opening and closing
			// Card Detail, "The keyboard"), and what has it goes with Card Detail:
			// the keyboard that the request left there goes back to the canvas
			// first, as for a branch grown from a PDF, and the note takes it there.
			const ownerDocument = this.view.root.ownerDocument;
			const focusInDetail = focusOrigin !== null && ownerDocument.activeElement === focusOrigin && this.view.detail.contains(focusOrigin);
			if (!await this.view.canvasNavigationService.closeCardDetail({ expectedCardDetail: sourceDetail })) {
				if (!this.view.isCanvasPostCreateOwnerCurrent(createOwner)) {
					return;
				}
				throw new Error(localize('basehalf.canvas.newNote.closeBlocked', "The note was created, but this file must finish saving before returning to the canvas."));
			}
			if (this.view.canvasInteractionEpoch !== createOwner.interactionEpoch
				|| this.view.canvasNavigationEpoch !== createOwner.navigationEpoch + 1
				|| this.view.canvasNavigationService.state.cardDetail) {
				return;
			}
			if (focusInDetail) {
				this.view.root.focus({ preventScroll: true });
				focusOrigin = this.view.root;
			}
		}
		const currentFolder = this.view.getCurrentFolder();
		if (!currentFolder || this.view.sceneKey(currentFolder) !== this.view.sceneKey(folder)) {
			return;
		}
		const activationOwner = this.view.captureCanvasPostCreateOwner();
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], activationOwner);
		this.view.noteEditing.queueCreatedCanvasNoteActivation(folder, path, target, activationOwner, {
			focus: true,
			origin: focusOrigin,
			returnPath: createFocusReturnPath
		});
		if (reveal) {
			this.revealCreatedCards(folder, [path], activationOwner);
		}
		this.view.requestRender();
	}

	/**
	 * New Folder (canvas Create menu): the folder `untitled folder`, or the
	 * first free `untitled folder <n>`, made at once in the folder of the
	 * canvas, placed as a card the user creates is placed, and selected. Its
	 * name is changed on its card.
	 */
	private async createUntitledFolder(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		postCreateOwner: IBaseHalfCanvasPostCreateOwner,
		reveal: boolean
	): Promise<void> {
		await this.view.canvasActionContextService.assertCurrent(context);
		if (!this.view.uriIdentityService.extUri.isEqual(this.view.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		let name: string | undefined;
		for (let index = 1; index <= 1000; index++) {
			const candidate = index === 1 ? 'untitled folder' : `untitled folder ${index}`;
			if (!await this.view.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.canvas.newFolder.exhausted', "Too many untitled folders. Rename one before creating another."));
		}
		await this.createCanvasEntry(folder, context, name, 'folder', canvasPosition, { postCreateOwner, reveal });
	}

	/**
	 * New Image, New Video, and New Audio (generation cards, "Creating a
	 * generation card"): a draft of the folder of the canvas, placed as a card
	 * the user creates is placed, selected, and with its prompt focused when
	 * its panel shows. The draft is one step of the canvas undo stack.
	 */
	private async createDraftCard(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		kind: BaseHalfGenerationKind,
		postCreateOwner: IBaseHalfCanvasPostCreateOwner,
		reveal: boolean
	): Promise<void> {
		await this.view.canvasActionContextService.assertCurrent(context);
		if (!this.view.uriIdentityService.extUri.isEqual(this.view.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		// The shape its place was chosen with: the ratio of the values the draft starts with.
		const size = this.createSize(kind);
		const draft = await this.view.generationCardActions.createDraft(folder.resource, kind);
		const path = baseHalfCanvasChildPath(folder.relativePath, basename(draft));
		await this.placeCreatedCard(folder, path, canvasPosition, size);
		this.selectCreatedDraft(folder, path, postCreateOwner, reveal);
	}

	/**
	 * Selects a draft the user just created once its card is drawn, and gives
	 * its prompt the keyboard when its panel first shows. With `reveal`, for a
	 * place BaseHalf computed, the view goes to a card that is out of sight,
	 * and the panel shows once it is in sight.
	 */
	selectCreatedDraft(folder: IBaseHalfCanvasFolderState, path: string, owner: IBaseHalfCanvasPostCreateOwner, reveal = false): void {
		this.view.createdNodeFocusPath = path;
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], owner);
		if (reveal) {
			this.revealCreatedCards(folder, [path], owner);
		}
		this.view.requestRender();
	}

	/**
	 * The user just created these cards at a place BaseHalf computed: once
	 * they are drawn, the view goes to them when one is not fully in sight
	 * (canvas card placement, "A card the user just created is shown").
	 */
	private revealCreatedCards(folder: IBaseHalfCanvasFolderState, paths: readonly string[], owner: IBaseHalfCanvasPostCreateOwner): void {
		this.view.pendingCanvasReveal = { sceneKey: this.view.sceneKey(folder), paths, owner };
	}

	/** Grow branch: a note of a passage selected in a PDF or a book, next to its card and connected from it. */
	async createDocumentBranch(resource: URI, selection: IBaseHalfDocumentSelection): Promise<void> {
		this.view.markCanvasUserInteraction();
		const createOwner = this.view.captureCanvasPostCreateOwner();
		const createFocusOrigin = this.view.root.ownerDocument.activeElement;
		const cardDetail = createOwner.navigationState.cardDetail;
		const folder = this.view.getCurrentFolder();
		if (!cardDetail || !folder
			|| !this.view.uriIdentityService.extUri.isEqual(cardDetail.resource, resource)
			|| !this.view.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource)) {
			throw new Error(localize('basehalf.document.branch.stale', "The document or its canvas changed before the branch could be created."));
		}

		const renderedItems = [...this.view.renderedItemsByPath.values()];
		const sourceItem = this.view.renderedItemsByPath.get(cardDetail.relativePath);
		const sourceIndex = sourceItem ? renderedItems.indexOf(sourceItem) : -1;
		// Every card has its place, so the document's card stays where it is when a
		// sibling is added (canvas card placement).
		const sourceBounds = sourceItem && sourceIndex >= 0
			? baseHalfCanvasItemBounds(sourceItem, sourceIndex, renderedItems.length)
			: undefined;

		const context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
		const sourceName = basename(resource);
		const baseName = baseHalfDocumentBranchBaseName(sourceName);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = `${baseName}${index === 0 ? '' : `-${index + 1}`}.md`;
			if (!await this.view.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.document.branch.exhausted', "Too many notes already use this document's branch name."));
		}

		const defaultPlacement = this.canvasCreatePlacement(undefined);
		// Beside the document's card, or, without it, centered on the middle of the visible part.
		const placement = sourceBounds
			? this.avoidCanvasCreateOverlap({ canvasPosition: { x: sourceBounds.x + sourceBounds.width + 72, y: sourceBounds.y } }, 'note')
			: this.computedCanvasCreatePlacement(defaultPlacement, 'note');
		// The note's first bytes list the document as upstream (D37): the create is
		// the connection, so there is no "created but not connected" state.
		const targetPath = baseHalfCanvasChildPath(folder.relativePath, name);
		const contents = VSBuffer.fromString(baseHalfDocumentBranchMarkdown(sourceName, selection, {
			sourcePath: cardDetail.relativePath,
			notePath: targetPath
		}));
		const target = await this.createCanvasEntry(folder, context, name, 'file', placement.canvasPosition, {
			contents,
			select: false
		});

		// Frame the document's downstream set from the index, including the new
		// note once it is indexed; fall back to the document and the new note.
		let fittedPaths: readonly string[] = [cardDetail.relativePath, targetPath];
		try {
			const downstream = this.view.referenceIndexService.getDownstream({
				resource,
				workspaceFolder: folder.workspaceFolder,
				relativePath: cardDetail.relativePath
			});
			fittedPaths = [...new Set([cardDetail.relativePath, ...downstream.map(entry => entry.node.relativePath), targetPath])];
		} catch (error) {
			// Framing is a view concern and must not turn a successful create
			// into an apparent action failure.
			this.view.logService.warn('[BaseHalf] failed to read the document downstream set for canvas framing', error);
		}
		await this.view.noteEditing.activateCreatedCanvasNoteAfterDetail(
			cardDetail,
			folder,
			targetPath,
			target,
			createFocusOrigin,
			createOwner,
			fittedPaths
		);
	}

	renderInlineRenameEditor(card: HTMLElement, item: IBaseHalfCanvasItem): void {
		const edit = this.view.inlineEdit;
		if (!edit || edit.path !== item.path
			|| !this.view.uriIdentityService.extUri.isEqual(edit.resource, item.stat.resource)) {
			return;
		}
		// The name is hidden. The editor comes when the scene mounts this
		// element: until then it stays in the element that is on screen.
		card.classList.add('inline-editing');
		if (this.view.inlineRenameEditor?.edit !== edit) {
			this.view.inlineRenameEditor?.store.dispose();
			const host = $('.basehalf-canvas-inline-name-editor');
			const store = new DisposableStore();
			// What is done inside the editor stays in the editor. The scene takes a
			// click on anything of a card for a click on the card and selects it,
			// and it answers a secondary click with the card's menu, which takes
			// the keyboard from the name.
			store.add(this.view.addDisposableListener(host, 'click', event => event.stopPropagation()));
			store.add(this.view.addDisposableListener(host, 'contextmenu', event => {
				event.preventDefault();
				event.stopPropagation();
			}));
			this.view.inlineRenameEditor = { edit, host, store, focus: this.renderInlineNameInput(host, edit, item.kind === 'folder', store) };
		}
	}

	/**
	 * Puts the rename editor into the card element the scene has just mounted
	 * and gives it the keyboard.
	 */
	mountInlineRenameEditor(path: string, card: HTMLElement): void {
		const editor = this.view.inlineRenameEditor;
		if (!editor || editor.edit !== this.view.inlineEdit || editor.edit.path !== path
			|| !card.classList.contains('inline-editing')) {
			return;
		}
		if (!card.contains(editor.host)) {
			card.querySelector('.basehalf-canvas-card-caption-identity')?.append(editor.host);
		}
		editor.focus();
	}

	/** Releases the rename editor of an edit that was accepted, cancelled, or replaced. */
	releaseEndedInlineRenameEditor(): void {
		if (this.view.inlineRenameEditor && this.view.inlineRenameEditor.edit !== this.view.inlineEdit) {
			// The element stays where it is: the card that shows it is replaced
			// by the render that follows.
			this.view.inlineRenameEditor.store.dispose();
			this.view.inlineRenameEditor = undefined;
		}
	}

	/**
	 * Builds the name input of a rename into `host`.
	 * @returns a function that gives the input the keyboard once it is in the
	 * document. An input that lost the keyboard because its card was replaced
	 * gets its caret back.
	 */
	private renderInlineNameInput(host: HTMLElement, edit: BaseHalfCanvasInlineEdit, folder: boolean, store: DisposableStore): () => void {
		host.classList.add('nodrag', 'nopan', 'nowheel');
		const inputHost = append(host, $('.basehalf-canvas-inline-name-input'));
		// A note is renamed by its name: the file keeps the extension it has.
		const noteExtension = edit.extension;
		const fileNameOf = (typed: string) => noteExtension ? baseHalfNoteFileName(typed, noteExtension) : typed;
		// An empty name is refused as it is, before an extension makes it a name.
		const validateTyped = (typed: string) => this.validateCanvasEntryName(
			edit.parent,
			typed.trim().length === 0 ? typed : fileNameOf(typed),
			edit.resource,
			edit.draft
		);
		const inputBox = new InputBox(inputHost, this.view.contextViewService, {
			ariaLabel: folder
				? localize('basehalf.canvas.folderNameInput', "Folder name. Press Enter to confirm or Escape to cancel.")
				: noteExtension
					? localize('basehalf.canvas.noteNameInput', "Note name. Press Enter to confirm or Escape to cancel.")
					: localize('basehalf.canvas.fileNameInput', "File name. Press Enter to confirm or Escape to cancel."),
			// The editor of a card's name is the name made editable: it has the
			// colors of the caption around it and no frame of its own.
			inputBoxStyles: { ...defaultInputBoxStyles, inputBackground: 'transparent', inputForeground: 'inherit', inputBorder: 'transparent' },
			placeholder: folder
				? localize('basehalf.canvas.folderNamePlaceholder', "Folder name")
				: noteExtension
					? localize('basehalf.canvas.noteNamePlaceholder', "Note name")
					: localize('basehalf.canvas.fileNamePlaceholder', "filename.ext")
		});
		store.add(inputBox);
		inputBox.value = edit.value;
		const extension = folder || noteExtension ? '' : extname(URI.file(edit.initialValue));
		const selectionEnd = extension.length > 0 && extension.length < edit.initialValue.length
			? edit.initialValue.length - extension.length
			: edit.initialValue.length;
		let validationSequence = 0;
		let finishing = false;

		const refreshValidation = async () => {
			const sequence = ++validationSequence;
			const candidate = inputBox.value;
			let result: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				result = await validateTyped(candidate);
			} catch (error) {
				result = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (sequence !== validationSequence || this.view.inlineEdit !== edit) {
				return;
			}
			// While the name of a card is typed, a name that cannot be used is
			// only marked in the text. The reason is said when Enter is refused:
			// a box that comes and goes with every letter is not editing in place.
			inputBox.hideMessage();
			host.classList.toggle('unusable', result?.type === MessageType.ERROR);
		};

		const finish = async (keepOpenOnError: boolean) => {
			if (finishing || this.view.inlineEdit !== edit) {
				return;
			}
			finishing = true;
			const enterOwner = keepOpenOnError ? this.view.captureCanvasPostCreateOwner() : undefined;
			const name = inputBox.value;
			edit.value = name;
			inputBox.disable();
			let validation: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				validation = await validateTyped(name);
			} catch (error) {
				validation = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (this.view.inlineEdit !== edit) {
				return;
			}
			if (validation?.type === MessageType.ERROR) {
				finishing = false;
				if (keepOpenOnError) {
					inputBox.enable();
					inputBox.showMessage({ content: validation.content, type: validation.type }, true);
					inputBox.focus();
				} else {
					this.cancelCanvasInlineEdit(edit);
				}
				return;
			}
			if (name === edit.initialValue || fileNameOf(name) === basename(edit.resource)) {
				this.cancelCanvasInlineEdit(edit);
				return;
			}
			this.view.inlineEdit = undefined;
			try {
				await this.commitCanvasInlineEdit(edit, fileNameOf(name));
				this.view.lastCanvasContextMenu = undefined;
				this.view.requestRender();
				// Enter gives the keyboard back to the canvas, as Escape does, so
				// the renamed card answers the keys of a selected card.
				if (enterOwner && this.view.isCanvasPostCreateOwnerCurrent(enterOwner)) {
					this.view.cards.focus({ preventScroll: true });
				}
			} catch (error) {
				this.view.inlineEdit = edit;
				finishing = false;
				inputBox.enable();
				const failure = error instanceof Error ? error.message : String(error);
				// While the name was being applied, the card may have been drawn
				// without its editor, and a render may have released the editor.
				// The next render shows the editor again, and the failure with it.
				if (inputBox.element.isConnected && this.view.inlineRenameEditor?.edit === edit) {
					inputBox.showMessage({ content: failure, type: MessageType.ERROR }, true);
					inputBox.focus();
				} else {
					edit.failure = failure;
					this.view.requestRender();
				}
			}
		};

		store.add(inputBox.onDidChange(value => {
			edit.value = value;
			void refreshValidation();
		}));
		store.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (event: IKeyboardEvent) => {
			event.stopPropagation();
			const browserEvent = event.browserEvent;
			const enter = event.equals(KeyCode.Enter) || browserEvent.key === 'Enter' || browserEvent.code === 'Enter';
			const escape = event.equals(KeyCode.Escape) || browserEvent.key === 'Escape' || browserEvent.key === 'Esc' || browserEvent.code === 'Escape';
			const action = baseHalfCanvasInlineEditKeyAction({
				key: enter ? 'Enter' : escape ? 'Escape' : '',
				isComposing: browserEvent.isComposing,
				keyCode: browserEvent.keyCode
			});
			if (action === undefined) {
				return;
			}
			if (action === 'accept') {
				event.preventDefault();
				void finish(true);
			} else {
				event.preventDefault();
				this.cancelCanvasInlineEdit(edit);
			}
		}));
		store.add(this.view.addDisposableListener(inputBox.inputElement, 'blur', () => {
			mainWindow.setTimeout(() => {
				if (inputBox.element.isConnected && !finishing && this.view.inlineEdit === edit
					&& inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
					void finish(false);
				}
			}, 0);
		}));
		let validated = false;
		return () => {
			if (this.view.inlineEdit !== edit || !inputBox.element.isConnected) {
				return;
			}
			const input = inputBox.inputElement;
			if (input.ownerDocument.activeElement !== input) {
				const { selectionStart, selectionEnd: caretEnd, selectionDirection } = input;
				inputBox.focus();
				if (!edit.selectionPending && selectionStart !== null && caretEnd !== null) {
					input.setSelectionRange(selectionStart, caretEnd, selectionDirection ?? undefined);
				}
			}
			if (edit.selectionPending) {
				edit.selectionPending = false;
				inputBox.select({ start: 0, end: selectionEnd });
				// A name longer than its room is shown from its beginning, as the
				// name at rest is.
				input.scrollLeft = 0;
			}
			if (edit.failure !== undefined) {
				inputBox.showMessage({ content: edit.failure, type: MessageType.ERROR }, true);
				edit.failure = undefined;
				validated = true;
			} else if (!validated) {
				// Once for every input: this runs whenever the scene mounts the card.
				validated = true;
				void refreshValidation();
			}
		};
	}

	private cancelCanvasInlineEdit(edit: BaseHalfCanvasInlineEdit): void {
		if (this.view.inlineEdit !== edit) {
			return;
		}
		this.view.inlineEdit = undefined;
		this.view.lastCanvasContextMenu = undefined;
		this.view.requestRender();
		mainWindow.setTimeout(() => this.view.cards.focus({ preventScroll: true }), 0);
	}

	/**
	 * Why a name cannot be given to a new item or to the item `current`, or a
	 * warning about it. The name of a draft of the folder is taken, as the name
	 * of a file or a folder is; a draft of `draftKind` keeps a name of its kind
	 * (canvas card name, "The editor in place").
	 */
	async validateCanvasEntryName(parent: URI, name: string, current?: URI, draftKind?: BaseHalfGenerationKind): Promise<{ readonly content: string; readonly type: MessageType } | undefined> {
		if (name.length === 0 || /^\s+$/.test(name)) {
			return { content: localize('basehalf.canvas.name.empty', "A file or folder name is required."), type: MessageType.ERROR };
		}
		if (name === '.' || name === '..' || /[\\/]/.test(name)) {
			return { content: localize('basehalf.canvas.name.singleSegment', "Enter a name without path separators."), type: MessageType.ERROR };
		}
		if (!(await this.view.pathService.hasValidBasename(parent, name))) {
			return { content: localize('basehalf.canvas.name.invalid', "This name is not valid on the current file system."), type: MessageType.ERROR };
		}
		const draftProblem = draftKind ? baseHalfCanvasDraftNameProblem(name, draftKind) : undefined;
		if (draftProblem) {
			return { content: draftProblem, type: MessageType.ERROR };
		}
		const target = joinPath(parent, name);
		const other = !current || !this.view.uriIdentityService.extUri.isEqual(target, current);
		if (other && await this.view.fileService.exists(target)) {
			return { content: localize('basehalf.canvas.name.exists', "A file or folder with this name already exists."), type: MessageType.ERROR };
		}
		if (other && await this.isDraftPath(target)) {
			return { content: localize('basehalf.canvas.name.draftExists', "A draft on this canvas already has this name."), type: MessageType.ERROR };
		}
		if (/^\s|\s$/.test(name)) {
			return { content: localize('basehalf.canvas.name.whitespace', "Leading or trailing whitespace will be preserved."), type: MessageType.WARNING };
		}
		return undefined;
	}

	private async commitCanvasInlineEdit(edit: BaseHalfCanvasInlineEdit, name: string): Promise<void> {
		const target = joinPath(edit.parent, name);
		// A name does not depend on what the file holds: an agent may write a
		// note while its name is edited. The stamp refuses an item that was
		// moved or removed, and one that another operation is changing.
		const gone = localize('basehalf.canvas.rename.gone', "This item was moved or removed while its name was edited.");
		if (!this.view.workspaceMutationCoordinator.isResourceStampCurrent(edit.context.workspaceFolder, edit.context.stamp)) {
			throw new Error(gone);
		}
		if (edit.draft) {
			// A draft has no file: its card information and its row move to the new name, as one step of undo.
			await this.view.generationCardActions.moveDraft(edit.resource, target);
			return;
		}
		let isDirectory: boolean | undefined;
		try {
			isDirectory = (await this.view.fileService.stat(edit.resource)).isDirectory;
		} catch {
			// Not there: refused below.
		}
		if (isDirectory !== edit.context.snapshot.isDirectory
			|| !this.view.workspaceMutationCoordinator.isResourceStampCurrent(edit.context.workspaceFolder, edit.context.stamp)) {
			throw new Error(gone);
		}
		const fileName = basename(edit.resource);
		// A step of the canvas's undo, as a delete on the canvas is.
		await this.view.explorerService.applyBulkEdit([new ResourceFileEdit(edit.resource, target)], {
			undoLabel: localize('basehalf.canvas.rename.undo', "Rename {0} to {1}", fileName, name),
			progressLabel: localize('basehalf.canvas.rename.progress', "Renaming {0}", fileName),
			confirmBeforeUndo: this.confirmExplorerUndo(),
			undoRedoSource: this.view.canvasUndoRedoSource
		});
	}

	private async createCanvasEntry(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		name: string,
		kind: 'file' | 'folder',
		canvasPosition: { readonly x: number; readonly y: number },
		options: {
			readonly contents?: VSBuffer;
			readonly select?: boolean;
			readonly postCreateOwner?: IBaseHalfCanvasPostCreateOwner;
			readonly size?: { readonly width: number; readonly height: number };
			/** The anchor row of a connection the new file's contents carry. */
			readonly edge?: IBaseHalfCanvasEdge;
			/** The place was computed: the view goes to the card when it is out of sight. */
			readonly reveal?: boolean;
		} = {}
	): Promise<URI> {
		const postCreateOwner = options.postCreateOwner ?? this.view.captureCanvasPostCreateOwner();
		await this.view.canvasActionContextService.assertCurrent(context);
		const target = joinPath(folder.resource, name);
		if (kind === 'folder') {
			await this.view.workingCopyFileService.createFolder([{ resource: target }], CancellationToken.None);
		} else {
			await this.view.workingCopyFileService.create([{ resource: target, contents: options.contents }], CancellationToken.None);
		}
		// One step of the canvas's undo: undo keeps what it made, with what was
		// typed or put into it since, and redo brings it back to its place
		// (exact undo, "What the canvas made").
		this.view.keptVersions.recordMade([target], {
			label: kind === 'folder'
				? localize('basehalf.canvas.newFolder.undo', "Create Folder {0}", name)
				: localize('basehalf.canvas.newFile.undo', "Create File {0}", name)
		});

		const path = baseHalfCanvasChildPath(folder.relativePath, name);
		const size = options.size ?? (kind === 'folder'
			? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT });
		await this.placeCreatedCard(folder, path, canvasPosition, size, { kind, edge: options.edge });

		// A canvas Create action produces and selects a card; it never implies an
		// Open action. Card-local editors/configuration remain available in place,
		// while Card Detail is reserved for an explicit Open/Expand interaction.
		if (options.select !== false) {
			this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], postCreateOwner);
			if (options.reveal) {
				this.revealCreatedCards(folder, [path], postCreateOwner);
			}
		}
		this.view.requestRender();
		return target;
	}

	/**
	 * Gives the card of an item the user just created its row at the place the
	 * canvas chose for it, and with `edge` the anchor row of the connection the
	 * item was created with. The item exists either way: a row that cannot be
	 * saved says so, and the card appears at the end of the canvas.
	 */
	async placeCreatedCard(
		folder: IBaseHalfCanvasFolderState,
		path: string,
		canvasPosition: { readonly x: number; readonly y: number },
		size: { readonly width: number; readonly height: number },
		options: { readonly kind?: 'file' | 'folder'; readonly edge?: IBaseHalfCanvasEdge } = {}
	): Promise<void> {
		// A change by the user writes the layout, and the places that wait are
		// saved with it: before, as they were drawn, and after, for a layout that
		// only this write made readable.
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		try {
			await this.view.canvasMirrorService.updateCardGeometry(folder, {
				path,
				kind: options.kind ?? 'file',
				x: canvasPosition.x,
				y: canvasPosition.y,
				width: size.width,
				height: size.height
			});
		} catch (error) {
			this.view.logService.warn(error);
			this.view.queueCanvasWarning(localize('basehalf.canvas.createGeometryFailed', "The item was created, but its canvas position could not be saved."));
		}
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		// Anchor memory only: in a marked folder the edge uses default anchors.
		if (options.edge && !await baseHalfIsWorkspaceFolderMarked(this.view.fileService, folder.workspaceFolder)) {
			try {
				await this.view.canvasMirrorService.upsertCanvasEdge(folder, options.edge);
			} catch (error) {
				this.view.logService.warn(`[BaseHalf] could not remember the anchors of ${options.edge.from} -> ${options.edge.to}`, error);
			}
		}
	}

	private async importCanvasResources(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		resources: readonly URI[],
		canvasPosition: { readonly x: number; readonly y: number },
		operation: 'copy' | 'move',
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		if (this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		await this.view.canvasActionContextService.assertCurrent(context);
		if (!this.view.uriIdentityService.extUri.isEqual(this.view.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		// An item that is there is never replaced: undo could not give it back
		// (exact undo, "What the canvas made"). A name that is taken gets the next
		// free one, as Duplicate does.
		const configuredNaming = this.view.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const incrementalNaming = configuredNaming === 'disabled' ? 'smart' : configuredNaming;
		const uniqueResources = [...new Map(resources.map(resource => [resource.toString(), resource])).values()];
		const transfers: { readonly source: URI; readonly target: URI; readonly kind: 'file' | 'folder' }[] = [];
		const drafts: URI[] = [];
		// Two items of one paste never take the same name.
		const reserved = new Set<string>();
		for (const source of uniqueResources) {
			if (operation === 'move' && this.view.uriIdentityService.extUri.isEqual(dirname(source), folder.resource)) {
				continue;
			}
			let stat;
			try {
				stat = await this.view.fileService.stat(source);
			} catch (error) {
				// A draft has no file: a copy of it is a new draft here, and a cut one
				// moves here (generation cards, "Moving, renaming, copying, and undo").
				if (await this.isDraftPath(source)) {
					drafts.push(source);
					continue;
				}
				throw error;
			}
			if (!stat.isFile && !stat.isDirectory) {
				continue;
			}
			if (stat.isDirectory && isEqualOrParent(folder.resource, source)) {
				throw new Error(localize('basehalf.canvas.import.ancestor', "A folder cannot be imported into itself or one of its descendants."));
			}
			const target = operation === 'copy'
				? await this.copyTarget(folder, source, stat.isDirectory, false, incrementalNaming, reserved)
				: await this.freeTransferTarget(folder, source, stat.isDirectory, false, incrementalNaming, reserved);
			if (target) {
				reserved.add(this.view.uriIdentityService.extUri.getComparisonKey(target));
				transfers.push({ source, target, kind: stat.isDirectory ? 'folder' : 'file' });
			}
		}
		if (transfers.length === 0 && drafts.length === 0) {
			if (operation === 'move') {
				await clearExplorerFileClipboardCut(this.view.explorerService);
			}
			return;
		}
		// One undo takes back the files and the drafts of the paste together.
		const undoRedoGroup = new UndoRedoGroup();
		await this.transferResources(transfers, operation, undoRedoGroup);
		const placed: { readonly target: URI; readonly kind: 'file' | 'folder' }[] = [...transfers];
		for (const draft of drafts) {
			placed.push({ target: await this.transferDraft(folder, draft, operation, undoRedoGroup), kind: 'file' });
		}
		if (operation === 'move') {
			await clearExplorerFileClipboardCut(this.view.explorerService);
		}

		// The user pointed at a place: the group keeps its block there, and a card
		// whose slot is taken goes to the nearest open place (canvas card placement).
		const paths = placed.map(transfer => baseHalfCanvasChildPath(folder.relativePath, basename(transfer.target)));
		// A card that was moved here keeps the size it had: its row came along.
		// A new card has the size of its kind, which for a generation card is read.
		let carried = new Map<string, IBaseHalfCanvasCard>();
		try {
			carried = new Map(((await this.view.canvasMirrorService.readCanvas(folder))?.cards ?? []).map(row => [row.path, row]));
		} catch (error) {
			this.view.logService.warn(error);
		}
		const sizes = await Promise.all(placed.map(async (transfer, index) => {
			const row = carried.get(paths[index]);
			if (row) {
				return { width: row.width, height: row.height };
			}
			if (transfer.kind === 'folder') {
				return { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT };
			}
			// The drafts come after the files and folders.
			const draftKind = index >= transfers.length ? baseHalfGenerationKindOfPath(transfer.target.path) : undefined;
			return draftKind ? baseHalfCanvasGenerationCardSize(draftKind) : await this.view.previews.sizeOfNewFileCard(transfer.target);
		}));
		const places = baseHalfCanvasTransferPlaces(canvasPosition, sizes, this.takenCanvasPlaces(new Set(paths)));
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		for (let index = 0; index < placed.length; index++) {
			const transfer = placed[index];
			const path = paths[index];
			try {
				await this.view.canvasMirrorService.updateCardGeometry(folder, {
					path,
					kind: transfer.kind,
					...places[index],
					...sizes[index]
				});
			} catch (error) {
				this.view.logService.warn(error);
				this.view.queueCanvasWarning(localize('basehalf.canvas.importGeometryFailed', "The items were imported, but some canvas positions could not be saved."));
			}
		}
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), paths, postCreateOwner);
		this.view.requestRender();
	}

	/**
	 * A draft pasted on the canvas: a copy is a new draft with its prompt and
	 * settings, and a draft that was cut moves here, under its name or the next
	 * free one; each is one step of the canvas undo stack.
	 */
	private async transferDraft(folder: IBaseHalfCanvasFolderState, draft: URI, operation: 'copy' | 'move', undoRedoGroup: UndoRedoGroup): Promise<URI> {
		if (operation === 'copy') {
			return this.view.generationCardActions.copyDraft(draft, folder.resource, localize('basehalf.canvas.paste.draftUndo', "Paste {0}", basename(draft)), undoRedoGroup);
		}
		// It keeps its name where that is free.
		const { base, extension } = baseHalfGenerationNameParts(basename(draft));
		const name = await this.view.generationCardStore.nextFreeName(folder.resource, base, extension, baseHalfGenerationNameOrdinal(basename(draft)));
		return this.view.generationCardActions.moveDraft(draft, joinPath(folder.resource, name));
	}

	/**
	 * Copies or moves files and folders onto the canvas's folder, as one step
	 * of the canvas undo (exact undo, "What the canvas made"): undo keeps the
	 * copies, with what was put into them since, and moves what was moved
	 * back.
	 */
	private async transferResources(
		transfers: readonly { readonly source: URI; readonly target: URI }[],
		operation: 'copy' | 'move',
		undoRedoGroup: UndoRedoGroup
	): Promise<void> {
		if (transfers.length === 0) {
			return;
		}
		const label = transfers.length === 1
			? operation === 'move'
				? localize('basehalf.canvas.move.undoOne', "Move {0}", basename(transfers[0].target))
				: localize('basehalf.canvas.import.undoOne', "Import {0}", basename(transfers[0].target))
			: operation === 'move'
				? localize('basehalf.canvas.move.undoMany', "Move {0} items", transfers.length)
				: localize('basehalf.canvas.import.undoMany', "Import {0} items", transfers.length);
		if (operation === 'copy') {
			await this.view.workingCopyFileService.copy(transfers.map(transfer => ({ file: { source: transfer.source, target: transfer.target }, overwrite: false })), CancellationToken.None);
			this.view.keptVersions.recordMade(transfers.map(transfer => transfer.target), { label, undoRedoGroup });
			return;
		}
		// The undo of a move moves it back, and the mirror cascade carries the
		// cards' information both ways. A cut draft moves in a step of its own.
		await this.view.explorerService.applyBulkEdit(transfers.map(transfer => new ResourceFileEdit(transfer.source, transfer.target, { overwrite: false })), {
			undoLabel: label,
			progressLabel: transfers.length === 1
				? localize('basehalf.canvas.move.progressOne', "Moving {0}", basename(transfers[0].target))
				: localize('basehalf.canvas.move.progressMany', "Moving {0} items", transfers.length),
			confirmBeforeUndo: this.confirmExplorerUndo(),
			undoRedoSource: this.view.canvasUndoRedoSource
		});
	}

	/**
	 * The path a copy of an item takes in the canvas's folder. The copy of a
	 * generation card with its file is named as the copy of a draft is
	 * (generation cards, "Moving, renaming, copying, and undo"): its own name
	 * where that is free, and the next free number after its own otherwise.
	 * Any other item is named as the Explorer names a pasted item. No copy
	 * takes a draft's name, nor one in `reserved`.
	 */
	async copyTarget(
		folder: IBaseHalfCanvasFolderState,
		source: URI,
		isDirectory: boolean,
		allowOverwrite: boolean,
		incrementalNaming: IFilesConfiguration['explorer']['incrementalNaming'],
		reserved?: ReadonlySet<string>
	): Promise<URI | undefined> {
		if (isDirectory || !await this.view.generationCardStore.isGenerationCard(source)) {
			return this.freeTransferTarget(folder, source, isDirectory, allowOverwrite, incrementalNaming, reserved);
		}
		return baseHalfCanvasGenerationCopyTarget(folder.resource, basename(source),
			(base, extension, ordinal) => this.view.generationCardStore.nextFreeName(folder.resource, base, extension, ordinal),
			candidate => !!reserved?.has(this.view.uriIdentityService.extUri.getComparisonKey(candidate)));
	}

	/**
	 * The path a file or folder takes in the canvas's folder, as the Explorer
	 * names a pasted item, where the path of a draft is taken as the path of an
	 * item is (generation cards, "Creating a generation card"): a paste, a drop,
	 * Import File, and a duplicate never take a draft's name.
	 */
	async freeTransferTarget(
		folder: IBaseHalfCanvasFolderState,
		source: URI,
		isDirectory: boolean,
		allowOverwrite: boolean,
		incrementalNaming: IFilesConfiguration['explorer']['incrementalNaming'],
		reserved?: ReadonlySet<string>
	): Promise<URI | undefined> {
		return baseHalfCanvasFreeTransferTarget(this.view.fileService, this.view.dialogService, folder.resource, source, isDirectory, allowOverwrite, incrementalNaming,
			async candidate => reserved?.has(this.view.uriIdentityService.extUri.getComparisonKey(candidate)) || await this.isDraftPath(candidate));
	}

	/** Whether a path holds a draft, whose name is taken as an item's is (generation cards, "Creating a generation card"). */
	async isDraftPath(resource: URI): Promise<boolean> {
		const workspaceFolder = this.view.workspaceContextService.getWorkspaceFolder(resource)?.uri;
		const relativePath = workspaceFolder ? this.view.uriIdentityService.extUri.relativePath(workspaceFolder, resource) : undefined;
		return !!workspaceFolder && !!relativePath && baseHalfGenerationKindOfPath(relativePath) !== undefined
			&& await baseHalfPathHoldsDraft(this.view.fileService, workspaceFolder, relativePath);
	}

	confirmExplorerUndo(): boolean {
		return this.view.configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose;
	}

	async requestInlineRename(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		try {
			const context = await this.view.canvasActionContextService.capture(item.stat.resource, folder.workspaceFolder, item.path);
			await this.view.canvasEditingService.requestRename(context);
		} catch (error) {
			this.view.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.view.requestRender();
		}
	}

	/** Gives the card of a new file a place right of another card, or the next open place there. */
	async placeNewCardBeside(folder: IBaseHalfCanvasFolderState, besidePath: string, resource: URI): Promise<void> {
		const path = baseHalfCanvasChildPath(folder.relativePath, basename(resource));
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.view.fileService, folder.workspaceFolder)) {
				return;
			}
			const layout = await this.view.canvasMirrorService.readCanvas(folder);
			const beside = layout?.cards.find(card => card.path === besidePath);
			if (!layout || !beside) {
				return;
			}
			// A picture, such as a captured frame, has its shape.
			const size = await this.view.previews.sizeOfNewFileCard(resource);
			const place = baseHalfCanvasOpenPosition({ x: beside.x + beside.width + BASEHALF_CANVAS_GRID_COLUMN_GAP, y: beside.y }, size, layout.cards.filter(card => card.path !== path));
			await this.view.canvasMirrorService.updateCardGeometry(folder, { path, kind: 'file', x: place.x, y: place.y, ...size });
		} catch (error) {
			this.view.logService.warn(`[BaseHalf] could not place ${path} beside ${besidePath}`, error);
		}
	}
}

/**
 * The size at which a card of a kind the user creates on the canvas is placed,
 * before it is drawn: for a draft of an image or a video the shape of
 * `ratio`, the ratio its values choose, and for a draft of a sound the size
 * of a file card (canvas card placement, "The card of an image or a video
 * has its picture's shape").
 */
function canvasCreateSize(kind: BaseHalfCanvasCreateKind, ratio?: number): { readonly width: number; readonly height: number } {
	return kind === 'folder'
		? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
		: isBaseHalfCanvasDraftCreateKind(kind)
			? baseHalfCanvasGenerationCardSize(kind, ratio)
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
}
