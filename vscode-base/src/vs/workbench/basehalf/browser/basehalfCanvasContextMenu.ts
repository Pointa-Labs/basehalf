/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { ResourceFileEdit } from '../../../editor/browser/services/bulkEditService.js';
import { localize, localize2 } from '../../../nls.js';
import { MenuId, Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasEditingService } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContextService, isBaseHalfCanvasActionContext } from '../common/basehalfCanvasActionContext.js';
import { COPY_PATH_COMMAND_ID, COPY_RELATIVE_PATH_COMMAND_ID, REVEAL_IN_EXPLORER_COMMAND_ID } from '../../contrib/files/browser/fileConstants.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../contrib/files/common/files.js';

export const BASEHALF_CANVAS_CARD_CONTEXT_MENU = MenuId.for('BaseHalfCanvasCardContext');
export const BASEHALF_CANVAS_PANE_CONTEXT_MENU = MenuId.for('BaseHalfCanvasPaneContext');

const BASEHALF_CANVAS_OPEN_COMMAND_ID = 'basehalf.canvas.openResource';
const BASEHALF_CANVAS_NEW_FILE_COMMAND_ID = 'basehalf.canvas.newFile';
const BASEHALF_CANVAS_NEW_FOLDER_COMMAND_ID = 'basehalf.canvas.newFolder';
const BASEHALF_CANVAS_RENAME_COMMAND_ID = 'basehalf.canvas.renameResource';
const BASEHALF_CANVAS_DELETE_COMMAND_ID = 'basehalf.canvas.moveResourceToTrash';
const BASEHALF_CANVAS_REVEAL_COMMAND_ID = 'basehalf.canvas.revealInFiles';
const BASEHALF_CANVAS_COPY_PATH_COMMAND_ID = 'basehalf.canvas.copyPath';
const BASEHALF_CANVAS_COPY_RELATIVE_PATH_COMMAND_ID = 'basehalf.canvas.copyRelativePath';
const MAX_UNDO_FILE_SIZE = 5_000_000;

interface IBaseHalfCanvasFileActionServices {
	readonly explorerService: IExplorerService;
	readonly configurationService: IConfigurationService;
	readonly dialogService: IDialogService;
	readonly fileService: IFileService;
	readonly actionContextService: IBaseHalfCanvasActionContextService;
}

registerAction2(class BaseHalfCanvasOpenResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_OPEN_COMMAND_ID,
			title: localize2('basehalf.canvas.context.open', "Open"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: 'navigation', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
		const navigationService = accessor.get(IBaseHalfCanvasNavigationService);
		await actionContextService.assertCurrent(argument);
		await navigationService.openResource(argument.resource, { source: 'api', pinned: true });
	}
});

registerAction2(class BaseHalfCanvasNewFileAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_FILE_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newFile', "New File..."),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (isBaseHalfCanvasActionContext(argument)) {
			const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await actionContextService.assertCurrent(argument);
			editingService.requestCreate(argument, false);
		}
	}
});

registerAction2(class BaseHalfCanvasNewFolderAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_FOLDER_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newFolder', "New Folder..."),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (isBaseHalfCanvasActionContext(argument)) {
			const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await actionContextService.assertCurrent(argument);
			editingService.requestCreate(argument, true);
		}
	}
});

registerAction2(class BaseHalfCanvasRenameResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_RENAME_COMMAND_ID,
			title: localize2('basehalf.canvas.context.rename', "Rename..."),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '7_modification', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (isBaseHalfCanvasActionContext(argument)) {
			const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await actionContextService.assertCurrent(argument);
			editingService.requestRename(argument);
		}
	}
});

registerAction2(class BaseHalfCanvasDeleteResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_DELETE_COMMAND_ID,
			title: localize2('basehalf.canvas.context.delete', "Delete..."),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '7_modification', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		const services = canvasFileActionServices(accessor);
		const stat = await services.actionContextService.assertCurrent(argument);
		const name = basename(argument.resource);
		const useTrash = services.configurationService.getValue<boolean>('files.enableTrash')
			&& services.fileService.hasCapability(argument.resource, FileSystemProviderCapabilities.Trash);
		const confirmation = await services.dialogService.confirm({
			type: 'warning',
			message: useTrash
				? stat.isDirectory
					? localize('basehalf.canvas.deleteFolder.message', "Move '{0}' and its contents to the Trash?", name)
					: localize('basehalf.canvas.deleteFile.message', "Move '{0}' to the Trash?", name)
				: stat.isDirectory
					? localize('basehalf.canvas.deleteFolderPermanently.message', "Permanently delete '{0}' and its contents?", name)
					: localize('basehalf.canvas.deleteFilePermanently.message', "Permanently delete '{0}'?", name),
			detail: useTrash
				? localize('basehalf.canvas.delete.detail', "You can restore it from the Trash.")
				: localize('basehalf.canvas.deletePermanently.detail', "This action cannot be undone from the Trash."),
			primaryButton: useTrash
				? localize('basehalf.canvas.delete.primaryButton', "&&Move to Trash")
				: localize('basehalf.canvas.deletePermanently.primaryButton', "&&Delete Permanently")
		});
		if (!confirmation.confirmed) {
			return;
		}
		const currentStat = await services.actionContextService.assertCurrent(argument);

		if (!useTrash) {
			await deleteCanvasResource(services, argument.resource, currentStat.isDirectory, true);
			return;
		}

		try {
			await deleteCanvasResource(services, argument.resource, currentStat.isDirectory, false);
		} catch (error) {
			const fallback = await services.dialogService.confirm({
				type: 'warning',
				message: isWindows
					? localize('basehalf.canvas.recycleBinFailed', "The Recycle Bin operation failed. Delete '{0}' permanently?", name)
					: localize('basehalf.canvas.trashFailed', "The Trash operation failed. Delete '{0}' permanently?", name),
				detail: error instanceof Error ? error.message : String(error),
				primaryButton: localize('basehalf.canvas.deletePermanently.primaryButton', "&&Delete Permanently")
			});
			if (!fallback.confirmed) {
				return;
			}
			await services.actionContextService.assertCurrent(argument);
			await deleteCanvasResource(services, argument.resource, currentStat.isDirectory, true);
		}
	}
});

registerAction2(class BaseHalfCanvasRevealResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_REVEAL_COMMAND_ID,
			title: localize2('basehalf.canvas.context.revealInFiles', "Reveal in Files"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '2_files', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
		const commandService = accessor.get(ICommandService);
		await actionContextService.assertCurrent(argument);
		await commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, argument.resource);
	}
});

registerAction2(class BaseHalfCanvasCopyPathAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_COPY_PATH_COMMAND_ID,
			title: localize2('basehalf.canvas.context.copyPath', "Copy Path"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '6_copypath', order: 10 }
		});
	}

	override run(accessor: ServicesAccessor, argument: unknown): Promise<void> | undefined {
		if (isBaseHalfCanvasActionContext(argument)) {
			return accessor.get(ICommandService).executeCommand(COPY_PATH_COMMAND_ID, argument.resource);
		}
		return undefined;
	}
});

registerAction2(class BaseHalfCanvasCopyRelativePathAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_COPY_RELATIVE_PATH_COMMAND_ID,
			title: localize2('basehalf.canvas.context.copyRelativePath', "Copy Relative Path"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '6_copypath', order: 20 }
		});
	}

	override run(accessor: ServicesAccessor, argument: unknown): Promise<void> | undefined {
		if (isBaseHalfCanvasActionContext(argument)) {
			return accessor.get(ICommandService).executeCommand(COPY_RELATIVE_PATH_COMMAND_ID, argument.resource);
		}
		return undefined;
	}
});

async function deleteCanvasResource(services: IBaseHalfCanvasFileActionServices, resource: URI, folder: boolean, permanently: boolean): Promise<void> {
	await applyCanvasFileEdit(services, [new ResourceFileEdit(resource, undefined, {
		recursive: true,
		folder,
		skipTrashBin: permanently,
		maxSize: MAX_UNDO_FILE_SIZE
	})], {
		undoLabel: localize('basehalf.canvas.delete.undo', "Delete {0}", basename(resource)),
		progressLabel: localize('basehalf.canvas.delete.progress', "Deleting {0}", basename(resource))
	});
}

async function applyCanvasFileEdit(
	services: IBaseHalfCanvasFileActionServices,
	edits: ResourceFileEdit[],
	labels: { readonly undoLabel: string; readonly progressLabel: string }
): Promise<void> {
	await services.explorerService.applyBulkEdit(edits, {
		undoLabel: labels.undoLabel,
		progressLabel: labels.progressLabel,
		confirmBeforeUndo: services.configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose
	});
}

function canvasFileActionServices(accessor: ServicesAccessor): IBaseHalfCanvasFileActionServices {
	return {
		explorerService: accessor.get(IExplorerService),
		configurationService: accessor.get(IConfigurationService),
		dialogService: accessor.get(IDialogService),
		fileService: accessor.get(IFileService),
		actionContextService: accessor.get(IBaseHalfCanvasActionContextService)
	};
}
