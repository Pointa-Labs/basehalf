/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { toAction } from '../../../../../base/common/actions.js';
import { basename, dirname } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../../nls.js';
import { FileSystemProviderCapabilities } from '../../../../../platform/files/common/files.js';
import { IFilesConfiguration } from '../../../../contrib/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { baseHalfCanvasChildPath, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { baseHalfCanvasDeleteImpact, IBaseHalfCanvasDeleteImpactStore } from '../../../references/common/basehalfCanvasUpstream.js';
import { IBaseHalfReferenceStoreEdit } from '../../../references/common/basehalfReferenceEdit.js';
import { baseHalfNormalizeUpstreamEntry } from '../../../references/common/basehalfReferenceEntries.js';
import { BaseHalfReferenceIndexState } from '../../../references/common/basehalfReferenceIndex.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_CARD_IS_DRAFT, IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';
import { isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfAgentSelectionCaption, IBaseHalfAgentSelectionText } from '../../../agentArea/common/basehalfAgentSelection.js';
import { BaseHalfCanvasSceneContextMenuRequest, BaseHalfCanvasSceneSelectionAction } from '../../common/basehalfCanvasScene.js';
import { BASEHALF_CANVAS_CARD_CONTEXT_MENU, BASEHALF_CANVAS_PANE_CONTEXT_MENU } from '../basehalfCanvasContextMenu.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { IBaseHalfCanvasPostCreateOwner, badgeType, cardDisplayName } from './basehalfCanvasViewShared.js';

const BASEHALF_CANVAS_SELECTION_UNDO_FILE_SIZE = 5_000_000;

/**
 * What the user does with cards: opening a card, duplicating and deleting a
 * selection, the context menus, Pick on Canvas, and the selection agents can
 * see.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasSelectionActions {
	/** Pick on Canvas while it waits for a click (IBaseHalfCanvasView.pickCard). */
	private canvasCardPick: { readonly store: DisposableStore; finish(path: string | undefined): void } | undefined;
	/** Bumped when a pending card open is cancelled: a late open that follows a selection that moved on does nothing. */
	private cardOpenIntent = 0;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	async prepareSceneSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean> {
		const accepted = await this.view.noteEditing.prepareSceneNoteSelectionChange(sceneKey, structuralEpoch, paths);
		if (accepted) {
			this.view.onDidChangeSelectionEmitter.fire({ sceneKey, paths });
		}
		return accepted;
	}

	currentPostCreateSelectionPaths(): readonly string[] | undefined {
		const pendingCreated = this.view.pendingCreatedCanvasNoteActivation;
		const promotedFocus = this.view.pendingCanvasNoteFocus;
		const activeFocus = this.view.activeCanvasNoteEditor?.focusIntent;
		return pendingCreated && this.view.isCanvasPostCreateOwnerCurrent(pendingCreated.owner)
			? [pendingCreated.path]
			: promotedFocus?.createOwner && this.view.isCanvasPostCreateOwnerCurrent(promotedFocus.createOwner)
				? [promotedFocus.path]
				: activeFocus?.createOwner && this.view.isCanvasPostCreateOwnerCurrent(activeFocus.createOwner)
					? [this.view.activeCanvasNoteEditor!.path]
					: this.view.pendingCanvasSelection && this.view.isCanvasPostCreateOwnerCurrent(this.view.pendingCanvasSelection.owner)
						? this.view.pendingCanvasSelection.paths
						: undefined;
	}

	private canvasSelectionSupersedesPostCreate(paths: readonly string[]): boolean {
		const expected = this.currentPostCreateSelectionPaths();
		return expected !== undefined && (
			expected.length !== paths.length
			|| expected.some(path => !paths.includes(path))
		);
	}

	queueCanvasSelection(
		sceneKey: string,
		paths: readonly string[],
		owner: IBaseHalfCanvasPostCreateOwner = this.view.captureCanvasPostCreateOwner()
	): boolean {
		if (paths.length === 0 || !this.view.isCanvasPostCreateOwnerCurrent(owner)) {
			return false;
		}
		this.view.pendingCanvasSelection = { sceneKey, paths, owner };
		return true;
	}

	async openSceneCard(sceneKey: string, structuralEpoch: number, path: string): Promise<void> {
		this.cancelPendingNodeActivation();
		const intent = this.cardOpenIntent;
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const item = this.view.renderedItemsByPath.get(path);
		if (!item) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const targetResourceKey = this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		if (!await this.view.noteEditing.waitForCanvasNoteFormatCommands(sceneKey, path, targetResourceKey)) {
			return;
		}
		const folderBeforeClose = this.view.getCurrentFolder();
		const itemBeforeClose = this.view.renderedItemsByPath.get(path);
		if (!folderBeforeClose || this.view.sceneKey(folderBeforeClose) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folderBeforeClose.workspaceFolder, this.view.sceneMutationStamp(folderBeforeClose, structuralEpoch))
			|| !itemBeforeClose
			|| this.view.uriIdentityService.extUri.getComparisonKey(itemBeforeClose.stat.resource) !== targetResourceKey) {
			return;
		}
		if (!await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
			return;
		}
		const currentFolder = this.view.getCurrentFolder();
		const currentItem = this.view.renderedItemsByPath.get(path);
		const currentStampValid = !!currentFolder
			&& this.view.sceneKey(currentFolder) === sceneKey
			&& this.view.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.view.sceneMutationStamp(currentFolder, structuralEpoch));
		if (this.cardOpenIntent !== intent
			|| !currentStampValid
			|| !currentItem
			|| !this.view.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)) {
			return;
		}
		if (currentItem.generation?.draft) {
			// A draft has no file to open: it stays selected on the canvas, where
			// its card and its panel are.
			this.selectCard(path);
			return;
		}
		if (currentItem.stat.isDirectory) {
			await this.view.canvasNavigationService.openFolderCanvas(currentItem.stat.resource, { source: 'api' });
		} else {
			await this.view.canvasNavigationService.openCardDetail(currentItem.stat.resource, {
				source: 'api',
				pinned: true,
				...(isBaseHalfMarkdownResource(currentItem.stat.resource) ? { projection: 'rich' as const } : {})
			});
		}
	}

	cancelPendingNodeActivation(): void {
		this.cardOpenIntent++;
	}

	async performSceneSelectionAction(
		sceneKey: string,
		structuralEpoch: number,
		action: BaseHalfCanvasSceneSelectionAction,
		paths: readonly string[]
	): Promise<void> {
		const uniquePaths = [...new Set(paths)];
		if (uniquePaths.length === 0) {
			return;
		}
		const duplicateOwner = action === 'duplicate'
			? (() => {
				this.view.markCanvasUserInteraction();
				return this.view.captureCanvasPostCreateOwner();
			})()
			: undefined;
		const { folder, items } = await this.resolveSceneSelection(sceneKey, structuralEpoch, uniquePaths);
		if (action !== 'duplicate') {
			this.view.markCanvasUserInteraction();
		}
		if (action === 'copyReferences') {
			if (items.length < 2) {
				return;
			}
			await this.view.clipboardService.writeText(items.map(item => item.path).join('\n'));
			return;
		}
		this.cancelPendingNodeActivation();
		if (action === 'rename') {
			if (items.length !== 1) {
				return;
			}
			const context = await this.view.canvasActionContextService.capture(items[0].stat.resource, folder.workspaceFolder, items[0].path);
			await this.view.canvasActionContextService.assertCurrent(context);
			await this.view.canvasEditingService.requestRename(context);
			return;
		}
		if (action === 'duplicate') {
			const hadActiveNote = !!this.view.activeCanvasNoteEditor;
			if (hadActiveNote && !await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
				return;
			}
			if (hadActiveNote) {
				this.view.canvasScene.select({ cardPaths: [] });
			}
			await this.duplicateSceneSelection(sceneKey, structuralEpoch, folder, items, duplicateOwner!);
			return;
		}
		await this.deleteSceneSelection(sceneKey, structuralEpoch, folder, items);
	}

	async resolveSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		paths: readonly string[]
	): Promise<{ readonly folder: IBaseHalfCanvasFolderState; readonly items: readonly IBaseHalfCanvasItem[] }> {
		const folder = this.view.folderForSceneMutation(sceneKey);
		if (!this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			throw new Error('The canvas changed before the selection action could be applied.');
		}
		const items = paths.map(path => this.view.renderedItemsByPath.get(path));
		if (items.some(item => !item)) {
			throw new Error('One or more selected cards are no longer available.');
		}
		const liveItems = items as IBaseHalfCanvasItem[];
		await this.view.resolveLiveCanvasNodes(sceneKey, folder, liveItems.map(item => ({ path: item.path, kind: item.kind })));
		return { folder, items: Object.freeze(liveItems) };
	}

	private async duplicateSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		postCreateOwner: IBaseHalfCanvasPostCreateOwner
	): Promise<void> {
		// A copied folder keeps its notes' bytes, so entries inside it that name
		// other items of the original folder still name the originals (D37).
		const internallyConnected = items.filter(item => item.kind === 'folder' && this.folderHasInternalUpstream(folder.workspaceFolder, item.path));
		if (internallyConnected.length > 0) {
			const confirmation = await this.view.dialogService.confirm({
				message: internallyConnected.length === 1
					? localize('basehalf.canvas.duplicate.connectedFolder.message', "Duplicate '{0}'?", internallyConnected[0].name)
					: localize('basehalf.canvas.duplicate.connectedFolders.message', "Duplicate {0} folders?", internallyConnected.length),
				detail: localize(
					'basehalf.canvas.duplicate.connectedFolder.detail',
					"Items in the copy keep their upstream entries, so entries that name other items in {0} still name the originals.",
					internallyConnected.map(item => `'${item.name}'`).join(', ')
				),
				primaryButton: localize('basehalf.canvas.duplicate.connectedFolder.primary', "&&Duplicate")
			});
			if (!confirmation.confirmed) {
				return;
			}
		}
		const configuredNaming = this.view.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const naming = configuredNaming === 'disabled' ? 'smart' : configuredNaming;
		const reserved = new Set<string>();
		const copies: { readonly item: IBaseHalfCanvasItem; readonly target: URI }[] = [];
		// A draft has no file to copy: its copy is a new draft (generation cards, "Moving, renaming, copying, and undo").
		const drafts = items.filter(item => item.generation?.draft);
		for (const item of items.filter(candidate => !candidate.generation?.draft)) {
			// Neither another copy nor a draft has the name a copy takes.
			const target = await this.view.creation.freeTransferTarget(folder, item.stat.resource, item.kind === 'folder', false, naming, reserved);
			if (!target) {
				return;
			}
			reserved.add(this.view.uriIdentityService.extUri.getComparisonKey(target));
			copies.push({ item, target });
		}

		await this.resolveSceneSelection(sceneKey, structuralEpoch, items.map(item => item.path));
		if (copies.length) {
			await this.view.explorerService.applyBulkEdit(copies.map(copy => new ResourceFileEdit(copy.item.stat.resource, copy.target, {
				copy: true,
				overwrite: false
			})), {
				undoLabel: copies.length === 1
					? localize('basehalf.canvas.duplicate.undoOne', "Duplicate {0}", basename(copies[0].target))
					: localize('basehalf.canvas.duplicate.undoMany', "Duplicate {0} items", copies.length),
				progressLabel: copies.length === 1
					? localize('basehalf.canvas.duplicate.progressOne', "Duplicating {0}", copies[0].item.name)
					: localize('basehalf.canvas.duplicate.progressMany', "Duplicating {0} items", copies.length),
				confirmBeforeUndo: this.view.creation.confirmExplorerUndo()
			});
		}
		const draftCopies: URI[] = [];
		for (const draft of drafts) {
			draftCopies.push(await this.view.generationCardActions.copyDraft(draft.stat.resource, folder.resource, localize('basehalf.canvas.duplicate.draftUndo', "Duplicate {0}", draft.name)));
		}
		const paths = [...copies.map(copy => copy.target), ...draftCopies].map(target => baseHalfCanvasChildPath(folder.relativePath, basename(target)));
		this.queueCanvasSelection(sceneKey, paths, postCreateOwner);
		this.view.requestRender();
	}

	/** Whether a store inside the folder lists another item of the same folder as upstream. */
	private folderHasInternalUpstream(workspaceFolder: URI, folderPath: string): boolean {
		const state = this.view.referenceIndexService.getState(workspaceFolder);
		if (state === undefined || state === 'building') {
			return false;
		}
		const identity = this.view.upstreamIdentity(workspaceFolder);
		const prefix = identity.key(folderPath);
		const inside = (path: string) => {
			let current = path;
			while (current.includes('/')) {
				current = current.slice(0, current.lastIndexOf('/'));
				if (identity.key(current) === prefix) {
					return true;
				}
			}
			return false;
		};
		return this.view.referenceIndexService.getStores(workspaceFolder).some(store => inside(store.node.relativePath)
			&& (store.sidecarState === undefined || store.sidecarState === 'active')
			&& store.read.items.some(item => item.path !== undefined && inside(item.path)));
	}

	private async deleteSceneSelection(
		sceneKey: string,
		structuralEpoch: number,
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[]
	): Promise<void> {
		// A draft has no file to move to the Trash: it is deleted with all of its
		// card information, as a step that undo takes back (generation cards, "Deleting").
		const drafts = items.filter(item => item.generation?.draft);
		const files = items.filter(item => !item.generation?.draft);
		const useTrash = files.length > 0
			&& this.view.configurationService.getValue<boolean>('files.enableTrash')
			&& files.every(item => this.view.fileService.hasCapability(item.stat.resource, FileSystemProviderCapabilities.Trash));
		const names = items.map(item => item.name);
		const selectionLabel = items.length === 1
			? localize('basehalf.canvas.selection.deleteOne.label', "'{0}'", names[0])
			: localize('basehalf.canvas.selection.deleteMany.label', "{0} selected items", items.length);
		const scopeDetail = items.some(item => item.kind === 'folder')
			? localize('basehalf.canvas.selection.deleteFolder.scopeUpstream', "Selected folders include all their contents. Other project files are not changed.")
			: localize('basehalf.canvas.selection.deleteFile.scopeUpstream', "Other project files are not changed.");
		const recoveryDetail = files.length === 0
			? localize('basehalf.canvas.selection.deleteDrafts.recovery', "You can undo this.")
			: useTrash
				? localize('basehalf.canvas.selection.deleteTrash.recovery', "You can restore the selected items from the Trash.")
				: localize('basehalf.canvas.selection.deletePermanent.recovery', "This action cannot be undone from the Trash.");
		// Deleting a node never changes another node's store: entries that name
		// it become dangling (D37). The user may remove them in one separate step.
		const impact = this.canvasDeleteImpact(folder, items);
		const impactDetail = this.canvasDeleteImpactDetail(items, impact);
		const detailParts = [impactDetail, scopeDetail, recoveryDetail].filter(part => !!part).join(' ');
		const confirmation = await this.view.dialogService.confirm({
			type: 'warning',
			message: files.length === 0
				? localize('basehalf.canvas.selection.deleteDrafts.message', "Delete {0}?", selectionLabel)
				: useTrash
					? localize('basehalf.canvas.selection.deleteTrash.message', "Move {0} to the Trash?", selectionLabel)
					: localize('basehalf.canvas.selection.deletePermanent.message', "Permanently delete {0}?", selectionLabel),
			detail: items.length === 1
				? detailParts
				: `${names.slice(0, 12).join('\n')}${names.length > 12 ? localize('basehalf.canvas.selection.delete.more', "\n+{0} more", names.length - 12) : ''}\n\n${detailParts}`,
			primaryButton: files.length === 0
				? localize('basehalf.canvas.selection.deleteDrafts.primary', "&&Delete")
				: useTrash
					? localize('basehalf.canvas.selection.deleteTrash.primary', "&&Move to Trash")
					: localize('basehalf.canvas.selection.deletePermanent.primary', "&&Delete Permanently"),
			...(impact.stores.length > 0 ? {
				checkbox: {
					label: items.length === 1
						? localize('basehalf.canvas.selection.delete.removeUpstreamOne', "Also remove {0} from their upstream lists", items[0].name)
						: localize('basehalf.canvas.selection.delete.removeUpstreamMany', "Also remove the selected items from their upstream lists"),
					checked: false
				}
			} : {})
		});
		if (!confirmation.confirmed) {
			return;
		}
		const removeUpstreamEntries = confirmation.checkboxChecked === true && impact.stores.length > 0;
		const hadActiveNote = !!this.view.activeCanvasNoteEditor;
		if (hadActiveNote && !await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
			return;
		}
		if (hadActiveNote) {
			this.view.canvasScene.select({ cardPaths: [] });
		}
		await this.resolveSceneSelection(sceneKey, structuralEpoch, items.map(item => item.path));
		if (drafts.length) {
			await this.view.generationCardActions.deleteDrafts(drafts.map(item => item.stat.resource));
		}
		const apply = (permanently: boolean) => this.view.canvasResourceDeletionService.delete(files.map(item => ({
			resource: item.stat.resource,
			folder: item.kind === 'folder',
			maxSize: BASEHALF_CANVAS_SELECTION_UNDO_FILE_SIZE
		})), {
			permanently,
			undoLabel: files.length === 1
				? localize('basehalf.canvas.selection.delete.undoOne', "Delete {0}", files[0].name)
				: localize('basehalf.canvas.selection.delete.undoMany', "Delete {0} items", files.length),
			progressLabel: files.length === 1
				? localize('basehalf.canvas.selection.delete.progressOne', "Deleting {0}", files[0].name)
				: localize('basehalf.canvas.selection.delete.progressMany', "Deleting {0} items", files.length),
			confirmBeforeUndo: this.view.creation.confirmExplorerUndo()
		});

		if (files.length === 0) {
			// Nothing goes to the Trash.
		} else if (!useTrash) {
			await apply(true);
		} else {
			try {
				await apply(false);
			} catch (error) {
				const fallback = await this.view.dialogService.confirm({
					type: 'warning',
					message: localize('basehalf.canvas.selection.trashFailed', "The Trash operation failed. Permanently delete {0}?", selectionLabel),
					detail: error instanceof Error ? error.message : String(error),
					primaryButton: localize('basehalf.canvas.selection.deletePermanent.primary', "&&Delete Permanently")
				});
				if (!fallback.confirmed) {
					return;
				}
				await this.resolveSceneSelection(sceneKey, structuralEpoch, files.map(item => item.path));
				await apply(true);
			}
		}
		this.view.canvasScene.select({ cardPaths: [] });
		if (removeUpstreamEntries) {
			await this.removeDeletedUpstreamEntries(folder, items, impact.stores);
		}
		this.view.requestRender();
	}

	/**
	 * The downstream stores that name the items about to be deleted. While the
	 * index is building the answer is unknown; while it is partial it is a
	 * lower bound.
	 */
	private canvasDeleteImpact(folder: IBaseHalfCanvasFolderState, items: readonly IBaseHalfCanvasItem[]): {
		readonly state: BaseHalfReferenceIndexState | undefined;
		readonly stores: readonly IBaseHalfCanvasDeleteImpactStore[];
	} {
		const state = this.view.referenceIndexService.getState(folder.workspaceFolder);
		if (state === undefined || state === 'building') {
			return { state, stores: [] };
		}
		return {
			state,
			stores: baseHalfCanvasDeleteImpact(
				// A sealed or imported Result artifact keeps the bytes its node
				// pins: its entries are never removed, so it is not offered.
				this.view.referenceIndexService.getStores(folder.workspaceFolder).filter(store => !this.view.referenceIndexService.getUpstreamOnlyReason(store.node)),
				items.map(item => item.path),
				this.view.upstreamIdentity(folder.workspaceFolder)
			)
		};
	}

	private canvasDeleteImpactDetail(
		items: readonly IBaseHalfCanvasItem[],
		impact: { readonly state: BaseHalfReferenceIndexState | undefined; readonly stores: readonly IBaseHalfCanvasDeleteImpactStore[] }
	): string {
		if (impact.state === 'building') {
			return localize('basehalf.canvas.selection.delete.checkingConnections', "Checking connections…");
		}
		const count = impact.stores.length;
		if (count === 0) {
			return '';
		}
		if (items.length > 1) {
			if (count === 1) {
				return impact.state === 'partial'
					? localize('basehalf.canvas.selection.delete.manyUpstreamOfAtLeastOne', "The selected items are upstream of at least 1 item. It will show a broken upstream entry that you can fix later.")
					: localize('basehalf.canvas.selection.delete.manyUpstreamOfOne', "The selected items are upstream of 1 item. It will show a broken upstream entry that you can fix later.");
			}
			return impact.state === 'partial'
				? localize('basehalf.canvas.selection.delete.manyUpstreamOfAtLeast', "The selected items are upstream of at least {0} items. They will show a broken upstream entry that you can fix later.", count)
				: localize('basehalf.canvas.selection.delete.manyUpstreamOf', "The selected items are upstream of {0} items. They will show a broken upstream entry that you can fix later.", count);
		}
		const name = items[0].name;
		if (impact.state === 'partial') {
			return count === 1
				? localize('basehalf.canvas.selection.delete.upstreamOfAtLeastOne', "{0} is upstream of at least 1 item. It will show a broken upstream entry that you can fix later.", name)
				: localize('basehalf.canvas.selection.delete.upstreamOfAtLeast', "{0} is upstream of at least {1} items. They will show a broken upstream entry that you can fix later.", name, count);
		}
		return count === 1
			? localize('basehalf.canvas.selection.delete.upstreamOfOne', "{0} is upstream of 1 item. It will show a broken upstream entry that you can fix later.", name)
			: localize('basehalf.canvas.selection.delete.upstreamOf', "{0} is upstream of {1} items. They will show a broken upstream entry that you can fix later.", name, count);
	}

	/**
	 * "Also remove <name> from their upstream lists": one bulk edit after the
	 * delete, as a separate canvas undo step.
	 */
	private async removeDeletedUpstreamEntries(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		stores: readonly IBaseHalfCanvasDeleteImpactStore[]
	): Promise<void> {
		const label = items.length === 1
			? localize('basehalf.canvas.selection.delete.removeUpstreamUndoOne', "Remove {0} from upstream lists", items[0].name)
			: localize('basehalf.canvas.selection.delete.removeUpstreamUndoMany', "Remove {0} items from upstream lists", items.length);
		const identity = this.view.upstreamIdentity(folder.workspaceFolder);
		const edits: IBaseHalfReferenceStoreEdit[] = [];
		for (const store of stores) {
			if (store.entries.length === 1) {
				edits.push({ node: store.node, operation: { kind: 'remove', entry: store.entries[0].path } });
				continue;
			}
			// One store may change only once per operation: remove all of its
			// entries that name deleted items in one transition.
			const snapshot = await this.view.referenceEditService.readSnapshot(store.node);
			if (!snapshot) {
				continue;
			}
			const removed = new Set(store.entries.map(entry => identity.key(entry.path)));
			edits.push({
				node: store.node,
				operation: {
					kind: 'transition',
					from: snapshot,
					to: {
						items: snapshot.items.filter(item => !(item.scalar && removed.has(identity.key(baseHalfNormalizeUpstreamEntry(item.text)))))
					}
				}
			});
		}
		if (edits.length === 0) {
			return;
		}
		const target = this.view.workspaceNode(folder.workspaceFolder, stores[0].node.relativePath, 'file');
		await this.view.upstreamActions.run(label, target, this.view.connections.upstreamActionContext(folder, () => this.view.renderer.scheduleBackgroundRender()), () => this.view.referenceEditService.apply(edits, { label }));
	}

	showSceneContextMenu(
		sceneKey: string,
		structuralEpoch: number,
		request: BaseHalfCanvasSceneContextMenuRequest,
		createPosition?: { readonly x: number; readonly y: number },
		createPositionComputed?: boolean
	): void {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		this.view.markCanvasUserInteraction();
		if (request.kind === 'edge') {
			mainWindow.setTimeout(() => {
				const current = this.view.getCurrentFolder();
				const edge = this.view.renderedSceneEdges.find(candidate => candidate.id === request.edge.id);
				if (this.view.disposed || !current || this.view.sceneKey(current) !== sceneKey || !edge
					|| !this.view.workspaceMutationCoordinator.isStampCurrent(current.workspaceFolder, this.view.sceneMutationStamp(current, structuralEpoch))) {
					return;
				}
				this.view.lastCanvasContextMenu = undefined;
				// An edge into a sealed or imported Result artifact can't be
				// disconnected: BaseHalf never changes that file's bytes.
				const upstreamOnly = !!this.view.referenceIndexService.getUpstreamOnlyReason(this.view.workspaceNode(current.workspaceFolder, edge.to, edge.toKind));
				this.view.contextMenuService.showContextMenu({
					getAnchor: () => request.anchor,
					getActions: () => [toAction({
						id: 'basehalf.canvas.disconnectSelection',
						label: localize('basehalf.canvas.edge.disconnect', "Disconnect"),
						enabled: !upstreamOnly,
						run: () => this.view.connections.removeEdgeFromScene(sceneKey, structuralEpoch, edge)
					})],
					onHide: wasCancelled => {
						if (wasCancelled) {
							this.view.cards.focus({ preventScroll: true });
						}
					}
				});
			}, 0);
			return;
		}
		const item = request.kind === 'card' ? this.view.renderedItemsByPath.get(request.path) : undefined;
		const resource = item?.stat.resource ?? (request.kind === 'pane' ? folder.resource : undefined);
		const relativePath = item?.path ?? folder.relativePath;
		if (!resource) {
			return;
		}

		mainWindow.setTimeout(async () => {
			const current = this.view.getCurrentFolder();
			if (this.view.disposed || !current || this.view.sceneKey(current) !== sceneKey
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(current.workspaceFolder, this.view.sceneMutationStamp(current, structuralEpoch))) {
				return;
			}
			let context: IBaseHalfCanvasActionContext;
			try {
				context = await this.view.canvasActionContextService.capture(resource, folder.workspaceFolder, relativePath);
			} catch (error) {
				this.view.logService.warn(error);
				return;
			}
			const latest = this.view.getCurrentFolder();
			if (this.view.disposed || !latest || this.view.sceneKey(latest) !== sceneKey
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(latest.workspaceFolder, this.view.sceneMutationStamp(latest, structuralEpoch))) {
				return;
			}
			this.view.lastCanvasContextMenu = { context, request, createPosition, createPositionComputed };
			const menuId = request.kind === 'card' ? BASEHALF_CANVAS_CARD_CONTEXT_MENU : BASEHALF_CANVAS_PANE_CONTEXT_MENU;
			this.view.contextMenuService.showContextMenu({
				menuId,
				menuActionOptions: { arg: context },
				// The menu of a draft offers only what works without a file.
				...(request.kind === 'card' ? { contextKeyService: this.view.contextKeyService.createOverlay([[BASEHALF_CANVAS_CARD_IS_DRAFT.key, context.snapshot.draft === true]]) } : {}),
				getAnchor: () => request.anchor,
				onHide: wasCancelled => {
					if (wasCancelled) {
						this.view.cards.focus({ preventScroll: true });
					}
				}
			});
		}, 0);
	}

	showCanvasCreateMenu(anchor: HTMLElement): void {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		const structuralStamp = this.view.workspaceMutationCoordinator.capture(folder.workspaceFolder);
		const anchorRect = anchor.getBoundingClientRect();
		const surfaceRect = this.view.surface.getBoundingClientRect();
		this.showSceneContextMenu(
			this.view.sceneKey(folder),
			structuralStamp.structuralEpoch,
			{ kind: 'pane', anchor: { x: anchorRect.right, y: anchorRect.bottom } },
			{ x: surfaceRect.left + surfaceRect.width / 2, y: surfaceRect.top + surfaceRect.height / 2 },
			true
		);
	}

	selectCanvasResources(folderResource: URI, resources: readonly URI[]): void {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.canvasNavigationService.state.cardDetail
			|| !this.view.uriIdentityService.extUri.isEqual(folder.resource, folderResource)) {
			return;
		}
		const paths = resources
			.filter(resource => this.view.uriIdentityService.extUri.isEqual(dirname(resource), folder.resource))
			.map(resource => baseHalfCanvasChildPath(folder.relativePath, basename(resource)));
		if (paths.length === 0) {
			return;
		}
		this.queueCanvasSelection(this.view.sceneKey(folder), paths);
		// The user just created these cards. A card that nobody pointed at is at
		// the end of the canvas, which can be out of sight: it is shown to them.
		this.view.pendingCanvasReveal = { sceneKey: this.view.sceneKey(folder), paths, owner: this.view.captureCanvasPostCreateOwner() };
		this.view.requestRender();
	}

	/**
	 * Pick on Canvas: the next click on a card picks it, as the Video panel
	 * picks a card to connect to its node (IBaseHalfCanvasView.pickCard). The
	 * gesture of that click never reaches the canvas, so it selects or moves
	 * nothing; the scene leaves dragging and resizing while the cards element
	 * is marked. A click on the blank canvas or Escape cancels; a click on
	 * `exceptPath` or on a folder keeps waiting.
	 */
	pickCanvasCard(exceptPath: string): Promise<string | undefined> {
		this.cancelCanvasCardPick();
		return new Promise<string | undefined>(resolve => {
			const store = new DisposableStore();
			const pick = {
				store,
				finish: (path: string | undefined) => {
					if (this.canvasCardPick !== pick) {
						return;
					}
					this.canvasCardPick = undefined;
					store.dispose();
					resolve(path);
				}
			};
			this.canvasCardPick = pick;
			// The panel says what the next click does, where the user chose Pick on Canvas.
			this.view.cards.dataset.videoInputPickActive = 'true';
			store.add(toDisposable(() => delete this.view.cards.dataset.videoInputPickActive));
			let pressedPath: string | undefined | null = null;
			const onPointer = (event: Event): void => {
				const target = event.target;
				if (!DOM.isHTMLElement(target) && !DOM.isSVGElement(target)) {
					return;
				}
				if (!this.view.cards.contains(target) || target.closest('.bh-video-panel')) {
					return;
				}
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.type === 'pointerdown') {
					pressedPath = target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]')?.dataset.basehalfCardPath;
					return;
				}
				if (event.type !== 'click' || pressedPath === null) {
					return;
				}
				const path = pressedPath;
				pressedPath = null;
				if (path === undefined) {
					pick.finish(undefined);
				} else if (path !== exceptPath && this.view.renderedItemsByPath.get(path)?.stat.isDirectory !== true) {
					pick.finish(path);
				}
			};
			const targetDocument = this.view.cards.ownerDocument;
			for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
				store.add(DOM.addDisposableListener(targetDocument, type, onPointer, true));
			}
			store.add(DOM.addDisposableListener(targetDocument, 'keydown', event => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopImmediatePropagation();
					pick.finish(undefined);
				}
			}, true));
		});
	}

	cancelCanvasCardPick(): void {
		this.canvasCardPick?.finish(undefined);
	}

	selectCard(path: string): void {
		const expected = this.currentPostCreateSelectionPaths();
		if (!expected || this.canvasSelectionSupersedesPostCreate([path])) {
			this.view.markCanvasUserInteraction();
		}
		this.view.canvasScene.select({ cardPaths: [path] });
	}

	/**
	 * Tells the record of the selection agents can see what is selected now:
	 * the folder of the canvas, its selected cards, the card Card Detail
	 * shows, and the text selected in the note being edited.
	 */
	reportAgentSelection(): void {
		if (this.view.disposed) {
			return;
		}
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			this.view.agentSelectionService.update(undefined);
			return;
		}
		const detail = this.view.canvasNavigationService.state.cardDetail;
		const sceneKey = this.view.sceneKey(folder);
		// In the canvas's list order: folders first, then by name.
		const cards = (this.view.agentSelectionCards.sceneKey === sceneKey ? this.view.agentSelectionCards.paths : [])
			.map(path => {
				const item = this.view.renderedItemsByPath.get(path);
				return { path, isFolder: item?.kind === 'folder', name: item?.name ?? path.slice(path.lastIndexOf('/') + 1), caption: this.agentSelectionCaption(path), draft: item?.generation?.draft === true };
			})
			.sort((a, b) => a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.localeCompare(b.name))
			// A draft is recorded by the path its file will have, and says it is one.
			.map(({ path, isFolder, caption, draft }) => ({ path, isFolder, caption, ...(draft ? { draft: true as const } : {}) }));
		let text: IBaseHalfAgentSelectionText | undefined;
		if (detail) {
			const detailText = this.view.activeDetailProjection ? this.view.agentSelectionDetailText.get(this.view.activeDetailProjection) : undefined;
			text = detailText?.path === detail.relativePath ? detailText : undefined;
		} else {
			const cardText = this.view.agentSelectionCardText;
			text = cardText && this.view.activeCanvasNoteEditor?.path === cardText.path ? cardText : undefined;
		}
		const workspaceFolder = this.view.workspaceContextService.getWorkspaceFolder(folder.workspaceFolder);
		this.view.agentSelectionService.update({
			workspaceFolder: folder.workspaceFolder,
			workspaceFolderName: workspaceFolder?.name ?? basename(folder.workspaceFolder),
			folderPath: folder.relativePath || '.',
			cards,
			detail: detail && this.view.uriIdentityService.extUri.isEqual(detail.workspaceFolder, folder.workspaceFolder) ? { path: detail.relativePath, isFolder: false, caption: this.agentSelectionCaption(detail.relativePath) } : undefined,
			text
		});
	}

	/** The name and glyph a card's caption shows, while the canvas has the card. */
	private agentSelectionCaption(path: string): IBaseHalfAgentSelectionCaption | undefined {
		const item = this.view.renderedItemsByPath.get(path);
		if (!item) {
			return undefined;
		}
		return { name: cardDisplayName(item), icon: badgeType(item.name, item.kind === 'folder') };
	}
}
