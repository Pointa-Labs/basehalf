/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { $, append, isHTMLElement } from '../../../../../base/browser/dom.js';
import { InputBox, MessageType } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { basename, dirname, extname, isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../../nls.js';
import { getPathForFile } from '../../../../../platform/dnd/browser/dnd.js';
import { defaultInputBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { clearExplorerFileClipboardCut, explorerFileClipboardShouldMove, findValidPasteFileTargetForResource } from '../../../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../../../contrib/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasItemBounds,
	baseHalfCanvasOpenPosition,
	BASEHALF_CANVAS_GRID_COLUMN_GAP,
	baseHalfCanvasChildPath,
	baseHalfCanvasTransferPlaces,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH,
	IBaseHalfCanvasBounds,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasItem
} from '../../common/basehalfCanvasModel.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../../workspace/common/basehalfLegacyCleanup.js';
import { planBaseHalfMarkdownUpstreamEdit } from '../../../references/common/basehalfReferenceStore.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasInlineEditKeyAction, BaseHalfCanvasCreateKind, BaseHalfCanvasEditingRequest } from '../../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';
import { baseHalfItemDisplayName, baseHalfNoteFileName, baseHalfNoteNameExtension } from '../../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfPdfSelection } from '../../../cardDetail/common/basehalfMediaViewState.js';
import { baseHalfPdfBranchBaseName, baseHalfPdfBranchMarkdown } from '../../../cardDetail/common/basehalfPdfBranch.js';
import { BASEHALF_NODE_DOCUMENT_EXTENSION, BaseHalfNodeKind, createBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../../video/common/basehalfNodeDocument.js';
import { IBaseHalfVideoGeneration } from '../../../video/common/basehalfVideoNode.js';
import { baseHalfVideoInitialGeneration } from '../../../video/common/basehalfVideoCatalog.js';
import { baseHalfActiveEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID } from '../../../navigation/common/basehalfEditorFlush.js';
import { BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP, BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT, BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, BaseHalfCanvasInlineEdit, IBaseHalfCanvasPostCreateOwner, canvasResultNodeKindLabel } from './basehalfCanvasViewShared.js';

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
		const createSize = request.kind === 'create' && request.createKind === 'resultNode' && request.resultKind === 'video'
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: undefined;
		// A point the user named is taken as it is: the card is not moved for
		// other cards or for the edge of the window, and neither is the view. A
		// place BaseHalf computed goes to the nearest open place.
		const placement = request.kind === 'create' && !initialPlacement.pointed
			? this.avoidCanvasCreateOverlap(initialPlacement, request.createKind, createSize)
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
				requestOwner.navigationState.cardDetail
			);
			return;
		}
		if (request.createKind === 'resultNode') {
			if (!this.view.isCanvasPostCreateOwnerCurrent(requestOwner)) {
				return;
			}
			await this.createEmptyContentNode(folder, context, placement.canvasPosition, request.resultKind, requestOwner);
			return;
		}
		if (this.view.canvasNavigationService.state.cardDetail) {
			return;
		}

		const surfaceRect = this.view.surface.getBoundingClientRect();
		this.view.inlineEdit = {
			kind: 'create',
			context,
			parent: context.resource,
			createKind: request.createKind,
			initialValue: '',
			anchor: { x: placement.screenPosition.x - surfaceRect.left, y: placement.screenPosition.y - surfaceRect.top },
			canvasPosition: placement.canvasPosition,
			value: '',
			selectionPending: true
		};
		this.view.requestRender();
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
	 * the visible canvas, which is a place BaseHalf computed (canvas card
	 * placement, "Pointing").
	 */
	private canvasCreatePlacement(context: IBaseHalfCanvasActionContext | undefined): {
		readonly screenPosition: { readonly x: number; readonly y: number };
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
			screenPosition,
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

	private avoidCanvasCreateOverlap(
		placement: { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } },
		kind: BaseHalfCanvasCreateKind,
		sizeOverride?: { readonly width: number; readonly height: number }
	): { readonly screenPosition: { readonly x: number; readonly y: number }; readonly canvasPosition: { readonly x: number; readonly y: number } } {
		const occupied = this.takenCanvasPlaces();
		const size = sizeOverride ?? (kind === 'folder'
			? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT });
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
		const canvasPosition = baseHalfCanvasOpenPosition(placement.canvasPosition, size, occupied, viewport);
		return {
			canvasPosition,
			screenPosition: {
				x: placement.screenPosition.x + (canvasPosition.x - placement.canvasPosition.x) * this.view.canvasZoom,
				y: placement.screenPosition.y + (canvasPosition.y - placement.canvasPosition.y) * this.view.canvasZoom
			}
		};
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
		}
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
		if (sourceDetail) {
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
		}
		const currentFolder = this.view.getCurrentFolder();
		if (!currentFolder || this.view.sceneKey(currentFolder) !== this.view.sceneKey(folder)) {
			return;
		}
		const activationOwner = this.view.captureCanvasPostCreateOwner();
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], activationOwner);
		this.view.noteEditing.queueCreatedCanvasNoteActivation(folder, path, target, activationOwner, {
			focus: true,
			origin: createFocusOrigin,
			returnPath: createFocusReturnPath
		});
		this.view.requestRender();
	}

	private async createEmptyContentNode(
		folder: IBaseHalfCanvasFolderState,
		context: IBaseHalfCanvasActionContext,
		canvasPosition: { readonly x: number; readonly y: number },
		kind: BaseHalfNodeKind,
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		if (!this.view.isCanvasPostCreateOwnerCurrent(postCreateOwner)) {
			return;
		}
		await this.view.canvasActionContextService.assertCurrent(context);
		if (!this.view.uriIdentityService.extUri.isEqual(this.view.getCurrentFolder()?.resource, folder.resource)) {
			return;
		}
		const label = canvasResultNodeKindLabel(kind);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = `${kind}${index === 0 ? '' : `-${index + 1}`}${BASEHALF_NODE_DOCUMENT_EXTENSION}`;
			if (!await this.view.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(`Too many ${label.toLowerCase()} outputs already use the default name.`);
		}
		// An empty node of its kind; a Video node starts with an empty prompt and
		// the model and settings of the last generation on this computer.
		const generation = kind === 'video' ? this.initialVideoGeneration() : undefined;
		const document = createBaseHalfNodeDocument({
			id: generateUuid(),
			kind,
			title: label,
			...(generation ? { generation } : {})
		});
		if (kind === 'video') {
			this.view.createdNodeFocusPath = baseHalfCanvasChildPath(folder.relativePath, name);
		}
		await this.createCanvasEntry(folder, context, name, 'file', canvasPosition, {
			contents: VSBuffer.fromString(serializeBaseHalfNodeDocument(document)),
			postCreateOwner,
			size: kind === 'video'
				? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
				: undefined
		});
	}

	async createPdfBranch(resource: URI, selection: IBaseHalfPdfSelection): Promise<void> {
		this.view.markCanvasUserInteraction();
		const createOwner = this.view.captureCanvasPostCreateOwner();
		const createFocusOrigin = this.view.root.ownerDocument.activeElement;
		const cardDetail = createOwner.navigationState.cardDetail;
		const folder = this.view.getCurrentFolder();
		if (!cardDetail || !folder
			|| !this.view.uriIdentityService.extUri.isEqual(cardDetail.resource, resource)
			|| !this.view.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource)) {
			throw new Error(localize('basehalf.pdf.branch.stale', "The PDF or its canvas changed before the branch could be created."));
		}

		const renderedItems = [...this.view.renderedItemsByPath.values()];
		const sourceItem = this.view.renderedItemsByPath.get(cardDetail.relativePath);
		const sourceIndex = sourceItem ? renderedItems.indexOf(sourceItem) : -1;
		// Every card has its place, so the PDF's card stays where it is when a
		// sibling is added (canvas card placement).
		const sourceBounds = sourceItem && sourceIndex >= 0
			? baseHalfCanvasItemBounds(sourceItem, sourceIndex, renderedItems.length)
			: undefined;

		const context = await this.view.canvasActionContextService.capture(folder.resource, folder.workspaceFolder, folder.relativePath);
		const sourceName = basename(resource);
		const baseName = baseHalfPdfBranchBaseName(sourceName);
		let name: string | undefined;
		for (let index = 0; index < 1000; index++) {
			const candidate = `${baseName}${index === 0 ? '' : `-${index + 1}`}.md`;
			if (!await this.view.fileService.exists(joinPath(folder.resource, candidate))) {
				name = candidate;
				break;
			}
		}
		if (!name) {
			throw new Error(localize('basehalf.pdf.branch.exhausted', "Too many notes already use this PDF's branch name."));
		}

		const defaultPlacement = this.canvasCreatePlacement(undefined);
		const initialCanvasPosition = sourceBounds
			? { x: sourceBounds.x + sourceBounds.width + 72, y: sourceBounds.y }
			: defaultPlacement.canvasPosition;
		const placement = this.avoidCanvasCreateOverlap({
			screenPosition: defaultPlacement.screenPosition,
			canvasPosition: initialCanvasPosition
		}, 'note');
		// The note's first bytes list the PDF as upstream (D37): the create is
		// the connection, so there is no "created but not connected" state.
		const targetPath = baseHalfCanvasChildPath(folder.relativePath, name);
		const contents = VSBuffer.fromString(baseHalfPdfBranchMarkdown(sourceName, selection, {
			sourcePath: cardDetail.relativePath,
			notePath: targetPath
		}));
		const target = await this.createCanvasEntry(folder, context, name, 'file', placement.canvasPosition, {
			contents,
			select: false
		});

		// Frame the PDF's downstream set from the index, including the new note
		// once it is indexed; fall back to the PDF and the new note.
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
			this.view.logService.warn('[BaseHalf] failed to read the PDF downstream set for canvas framing', error);
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
		if (!edit || edit.kind !== 'rename' || edit.path !== item.path
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
		if (!editor || editor.edit !== this.view.inlineEdit || editor.edit.kind !== 'rename' || editor.edit.path !== path
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

	renderInlineCreateEditor(folder: IBaseHalfCanvasFolderState): void {
		const edit = this.view.inlineEdit;
		if (!edit) {
			return;
		}
		if (!this.view.uriIdentityService.extUri.isEqual(edit.parent, folder.resource)) {
			this.view.inlineEdit = undefined;
			return;
		}
		if (edit.kind !== 'create') {
			return;
		}
		const host = append(this.view.inlineEditLayer, $('.basehalf-canvas-inline-create-card'));
		host.style.left = `${Math.max(12, Math.min(edit.anchor.x, this.view.surface.clientWidth - 292))}px`;
		host.style.top = `${Math.max(12, Math.min(edit.anchor.y, this.view.surface.clientHeight - 64))}px`;
		const focus = this.renderInlineNameInput(host, edit, edit.createKind === 'folder', this.view.inlineEditListeners);
		mainWindow.setTimeout(focus, 0);
	}

	/**
	 * Builds the name input of an inline edit into `host`.
	 * @returns a function that gives the input the keyboard once it is in the
	 * document. An input that lost the keyboard because its card was replaced
	 * gets its caret back.
	 */
	private renderInlineNameInput(host: HTMLElement, edit: BaseHalfCanvasInlineEdit, folder: boolean, store: DisposableStore): () => void {
		host.classList.add('nodrag', 'nopan', 'nowheel');
		const icon = append(host, $(`span.basehalf-canvas-inline-name-icon.codicon.${folder ? 'codicon-folder' : 'codicon-file'}`));
		icon.setAttribute('aria-hidden', 'true');
		const inputHost = append(host, $('.basehalf-canvas-inline-name-input'));
		// A note is renamed by its name: the file keeps the extension it has.
		const noteExtension = edit.kind === 'rename' ? edit.extension : '';
		const fileNameOf = (typed: string) => noteExtension ? baseHalfNoteFileName(typed, noteExtension) : typed;
		// An empty name is refused as it is, before an extension makes it a name.
		const validateTyped = (typed: string) => this.validateCanvasEntryName(
			edit.parent,
			typed.trim().length === 0 ? typed : fileNameOf(typed),
			edit.kind === 'rename' ? edit.resource : undefined
		);
		const inputBox = new InputBox(inputHost, this.view.contextViewService, {
			ariaLabel: folder
				? localize('basehalf.canvas.folderNameInput', "Folder name. Press Enter to confirm or Escape to cancel.")
				: noteExtension
					? localize('basehalf.canvas.noteNameInput', "Note name. Press Enter to confirm or Escape to cancel.")
					: localize('basehalf.canvas.fileNameInput', "File name. Press Enter to confirm or Escape to cancel."),
			// The editor of a card's name is the name made editable: it has the
			// colors of the caption around it and no frame of its own.
			inputBoxStyles: edit.kind === 'rename'
				? { ...defaultInputBoxStyles, inputBackground: 'transparent', inputForeground: 'inherit', inputBorder: 'transparent' }
				: defaultInputBoxStyles,
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
			if (edit.kind === 'rename') {
				// While the name of a card is typed, a name that cannot be used is
				// only marked in the text. The reason is said when Enter is refused:
				// a box that comes and goes with every letter is not editing in place.
				inputBox.hideMessage();
				host.classList.toggle('unusable', result?.type === MessageType.ERROR);
			} else if (result) {
				inputBox.showMessage({ content: result.content, type: result.type });
			} else {
				inputBox.hideMessage();
			}
		};

		const finish = async (keepOpenOnError: boolean) => {
			if (finishing || this.view.inlineEdit !== edit) {
				return;
			}
			finishing = true;
			const postCreateOwner = edit.kind === 'create' || keepOpenOnError ? this.view.captureCanvasPostCreateOwner() : undefined;
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
			if (edit.kind === 'rename' && (name === edit.initialValue || fileNameOf(name) === basename(edit.resource))) {
				this.cancelCanvasInlineEdit(edit);
				return;
			}
			this.view.inlineEdit = undefined;
			try {
				await this.commitCanvasInlineEdit(edit, fileNameOf(name), postCreateOwner);
				this.view.lastCanvasContextMenu = undefined;
				this.view.requestRender();
				// Enter gives the keyboard back to the canvas, as Escape does, so
				// the renamed card answers the keys of a selected card.
				if (edit.kind === 'rename' && postCreateOwner && this.view.isCanvasPostCreateOwnerCurrent(postCreateOwner)) {
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
				if (inputBox.element.isConnected && (edit.kind !== 'rename' || this.view.inlineRenameEditor?.edit === edit)) {
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
				// Once for every input: the create editor is built by every render.
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

	async validateCanvasEntryName(parent: URI, name: string, current?: URI): Promise<{ readonly content: string; readonly type: MessageType } | undefined> {
		if (name.length === 0 || /^\s+$/.test(name)) {
			return { content: localize('basehalf.canvas.name.empty', "A file or folder name is required."), type: MessageType.ERROR };
		}
		if (name === '.' || name === '..' || /[\\/]/.test(name)) {
			return { content: localize('basehalf.canvas.name.singleSegment', "Enter a name without path separators."), type: MessageType.ERROR };
		}
		if (!(await this.view.pathService.hasValidBasename(parent, name))) {
			return { content: localize('basehalf.canvas.name.invalid', "This name is not valid on the current file system."), type: MessageType.ERROR };
		}
		const target = joinPath(parent, name);
		if ((!current || !this.view.uriIdentityService.extUri.isEqual(target, current)) && await this.view.fileService.exists(target)) {
			return { content: localize('basehalf.canvas.name.exists', "A file or folder with this name already exists."), type: MessageType.ERROR };
		}
		if (/^\s|\s$/.test(name)) {
			return { content: localize('basehalf.canvas.name.whitespace', "Leading or trailing whitespace will be preserved."), type: MessageType.WARNING };
		}
		return undefined;
	}

	private async commitCanvasInlineEdit(
		edit: BaseHalfCanvasInlineEdit,
		name: string,
		postCreateOwner?: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		const target = joinPath(edit.parent, name);
		if (edit.kind === 'rename') {
			// A name does not depend on what the file holds: an agent may write a
			// note while its name is edited. The stamp refuses an item that was
			// moved or removed, and one that another operation is changing.
			const gone = localize('basehalf.canvas.rename.gone', "This item was moved or removed while its name was edited.");
			if (!this.view.workspaceMutationCoordinator.isResourceStampCurrent(edit.context.workspaceFolder, edit.context.stamp)) {
				throw new Error(gone);
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
			await this.view.explorerService.applyBulkEdit([new ResourceFileEdit(edit.resource, target)], {
				undoLabel: localize('basehalf.canvas.rename.undo', "Rename {0} to {1}", fileName, name),
				progressLabel: localize('basehalf.canvas.rename.progress', "Renaming {0}", fileName),
				confirmBeforeUndo: this.confirmExplorerUndo()
			});
			return;
		}
		const folder = this.view.getCurrentFolder();
		if (!folder || !this.view.uriIdentityService.extUri.isEqual(folder.resource, edit.parent)) {
			throw new Error(localize('basehalf.canvas.create.folderChanged', "The canvas changed before the item could be created."));
		}
		await this.createCanvasEntry(folder, edit.context, name, edit.createKind, edit.canvasPosition, {
			postCreateOwner: postCreateOwner ?? this.view.captureCanvasPostCreateOwner()
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
		} = {}
	): Promise<URI> {
		const postCreateOwner = options.postCreateOwner ?? this.view.captureCanvasPostCreateOwner();
		await this.view.canvasActionContextService.assertCurrent(context);
		const target = joinPath(folder.resource, name);
		await this.view.explorerService.applyBulkEdit([new ResourceFileEdit(undefined, target, {
			folder: kind === 'folder',
			contents: options.contents ? Promise.resolve(options.contents) : undefined
		})], {
			undoLabel: kind === 'folder'
				? localize('basehalf.canvas.newFolder.undo', "Create Folder {0}", name)
				: localize('basehalf.canvas.newFile.undo', "Create File {0}", name),
			progressLabel: kind === 'folder'
				? localize('basehalf.canvas.newFolder.progress', "Creating folder {0}", name)
				: localize('basehalf.canvas.newFile.progress', "Creating file {0}", name),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});

		const path = baseHalfCanvasChildPath(folder.relativePath, name);
		const size = options.size ?? (kind === 'folder'
			? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT });
		// A change by the user writes the layout, and the places that wait are
		// saved with it: before, as they were drawn, and after, for a layout that
		// only this write made readable.
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		try {
			await this.view.canvasMirrorService.updateCardGeometry(folder, {
				path,
				kind,
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

		// A canvas Create action produces and selects a card; it never implies an
		// Open action. Card-local editors/configuration remain available in place,
		// while Card Detail is reserved for an explicit Open/Expand interaction.
		if (options.select !== false) {
			this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], postCreateOwner);
		}
		this.view.requestRender();
		return target;
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
		const incrementalNaming = this.view.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const uniqueResources = [...new Map(resources.map(resource => [resource.toString(), resource])).values()];
		const transfers: { readonly source: URI; readonly target: URI; readonly kind: 'file' | 'folder' }[] = [];
		for (const source of uniqueResources) {
			if (operation === 'move' && this.view.uriIdentityService.extUri.isEqual(dirname(source), folder.resource)) {
				continue;
			}
			const stat = await this.view.fileService.stat(source);
			if (!stat.isFile && !stat.isDirectory) {
				continue;
			}
			if (stat.isDirectory && isEqualOrParent(folder.resource, source)) {
				throw new Error(localize('basehalf.canvas.import.ancestor', "A folder cannot be imported into itself or one of its descendants."));
			}
			const target = await findValidPasteFileTargetForResource(
				this.view.fileService,
				this.view.dialogService,
				folder.resource,
				{ resource: source, isDirectory: stat.isDirectory, allowOverwrite: operation === 'move' || incrementalNaming === 'disabled' },
				incrementalNaming
			);
			if (target) {
				transfers.push({ source, target, kind: stat.isDirectory ? 'folder' : 'file' });
			}
		}
		if (transfers.length === 0) {
			if (operation === 'move') {
				await clearExplorerFileClipboardCut(this.view.explorerService);
			}
			return;
		}
		await this.view.explorerService.applyBulkEdit(transfers.map(transfer => new ResourceFileEdit(transfer.source, transfer.target, {
			copy: operation === 'copy',
			overwrite: incrementalNaming === 'disabled'
		})), {
			undoLabel: transfers.length === 1
				? operation === 'move'
					? localize('basehalf.canvas.move.undoOne', "Move {0}", basename(transfers[0].target))
					: localize('basehalf.canvas.import.undoOne', "Import {0}", basename(transfers[0].target))
				: operation === 'move'
					? localize('basehalf.canvas.move.undoMany', "Move {0} items", transfers.length)
					: localize('basehalf.canvas.import.undoMany', "Import {0} items", transfers.length),
			progressLabel: transfers.length === 1
				? operation === 'move'
					? localize('basehalf.canvas.move.progressOne', "Moving {0}", basename(transfers[0].target))
					: localize('basehalf.canvas.import.progressOne', "Importing {0}", basename(transfers[0].target))
				: operation === 'move'
					? localize('basehalf.canvas.move.progressMany', "Moving {0} items", transfers.length)
					: localize('basehalf.canvas.import.progressMany', "Importing {0} items", transfers.length),
			confirmBeforeUndo: this.confirmExplorerUndo()
		});
		if (operation === 'move') {
			await clearExplorerFileClipboardCut(this.view.explorerService);
		}

		// The user pointed at a place: the group keeps its block there, and a card
		// whose slot is taken goes to the nearest open place (canvas card placement).
		const paths = transfers.map(transfer => baseHalfCanvasChildPath(folder.relativePath, basename(transfer.target)));
		// A card that was moved here keeps the size it had: its row came along.
		// A new card has the size of its kind, which for a node file is read.
		let carried = new Map<string, IBaseHalfCanvasCard>();
		try {
			carried = new Map(((await this.view.canvasMirrorService.readCanvas(folder))?.cards ?? []).map(row => [row.path, row]));
		} catch (error) {
			this.view.logService.warn(error);
		}
		const sizes = await Promise.all(transfers.map(async (transfer, index) => {
			const row = carried.get(paths[index]);
			if (row) {
				return { width: row.width, height: row.height };
			}
			return transfer.kind === 'folder'
				? { width: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FOLDER_CARD_HEIGHT }
				: await this.view.previews.sizeOfNewFileCard(transfer.target);
		}));
		const places = baseHalfCanvasTransferPlaces(canvasPosition, sizes, this.takenCanvasPlaces(new Set(paths)));
		await this.view.renderer.saveWaitingCanvasPlacesWithUserChange(folder);
		for (let index = 0; index < transfers.length; index++) {
			const transfer = transfers[index];
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

	// --- the Video node panel (D58, video node, "The panel") ---------------------------------

	/** The provider, model, mode, and values a new Video node starts with: those of the last generation on this computer, made legal for the model. */
	initialVideoGeneration(): IBaseHalfVideoGeneration | undefined {
		const catalog = this.view.videoCatalogService.state;
		return baseHalfVideoInitialGeneration(this.view.videoProviderSettings.getLastUsed(), catalog.kind === 'ready' ? catalog.catalog : undefined);
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
			const size = { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
			const place = baseHalfCanvasOpenPosition({ x: beside.x + beside.width + BASEHALF_CANVAS_GRID_COLUMN_GAP, y: beside.y }, size, layout.cards.filter(card => card.path !== path));
			await this.view.canvasMirrorService.updateCardGeometry(folder, { path, kind: 'file', x: place.x, y: place.y, ...size });
		} catch (error) {
			this.view.logService.warn(`[BaseHalf] could not place ${path} beside ${besidePath}`, error);
		}
	}
}
