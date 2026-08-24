/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, isEqualOrParent, joinPath, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../base/common/errors.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize, localize2 } from '../../../nls.js';
import { MenuId, MenuRegistry, Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IBaseHalfNodeExecutionService } from './basehalfNodeExecutionService.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID, BASEHALF_CANVAS_UNDO_REDO_SOURCE, IBaseHalfCanvasEditingService, IBaseHalfCanvasPostCreateIntent } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContextService, isBaseHalfCanvasActionContext } from '../common/basehalfCanvasActionContext.js';
import { IBaseHalfCanvasMirrorService, IBaseHalfCanvasStateTransition } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfBadgeGraphService, IBaseHalfReferenceStateTransition } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfBadgeNode } from '../common/basehalfBadgeMirror.js';
import {
	BaseHalfCanvasContentKind,
	IBaseHalfCanvasRecipeInput,
	IBaseHalfCanvasRecipeRegistryService,
	baseHalfCanvasContentKindForPath,
	resolveBaseHalfCanvasRecipeParameters,
	validateBaseHalfCanvasRecipeInputs
} from '../common/basehalfCanvasRecipes.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID, IBaseHalfCanvasCreateFromTemplateCommandArguments, IBaseHalfCanvasCreateFromTemplateCommandResult, IBaseHalfCanvasTemplate, parseBaseHalfCanvasTemplate } from '../common/basehalfCanvasTemplate.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import { BASEHALF_CANVAS_RUN_NODE_COMMAND_ID, BASEHALF_NODE_DOCUMENT_EXTENSION, BASEHALF_NODE_DOCUMENT_MAX_BYTES, BaseHalfNodeJsonValue, BaseHalfNodeKind, baseHalfProjectPathKey, baseHalfProjectPathProblem, createBaseHalfNodeDocument, IBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../common/basehalfNodeDocument.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';
import { IBaseHalfCanvasResourceDeletionService } from './basehalfCanvasResourceDeletion.js';
import { COPY_PATH_COMMAND_ID, COPY_RELATIVE_PATH_COMMAND_ID, REVEAL_IN_EXPLORER_COMMAND_ID } from '../../contrib/files/browser/fileConstants.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { setExplorerFileClipboard } from '../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../contrib/files/common/files.js';

export const BASEHALF_CANVAS_CARD_CONTEXT_MENU = MenuId.for('BaseHalfCanvasCardContext');
export const BASEHALF_CANVAS_PANE_CONTEXT_MENU = MenuId.for('BaseHalfCanvasPaneContext');
export const BASEHALF_CANVAS_NEW_RESULT_NODE_MENU = MenuId.for('BaseHalfCanvasNewResultNode');

const BASEHALF_CANVAS_OPEN_COMMAND_ID = 'basehalf.canvas.openResource';
export const BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID = 'basehalf.canvas.openResultNodeContent';
const BASEHALF_CANVAS_NEW_FILE_COMMAND_ID = 'basehalf.canvas.newFile';
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
const BASEHALF_CANVAS_RESUME_TEMPLATE_SETUP_COMMAND_ID = 'basehalf.canvas.resumeTemplateSetup';
const MAX_UNDO_FILE_SIZE = 5_000_000;
const PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v1';
const MAX_PENDING_TEMPLATE_SETUPS = 32;
const MAX_PENDING_TEMPLATE_FILES = 200;

MenuRegistry.appendMenuItem(BASEHALF_CANVAS_PANE_CONTEXT_MENU, {
	submenu: BASEHALF_CANVAS_NEW_RESULT_NODE_MENU,
	title: localize2('basehalf.canvas.context.newResultNode', "New Media or Document"),
	group: '1_new',
	order: 15
});

export interface IBaseHalfPendingTemplateFile {
	readonly path: string;
	readonly digest: string;
}

export interface IBaseHalfPendingTemplateSetup {
	readonly id: string;
	readonly templateId: string;
	readonly templateLabel: string;
	readonly templateDigest: string;
	readonly files: readonly IBaseHalfPendingTemplateFile[];
	readonly workspaceFolder: string;
	readonly projectRelativePath: string;
	readonly createdAt: string;
}

interface IBaseHalfTemplateProjectFile {
	readonly path: string;
	readonly contents: VSBuffer;
}

interface IBaseHalfTemplateCanvasMutation {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly transition: IBaseHalfCanvasStateTransition;
}

interface IBaseHalfTemplateMetadataPlan {
	readonly canvases: readonly IBaseHalfTemplateCanvasMutation[];
	readonly references: readonly IBaseHalfReferenceStateTransition[];
}

interface IBaseHalfTemplateMetadataClassification extends IBaseHalfTemplateMetadataPlan {
	readonly state: 'expected' | 'next' | 'mixed';
}

class BaseHalfTemplatePartialMetadataError extends Error {
	constructor() {
		super('Some canvas setup metadata is already present while other rows are missing. Nothing was changed.');
	}
}

interface IBaseHalfPendingTemplateSetupPick extends IQuickPickItem {
	readonly setup: IBaseHalfPendingTemplateSetup;
}

registerAction2(class BaseHalfCanvasRunNodeAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_RUN_NODE_COMMAND_ID,
			title: localize2('basehalf.canvas.runNode', "Run Canvas Node")
		});
	}

	override run(accessor: ServicesAccessor, argument: unknown): Promise<IBaseHalfNodeDocument> {
		if (!URI.isUri(argument) || argument.query || argument.fragment) {
			throw new Error(localize('basehalf.canvas.runNode.uriRequired', "A workspace node URI is required."));
		}
		const workspaceFolder = accessor.get(IWorkspaceContextService).getWorkspaceFolder(argument);
		const relativePath = workspaceFolder ? getRelativePath(workspaceFolder.uri, argument) : undefined;
		if (!workspaceFolder || !relativePath || baseHalfProjectPathProblem(relativePath)
			|| !relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error(localize('basehalf.canvas.runNode.workspaceNodeRequired', "The URI must identify a node document inside the current workspace."));
		}
		return accessor.get(IBaseHalfNodeExecutionService).run({
			resource: argument,
			workspaceFolder: workspaceFolder.uri,
			relativePath
		});
	}
});

registerAction2(class BaseHalfCanvasCreateFromTemplateAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID,
			title: localize2('basehalf.canvas.createFromTemplate', "Create Canvas from Template")
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<IBaseHalfCanvasCreateFromTemplateCommandResult> {
		const commandArguments = templateCommandArguments(argument);
		const cancellationToken = commandArguments.cancellationToken ?? CancellationToken.None;
		throwIfTemplateCreationCancelled(cancellationToken);
		if (!commandArguments.templateId) {
			throw new Error(localize('basehalf.canvas.template.idRequired', "A canvas template id is required."));
		}
		const recipes = accessor.get(IBaseHalfCanvasRecipeRegistryService);
		const fileService = accessor.get(IFileService);
		const navigation = accessor.get(IBaseHalfCanvasNavigationService);
		const editing = accessor.get(IBaseHalfCanvasEditingService);
		const postCreateIntent = editing.beginPostCreateIntent();
		const canvasMirror = accessor.get(IBaseHalfCanvasMirrorService);
		const badgeGraph = accessor.get(IBaseHalfBadgeGraphService);
		const configurationService = accessor.get(IConfigurationService);
		const storageService = accessor.get(IStorageService);
		const dialogService = accessor.get(IDialogService);
		const workspaceMutationCoordinator = accessor.get(IBaseHalfWorkspaceMutationCoordinator);
		const undoRedoService = accessor.get(IUndoRedoService);
		const workingCopyService = accessor.get(IWorkingCopyService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const descriptor = recipes.getTemplate(commandArguments.templateId);
		if (!descriptor) {
			throw new Error(localize('basehalf.canvas.template.notFound', "Canvas template '{0}' is not installed.", commandArguments.templateId));
		}
		const raw = await fileService.readFile(descriptor.resource, { limits: { size: 512 * 1024 } });
		throwIfTemplateCreationCancelled(cancellationToken);
		const templateSource = raw.value.toString();
		const template = parseBaseHalfCanvasTemplate(templateSource);
		const createdKinds = new Map<string, BaseHalfCanvasContentKind>([
			...template.files.map(file => [file.path, baseHalfCanvasContentKindForPath(file.path, false)] as const),
			...template.nodes.map(node => [node.path, node.kind] as const)
		]);
		const validatedParameters = validateTemplateRecipes(template, recipes, createdKinds);

		const currentFolder = commandArguments.targetFolder
			? canvasFolderForTemplateTarget(workspaceContextService, commandArguments.targetFolder)
			: navigation.state.canvasFolder;
		if (!currentFolder) {
			throw new Error(localize('basehalf.canvas.template.noFolder', "Open a project folder before creating a canvas from a template."));
		}
		const projectName = await availableTemplateFolderName(
			fileService,
			currentFolder.resource,
			currentFolder.workspaceFolder,
			currentFolder.relativePath,
			descriptor.label
		);
		throwIfTemplateCreationCancelled(cancellationToken);
		const projectResource = joinPath(currentFolder.resource, projectName);
		const projectRelativePath = joinCanvasPath(currentFolder.relativePath, projectName);
		const nodeDocuments = new Map(template.nodes.map(node => [node.path, serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
			id: generateUuid(),
			kind: node.kind,
			title: node.title,
			role: node.role,
			prompt: node.prompt ?? '',
			...(node.recipe ? {
				recipe: {
					recipeId: node.recipe.recipeId,
					parameters: validatedParameters.get(node.path)!,
					inputBindings: node.recipe.inputBindings.map(binding => ({
						...binding,
						sourcePath: joinCanvasPath(projectRelativePath, binding.sourcePath)
					}))
				}
			} : {})
		}))]));
		const allFiles: readonly IBaseHalfTemplateProjectFile[] = [
			...template.files.map(file => ({ path: file.path, contents: VSBuffer.fromString(file.contents) })),
			...template.nodes.map(node => ({ path: node.path, contents: VSBuffer.fromString(nodeDocuments.get(node.path)!) }))
		];
		const directories = templateDirectories(allFiles.map(file => file.path));

		const pending: IBaseHalfPendingTemplateSetup = {
			id: generateUuid(),
			templateId: descriptor.id,
			templateLabel: descriptor.label,
			templateDigest: await templateSourceDigest(templateSource),
			files: Object.freeze(await Promise.all(allFiles.map(async file => Object.freeze({
				path: file.path,
				digest: await templateBytesDigest(file.contents.buffer)
			})))),
			workspaceFolder: currentFolder.workspaceFolder.toString(),
			projectRelativePath,
			createdAt: new Date().toISOString()
		};
		const runtime: IBaseHalfTemplateSetupRuntime = {
			pending,
			template,
			workspaceFolder: currentFolder.workspaceFolder,
			projectResource,
			canvasMirror,
			badgeGraph,
			navigation,
			editing,
			postCreateIntent,
			fileService,
			storageService,
			dialogService,
			workspaceMutationCoordinator,
			undoRedoService,
			workingCopyService,
			confirmBeforeUndo: configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose
		};
		throwIfTemplateCreationCancelled(cancellationToken);
		storePendingTemplateSetup(storageService, pending);
		const reservation = workspaceMutationCoordinator.reserveStructural(currentFolder.workspaceFolder, [{
			workspace: currentFolder.workspaceFolder,
			relativePath: projectRelativePath
		}]);
		try {
			await reservation.finish(async lease => {
				await createTemplateProjectFiles(fileService, currentFolder.workspaceFolder, projectResource, directories, allFiles, cancellationToken);
				await assertTemplateProjectPathSafe(fileService, currentFolder.workspaceFolder, projectResource);
				await assertExactTemplateProjectTree(fileService, projectResource, directories, allFiles);
				await assertTemplateProjectPathSafe(fileService, currentFolder.workspaceFolder, projectResource);
				await applyPendingTemplateMetadata(runtime, lease, cancellationToken);
			});
		} catch (error) {
			if (isCancellationError(error)) {
				try {
					await rollbackCancelledTemplateCreation(runtime, directories, allFiles);
					removePendingTemplateSetup(storageService, pending.id);
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'Canvas creation was cancelled, but its unchanged project files could not be removed. Recovery remains available.'
					);
				}
				throw error;
			}
			if (!await fileService.exists(projectResource)) {
				removePendingTemplateSetup(storageService, pending.id);
				throw error;
			}
			await finishPendingTemplateSetup(runtime, error);
			return { templateId: descriptor.id, projectPath: projectRelativePath };
		}
		removePendingTemplateSetup(storageService, pending.id);
		pushTemplateCreationUndo(runtime, allFiles);
		await editing.requestSelection(currentFolder.resource, [projectResource], postCreateIntent);
		return { templateId: descriptor.id, projectPath: projectRelativePath };
	}
});

function templateCommandArguments(argument: unknown): { readonly templateId: string; readonly targetFolder?: URI; readonly cancellationToken?: CancellationToken } {
	if (typeof argument === 'string') {
		return { templateId: argument.trim() };
	}
	if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
		return { templateId: '' };
	}
	const record = argument as Partial<IBaseHalfCanvasCreateFromTemplateCommandArguments>;
	if (Object.keys(record).some(key => key !== 'templateId' && key !== 'targetFolder' && key !== 'cancellationToken')
		|| typeof record.templateId !== 'string'
		|| !URI.isUri(record.targetFolder)
		|| (record.cancellationToken !== undefined && !CancellationToken.isCancellationToken(record.cancellationToken))
		|| record.targetFolder.query
		|| record.targetFolder.fragment) {
		throw new Error(localize('basehalf.canvas.template.argumentsInvalid', "Canvas template command arguments are invalid."));
	}
	return {
		templateId: record.templateId.trim(),
		targetFolder: record.targetFolder,
		...(record.cancellationToken === undefined ? {} : { cancellationToken: record.cancellationToken })
	};
}

function canvasFolderForTemplateTarget(
	workspaceContextService: IWorkspaceContextService,
	resource: URI
): IBaseHalfCanvasFolderState {
	const workspaceFolder = workspaceContextService.getWorkspaceFolder(resource);
	const relativePath = workspaceFolder ? getRelativePath(workspaceFolder.uri, resource) : undefined;
	if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file' || resource.scheme !== 'file'
		|| relativePath === undefined || relativePath === '..' || relativePath.startsWith('../')) {
		throw new Error(localize('basehalf.canvas.template.targetInvalid', "The template target must be a local directory inside the current workspace."));
	}
	return {
		resource,
		workspaceFolder: workspaceFolder.uri,
		relativePath,
		source: 'api'
	};
}

registerAction2(class BaseHalfCanvasResumeTemplateSetupAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_RESUME_TEMPLATE_SETUP_COMMAND_ID,
			title: localize2('basehalf.canvas.template.resume', "Finish Incomplete Canvas Setup"),
			category: localize2('basehalf.category', "BaseHalf"),
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		const dialogService = accessor.get(IDialogService);
		const quickInputService = accessor.get(IQuickInputService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const recipes = accessor.get(IBaseHalfCanvasRecipeRegistryService);
		const fileService = accessor.get(IFileService);
		const canvasMirror = accessor.get(IBaseHalfCanvasMirrorService);
		const badgeGraph = accessor.get(IBaseHalfBadgeGraphService);
		const navigation = accessor.get(IBaseHalfCanvasNavigationService);
		const editing = accessor.get(IBaseHalfCanvasEditingService);
		const workspaceMutationCoordinator = accessor.get(IBaseHalfWorkspaceMutationCoordinator);
		const undoRedoService = accessor.get(IUndoRedoService);
		const workingCopyService = accessor.get(IWorkingCopyService);
		const confirmBeforeUndo = accessor.get(IConfigurationService).getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose;
		const pending = readPendingTemplateSetups(storageService);
		if (pending.length === 0) {
			await dialogService.info(
				localize('basehalf.canvas.template.noPendingSetup', "There is no incomplete canvas setup in this workspace.")
			);
			return;
		}
		const picks: IBaseHalfPendingTemplateSetupPick[] = pending.map(setup => ({
			label: setup.templateLabel,
			description: setup.projectRelativePath,
			detail: localize('basehalf.canvas.template.resumeCreatedAt', "Created {0}", setup.createdAt),
			setup
		}));
		const pick = await quickInputService.pick(picks, {
			title: localize('basehalf.canvas.template.resumeTitle', "Finish Canvas Setup"),
			placeHolder: localize('basehalf.canvas.template.resumePlaceholder', "Choose the project whose canvas metadata should be completed")
		});
		if (!pick) {
			return;
		}
		const postCreateIntent = editing.beginPostCreateIntent();

		const setup = pick.setup;
		const workspaceFolder = workspaceContextService.getWorkspace().folders
			.find(folder => folder.uri.toString() === setup.workspaceFolder)?.uri;
		if (!workspaceFolder) {
			throw new Error(localize('basehalf.canvas.template.resumeWorkspaceMissing', "The workspace folder for this incomplete setup is not open."));
		}
		const descriptor = recipes.getTemplate(setup.templateId);
		if (!descriptor) {
			throw new Error(localize('basehalf.canvas.template.resumeTemplateMissing', "Install or enable the plugin that provides '{0}', then try again.", setup.templateLabel));
		}
		const projectResource = joinProjectPath(workspaceFolder, setup.projectRelativePath);
		if (!await fileService.exists(projectResource)) {
			removePendingTemplateSetup(storageService, setup.id);
			throw new Error(localize(
				'basehalf.canvas.template.resumeProjectNotCreated',
				"The incomplete setup record was cleared because '{0}' no longer exists. No project files were changed.",
				setup.projectRelativePath
			));
		}
		const raw = await fileService.readFile(descriptor.resource, { limits: { size: 512 * 1024 } });
		const templateSource = raw.value.toString();
		if (await templateSourceDigest(templateSource) !== setup.templateDigest) {
			throw new Error(localize(
				'basehalf.canvas.template.resumeTemplateChanged',
				"'{0}' changed after these project files were created. Reinstall the original plugin version to finish this setup, or keep the files and create a new project from the current template.",
				setup.templateLabel
			));
		}
		const template = parseBaseHalfCanvasTemplate(templateSource);
		validateTemplateRecipes(template, recipes);
		await finishPendingTemplateSetup({
			pending: setup,
			template,
			workspaceFolder,
			projectResource,
			canvasMirror,
			badgeGraph,
			navigation,
			editing,
			postCreateIntent,
			fileService,
			storageService,
			dialogService,
			workspaceMutationCoordinator,
			undoRedoService,
			workingCopyService,
			confirmBeforeUndo
		});
	}
});

interface IBaseHalfCanvasFileActionServices {
	readonly configurationService: IConfigurationService;
	readonly dialogService: IDialogService;
	readonly fileService: IFileService;
	readonly actionContextService: IBaseHalfCanvasActionContextService;
	readonly resourceDeletionService: IBaseHalfCanvasResourceDeletionService;
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
		const commandService = accessor.get(ICommandService);
		const navigationService = accessor.get(IBaseHalfCanvasNavigationService);
		await actionContextService.assertCurrent(argument);
		if (argument.resource.path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			await commandService.executeCommand(BASEHALF_CANVAS_OPEN_RESULT_NODE_COMMAND_ID, argument);
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

registerAction2(class BaseHalfCanvasNewFileAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_FILE_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newFile', "New File..."),
			menu: { id: BASEHALF_CANVAS_PANE_CONTEXT_MENU, group: '1_new', order: 20 }
		});
	}

	override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
		if (isBaseHalfCanvasActionContext(argument)) {
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await editingService.requestCreate(argument, 'file');
		}
	}
});

function registerBaseHalfCanvasNewResultNodeAction(
	id: string,
	title: ReturnType<typeof localize2>,
	resultKind: BaseHalfNodeKind,
	order: number
): void {
	registerAction2(class BaseHalfCanvasNewResultNodeAction extends Action2 {
		constructor() {
			super({
				id,
				title,
				menu: { id: BASEHALF_CANVAS_NEW_RESULT_NODE_MENU, group: '1_content', order }
			});
		}

		override async run(accessor: ServicesAccessor, argument: unknown): Promise<void> {
			const editingService = accessor.get(IBaseHalfCanvasEditingService);
			await editingService.requestCreate(
				isBaseHalfCanvasActionContext(argument) ? argument : undefined,
				'resultNode',
				resultKind
			);
		}
	});
}

registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newFileNode',
	localize2('basehalf.canvas.context.newFileNode', "File"),
	'file',
	5
);
registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newImageNode',
	localize2('basehalf.canvas.context.newImageNode', "Image"),
	'image',
	10
);
registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newVideoNode',
	localize2('basehalf.canvas.context.newVideoNode', "Video"),
	'video',
	20
);
registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newAudioNode',
	localize2('basehalf.canvas.context.newAudioNode', "Audio"),
	'audio',
	30
);
registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newPdfNode',
	localize2('basehalf.canvas.context.newPdfNode', "PDF"),
	'pdf',
	40
);
registerBaseHalfCanvasNewResultNodeAction(
	'basehalf.canvas.newPresentationNode',
	localize2('basehalf.canvas.context.newPresentationNode', "Presentation"),
	'presentation',
	50
);

registerAction2(class BaseHalfCanvasNewFolderAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CANVAS_NEW_FOLDER_COMMAND_ID,
			title: localize2('basehalf.canvas.context.newFolder', "New Folder..."),
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
		const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
		const explorerService = accessor.get(IExplorerService);
		await actionContextService.assertCurrent(argument);
		await setExplorerFileClipboard(explorerService, [argument.resource], true);
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
		const actionContextService = accessor.get(IBaseHalfCanvasActionContextService);
		const explorerService = accessor.get(IExplorerService);
		await actionContextService.assertCurrent(argument);
		await setExplorerFileClipboard(explorerService, [argument.resource], false);
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
	await services.resourceDeletionService.delete([{ resource, folder, maxSize: MAX_UNDO_FILE_SIZE }], {
		permanently,
		undoLabel: localize('basehalf.canvas.delete.undo', "Delete {0}", basename(resource)),
		progressLabel: localize('basehalf.canvas.delete.progress', "Deleting {0}", basename(resource)),
		confirmBeforeUndo: services.configurationService.getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose
	});
}

function canvasFileActionServices(accessor: ServicesAccessor): IBaseHalfCanvasFileActionServices {
	return {
		configurationService: accessor.get(IConfigurationService),
		dialogService: accessor.get(IDialogService),
		fileService: accessor.get(IFileService),
		actionContextService: accessor.get(IBaseHalfCanvasActionContextService),
		resourceDeletionService: accessor.get(IBaseHalfCanvasResourceDeletionService)
	};
}

interface IBaseHalfTemplateSetupRuntime {
	readonly pending: IBaseHalfPendingTemplateSetup;
	readonly template: IBaseHalfCanvasTemplate;
	readonly workspaceFolder: URI;
	readonly projectResource: URI;
	readonly canvasMirror: IBaseHalfCanvasMirrorService;
	readonly badgeGraph: IBaseHalfBadgeGraphService;
	readonly navigation: IBaseHalfCanvasNavigationService;
	readonly editing: IBaseHalfCanvasEditingService;
	readonly postCreateIntent: IBaseHalfCanvasPostCreateIntent;
	readonly fileService: IFileService;
	readonly storageService: IStorageService;
	readonly dialogService: IDialogService;
	readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator;
	readonly undoRedoService: IUndoRedoService;
	readonly workingCopyService: IWorkingCopyService;
	readonly confirmBeforeUndo: boolean;
}

function validateTemplateRecipes(
	template: IBaseHalfCanvasTemplate,
	recipes: IBaseHalfCanvasRecipeRegistryService,
	createdKinds = new Map<string, BaseHalfCanvasContentKind>([
		...template.files.map(file => [file.path, baseHalfCanvasContentKindForPath(file.path, false)] as const),
		...template.nodes.map(node => [node.path, node.kind] as const)
	])
): ReadonlyMap<string, Readonly<Record<string, BaseHalfNodeJsonValue>>> {
	const validatedParameters = new Map<string, Readonly<Record<string, BaseHalfNodeJsonValue>>>();
	for (const node of template.nodes) {
		if (!node.recipe) {
			continue;
		}
		const recipe = recipes.getRecipe(node.recipe.recipeId);
		if (!recipe) {
			throw new Error(localize('basehalf.canvas.template.recipeMissing', "Template recipe '{0}' is not installed.", node.recipe.recipeId));
		}
		const primary = recipe.outputs.find(output => output.primary === true)!;
		if (primary.kind !== node.kind) {
			throw new Error(localize('basehalf.canvas.template.recipeOutputMismatch', "Template node '{0}' is {1}, but recipe '{2}' produces {3}.", node.path, node.kind, recipe.label, primary.kind));
		}
		validatedParameters.set(node.path, resolveBaseHalfCanvasRecipeParameters(recipe, node.recipe.parameters));
		const inputs: IBaseHalfCanvasRecipeInput[] = node.recipe.inputBindings.map(binding => ({
			edgeId: `${binding.sourcePath}->${node.path}`,
			slotId: binding.slot,
			order: binding.order,
			source: {
				id: binding.sourcePath,
				path: binding.sourcePath,
				kind: createdKinds.get(binding.sourcePath)!
			}
		}));
		validateBaseHalfCanvasRecipeInputs(recipe, inputs);
	}
	return validatedParameters;
}

async function finishPendingTemplateSetup(runtime: IBaseHalfTemplateSetupRuntime, initialError?: unknown): Promise<void> {
	let failure = initialError;
	let allowPartialRecovery = false;
	let postCreateIntent = runtime.postCreateIntent;
	for (;;) {
		if (failure === undefined) {
			try {
				await runtime.workspaceMutationCoordinator.runExclusive(runtime.workspaceFolder, lease => applyPendingTemplateMetadata(runtime, lease, CancellationToken.None, allowPartialRecovery));
				allowPartialRecovery = false;
				const files = await readExactTemplateProjectFiles(runtime);
				removePendingTemplateSetup(runtime.storageService, runtime.pending.id);
				pushTemplateCreationUndo(runtime, files);
			} catch (error) {
				failure = error;
			}
			if (failure === undefined) {
				await runtime.editing.requestSelection(dirname(runtime.projectResource), [runtime.projectResource], postCreateIntent);
				return;
			}
		}
		{
			const message = failure instanceof Error ? failure.message : String(failure);
			const canStopSetup = await canStopPendingTemplateSetup(runtime);
			const { result } = await runtime.dialogService.prompt<'retry' | 'open' | 'forget'>({
				type: 'warning',
				message: localize('basehalf.canvas.template.partialCreation', "The project files were created, but canvas setup did not finish."),
				detail: localize(
					'basehalf.canvas.template.partialCreationDetail',
					"Nothing was deleted. Continue now, or run 'Finish Incomplete Canvas Setup' later.\n\n{0}",
					message
				),
				buttons: [
					{ label: localize('basehalf.canvas.template.retrySetup', "&&Continue Setup"), run: () => 'retry' },
					{ label: localize('basehalf.canvas.template.openPartial', "&&Open Project"), run: () => 'open' },
					...(canStopSetup ? [{ label: localize('basehalf.canvas.template.keepFiles', "&&Keep Files and Stop Setup"), run: () => 'forget' as const }] : [])
				],
				cancelButton: true
			});
			if (result === 'retry') {
				postCreateIntent = runtime.editing.beginPostCreateIntent();
				allowPartialRecovery = failure instanceof BaseHalfTemplatePartialMetadataError;
				failure = undefined;
				continue;
			}
			if (result === 'open') {
				await runtime.navigation.openResource(runtime.projectResource, { source: 'api', pinned: true });
			}
			if (result === 'forget') {
				postCreateIntent = runtime.editing.beginPostCreateIntent();
				if (await canStopPendingTemplateSetup(runtime)) {
					removePendingTemplateSetup(runtime.storageService, runtime.pending.id);
					await runtime.editing.requestSelection(dirname(runtime.projectResource), [runtime.projectResource], postCreateIntent);
					return;
				}
				failure = new Error(localize(
					'basehalf.canvas.template.recoveryStillRequired',
					'Canvas setup changed while the recovery prompt was open. Recovery remains available so the partial metadata cannot be forgotten.'
				));
				continue;
			}
			return;
		}
	}
}

async function canStopPendingTemplateSetup(runtime: IBaseHalfTemplateSetupRuntime): Promise<boolean> {
	try {
		return await runtime.workspaceMutationCoordinator.runExclusive(runtime.workspaceFolder, async () => {
			const plan = createTemplateMetadataPlan(runtime);
			return (await classifyTemplateMetadataState(runtime, plan.canvases, plan.references)).state === 'expected';
		});
	} catch {
		return false;
	}
}

async function applyPendingTemplateMetadata(
	runtime: IBaseHalfTemplateSetupRuntime,
	lease: IBaseHalfWorkspaceMutationLease,
	cancellationToken: CancellationToken = CancellationToken.None,
	allowPartialRecovery = false
): Promise<void> {
	throwIfTemplateCreationCancelled(cancellationToken);
	await readExactTemplateProjectFiles(runtime);
	throwIfTemplateCreationCancelled(cancellationToken);
	const plan = createTemplateMetadataPlan(runtime);
	if (!allowPartialRecovery
		&& (await classifyTemplateMetadataState(runtime, plan.canvases, plan.references)).state === 'mixed') {
		throw new BaseHalfTemplatePartialMetadataError();
	}
	await applyTemplateMetadataPlan(runtime, plan, 'forward', lease, cancellationToken);
}

async function readExactTemplateProjectFiles(runtime: IBaseHalfTemplateSetupRuntime): Promise<readonly IBaseHalfTemplateProjectFile[]> {
	await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
	const projectStat = await runtime.fileService.stat(runtime.projectResource);
	if (!projectStat.isDirectory || projectStat.isSymbolicLink) {
		throw new Error(localize('basehalf.canvas.template.resumeProjectMissing', "The incomplete project folder is missing or no longer a regular folder."));
	}
	const templatePaths = [...runtime.template.files.map(file => file.path), ...runtime.template.nodes.map(node => node.path)]
		.map(baseHalfProjectPathKey)
		.sort();
	const recordedPaths = runtime.pending.files.map(file => baseHalfProjectPathKey(file.path)).sort();
	if (templatePaths.length !== recordedPaths.length || templatePaths.some((path, index) => path !== recordedPaths[index])) {
		throw new Error(localize(
			'basehalf.canvas.template.resumeRecordMismatch',
			"The saved setup record no longer matches '{0}'. Keep the project files and create a new project from the current template.",
			runtime.pending.templateLabel
		));
	}
	const files: IBaseHalfTemplateProjectFile[] = [];
	for (const file of runtime.pending.files) {
		const resource = joinProjectPath(runtime.projectResource, file.path);
		await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, resource);
		const stat = await runtime.fileService.stat(resource);
		if (!stat.isFile || stat.isSymbolicLink) {
			throw new Error(localize('basehalf.canvas.template.resumeFileChanged', "'{0}' is no longer the file created by this template, so setup cannot continue safely.", file.path));
		}
		const contents = await runtime.fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, resource);
		if (await templateBytesDigest(contents.value.buffer) !== file.digest) {
			throw new Error(localize(
				'basehalf.canvas.template.resumeFileContentsChanged',
				"'{0}' changed after it was created. Keep the files as they are, or restore the original contents before finishing canvas setup.",
				file.path
			));
		}
		files.push({ path: file.path, contents: contents.value });
	}
	return Object.freeze(files);
}

function createTemplateMetadataPlan(runtime: IBaseHalfTemplateSetupRuntime): IBaseHalfTemplateMetadataPlan {
	const projectFolder = {
		resource: runtime.projectResource,
		workspaceFolder: runtime.workspaceFolder,
		relativePath: runtime.pending.projectRelativePath,
		source: 'api' as const
	};
	const transitionsByFolder = new Map<string, { cards: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number][]; edges: NonNullable<IBaseHalfCanvasStateTransition['edges']>[number][] }>();
	const transitionFor = (parent: string) => {
		let transition = transitionsByFolder.get(parent);
		if (!transition) {
			transition = { cards: [], edges: [] };
			transitionsByFolder.set(parent, transition);
		}
		return transition;
	};
	for (const card of runtime.template.cards) {
		const parent = templateParentPath(card.path);
		const next = {
				path: joinCanvasPath(runtime.pending.projectRelativePath, card.path),
				kind: 'file' as const,
				x: card.x,
				y: card.y,
				width: card.width,
				height: card.height
			};
		transitionFor(parent).cards.push({ path: next.path, expected: null, next });
	}

	const references: IBaseHalfReferenceStateTransition[] = [];
	for (const reference of runtime.template.references) {
		const from = templateBadgeNode(runtime.workspaceFolder, runtime.projectResource, runtime.pending.projectRelativePath, reference.from);
		const to = templateBadgeNode(runtime.workspaceFolder, runtime.projectResource, runtime.pending.projectRelativePath, reference.to);
		references.push({
			source: from,
			target: to,
			expected: { forward: false, backlink: false },
			next: { forward: true, backlink: true }
		});
		const parent = templateParentPath(reference.from);
		if (parent === templateParentPath(reference.to)) {
			const next = {
				from: from.relativePath,
				from_anchor: reference.fromAnchor,
				to: to.relativePath,
				to_anchor: reference.toAnchor
			};
			transitionFor(parent).edges.push({ from: next.from, to: next.to, expected: null, next });
		}
	}

	return {
		canvases: [...transitionsByFolder]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([parent, transition]) => ({
				folder: templateFolderState(projectFolder, runtime.projectResource, runtime.pending.projectRelativePath, parent),
				transition
			})),
		references: Object.freeze(references)
	};
}

type BaseHalfTemplateTransitionDirection = 'forward' | 'reverse';

async function applyTemplateMetadataPlan(
	runtime: IBaseHalfTemplateSetupRuntime,
	plan: IBaseHalfTemplateMetadataPlan,
	direction: BaseHalfTemplateTransitionDirection,
	lease: IBaseHalfWorkspaceMutationLease,
	cancellationToken: CancellationToken = CancellationToken.None
): Promise<void> {
	throwIfTemplateCreationCancelled(cancellationToken);
	const canvases = plan.canvases.map(change => ({
		folder: change.folder,
		transition: direction === 'forward' ? change.transition : reverseTemplateCanvasTransition(change.transition)
	}));
	const references = direction === 'forward' ? plan.references : plan.references.map(reverseTemplateReferenceTransition);
	const classification = await classifyTemplateMetadataState(runtime, canvases, references);
	if (classification.state === 'next') {
		return;
	}
	const pendingCanvases = classification.canvases;
	const pendingReferences = classification.references;

	const appliedCanvases: IBaseHalfTemplateCanvasMutation[] = [];
	let referencesApplied = false;
	try {
		for (const change of pendingCanvases) {
			throwIfTemplateCreationCancelled(cancellationToken);
			await runtime.canvasMirror.transitionCanvasState(change.folder, change.transition, lease);
			appliedCanvases.push(change);
		}
		if (pendingReferences.length > 0) {
			throwIfTemplateCreationCancelled(cancellationToken);
			await runtime.badgeGraph.transitionReferenceStates(pendingReferences, lease);
			referencesApplied = true;
		}
		throwIfTemplateCreationCancelled(cancellationToken);
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		if (referencesApplied) {
			try {
				await runtime.badgeGraph.transitionReferenceStates(pendingReferences.map(reverseTemplateReferenceTransition), lease);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		for (const change of appliedCanvases.reverse()) {
			try {
				await runtime.canvasMirror.transitionCanvasState(change.folder, reverseTemplateCanvasTransition(change.transition), lease);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		throw rollbackErrors.length > 0
			? new AggregateError([error, ...rollbackErrors], 'Canvas setup failed and its metadata could not be fully restored. No project file was deleted.')
			: error;
	}
}

async function classifyTemplateMetadataState(
	runtime: IBaseHalfTemplateSetupRuntime,
	canvases: readonly IBaseHalfTemplateCanvasMutation[],
	references: readonly IBaseHalfReferenceStateTransition[]
): Promise<IBaseHalfTemplateMetadataClassification> {
	let sawExpected = false;
	let sawNext = false;
	const pendingCanvases: IBaseHalfTemplateCanvasMutation[] = [];
	for (const change of canvases) {
		const canvas = await runtime.canvasMirror.readCanvas(change.folder);
		const pendingCards: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number][] = [];
		const pendingEdges: NonNullable<IBaseHalfCanvasStateTransition['edges']>[number][] = [];
		for (const card of change.transition.cards ?? []) {
			const actual = canvas?.cards.find(candidate => candidate.path === card.path) ?? null;
			const state = templateCanvasCardEqual(actual, card.expected) ? 'expected'
				: templateCanvasCardEqual(actual, card.next) ? 'next'
					: undefined;
			if (!state) {
				throw new Error(`The canvas card '${card.path}' changed after setup began. No metadata was changed.`);
			}
			if (state === 'expected') {
				sawExpected = true;
				pendingCards.push(card);
			} else {
				sawNext = true;
			}
		}
		for (const edge of change.transition.edges ?? []) {
			const actual = canvas?.edges.find(candidate => candidate.from === edge.from && candidate.to === edge.to) ?? null;
			const state = templateCanvasEdgeEqual(actual, edge.expected) ? 'expected'
				: templateCanvasEdgeEqual(actual, edge.next) ? 'next'
					: undefined;
			if (!state) {
				throw new Error(`The canvas connection '${edge.from}' → '${edge.to}' changed after setup began. No metadata was changed.`);
			}
			if (state === 'expected') {
				sawExpected = true;
				pendingEdges.push(edge);
			} else {
				sawNext = true;
			}
		}
		if (pendingCards.length > 0 || pendingEdges.length > 0) {
			pendingCanvases.push({
				folder: change.folder,
				transition: {
					...(pendingCards.length > 0 ? { cards: pendingCards } : {}),
					...(pendingEdges.length > 0 ? { edges: pendingEdges } : {})
				}
			});
		}
	}
	const badges = new Map<string, Awaited<ReturnType<IBaseHalfBadgeGraphService['readBadge']>>>();
	const pendingReferences: IBaseHalfReferenceStateTransition[] = [];
	for (const reference of references) {
		const read = async (node: IBaseHalfBadgeNode) => {
			if (!badges.has(node.relativePath)) {
				badges.set(node.relativePath, await runtime.badgeGraph.readBadge(node));
			}
			return badges.get(node.relativePath) ?? null;
		};
		const source = await read(reference.source);
		const target = await read(reference.target);
		const actual = {
			forward: source?.references.includes(reference.target.relativePath) ?? false,
			backlink: target?.referenced_by.includes(reference.source.relativePath) ?? false
		};
		const state = templateReferenceStateEqual(actual, reference.expected) ? 'expected'
			: templateReferenceStateEqual(actual, reference.next) ? 'next'
				: undefined;
		if (!state) {
			throw new Error(`The reference '${reference.source.relativePath}' → '${reference.target.relativePath}' changed after setup began. No metadata was changed.`);
		}
		if (state === 'expected') {
			sawExpected = true;
			pendingReferences.push(reference);
		} else {
			sawNext = true;
		}
	}
	return {
		state: sawExpected ? sawNext ? 'mixed' : 'expected' : sawNext ? 'next' : 'expected',
		canvases: Object.freeze(pendingCanvases),
		references: Object.freeze(pendingReferences)
	};
}

function reverseTemplateCanvasTransition(transition: IBaseHalfCanvasStateTransition): IBaseHalfCanvasStateTransition {
	return {
		cards: transition.cards?.map(card => ({ ...card, expected: card.next, next: card.expected })),
		edges: transition.edges?.map(edge => ({ ...edge, expected: edge.next, next: edge.expected }))
	};
}

function reverseTemplateReferenceTransition(transition: IBaseHalfReferenceStateTransition): IBaseHalfReferenceStateTransition {
	return { ...transition, expected: transition.next, next: transition.expected };
}

function templateCanvasCardEqual(left: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number]['expected'], right: NonNullable<IBaseHalfCanvasStateTransition['cards']>[number]['expected']): boolean {
	return left === right || !!left && !!right
		&& left.path === right.path && left.kind === right.kind
		&& left.x === right.x && left.y === right.y
		&& left.width === right.width && left.height === right.height;
}

function templateCanvasEdgeEqual(left: NonNullable<IBaseHalfCanvasStateTransition['edges']>[number]['expected'], right: NonNullable<IBaseHalfCanvasStateTransition['edges']>[number]['expected']): boolean {
	return left === right || !!left && !!right
		&& left.from === right.from && left.from_anchor === right.from_anchor
		&& left.to === right.to && left.to_anchor === right.to_anchor;
}

function templateReferenceStateEqual(left: { readonly forward: boolean; readonly backlink: boolean }, right: { readonly forward: boolean; readonly backlink: boolean }): boolean {
	return left.forward === right.forward && left.backlink === right.backlink;
}

async function createTemplateProjectFiles(
	fileService: IFileService,
	workspaceFolder: URI,
	projectResource: URI,
	directories: readonly string[],
	files: readonly IBaseHalfTemplateProjectFile[],
	cancellationToken: CancellationToken = CancellationToken.None
): Promise<void> {
	const created: { readonly resource: URI; readonly kind: 'file' | 'folder'; readonly contents?: VSBuffer }[] = [];
	try {
		throwIfTemplateCreationCancelled(cancellationToken);
		await assertTemplateProjectPathSafe(fileService, workspaceFolder, projectResource);
		if (await fileService.exists(projectResource)) {
			throw new Error(`'${basename(projectResource)}' already exists. Project setup did not replace it.`);
		}
		await fileService.createFolder(projectResource);
		await assertTemplateProjectPathSafe(fileService, workspaceFolder, projectResource);
		created.push({ resource: projectResource, kind: 'folder' });
		for (const directory of directories) {
			throwIfTemplateCreationCancelled(cancellationToken);
			const resource = joinProjectPath(projectResource, directory);
			await assertTemplateProjectPathSafe(fileService, workspaceFolder, resource);
			await fileService.createFolder(resource);
			await assertTemplateProjectPathSafe(fileService, workspaceFolder, resource);
			created.push({ resource, kind: 'folder' });
		}
		for (const file of files) {
			throwIfTemplateCreationCancelled(cancellationToken);
			const resource = joinProjectPath(projectResource, file.path);
			await assertTemplateProjectPathSafe(fileService, workspaceFolder, resource);
			await fileService.createFile(resource, file.contents, { overwrite: false });
			await assertTemplateProjectPathSafe(fileService, workspaceFolder, resource);
			created.push({ resource, kind: 'file', contents: file.contents });
		}
		throwIfTemplateCreationCancelled(cancellationToken);
	} catch (error) {
		const cleanupErrors: unknown[] = [];
		for (const entry of created.reverse()) {
			try {
				await assertTemplateProjectPathSafe(fileService, workspaceFolder, entry.resource);
				if (entry.kind === 'file') {
					const current = await fileService.readFile(entry.resource, { atomic: true, limits: { size: MAX_UNDO_FILE_SIZE } });
					if (!current.value.equals(entry.contents!)) {
						throw new Error(`'${basename(entry.resource)}' changed while project setup was being rolled back, so it was preserved.`);
					}
				}
				await fileService.del(entry.resource, { recursive: false, useTrash: false, atomic: false });
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		throw cleanupErrors.length > 0
			? new AggregateError([error, ...cleanupErrors], 'Project setup failed and changed files were preserved.')
			: error;
	}
}

async function rollbackCancelledTemplateCreation(
	runtime: IBaseHalfTemplateSetupRuntime,
	directories: readonly string[],
	files: readonly IBaseHalfTemplateProjectFile[]
): Promise<void> {
	if (!await runtime.fileService.exists(runtime.projectResource)) {
		return;
	}
	await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
	await assertExactTemplateProjectTree(runtime.fileService, runtime.projectResource, directories, files);
	await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
	await runtime.fileService.del(runtime.projectResource, { recursive: true, useTrash: false, atomic: false });
}

function throwIfTemplateCreationCancelled(cancellationToken: CancellationToken): void {
	if (cancellationToken.isCancellationRequested) {
		throw new CancellationError();
	}
}

async function assertTemplateProjectPathSafe(fileService: IFileService, workspaceFolder: URI, resource: URI): Promise<void> {
	const relative = getRelativePath(workspaceFolder, resource);
	if (!relative || relative === '..' || relative.startsWith('../')) {
		throw new Error('The template project path is outside this workspace.');
	}
	let current = workspaceFolder;
	for (const segment of relative.split('/')) {
		current = joinPath(current, segment);
		if (!await fileService.exists(current)) {
			return;
		}
		const stat = await fileService.stat(current);
		if (stat.isSymbolicLink) {
			throw new Error(`The template project path crosses a symbolic link at '${segment}'.`);
		}
	}
}

function pushTemplateCreationUndo(runtime: IBaseHalfTemplateSetupRuntime, files: readonly IBaseHalfTemplateProjectFile[]): void {
	const plan = createTemplateMetadataPlan(runtime);
	const directories = templateDirectories(files.map(file => file.path));
	const stashResource = joinPath(runtime.workspaceFolder, '.bh', 'cache', 'canvas-template-undo', runtime.pending.id, 'project');
	const run = async (reverse: boolean): Promise<void> => {
		const reservation = runtime.workspaceMutationCoordinator.reserveStructural(runtime.workspaceFolder, [{
			workspace: runtime.workspaceFolder,
			relativePath: runtime.pending.projectRelativePath
		}]);
		await reservation.finish(lease => reverse
			? undoTemplateCreation(runtime, plan, directories, files, stashResource, lease)
			: redoTemplateCreation(runtime, plan, directories, files, stashResource, lease));
	};
	const resources = new Map<string, URI>();
	for (const resource of [
		runtime.projectResource,
		...plan.canvases.map(change => runtime.canvasMirror.canvasResource(change.folder)),
		...plan.references.flatMap(reference => [reference.source.resource, reference.target.resource])
	]) {
		resources.set(resource.toString(), resource);
	}
	runtime.undoRedoService.pushElement({
		type: UndoRedoElementType.Workspace,
		resources: [...resources.values()],
		label: localize('basehalf.canvas.template.undo', "Create {0}", runtime.pending.templateLabel),
		code: 'basehalf.canvas.template.create',
		confirmBeforeUndo: runtime.confirmBeforeUndo,
		undo: () => run(true),
		redo: () => run(false)
	}, undefined, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
}

async function undoTemplateCreation(
	runtime: IBaseHalfTemplateSetupRuntime,
	plan: IBaseHalfTemplateMetadataPlan,
	directories: readonly string[],
	files: readonly IBaseHalfTemplateProjectFile[],
	stashResource: URI,
	lease: IBaseHalfWorkspaceMutationLease
): Promise<void> {
	const dirty = runtime.workingCopyService.dirtyWorkingCopies.find(workingCopy => isEqualOrParent(workingCopy.resource, runtime.projectResource));
	if (dirty) {
		throw new Error(`Save '${basename(dirty.resource)}' before undoing this project creation.`);
	}
	await assertExactTemplateProjectTree(runtime.fileService, runtime.projectResource, directories, files);
	await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
	await assertTemplateStashPathSafe(runtime.fileService, runtime.workspaceFolder, stashResource);
	if (await runtime.fileService.exists(stashResource)) {
		throw new Error('The private undo copy for this project already exists. The project was preserved.');
	}
	await assertTemplateMetadataState(runtime, plan, 'next', 'Undo did not remove anything.');
	await applyTemplateMetadataPlan(runtime, plan, 'reverse', lease);
	try {
		await runtime.fileService.createFolder(dirname(stashResource));
		await runtime.fileService.move(runtime.projectResource, stashResource, false);
		await assertTemplateStashPathSafe(runtime.fileService, runtime.workspaceFolder, stashResource);
	} catch (error) {
		try {
			await applyTemplateMetadataPlan(runtime, plan, 'forward', lease);
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], 'Undo could not move the project or restore its canvas metadata. The project files were preserved.');
		}
		throw error;
	}
}

async function redoTemplateCreation(
	runtime: IBaseHalfTemplateSetupRuntime,
	plan: IBaseHalfTemplateMetadataPlan,
	directories: readonly string[],
	files: readonly IBaseHalfTemplateProjectFile[],
	stashResource: URI,
	lease: IBaseHalfWorkspaceMutationLease
): Promise<void> {
	if (await runtime.fileService.exists(runtime.projectResource)) {
		throw new Error(`'${runtime.pending.projectRelativePath}' already exists. Redo did not replace it.`);
	}
	await assertTemplateStashPathSafe(runtime.fileService, runtime.workspaceFolder, stashResource);
	await assertExactTemplateProjectTree(runtime.fileService, stashResource, directories, files);
	await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
	await assertTemplateMetadataState(runtime, plan, 'expected', 'Redo did not replace any canvas metadata.');
	await runtime.fileService.move(stashResource, runtime.projectResource, false);
	try {
		await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
		await applyTemplateMetadataPlan(runtime, plan, 'forward', lease);
	} catch (error) {
		try {
			await assertExactTemplateProjectTree(runtime.fileService, runtime.projectResource, directories, files);
			await runtime.fileService.createFolder(dirname(stashResource));
			await runtime.fileService.move(runtime.projectResource, stashResource, false);
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], 'Redo could not restore the canvas metadata or return the unchanged project to its private undo location. The project files were preserved.');
		}
		throw error;
	}
}

async function assertTemplateMetadataState(
	runtime: IBaseHalfTemplateSetupRuntime,
	plan: IBaseHalfTemplateMetadataPlan,
	expected: 'expected' | 'next',
	consequence: string
): Promise<void> {
	const classification = await classifyTemplateMetadataState(runtime, plan.canvases, plan.references);
	if (classification.state !== expected) {
		throw new Error(`The canvas setup metadata changed after this history action was recorded. ${consequence}`);
	}
}

async function assertExactTemplateProjectTree(
	fileService: IFileService,
	root: URI,
	directories: readonly string[],
	files: readonly IBaseHalfTemplateProjectFile[]
): Promise<void> {
	const expectedByParent = new Map<string, Map<string, 'file' | 'folder'>>();
	const expectedChildren = (parent: string): Map<string, 'file' | 'folder'> => {
		let children = expectedByParent.get(parent);
		if (!children) {
			children = new Map();
			expectedByParent.set(parent, children);
		}
		return children;
	};
	expectedChildren('');
	for (const directory of directories) {
		expectedChildren(templateParentPath(directory)).set(basename(URI.file(directory)), 'folder');
		expectedChildren(directory);
	}
	for (const file of files) {
		expectedChildren(templateParentPath(file.path)).set(basename(URI.file(file.path)), 'file');
	}
	for (const [directory, expected] of expectedByParent) {
		const stat = await fileService.resolve(directory ? joinProjectPath(root, directory) : root);
		if (!stat.isDirectory || stat.isSymbolicLink) {
			throw new Error(`'${directory || basename(root)}' is no longer the folder created by this template.`);
		}
		const actual = new Map((stat.children ?? []).map(child => [basename(child.resource), child]));
		if (actual.size !== expected.size || [...expected].some(([name, kind]) => {
			const child = actual.get(name);
			return !child || child.isSymbolicLink || (kind === 'file' ? !child.isFile : !child.isDirectory);
		})) {
			throw new Error(`'${runtimeSafePath(directory)}' contains files or folders that were not part of the original project. Undo did not remove anything.`);
		}
	}
	for (const file of files) {
		const current = await fileService.readFile(joinProjectPath(root, file.path), { atomic: true, limits: { size: MAX_UNDO_FILE_SIZE } });
		if (!current.value.equals(file.contents)) {
			throw new Error(`'${file.path}' changed after the project was created. Undo did not remove anything.`);
		}
	}
}

function runtimeSafePath(path: string): string {
	return path || 'project';
}

async function assertTemplateStashPathSafe(fileService: IFileService, workspaceFolder: URI, stashResource: URI): Promise<void> {
	const relative = getRelativePath(workspaceFolder, stashResource);
	if (!relative || relative === '..' || relative.startsWith('../')) {
		throw new Error('The private undo location is outside this workspace.');
	}
	let current = workspaceFolder;
	for (const segment of relative.split('/')) {
		current = joinPath(current, segment);
		if (!await fileService.exists(current)) {
			return;
		}
		const stat = await fileService.stat(current);
		if (stat.isSymbolicLink) {
			throw new Error(`The private undo location crosses a symbolic link at '${segment}'.`);
		}
	}
}

export function parseBaseHalfPendingTemplateSetups(raw: string | undefined): readonly IBaseHalfPendingTemplateSetup[] {
	if (!raw || raw.length > 256 * 1024) {
		return [];
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(value)) {
		return [];
	}
	const result: IBaseHalfPendingTemplateSetup[] = [];
	const ids = new Set<string>();
	for (const candidate of value.slice(0, MAX_PENDING_TEMPLATE_SETUPS)) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			continue;
		}
		const entry = candidate as Record<string, unknown>;
		const files = parsePendingTemplateFiles(entry.files);
		if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.id) || ids.has(entry.id)
			|| typeof entry.templateId !== 'string' || !entry.templateId.trim() || entry.templateId.length > 240
			|| typeof entry.templateLabel !== 'string' || !entry.templateLabel.trim() || entry.templateLabel.length > 240
			|| typeof entry.templateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.templateDigest)
			|| !files
			|| typeof entry.workspaceFolder !== 'string' || !entry.workspaceFolder || entry.workspaceFolder.length > 4096
			|| typeof entry.projectRelativePath !== 'string' || !!baseHalfProjectPathProblem(entry.projectRelativePath)
			|| typeof entry.createdAt !== 'string' || entry.createdAt.length > 64 || !Number.isFinite(Date.parse(entry.createdAt))) {
			continue;
		}
		ids.add(entry.id);
		result.push(Object.freeze({
			id: entry.id,
			templateId: entry.templateId.trim(),
			templateLabel: entry.templateLabel.trim(),
			templateDigest: entry.templateDigest,
			files,
			workspaceFolder: entry.workspaceFolder,
			projectRelativePath: entry.projectRelativePath,
			createdAt: entry.createdAt
		}));
	}
	return Object.freeze(result);
}

function parsePendingTemplateFiles(value: unknown): readonly IBaseHalfPendingTemplateFile[] | undefined {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PENDING_TEMPLATE_FILES) {
		return undefined;
	}
	const paths = new Set<string>();
	const files: IBaseHalfPendingTemplateFile[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			return undefined;
		}
		const file = candidate as Record<string, unknown>;
		if (typeof file.path !== 'string' || !!baseHalfProjectPathProblem(file.path)
			|| typeof file.digest !== 'string' || !/^[a-f0-9]{64}$/.test(file.digest)) {
			return undefined;
		}
		const key = baseHalfProjectPathKey(file.path);
		if (paths.has(key)) {
			return undefined;
		}
		paths.add(key);
		files.push(Object.freeze({ path: file.path, digest: file.digest }));
	}
	return Object.freeze(files);
}

async function templateSourceDigest(source: string): Promise<string> {
	return templateBytesDigest(new TextEncoder().encode(source));
}

async function templateBytesDigest(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readPendingTemplateSetups(storageService: IStorageService): readonly IBaseHalfPendingTemplateSetup[] {
	return parseBaseHalfPendingTemplateSetups(storageService.get(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE));
}

function writePendingTemplateSetups(storageService: IStorageService, setups: readonly IBaseHalfPendingTemplateSetup[]): void {
	if (setups.length === 0) {
		storageService.remove(PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);
		return;
	}
	storageService.store(
		PENDING_TEMPLATE_SETUPS_STORAGE_KEY,
		JSON.stringify(setups.slice(-MAX_PENDING_TEMPLATE_SETUPS)),
		StorageScope.WORKSPACE,
		StorageTarget.MACHINE
	);
}

function storePendingTemplateSetup(storageService: IStorageService, setup: IBaseHalfPendingTemplateSetup): void {
	writePendingTemplateSetups(storageService, [
		...readPendingTemplateSetups(storageService).filter(candidate => candidate.id !== setup.id),
		setup
	]);
}

function removePendingTemplateSetup(storageService: IStorageService, id: string): void {
	writePendingTemplateSetups(storageService, readPendingTemplateSetups(storageService).filter(candidate => candidate.id !== id));
}

async function availableTemplateFolderName(
	fileService: IFileService,
	parent: URI,
	workspaceFolder: URI,
	parentRelativePath: string,
	label: string
): Promise<string> {
	const base = baseHalfTemplateFolderBaseName(label);
	for (let index = 1; index < 1000; index++) {
		const candidate = index === 1 ? base : `${base} ${index}`;
		const relativePath = joinCanvasPath(parentRelativePath, candidate);
		const mirrorDirectory = joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(relativePath));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(fileService, workspaceFolder, mirrorDirectory);
		if (!baseHalfProjectPathProblem(candidate)
			&& !await fileService.exists(joinPath(parent, candidate))
			&& !await fileService.exists(mirrorDirectory)) {
			return candidate;
		}
	}
	throw new Error(localize('basehalf.canvas.template.noAvailableFolder', "No available folder name could be found for this template."));
}

export function baseHalfTemplateFolderBaseName(label: string): string {
	const candidate = label
		.normalize('NFC')
		.trim()
		.replace(/[\\/:*?"<>|]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.slice(0, 80);
	return candidate && !baseHalfProjectPathProblem(candidate) ? candidate : 'Canvas';
}

function templateDirectories(paths: readonly string[]): readonly string[] {
	const directories = new Set<string>();
	for (const path of paths) {
		const segments = path.split('/');
		for (let index = 1; index < segments.length; index++) {
			directories.add(segments.slice(0, index).join('/'));
		}
	}
	return [...directories].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}

function joinProjectPath(root: URI, relativePath: string): URI {
	return joinPath(root, ...relativePath.split('/'));
}

function joinCanvasPath(parent: string, child: string): string {
	return parent ? `${parent}/${child}` : child;
}

function templateParentPath(path: string): string {
	const separator = path.lastIndexOf('/');
	return separator < 0 ? '' : path.slice(0, separator);
}

function templateFolderState(
	projectFolder: { readonly resource: URI; readonly workspaceFolder: URI; readonly relativePath: string; readonly source: 'api' },
	projectResource: URI,
	projectRelativePath: string,
	parent: string
): typeof projectFolder {
	return parent ? {
		resource: joinProjectPath(projectResource, parent),
		workspaceFolder: projectFolder.workspaceFolder,
		relativePath: joinCanvasPath(projectRelativePath, parent),
		source: 'api'
	} : projectFolder;
}

function templateBadgeNode(workspaceFolder: URI, projectResource: URI, projectRelativePath: string, path: string): IBaseHalfBadgeNode {
	return {
		resource: joinProjectPath(projectResource, path),
		workspaceFolder,
		relativePath: joinCanvasPath(projectRelativePath, path),
		kind: 'file'
	};
}
