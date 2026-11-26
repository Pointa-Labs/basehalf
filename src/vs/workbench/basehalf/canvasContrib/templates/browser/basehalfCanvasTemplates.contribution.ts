/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID, IBaseHalfCanvasCreateFromTemplateCommandArguments, IBaseHalfCanvasCreateFromTemplateCommandResult, materializeBaseHalfCanvasTemplateUpstream, parseBaseHalfCanvasTemplate } from '../../../canvas/common/basehalfCanvasTemplate.js';
import { localize, localize2 } from '../../../../../nls.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { applyPendingTemplateMetadata, applyTemplateDrafts, applyTemplateSidecarUpstream, assertExactTemplateProjectTree, assertTemplateProjectPathSafe, availableTemplateFolderName, BASEHALF_CANVAS_RESUME_TEMPLATE_SETUP_COMMAND_ID, createTemplateProjectFiles, discardLegacyBaseHalfPendingTemplateSetups, finishPendingTemplateSetup, IBaseHalfPendingTemplateSetup, IBaseHalfPendingTemplateSetupPick, IBaseHalfTemplateProjectFile, IBaseHalfTemplateSetupRuntime, joinCanvasPath, joinProjectPath, pushTemplateCreationUndo, readPendingTemplateSetups, removePendingTemplateSetup, rollbackCancelledTemplateCreation, storePendingTemplateSetup, templateBytesDigest, templateDirectories, templateDraftInfo, templateSourceDigest, throwIfTemplateCreationCancelled } from './basehalfCanvasTemplateSetup.js';
import { IBaseHalfCanvasTemplateRegistryService } from '../../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasEditingService } from '../../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { IUndoRedoService } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService } from '../../../generation/common/basehalfVideoGeneration.js';
import { joinPath, relativePath as getRelativePath } from '../../../../../base/common/resources.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../../workspace/common/basehalfSourceTreeMarker.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../../../contrib/files/common/files.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';

// Templates on the canvas (reference graph, "Templates"): the command that makes a project from a template, the one
// that finishes a setup a closed window left, and the cleanup of what an earlier release kept of such setups.

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
		const templates = accessor.get(IBaseHalfCanvasTemplateRegistryService);
		const fileService = accessor.get(IFileService);
		const navigation = accessor.get(IBaseHalfCanvasNavigationService);
		const editing = accessor.get(IBaseHalfCanvasEditingService);
		const postCreateIntent = editing.beginPostCreateIntent();
		const canvasMirror = accessor.get(IBaseHalfCanvasMirrorService);
		const referenceEditService = accessor.get(IBaseHalfReferenceEditService);
		const configurationService = accessor.get(IConfigurationService);
		const storageService = accessor.get(IStorageService);
		const dialogService = accessor.get(IDialogService);
		const workspaceMutationCoordinator = accessor.get(IBaseHalfWorkspaceMutationCoordinator);
		const undoRedoService = accessor.get(IUndoRedoService);
		const workingCopyService = accessor.get(IWorkingCopyService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const generationCardStore = accessor.get(IBaseHalfGenerationCardStore);
		const draftInfo = templateDraftInfo(accessor.get(IBaseHalfVideoCatalogService), accessor.get(IBaseHalfVideoProviderSettingsService));
		const descriptor = templates.getTemplate(commandArguments.templateId);
		if (!descriptor) {
			throw new Error(localize('basehalf.canvas.template.notFound', "Canvas template '{0}' is not available.", commandArguments.templateId));
		}
		const templateSource = descriptor.source;
		throwIfTemplateCreationCancelled(cancellationToken);
		const template = parseBaseHalfCanvasTemplate(templateSource);

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
		// Each template reference is stored once, in its target's own store,
		// rebased under the new project folder.
		const upstream = materializeBaseHalfCanvasTemplateUpstream(template, projectRelativePath);
		if ((upstream.sidecars.length > 0 || template.drafts.length > 0) && await baseHalfIsWorkspaceFolderMarked(fileService, currentFolder.workspaceFolder)) {
			throw new Error(localize(
				'basehalf.canvas.template.markedFolder',
				"'{0}' makes cards and connections that BaseHalf can't save in a folder it is set to leave alone.",
				descriptor.label
			));
		}
		throwIfTemplateCreationCancelled(cancellationToken);
		// The files; the drafts are card information, which the card store makes after them (D63).
		const allFiles: readonly IBaseHalfTemplateProjectFile[] = template.files.map(file => ({ path: file.path, contents: VSBuffer.fromString(upstream.files.get(file.path) ?? file.contents) }));
		const directories = templateDirectories([...allFiles.map(file => file.path), ...template.drafts.map(draft => draft.path)]);

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
			referenceEditService,
			sidecars: upstream.sidecars,
			draftUpstream: upstream.drafts,
			draftPrompts: upstream.prompts,
			generationCardStore,
			draftInfo,
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
			// Outside the structural lease: the reference edit service takes its
			// own workspace mutation lease for every write, a draft's list among them.
			await applyTemplateDrafts(runtime);
			await applyTemplateSidecarUpstream(runtime);
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
		const templates = accessor.get(IBaseHalfCanvasTemplateRegistryService);
		const fileService = accessor.get(IFileService);
		const canvasMirror = accessor.get(IBaseHalfCanvasMirrorService);
		const referenceEditService = accessor.get(IBaseHalfReferenceEditService);
		const navigation = accessor.get(IBaseHalfCanvasNavigationService);
		const editing = accessor.get(IBaseHalfCanvasEditingService);
		const workspaceMutationCoordinator = accessor.get(IBaseHalfWorkspaceMutationCoordinator);
		const undoRedoService = accessor.get(IUndoRedoService);
		const workingCopyService = accessor.get(IWorkingCopyService);
		const notificationService = accessor.get(INotificationService);
		const generationCardStore = accessor.get(IBaseHalfGenerationCardStore);
		const draftInfo = templateDraftInfo(accessor.get(IBaseHalfVideoCatalogService), accessor.get(IBaseHalfVideoProviderSettingsService));
		const confirmBeforeUndo = accessor.get(IConfigurationService).getValue<IFilesConfiguration>().explorer.confirmUndo === UndoConfirmLevel.Verbose;
		discardLegacyBaseHalfPendingTemplateSetups(storageService, notificationService);
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
			placeHolder: localize('basehalf.canvas.template.resumePlaceholder', "Choose the project whose canvas setup should be finished")
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
		const descriptor = templates.getTemplate(setup.templateId);
		if (!descriptor) {
			throw new Error(localize('basehalf.canvas.template.resumeTemplateMissing', "'{0}' is not available, so this setup cannot be finished.", setup.templateLabel));
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
		const templateSource = descriptor.source;
		if (await templateSourceDigest(templateSource) !== setup.templateDigest) {
			throw new Error(localize(
				'basehalf.canvas.template.resumeTemplateChanged',
				"'{0}' changed after these project files were created, so this setup cannot be finished. Keep the files and create a new project from the current template.",
				setup.templateLabel
			));
		}
		const template = parseBaseHalfCanvasTemplate(templateSource);
		const upstream = materializeBaseHalfCanvasTemplateUpstream(template, setup.projectRelativePath);
		await finishPendingTemplateSetup({
			pending: setup,
			template,
			workspaceFolder,
			projectResource,
			canvasMirror,
			referenceEditService,
			sidecars: upstream.sidecars,
			draftUpstream: upstream.drafts,
			draftPrompts: upstream.prompts,
			generationCardStore,
			draftInfo,
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

class BaseHalfLegacyPendingTemplateSetupsContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfLegacyPendingTemplateSetups';

	constructor(
		@IStorageService storageService: IStorageService,
		@INotificationService notificationService: INotificationService
	) {
		discardLegacyBaseHalfPendingTemplateSetups(storageService, notificationService);
	}
}

registerWorkbenchContribution2(BaseHalfLegacyPendingTemplateSetupsContribution.ID, BaseHalfLegacyPendingTemplateSetupsContribution, WorkbenchPhase.Eventually);
