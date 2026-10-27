/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basename, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../../../contrib/files/common/files.js';
import { IWorkingCopyFileService } from '../../../../services/workingCopy/common/workingCopyFileService.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasFolderDrops, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { baseHalfCanvasFreeTransferTarget, baseHalfCanvasMoveTarget } from '../../../canvas/browser/view/basehalfCanvasViewShared.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../../canvas/common/basehalfCanvasEditing.js';
import { baseHalfPathHoldsDraft } from '../../../video/common/basehalfGenerationDraft.js';
import { baseHalfGenerationKindOfPath, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardActions, IBaseHalfGenerationCardStore } from '../../../video/common/basehalfVideoGeneration.js';
import { IBaseHalfKeptVersionsService } from '../../../workspace/browser/basehalfKeptVersions.js';

interface IBaseHalfFolderDropTransfer {
	readonly source: URI;
	readonly target: URI;
}

/**
 * The move of files and folders into a folder, as a step of the canvas undo:
 * undo moves them back and redo moves them again, and the mirror cascade
 * carries their card information both ways, as for any move in the workbench.
 */
class BaseHalfFolderDropUndoElement implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly code = 'basehalf.canvas.folderDrop';
	readonly resources: readonly URI[];

	constructor(
		readonly label: string,
		private readonly moves: readonly IBaseHalfFolderDropTransfer[],
		private readonly workingCopyFileService: IWorkingCopyFileService,
		readonly confirmBeforeUndo: boolean
	) {
		this.resources = moves.flatMap(move => [move.source, move.target]);
	}

	async undo(): Promise<void> {
		await this.workingCopyFileService.move(this.moves.map(move => ({ file: { source: move.target, target: move.source }, overwrite: false })), CancellationToken.None, { isUndoing: true });
	}

	async redo(): Promise<void> {
		await this.workingCopyFileService.move(this.moves.map(move => ({ file: { source: move.source, target: move.target }, overwrite: false })), CancellationToken.None, { isUndoing: false });
	}
}

/**
 * Dropping into a folder (docs/specs/canvas-drop-into-folder.md): what the
 * user lets go on a folder goes into it. Cards of the canvas and items from
 * Files move, files from outside the window are copied. A move is one step of
 * the canvas undo, drafts included, and a name the folder holds is kept
 * beside it, with a number after the moved item's name.
 */
export class BaseHalfCanvasFolderDrop extends Disposable implements IBaseHalfCanvasContribution, IBaseHalfCanvasFolderDrops {
	static readonly ID = 'basehalf.canvas.folderDrop';

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IBaseHalfGenerationCardStore private readonly generationCardStore: IBaseHalfGenerationCardStore,
		@IBaseHalfGenerationCardActions private readonly generationCardActions: IBaseHalfGenerationCardActions,
		@IBaseHalfKeptVersionsService private readonly keptVersions: IBaseHalfKeptVersionsService
	) {
		super();
		this._register(context.canvas.takeFolderDrops(this));
	}

	async drop(resources: readonly URI[], folder: URI, operation: 'move' | 'copy'): Promise<void> {
		const extUri = this.uriIdentityService.extUri;
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(folder)?.uri;
		if (!workspaceFolder) {
			throw new Error(localize('basehalf.canvas.folderDrop.notOpen', "{0} is not in a folder that is open.", basename(folder)));
		}
		// Two items of one drop never take the same name, and none takes a draft's.
		const reserved = new Set<string>();
		const isTaken = async (candidate: URI) => reserved.has(extUri.getComparisonKey(candidate)) || await this.isDraftPath(workspaceFolder, candidate);
		const configuredNaming = this.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
		const copyNaming = configuredNaming === 'disabled' ? 'smart' : configuredNaming;
		const moves: IBaseHalfFolderDropTransfer[] = [];
		const drafts: IBaseHalfFolderDropTransfer[] = [];
		const copies: IBaseHalfFolderDropTransfer[] = [];
		for (const source of new Map(resources.map(resource => [extUri.getComparisonKey(resource), resource])).values()) {
			// An item that is in the folder already stays where it is.
			if (extUri.isEqual(extUri.dirname(source), folder)) {
				continue;
			}
			if (extUri.isEqualOrParent(folder, source)) {
				throw new Error(localize('basehalf.canvas.folderDrop.intoItself', "{0} cannot go into itself or into one of its own folders.", basename(source)));
			}
			if (operation === 'move' && !extUri.isEqual(this.workspaceContextService.getWorkspaceFolder(source)?.uri, workspaceFolder)) {
				throw new Error(localize('basehalf.canvas.folderDrop.otherRoot', "Moving an item between workspace folders is not supported, because upstream lists can only name items in their own workspace folder."));
			}
			const stat = await this.fileService.stat(source).catch(() => undefined);
			if (!stat) {
				// A draft has no file. It keeps its name where that is free and takes
				// the next free number otherwise (generation cards, "Moving,
				// renaming, copying, and undo").
				if (operation === 'move' && await this.isDraftPath(workspaceFolder, source)) {
					const { base, extension } = baseHalfGenerationNameParts(basename(source));
					const name = await this.generationCardStore.nextFreeName(folder, base, extension, baseHalfGenerationNameOrdinal(basename(source)));
					reserved.add(extUri.getComparisonKey(joinPath(folder, name)));
					drafts.push({ source, target: joinPath(folder, name) });
					continue;
				}
				throw new Error(localize('basehalf.canvas.folderDrop.missing', "{0} is not there any more.", basename(source)));
			}
			// A copy is named as Duplicate names it; a moved item keeps both names.
			const target = operation === 'move'
				? await baseHalfCanvasMoveTarget(this.fileService, folder, source, stat.isDirectory, isTaken)
				: await baseHalfCanvasFreeTransferTarget(this.fileService, this.dialogService, folder, source, stat.isDirectory, false, copyNaming, isTaken);
			if (target) {
				reserved.add(extUri.getComparisonKey(target));
				(operation === 'move' ? moves : copies).push({ source, target });
			}
		}

		const undoRedoGroup = new UndoRedoGroup();
		if (copies.length > 0) {
			await this.workingCopyFileService.copy(copies.map(copy => ({ file: { source: copy.source, target: copy.target }, overwrite: false })), CancellationToken.None);
			this.keptVersions.recordMade(copies.map(copy => copy.target), {
				label: copies.length === 1
					? localize('basehalf.canvas.folderDrop.copyOne', "Import {0}", basename(copies[0].target))
					: localize('basehalf.canvas.folderDrop.copyMany', "Import {0} items", copies.length),
				undoRedoGroup
			});
		}
		// One step holds the drafts and the files: the drafts' moves join the
		// group first, and the step of the files names the whole drop.
		for (const draft of drafts) {
			await this.generationCardActions.moveDraft(draft.source, draft.target, undoRedoGroup);
		}
		if (moves.length > 0) {
			await this.workingCopyFileService.move(moves.map(move => ({ file: { source: move.source, target: move.target }, overwrite: false })), CancellationToken.None);
			const count = moves.length + drafts.length;
			const label = count === 1
				? localize('basehalf.canvas.folderDrop.moveOne', "Move {0} to {1}", basename(moves[0].target), basename(folder))
				: localize('basehalf.canvas.folderDrop.moveMany', "Move {0} items to {1}", count, basename(folder));
			const confirm = this.configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose;
			this.undoRedoService.pushElement(new BaseHalfFolderDropUndoElement(label, moves, this.workingCopyFileService, confirm), undoRedoGroup, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		}
	}

	/** Whether a path holds a draft, whose name is taken as an item's is. */
	private async isDraftPath(workspaceFolder: URI, resource: URI): Promise<boolean> {
		const relativePath = this.uriIdentityService.extUri.relativePath(workspaceFolder, resource);
		return !!relativePath && baseHalfGenerationKindOfPath(relativePath) !== undefined
			&& await baseHalfPathHoldsDraft(this.fileService, workspaceFolder, relativePath);
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasFolderDrop.ID, BaseHalfCanvasFolderDrop);
