/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IBaseHalfCanvasFolderState, IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasMirrorService, IBaseHalfCanvasStateTransition } from '../../../canvas/common/basehalfCanvasMirror.js';
import { IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IBaseHalfCanvasTemplate, IBaseHalfCanvasTemplateDraft, IBaseHalfCanvasTemplateSidecarUpstream } from '../../../canvas/common/basehalfCanvasTemplate.js';
import { URI } from '../../../../../base/common/uri.js';
import { IBaseHalfReferenceEditService } from '../../../references/common/basehalfReferenceEdit.js';
import { IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService } from '../../../generation/common/basehalfVideoGeneration.js';
import { IBaseHalfGenerationInfo } from '../../../generation/common/basehalfGenerationInfo.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE, IBaseHalfCanvasEditingService, IBaseHalfCanvasPostCreateIntent } from '../../../canvas/common/basehalfCanvasEditing.js';
import { FileOperation, IFileService } from '../../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { IUndoRedoService, UndoRedoElementType } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { basename, dirname, isEqualOrParent, joinPath, relativePath as getRelativePath } from '../../../../../base/common/resources.js';
import { baseHalfUserFacingErrorMessage } from '../../../workspace/common/basehalfPlainFailureReason.js';
import { localize } from '../../../../../nls.js';
import { baseHalfProjectPathKey, baseHalfProjectPathProblem } from '../../../workspace/common/basehalfProjectPath.js';
import { baseHalfIsDraft, baseHalfReadDraftFacts } from '../../../generation/common/basehalfGenerationDraft.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../../workspace/common/basehalfMirrorIgnore.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorRoot } from '../../../workspace/common/basehalfMirrorTree.js';
import { baseHalfVideoInitialGeneration } from '../../../generation/common/basehalfVideoCatalog.js';

// Making a project from a template on the canvas: its files, its card information, and its places on the canvas
// written in steps that a failure or a closed window leaves resumable, the setups that wait to be finished, and the
// undo and redo of a creation (reference graph, "Templates").

export const BASEHALF_CANVAS_RESUME_TEMPLATE_SETUP_COMMAND_ID = 'basehalf.canvas.resumeTemplateSetup';

const MAX_UNDO_FILE_SIZE = 5_000_000;

/** The largest text file a template creates, as its parser bounds it; a resumed setup reads no more. */
const MAX_TEMPLATE_FILE_BYTES = 256 * 1024;

/**
 * Version 2 (D37): created Markdown files carry their `upstream` list in the
 * recorded digests, and sidecar targets are written through the reference
 * edit service. Drafts are not files: they are made again from the template
 * when a setup is finished (D63). Version 1 records came from the badge-pair
 * model and cannot be finished; they are discarded with a warning that names
 * each setup.
 */
const PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v2';

const LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY = 'basehalf.canvas.pendingTemplateSetups.v1';

const MAX_PENDING_TEMPLATE_SETUPS = 32;

const MAX_PENDING_TEMPLATE_FILES = 200;

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

export interface IBaseHalfTemplateProjectFile {
	readonly path: string;
	readonly contents: VSBuffer;
}

interface IBaseHalfTemplateCanvasMutation {
	readonly folder: IBaseHalfCanvasFolderState;
	readonly transition: IBaseHalfCanvasStateTransition;
}

/**
 * The canvas metadata of a template setup: card geometry, drafts' cards
 * included, and same-folder anchor rows. References are not metadata:
 * Markdown targets carry their `upstream` list in their initial bytes, a
 * draft gets its list from the card store, and other sidecar targets are
 * written separately through the reference edit service.
 */
interface IBaseHalfTemplateMetadataPlan {
	readonly canvases: readonly IBaseHalfTemplateCanvasMutation[];
}

interface IBaseHalfTemplateMetadataClassification extends IBaseHalfTemplateMetadataPlan {
	readonly state: 'expected' | 'next' | 'mixed';
}

class BaseHalfTemplatePartialMetadataError extends Error {
	constructor() {
		super('Some canvas setup metadata is already present while other rows are missing. Nothing was changed.');
	}
}

export interface IBaseHalfPendingTemplateSetupPick extends IQuickPickItem {
	readonly setup: IBaseHalfPendingTemplateSetup;
}

export interface IBaseHalfTemplateSetupRuntime {
	readonly pending: IBaseHalfPendingTemplateSetup;
	readonly template: IBaseHalfCanvasTemplate;
	readonly workspaceFolder: URI;
	readonly projectResource: URI;
	readonly canvasMirror: IBaseHalfCanvasMirrorService;
	readonly referenceEditService: IBaseHalfReferenceEditService;
	/** Created sidecar-store targets and their workspace-relative entries. */
	readonly sidecars: readonly IBaseHalfCanvasTemplateSidecarUpstream[];
	/** The workspace-relative entries of each draft, by its template-relative path. */
	readonly draftUpstream: ReadonlyMap<string, readonly string[]>;
	/** The prompt of each draft with its mentions rebased, by its template-relative path (D74). */
	readonly draftPrompts: ReadonlyMap<string, string>;
	readonly generationCardStore: IBaseHalfGenerationCardStore;
	/** What a draft of the template starts with: its prompt and this computer's last values of its kind. */
	readonly draftInfo: (draft: IBaseHalfCanvasTemplateDraft) => IBaseHalfGenerationInfo;
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

export async function finishPendingTemplateSetup(runtime: IBaseHalfTemplateSetupRuntime, initialError?: unknown): Promise<void> {
	let failure = initialError;
	let allowPartialRecovery = false;
	let postCreateIntent = runtime.postCreateIntent;
	for (;;) {
		if (failure === undefined) {
			try {
				await runtime.workspaceMutationCoordinator.runExclusive(runtime.workspaceFolder, lease => applyPendingTemplateMetadata(runtime, lease, CancellationToken.None, allowPartialRecovery));
				allowPartialRecovery = false;
				await applyTemplateDrafts(runtime);
				await applyTemplateSidecarUpstream(runtime);
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
			const message = baseHalfUserFacingErrorMessage(failure);
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
					'Canvas setup changed while this prompt was open. It can still be finished later with \'Finish Incomplete Canvas Setup\'.'
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
			return (await classifyTemplateMetadataState(runtime, plan.canvases)).state === 'expected'
				&& await templateSidecarUpstreamIsEmpty(runtime);
		});
	} catch {
		return false;
	}
}

export async function applyPendingTemplateMetadata(
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
		&& (await classifyTemplateMetadataState(runtime, plan.canvases)).state === 'mixed') {
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
	const templatePaths = runtime.template.files.map(file => baseHalfProjectPathKey(file.path)).sort();
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
			limits: { size: MAX_TEMPLATE_FILE_BYTES }
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

	// `canvas.yaml` edge rows are anchor memory only: the reference itself is
	// already in the target's store.
	for (const reference of runtime.template.references) {
		const parent = templateParentPath(reference.from);
		if (parent === templateParentPath(reference.to)) {
			const next = {
				from: joinCanvasPath(runtime.pending.projectRelativePath, reference.from),
				from_anchor: reference.fromAnchor,
				to: joinCanvasPath(runtime.pending.projectRelativePath, reference.to),
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
			}))
	};
}

/**
 * Makes every draft of the template through the card store: its
 * `upstream.yaml` with the template's references into it, then its
 * `generation.yaml` with the template's prompt and this computer's last
 * values of its kind (reference graph, "Templates"). A draft that an earlier
 * run of the same setup made is kept; a path that anything else took is
 * refused with its name, and nothing of that draft is written.
 */
export async function applyTemplateDrafts(runtime: IBaseHalfTemplateSetupRuntime): Promise<void> {
	for (const draft of runtime.template.drafts) {
		const path = joinCanvasPath(runtime.pending.projectRelativePath, draft.path);
		const facts = await baseHalfReadDraftFacts(runtime.fileService, runtime.workspaceFolder, path);
		if (baseHalfIsDraft(facts)) {
			continue;
		}
		if (facts.itemExists || facts.hasGenerationInfo || facts.hasMade) {
			throw new Error(localize('basehalf.canvas.template.draftTaken', "'{0}' is taken by another item, so the template could not make its card there.", draft.path));
		}
		const resource = joinProjectPath(runtime.projectResource, draft.path);
		const info = runtime.draftInfo(draft);
		await runtime.generationCardStore.createDraft(dirname(resource), basename(resource), { ...info, prompt: runtime.draftPrompts.get(draft.path) ?? info.prompt }, runtime.draftUpstream.get(draft.path) ?? []);
	}
}

/**
 * Writes the `upstream.yaml` of every created sidecar-store target through the
 * reference edit service. Each store is one idempotent transition from an
 * empty list, so a resumed setup skips stores that already hold their entries
 * and refuses stores that changed. Template instantiation is not a canvas undo
 * step, and undoing the project creation keeps these files like a trash
 * delete does.
 */
export async function applyTemplateSidecarUpstream(runtime: IBaseHalfTemplateSetupRuntime): Promise<void> {
	for (const sidecar of runtime.sidecars) {
		await runtime.referenceEditService.apply([{
			node: {
				resource: joinProjectPath(runtime.workspaceFolder, sidecar.path),
				workspaceFolder: runtime.workspaceFolder,
				relativePath: sidecar.path
			},
			operation: {
				kind: 'transition',
				from: { items: [] },
				to: { items: sidecar.entries.map(text => ({ text, scalar: true })) }
			}
		}], { label: localize('basehalf.canvas.template.upstreamLabel', "Create {0}", runtime.pending.templateLabel) });
	}
}

async function templateSidecarUpstreamIsEmpty(runtime: IBaseHalfTemplateSetupRuntime): Promise<boolean> {
	for (const sidecar of runtime.sidecars) {
		const snapshot = await runtime.referenceEditService.readSnapshot({
			resource: joinProjectPath(runtime.workspaceFolder, sidecar.path),
			workspaceFolder: runtime.workspaceFolder,
			relativePath: sidecar.path
		});
		if (!snapshot || snapshot.items.length > 0) {
			return false;
		}
	}
	return true;
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
	const classification = await classifyTemplateMetadataState(runtime, canvases);
	if (classification.state === 'next') {
		return;
	}
	const pendingCanvases = classification.canvases;

	const appliedCanvases: IBaseHalfTemplateCanvasMutation[] = [];
	try {
		for (const change of pendingCanvases) {
			throwIfTemplateCreationCancelled(cancellationToken);
			await runtime.canvasMirror.transitionCanvasState(change.folder, change.transition, lease);
			appliedCanvases.push(change);
		}
		throwIfTemplateCreationCancelled(cancellationToken);
	} catch (error) {
		const rollbackErrors: unknown[] = [];
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
	canvases: readonly IBaseHalfTemplateCanvasMutation[]
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
	return {
		state: sawExpected ? sawNext ? 'mixed' : 'expected' : sawNext ? 'next' : 'expected',
		canvases: Object.freeze(pendingCanvases)
	};
}

function reverseTemplateCanvasTransition(transition: IBaseHalfCanvasStateTransition): IBaseHalfCanvasStateTransition {
	return {
		cards: transition.cards?.map(card => ({ ...card, expected: card.next, next: card.expected })),
		edges: transition.edges?.map(edge => ({ ...edge, expected: edge.next, next: edge.expected }))
	};
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

export async function createTemplateProjectFiles(
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

export async function rollbackCancelledTemplateCreation(
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

export function throwIfTemplateCreationCancelled(cancellationToken: CancellationToken): void {
	if (cancellationToken.isCancellationRequested) {
		throw new CancellationError();
	}
}

export async function assertTemplateProjectPathSafe(fileService: IFileService, workspaceFolder: URI, resource: URI): Promise<void> {
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

export function pushTemplateCreationUndo(runtime: IBaseHalfTemplateSetupRuntime, files: readonly IBaseHalfTemplateProjectFile[]): void {
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
		...plan.canvases.map(change => runtime.canvasMirror.canvasResource(change.folder))
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
		// An undo copy is a working file: git must not show it.
		await baseHalfEnsureMirrorIgnoreFile(runtime.fileService, runtime.workspaceFolder);
		await runtime.fileService.createFolder(dirname(stashResource));
		// The window is told the project's delete, not a move into the private undo copy.
		await runtime.fileService.move(runtime.projectResource, stashResource, false, FileOperation.DELETE);
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
	// The window is told the project's creation, not a move out of the private undo copy.
	await runtime.fileService.move(stashResource, runtime.projectResource, false, FileOperation.CREATE);
	try {
		await assertTemplateProjectPathSafe(runtime.fileService, runtime.workspaceFolder, runtime.projectResource);
		await applyTemplateMetadataPlan(runtime, plan, 'forward', lease);
	} catch (error) {
		try {
			await assertExactTemplateProjectTree(runtime.fileService, runtime.projectResource, directories, files);
			await runtime.fileService.createFolder(dirname(stashResource));
			await runtime.fileService.move(runtime.projectResource, stashResource, false, FileOperation.DELETE);
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
	const classification = await classifyTemplateMetadataState(runtime, plan.canvases);
	if (classification.state !== expected) {
		throw new Error(`The canvas setup metadata changed after this history action was recorded. ${consequence}`);
	}
}

export async function assertExactTemplateProjectTree(
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

export async function templateSourceDigest(source: string): Promise<string> {
	return templateBytesDigest(new TextEncoder().encode(source));
}

export async function templateBytesDigest(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Discards the version 1 pending template setups of an older build. Their
 * references were pending as badge pairs and their digests exclude the
 * `upstream` lists this build writes, so they cannot be finished. Each
 * discarded setup is named in a warning; its project files are kept.
 */
export function discardLegacyBaseHalfPendingTemplateSetups(
	storageService: IStorageService,
	notificationService: INotificationService
): readonly IBaseHalfPendingTemplateSetup[] {
	const raw = storageService.get(LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);
	if (raw === undefined) {
		return [];
	}
	storageService.remove(LEGACY_PENDING_TEMPLATE_SETUPS_STORAGE_KEY, StorageScope.WORKSPACE);
	const discarded = parseBaseHalfPendingTemplateSetups(raw);
	for (const setup of discarded) {
		notificationService.warn(localize(
			'basehalf.canvas.template.legacySetupDiscarded',
			"The incomplete canvas setup '{0}' in '{1}' was started by an earlier BaseHalf version and can't be finished. Its files were kept; connect them again on the canvas if needed.",
			setup.templateLabel,
			setup.projectRelativePath
		));
	}
	return discarded;
}

export function readPendingTemplateSetups(storageService: IStorageService): readonly IBaseHalfPendingTemplateSetup[] {
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

export function storePendingTemplateSetup(storageService: IStorageService, setup: IBaseHalfPendingTemplateSetup): void {
	writePendingTemplateSetups(storageService, [
		...readPendingTemplateSetups(storageService).filter(candidate => candidate.id !== setup.id),
		setup
	]);
}

export function removePendingTemplateSetup(storageService: IStorageService, id: string): void {
	writePendingTemplateSetups(storageService, readPendingTemplateSetups(storageService).filter(candidate => candidate.id !== id));
}

export async function availableTemplateFolderName(
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

export function templateDirectories(paths: readonly string[]): readonly string[] {
	const directories = new Set<string>();
	for (const path of paths) {
		const segments = path.split('/');
		for (let index = 1; index < segments.length; index++) {
			directories.add(segments.slice(0, index).join('/'));
		}
	}
	return [...directories].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}

export function joinProjectPath(root: URI, relativePath: string): URI {
	return joinPath(root, ...relativePath.split('/'));
}

export function joinCanvasPath(parent: string, child: string): string {
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

/**
 * What a draft of a template starts with (reference graph, "Templates"): the
 * template's prompt, and the provider, model, mode, and values of the last
 * generation of its kind on this computer, made legal for the model, as New
 * Image, New Video, and New Audio do. Read when the draft is made.
 */
export function templateDraftInfo(catalogService: IBaseHalfVideoCatalogService, providerSettings: IBaseHalfVideoProviderSettingsService): (draft: IBaseHalfCanvasTemplateDraft) => IBaseHalfGenerationInfo {
	return draft => {
		const catalog = catalogService.state;
		const choice = baseHalfVideoInitialGeneration(
			providerSettings.getLastUsed(draft.kind),
			catalog.kind === 'ready' ? catalog.catalog : undefined,
			draft.kind,
			provider => providerSettings.getStatus(provider).region.id
		);
		return { prompt: draft.prompt, ...choice };
	};
}
