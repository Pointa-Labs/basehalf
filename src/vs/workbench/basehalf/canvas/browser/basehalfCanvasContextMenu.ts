/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname } from '../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId, Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID, IBaseHalfCanvasEditingService } from '../common/basehalfCanvasEditing.js';
import { BASEHALF_CANVAS_CARD_IS_DRAFT, IBaseHalfCanvasActionContextService, isBaseHalfCanvasActionContext } from '../common/basehalfCanvasActionContext.js';
import { BaseHalfGenerationKind } from '../../generation/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardActions } from '../../generation/common/basehalfVideoGeneration.js';
import { IBaseHalfKeptVersionsService } from '../../upkeep/browser/basehalfKeptVersions.js';
import { COPY_PATH_COMMAND_ID, COPY_RELATIVE_PATH_COMMAND_ID, REVEAL_IN_EXPLORER_COMMAND_ID } from '../../../contrib/files/browser/fileConstants.js';
export const BASEHALF_CANVAS_CARD_CONTEXT_MENU = MenuId.for('BaseHalfCanvasCardContext');
export const BASEHALF_CANVAS_PANE_CONTEXT_MENU = MenuId.for('BaseHalfCanvasPaneContext');

const BASEHALF_CANVAS_OPEN_COMMAND_ID = 'basehalf.canvas.openResource';
/** New Image, New Video, and New Audio of the canvas menu (generation cards, "Creating a generation card"). */
export const BASEHALF_CANVAS_NEW_IMAGE_COMMAND_ID = 'basehalf.canvas.newImage';
export const BASEHALF_CANVAS_NEW_VIDEO_COMMAND_ID = 'basehalf.canvas.newVideo';
export const BASEHALF_CANVAS_NEW_AUDIO_COMMAND_ID = 'basehalf.canvas.newAudio';
const BASEHALF_CANVAS_NEW_FOLDER_COMMAND_ID = 'basehalf.canvas.newFolder';
const BASEHALF_CANVAS_PASTE_COMMAND_ID = 'basehalf.canvas.paste';
const BASEHALF_CANVAS_IMPORT_COMMAND_ID = 'basehalf.canvas.importFiles';
const BASEHALF_CANVAS_RENAME_COMMAND_ID = 'basehalf.canvas.renameResource';
const BASEHALF_CANVAS_DELETE_COMMAND_ID = 'basehalf.canvas.moveResourceToTrash';
const BASEHALF_CANVAS_REVEAL_COMMAND_ID = 'basehalf.canvas.revealInFiles';
const BASEHALF_CANVAS_COPY_PATH_COMMAND_ID = 'basehalf.canvas.copyPath';
const BASEHALF_CANVAS_COPY_RELATIVE_PATH_COMMAND_ID = 'basehalf.canvas.copyRelativePath';
const BASEHALF_CANVAS_CUT_COMMAND_ID = 'basehalf.canvas.cut';
const BASEHALF_CANVAS_COPY_COMMAND_ID = 'basehalf.canvas.copy';
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
		const editingService = accessor.get(IBaseHalfCanvasEditingService);
		await actionContextService.assertCurrent(argument);
		if (argument.snapshot.draft) {
			// A draft has no file to open: its card is selected, and its panel shows.
			await editingService.requestSelection(dirname(argument.resource), [argument.resource]);
			return;
		}
		await navigationService.openResource(argument.resource, { source: 'api', pinned: true });
	}
});

registerAction2(class BaseHalfCanvasNewNoteAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newNote', "New Note"),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		const editingService = accessor.get(IBaseHalfCanvasEditingService);
		if (!isBaseHalfCanvasActionContext(argument)) {
			await editingService.requestCreate(undefined, 'note');
			return;
		}
		await editingService.requestCreate(argument, 'note');
	}
});

function registerBaseHalfCanvasNewDraftAction(id: string, title: ReturnType<typeof localize2>, kind: BaseHalfGenerationKind, order: number): void {
	registerAction2(class BaseHalfCanvasNewDraftAction extends Action2 {
		constructor() {
			super({
				id,
				title,
				menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order }
			});
		}

		override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
			await accessor.get(IBaseHalfCanvasEditingService).requestCreate(isBaseHalfCanvasActionContext(argument) ? argument : undefined, kind);
		}
	});
}

registerBaseHalfCanvasNewDraftAction(BASEHALF_CANVAS_NEW_IMAGE_COMMAND_ID, localize2('basehalf.canvas.context.newImage', "New Image"), 'image', 12);
registerBaseHalfCanvasNewDraftAction(BASEHALF_CANVAS_NEW_VIDEO_COMMAND_ID, localize2('basehalf.canvas.context.newVideo', "New Video"), 'video', 14);
registerBaseHalfCanvasNewDraftAction(BASEHALF_CANVAS_NEW_AUDIO_COMMAND_ID, localize2('basehalf.canvas.context.newAudio', "New Audio"), 'audio', 16);

// New Folder makes `untitled folder` at once. The canvas makes no file from a
// typed name: files of other kinds are made in Files (canvas Create menu).
registerAction2(class BaseHalfCanvasNewFolderAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_FOLDER_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newFolder', "New Folder"),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order: 30 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (isBaseHalfCanvasActionContext(argument)) {
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await editingService.requestCreate(argument, 'folder');
		}
	}
});

registerAction2(class BaseHalfCanvasPasteAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_PASTE_COMMAND_ID,
			title: localize2('basehalf.canvas.context.paste', "Paste"),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '5_transfer', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		await accessor.get(IBaseHalfCanvasEditingService).requestPaste(argument);
	}
});

registerAction2(class BaseHalfCanvasImportAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_IMPORT_COMMAND_ID,
			title: localize2('basehalf.canvas.context.importFiles', "Import Files..."),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '5_transfer', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		await accessor.get(IBaseHalfCanvasEditingService).requestImport(argument);
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
			await editingService.requestRename(argument);
		}
	}
});

registerAction2(class BaseHalfCanvasDeleteResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_DELETE_COMMAND_ID,
			// A delete asks nothing: one undo brings back what it took (exact undo, "Deleting").
			title: localize2('basehalf.canvas.context.delete', "Delete"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '7_modification', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
		const generationCardActions = accessor.get(IBaseHalfGenerationCardActions);
		const keptVersions = accessor.get(IBaseHalfKeptVersionsService);
		await actionContextService.assertCurrent(argument);
		if (argument.snapshot.draft) {
			// A draft goes with all of its card information (generation cards, "Deleting").
			await generationCardActions.deleteDrafts([argument.resource]);
			return;
		}
		await keptVersions.deleteItems([argument.resource], { label: localize('basehalf.canvas.delete.undo', "Delete {0}", basename(argument.resource)) });
	}
});

registerAction2(class BaseHalfCanvasRevealResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_REVEAL_COMMAND_ID,
			title: localize2('basehalf.canvas.context.revealInFiles', "Reveal in Files"),
			// A draft is not in Files.
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '2_files', order: 10, when: BASEHALF_CANVAS_CARD_IS_DRAFT.negate() }
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

registerAction2(class BaseHalfCanvasCutResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_CUT_COMMAND_ID,
			title: localize2('basehalf.canvas.context.cut', "Cut"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '5_cutcopypaste', order: 10 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		// The selected cards, when this card is one of them, as in a file manager (copy, paste, and drop).
		await accessor.get(IBaseHalfCanvasEditingService).requestCopy(argument, true);
	}
});

registerAction2(class BaseHalfCanvasCopyResourceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_COPY_COMMAND_ID,
			title: localize2('basehalf.canvas.context.copy', "Copy"),
			menu: { id: BASEHALF_CANVAS_CARD_CONTEXT_MENU, group: '5_cutcopypaste', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (!isBaseHalfCanvasActionContext(argument)) {
			return;
		}
		// The selected cards, when this card is one of them, as in a file manager (copy, paste, and drop).
		await accessor.get(IBaseHalfCanvasEditingService).requestCopy(argument, false);
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
