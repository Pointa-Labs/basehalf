/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { dirname, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { FileOperation, FileOperationError, FileOperationResult, FileSystemProviderCapabilities, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IFileOperationUndoRedoInfo, IWorkingCopyFileOperationPreconditionGuard, IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IBaseHalfAdhdMirrorService } from '../common/basehalfAdhdMirror.js';
import { BaseHalfBadgeKind, BaseHalfBadgeMirrorCorrupt, IBaseHalfBadgeMirrorService, IBaseHalfBadgeNode } from '../common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../common/basehalfCanvasViewportState.js';
import { BaseHalfCardDetailProjection } from '../common/basehalfCardDetail.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfCommitMirrorFile } from '../common/basehalfMirrorFileCommit.js';
import {
	baseHalfIsMirrorSubtree,
	baseHalfAssertMirrorPathComponentsNotSymbolicLink,
	baseHalfMirrorPathSegments,
	baseHalfMirrorResource,
	baseHalfMirrorRoot,
	baseHalfRemapSubtreeRel,
	baseHalfWalkMirror
} from '../common/basehalfMirrorTree.js';
import { BaseHalfMirrorCascadeStageError, baseHalfForgetCanvasViewportsForStructuralChange, baseHalfMirrorCascadeCompletedMutations, baseHalfMoveCrossesWorkspaceRoots, baseHalfPrepareStructuralDetail, baseHalfRelocateBadgeText, baseHalfRunRequiredCascadeStages, baseHalfShouldRepublishCascadeRecoveryPrompt, baseHalfStructuralOperationAffectsResource } from '../common/basehalfMirrorCascadeOperation.js';
import { BASEHALF_UPSTREAM_SIDECAR_FILE_NAME } from '../common/basehalfReferenceStore.js';
import { IBaseHalfStructuralMutationReservation, IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';
import { baseHalfStructuralEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import { IBaseHalfNodeExecutionService } from './basehalfNodeExecutionService.js';
import { IBaseHalfOwnedStagedDeleteCleanup, IBaseHalfPluginStructuralDeleteCleanupService, rollbackBaseHalfUncompletedDeleteCleanups, settleBaseHalfStagedDeleteCleanups } from './basehalfPluginStructuralDeleteCleanup.js';

const BADGE_FILE_NAME = 'badge.yaml';
const APPEARANCE_FILE_NAME = 'appearance.yaml';
/** Largest per-node mirror file a relocation reads (badge.yaml is capped at 128 KiB). */
const MIRROR_FILE_MAX_BYTES = 1024 * 1024;

interface IBaseHalfPreparedStructuralOperation {
	readonly operation: FileOperation.MOVE | FileOperation.DELETE;
	readonly reservation: IBaseHalfStructuralMutationReservation;
	readonly undoRedoGroup: UndoRedoGroup | undefined;
	readonly stagedDeleteCleanups: IBaseHalfOwnedStagedDeleteCleanup[];
	completedFileCount: number;
	deleteCleanupsSettled: boolean;
	finalizationSucceeded: boolean;
	finalized: boolean;
	published: boolean;
	publication?: Promise<void>;
}

interface IBaseHalfCascadeStage {
	readonly label: string;
	run(lease: IBaseHalfWorkspaceMutationLease): Promise<void>;
}

interface IBaseHalfCascadePlan {
	readonly workspaceFolder: URI;
	readonly description: string;
	readonly stages: readonly IBaseHalfCascadeStage[];
}

interface IBaseHalfPendingCascadeRecovery {
	readonly workspaceFolders: readonly URI[];
	readonly description: string;
	readonly stages: readonly IBaseHalfCascadeStage[];
	readonly lease: IBaseHalfWorkspaceMutationLease;
	readonly completion: Promise<void>;
	resolveCompletion(): void;
	rejectCompletion(error: unknown): void;
	nextStage: number;
	lastFailure: unknown;
	running?: Promise<void>;
	notification?: { readonly handle: INotificationHandle; suppressed: boolean };
	notificationRepublishQueued?: boolean;
}

/**
 * Keeps `.bh/mirror/` in step with the files it annotates. The mirror is
 * addressed by workspace-relative path, so when a node moves or dies its own
 * mirror files must follow or fall away.
 *
 * In-app file operations (Explorer rename/delete, card renames, extension
 * `workspace.fs` calls) all flow through `IWorkingCopyFileService`; this
 * contribution listens there and cascades, for the moved or deleted node and
 * every node below it:
 *
 *  - MOVE   → canvas relocate (geometry + edge anchor rows), ADHD reading
 *             aids relocate, and the node's own `badge.yaml` (description),
 *             `appearance.yaml`, and `upstream.yaml` (its upstream list, D37)
 *             move with its mirror directory. The per-machine canvas viewports
 *             of the moved subtree (and of a replaced destination) are
 *             forgotten.
 *  - DELETE → canvas purge, ADHD dropped, the node's badge retired, and the
 *             canvas viewports of the subtree forgotten. A delete to the trash
 *             keeps `upstream.yaml`, so a restore brings the upstream list
 *             back; a permanent delete removes it.
 *
 * The cascade never changes another node's upstream list: entries that named
 * a moved or deleted node become dangling and stay visible until the rename
 * refactor the user confirms (reference graph, "Removed cascades"). Recipe
 * input bindings are not rewritten or removed either; a binding to a deleted
 * source shows as a missing source. The one cross-node rewrite is of legacy
 * `references` and `referenced_by` badge items that name a moved path, so a
 * pair a migration has not moved yet stays complete.
 *
 * Operations that happen OUTSIDE the app (a terminal `mv`, an agent's tools)
 * don't pass through the working-copy service. On workspace open every badge
 * whose disk node is gone is marked `orphan`, preserving its description, and
 * a file reappearing clears the flag again via file events.
 *
 * All cascades run on one FIFO queue so two rapid operations (rename A→B, then
 * B→C) can never interleave their multi-file rewrites.
 */
export class BaseHalfMirrorCascadeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.mirrorCascade';

	private queue: Promise<void> = Promise.resolve();
	private readonly pendingCascadeRecoveries = new Set<IBaseHalfPendingCascadeRecovery>();
	private disposed = false;

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@IBaseHalfCanvasViewportStateService private readonly viewportStateService: IBaseHalfCanvasViewportStateService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfNodeExecutionService private readonly nodeExecutionService: IBaseHalfNodeExecutionService,
		@IBaseHalfPluginStructuralDeleteCleanupService private readonly pluginStructuralDeleteCleanupService: IBaseHalfPluginStructuralDeleteCleanupService
	) {
		super();

		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: (files, operation, undoInfo, token) => this.prepareStructuralDetail(files, operation, undoInfo, token)
		}));

		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				this.handleAppeared(resource);
			}
		}));

		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const added of event.added) {
				this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(added.uri, () => this.sweepOrphans(added.uri)));
			}
		}));

		for (const folder of this.contextService.getWorkspace().folders) {
			this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(folder.uri, () => this.sweepOrphans(folder.uri)));
		}
	}

	private async prepareStructuralDetail(files: readonly SourceTargetPair[], operation: FileOperation, undoInfo: IFileOperationUndoRedoInfo | undefined, token: CancellationToken): Promise<IWorkingCopyFileOperationPreconditionGuard | void> {
		if (operation !== FileOperation.MOVE && operation !== FileOperation.DELETE) {
			return;
		}
		if (operation === FileOperation.MOVE && baseHalfMoveCrossesWorkspaceRoots(files, resource => this.contextService.getWorkspaceFolder(resource)?.uri)) {
			throw new Error(localize('basehalf.mirrorCascade.crossRootMove', "Moving an item between workspace folders is not supported, because upstream lists can only name items in their own workspace folder."));
		}
		const executionFence = await this.nodeExecutionService.acquireStructuralOperation(operation, files, token);
		const affectedPaths = this.operationAffectedPaths(files);
		const workspaces = this.operationWorkspaces(files);
		if (affectedPaths.length === 0 || workspaces.length === 0) {
			return executionFence;
		}
		const pendingRecovery = this.pendingRecoveryFor(workspaces);
		if (pendingRecovery) {
			executionFence.dispose();
			throw new Error(`A file operation is still finalizing BaseHalf metadata for ${pendingRecovery.description}. Use the Retry action in Notifications before changing these paths again.`);
		}

		// This is deliberately the first await boundary in BaseHalf's prepare:
		// commit order is the order operations reach this hard barrier after VS
		// Code participants complete, not the order of un-awaited API calls.
		let context: IBaseHalfPreparedStructuralOperation;
		try {
			context = {
				operation,
				reservation: this.workspaceMutationCoordinator.reserveStructural(workspaces, affectedPaths),
				undoRedoGroup: undoInfo?.undoRedoGroup,
				stagedDeleteCleanups: [],
				completedFileCount: 0,
				deleteCleanupsSettled: false,
				finalizationSucceeded: false,
				finalized: false,
				published: false
			};
		} catch (error) {
			executionFence.dispose();
			throw error;
		}
		let fence: IDisposable | undefined;
		try {
			await context.reservation.ready;
			if (this.disposed) {
				throw new Error('BaseHalf mirror cascade was disposed before the file operation reached its commit barrier.');
			}
			const activeEditor = this.activeEditorProjection();
			const preparedFence = await baseHalfPrepareStructuralDetail(
				operation,
				files,
				activeEditor?.resource,
				() => {
					const fences = new DisposableStore();
					for (const path of affectedPaths) {
						fences.add(this.workspaceMutationCoordinator.acquireResourceMutationFence(path.workspace, path.relativePath));
					}
					return fences;
				},
				async () => this.flushAffectedActiveProjection(files, operation)
			);
			fence = preparedFence || undefined;
			if (operation === FileOperation.DELETE && !undoInfo?.isUndoing) {
				await context.reservation.runPrepared(async lease => {
					context.stagedDeleteCleanups.push(...await this.pluginStructuralDeleteCleanupService.stageDelete(files, token, lease));
				});
			}
			let disposed = false;
			return {
				didRun: completedFiles => this.finalizePreparedOperation(context, completedFiles, false),
				didFail: completedFiles => this.finalizePreparedOperation(context, completedFiles, true),
				afterPublicEvents: operationSucceeded => this.completePreparedOperation(context, operationSucceeded),
				dispose: () => {
					if (disposed) {
						return;
					}
					disposed = true;
					if (context.finalized) {
						if (!context.published) {
							void this.publishPreparedOperation(context);
						}
					} else {
						void this.abortPreparedOperation(context);
					}
					fence?.dispose();
					executionFence.dispose();
				}
			};
		} catch (error) {
			fence?.dispose();
			executionFence.dispose();
			await this.abortPreparedOperation(context);
			throw error;
		}
	}

	private async flushAffectedActiveProjection(files: readonly SourceTargetPair[], operation: FileOperation): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const inlineEditor = this.canvasNavigationService.activeCanvasEditor;
			if (inlineEditor && baseHalfStructuralOperationAffectsResource(operation, files, inlineEditor.resource)) {
				if (!await inlineEditor.prepareToClose()) {
					return false;
				}
				if (this.canvasNavigationService.activeCanvasEditor === inlineEditor) {
					return false;
				}
				continue;
			}
			const activeEditor = this.activeEditorProjection();
			if (!activeEditor || !baseHalfStructuralOperationAffectsResource(operation, files, activeEditor.resource)) {
				return true;
			}
			const identity = `${activeEditor.resource.toString()}\0${activeEditor.projection}`;
			if (!await this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, baseHalfStructuralEditorFlushOptions(activeEditor.projection))) {
				return false;
			}
			const current = this.activeEditorProjection();
			if (`${current?.resource.toString()}\0${current?.projection}` === identity) {
				return true;
			}
		}
		return false;
	}

	private activeEditorProjection(): { readonly resource: URI; readonly projection: BaseHalfCardDetailProjection } | undefined {
		const detail = this.canvasNavigationService.state.cardDetail;
		if (detail) {
			return detail;
		}
		const inlineEditor = this.canvasNavigationService.activeCanvasEditor;
		return inlineEditor ? { resource: inlineEditor.resource, projection: 'rich' } : undefined;
	}

	override dispose(): void {
		this.disposed = true;
		for (const recovery of this.pendingCascadeRecoveries) {
			this.cancelCascadeRecovery(recovery);
		}
		super.dispose();
	}

	private async publishPreparedOperation(context: IBaseHalfPreparedStructuralOperation): Promise<void> {
		if (!context.finalized || context.published) {
			return;
		}
		if (!context.publication) {
			const publication = context.reservation.publish();
			context.publication = publication;
			void publication.then(undefined, () => {
				if (!context.published && context.publication === publication) {
					context.publication = undefined;
				}
			});
		}
		await context.publication;
		context.published = true;
	}

	private async completePreparedOperation(context: IBaseHalfPreparedStructuralOperation, operationSucceeded: boolean): Promise<void> {
		if (!context.deleteCleanupsSettled) {
			context.deleteCleanupsSettled = true;
			const canJoinFileUndo = operationSucceeded
				&& context.finalizationSucceeded
				&& context.completedFileCount > 0
				&& context.undoRedoGroup !== undefined;
			settleBaseHalfStagedDeleteCleanups(
				context.stagedDeleteCleanups,
				context.completedFileCount,
				canJoinFileUndo ? context.undoRedoGroup : undefined
			);
		}
		await this.publishPreparedOperation(context);
	}

	private async finalizePreparedOperation(context: IBaseHalfPreparedStructuralOperation, completedFiles: readonly SourceTargetPair[], failed: boolean): Promise<void> {
		if (context.finalized) {
			return;
		}
		context.finalized = true;
		context.completedFileCount = completedFiles.length;
		if (!failed) {
			try {
				await context.reservation.finishInternal(
					lease => this.handleOperation(context.operation, completedFiles, lease),
					baseHalfMirrorCascadeCompletedMutations(context.operation, completedFiles)
				);
				context.finalizationSucceeded = true;
			} catch (error) {
				// The physical operation completed, so every staged cleanup must
				// remain even though no file undo element will be published.
				throw error;
			}
		} else if (completedFiles.length === 0) {
			let rollbackError: unknown;
			try {
				await context.reservation.runPrepared(lease => rollbackBaseHalfUncompletedDeleteCleanups(context.stagedDeleteCleanups, 0, lease));
			} catch (error) {
				rollbackError = error;
			} finally {
				await context.reservation.abortInternal();
			}
			if (rollbackError !== undefined) {
				throw rollbackError;
			}
		} else {
			this.logService.warn(`BaseHalf mirror cascade: ${context.operation === FileOperation.MOVE ? 'move' : 'delete'} batch failed after ${completedFiles.length} member(s) reached disk; reconciling the completed prefix`);
			await context.reservation.reconcileInternal(
				baseHalfMirrorCascadeCompletedMutations(context.operation, completedFiles),
				async lease => {
					await rollbackBaseHalfUncompletedDeleteCleanups(context.stagedDeleteCleanups, completedFiles.length, lease);
					await this.handleOperation(context.operation, completedFiles, lease);
				}
			);
		}
	}

	private async abortPreparedOperation(context: IBaseHalfPreparedStructuralOperation): Promise<void> {
		if (context.finalized) {
			return;
		}
		context.finalized = true;
		let rollbackError: unknown;
		try {
			await context.reservation.runPrepared(lease => rollbackBaseHalfUncompletedDeleteCleanups(context.stagedDeleteCleanups, 0, lease));
			context.deleteCleanupsSettled = true;
		} catch (error) {
			rollbackError = error;
		} finally {
			await context.reservation.cancel();
		}
		if (rollbackError !== undefined) {
			throw rollbackError;
		}
	}

	private async handleOperation(operation: FileOperation.MOVE | FileOperation.DELETE, files: readonly SourceTargetPair[], lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		baseHalfForgetCanvasViewportsForStructuralChange(this.viewportStateService, operation, files);
		const plans: IBaseHalfCascadePlan[] = [];
		for (const pair of files) {
			if (operation === FileOperation.MOVE && pair.source) {
				const plan = this.planCascadeMove(pair.source, pair.target);
				if (plan) {
					plans.push(plan);
				}
			} else if (operation === FileOperation.DELETE) {
				const plan = this.planCascadeDelete(pair.target, !this.deletesToTrash(pair.target));
				if (plan) {
					plans.push(plan);
				}
			}
		}
		if (plans.length === 0) {
			return;
		}

		// A working-copy batch is one ordered physical fact. Keep every pair in
		// that same order behind ONE recovery cursor: if pair 1 stops at Canvas,
		// no stage from pair 2 may observe or mutate the half-reconciled mirror.
		// Recovery resumes the failed stage and then drains the untouched suffix.
		const workspaceFolders = [...new Map(plans.map(plan => [plan.workspaceFolder.toString(), plan.workspaceFolder])).values()];
		const description = plans.length === 1
			? plans[0].description
			: `${operation === FileOperation.MOVE ? 'move' : 'delete'} batch (${plans.map(plan => plan.description).join(', ')})`;
		await this.runCascadeStagesOrRecover(
			workspaceFolders,
			description,
			plans.flatMap(plan => plan.stages),
			lease
		);
	}

	/**
	 * Whether a workbench delete of `resource` goes to the trash. The working
	 * copy precondition does not receive the delete's `useTrash` option, so
	 * this follows the same rule the canvas and Explorer use to choose it:
	 * `files.enableTrash` and a provider that supports the trash.
	 */
	private deletesToTrash(resource: URI): boolean {
		return this.configurationService.getValue<boolean>('files.enableTrash') !== false
			&& this.fileService.hasCapability(resource, FileSystemProviderCapabilities.Trash);
	}

	private planCascadeMove(source: URI, target: URI): IBaseHalfCascadePlan | undefined {
		const from = this.workspaceLocation(source);
		const to = this.workspaceLocation(target);
		if (from && !to) {
			// Moved OUT of the workspace: the mirror cannot follow, and nothing
			// can restore the node here, so this is a permanent delete.
			return this.planCascadeDelete(source, true);
		}
		if (!from || !to || from.workspaceFolder.toString() !== to.workspaceFolder.toString()) {
			return undefined;
		}

		const workspaceFolder = from.workspaceFolder;
		const sameResourceIdentity = this.uriIdentityService.extUri.isEqual(source, target);
		if (sameResourceIdentity) {
			// The user-file provider has already committed the casing change. Mirror
			// files still contain the old logical paths, so first rename the ONE
			// physical mirror subtree (which carries badge.yaml, appearance.yaml, and
			// upstream.yaml) and then rewrite every projection in place. Do not route
			// this branch through best-effort steps: half of a same-resource identity
			// rewrite would leave aliased YAML that cannot be repaired by a later
			// ordinary rename.
			return {
				workspaceFolder,
				description: `"${from.relativePath}" → "${to.relativePath}"`,
				stages: [
					{
						label: 'mirror directory casing',
						run: () => this.relocateMirrorDirectoryIdentity(workspaceFolder, from.relativePath, to.relativePath)
					},
					{
						label: 'canvas identity rewrite',
						run: activeLease => this.canvasMirrorService.relocateNodeIdentity(workspaceFolder, from.relativePath, to.relativePath, activeLease)
					},
					{
						label: 'ADHD identity rewrite',
						run: activeLease => this.relocateAdhd(workspaceFolder, from.relativePath, to.relativePath, true, activeLease)
					},
					{
						label: 'badge identity rewrite',
						run: () => this.rewriteBadgeIdentities(workspaceFolder, to.relativePath)
					},
					{
						label: 'legacy connection paths',
						run: () => this.renameLegacyConnectionPaths(workspaceFolder, from.relativePath, to.relativePath)
					}
				]
			};
		}

		return {
			workspaceFolder,
			description: `"${from.relativePath}" → "${to.relativePath}"`,
			stages: [
				{
					label: 'canvas subtree relocation',
					run: activeLease => this.canvasMirrorService.relocateNode(
						workspaceFolder,
						from.relativePath,
						to.relativePath,
						{ retireDestination: true },
						activeLease
					)
				},
				{
					label: 'destination ADHD retirement',
					run: activeLease => this.retireAdhd(workspaceFolder, to.relativePath, activeLease)
				},
				{
					label: 'ADHD subtree relocation',
					run: activeLease => this.relocateAdhd(workspaceFolder, from.relativePath, to.relativePath, false, activeLease)
				},
				this.mirrorFileRelocationStage('badge subtree relocation', workspaceFolder, from.relativePath, to.relativePath, BADGE_FILE_NAME),
				this.mirrorFileRelocationStage('appearance subtree relocation', workspaceFolder, from.relativePath, to.relativePath, APPEARANCE_FILE_NAME),
				this.mirrorFileRelocationStage('upstream list relocation', workspaceFolder, from.relativePath, to.relativePath, BASEHALF_UPSTREAM_SIDECAR_FILE_NAME),
				{
					label: 'legacy connection paths',
					run: () => this.renameLegacyConnectionPaths(workspaceFolder, from.relativePath, to.relativePath)
				}
			]
		};
	}

	private planCascadeDelete(resource: URI, permanent: boolean): IBaseHalfCascadePlan | undefined {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return undefined;
		}

		const { workspaceFolder, relativePath } = location;
		const stages: IBaseHalfCascadeStage[] = [
			{
				label: 'canvas subtree retirement',
				run: activeLease => this.canvasMirrorService.purgeNode(workspaceFolder, relativePath, activeLease)
			},
			{
				label: 'ADHD subtree retirement',
				run: activeLease => this.retireAdhd(workspaceFolder, relativePath, activeLease)
			},
			{
				label: 'badge subtree retirement',
				run: () => this.retireBadges(workspaceFolder, relativePath)
			}
		];
		if (permanent) {
			// A delete to the trash keeps every upstream.yaml of the subtree so a
			// restore brings the upstream lists back (the index treats them as
			// naming a missing node until then).
			stages.push({
				label: 'upstream list removal',
				run: () => this.removeUpstreamLists(workspaceFolder, relativePath)
			});
		}
		return {
			workspaceFolder,
			description: `delete "${relativePath}"`,
			stages
		};
	}

	/**
	 * A stage that moves one kind of per-node mirror file of a moved subtree to
	 * the new paths. Destination files that no incoming file replaces belong to
	 * a replaced or deleted node and are retired. That set is computed on the
	 * first run only, so a retry never retires a file this stage already moved
	 * in. `upstream.yaml` is neither moved nor retired in a folder marked with
	 * the source-tree marker, where BaseHalf writes no upstream.yaml.
	 */
	private mirrorFileRelocationStage(label: string, workspaceFolder: URI, from: string, to: string, fileName: string): IBaseHalfCascadeStage {
		let retired: readonly string[] | undefined;
		return {
			label,
			run: async () => {
				if (fileName === BASEHALF_UPSTREAM_SIDECAR_FILE_NAME && await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
					return;
				}
				const entries = await baseHalfWalkMirror(this.fileService, workspaceFolder, fileName);
				const sources = entries.filter(entry => baseHalfIsMirrorSubtree(entry.relativePath, from));
				if (!retired) {
					const incoming = new Set(sources.map(entry => baseHalfRemapSubtreeRel(entry.relativePath, from, to)));
					retired = entries
						.filter(entry => baseHalfIsMirrorSubtree(entry.relativePath, to) && !incoming.has(entry.relativePath))
						.map(entry => entry.relativePath);
				}
				for (const path of retired) {
					if (fileName === BADGE_FILE_NAME) {
						await this.retireBadge(workspaceFolder, path);
					} else {
						await this.deleteMirrorFile(workspaceFolder, baseHalfMirrorResource(workspaceFolder, path, fileName));
					}
				}
				for (const source of sources) {
					const targetPath = baseHalfRemapSubtreeRel(source.relativePath, from, to);
					await this.moveMirrorFile(workspaceFolder, source.resource, baseHalfMirrorResource(workspaceFolder, targetPath, fileName), fileName === BADGE_FILE_NAME ? targetPath : undefined);
				}
			}
		};
	}

	/**
	 * Moves one mirror file. A relocated `badge.yaml` gets its new `path`; every
	 * other byte travels unchanged, so legacy reference keys a migration has
	 * not removed yet move with the badge. The target is written against its
	 * current bytes before the source is removed against the bytes that were
	 * copied, so a retry after a partial move finishes it without loss.
	 */
	private async moveMirrorFile(workspaceFolder: URI, source: URI, target: URI, badgePath: string | undefined): Promise<void> {
		const bytes = await this.readMirrorFile(workspaceFolder, source);
		if (bytes === null) {
			return;
		}
		let next = bytes;
		if (badgePath !== undefined) {
			const relocated = baseHalfRelocateBadgeText(bytes.toString(), badgePath);
			if (relocated !== undefined) {
				next = VSBuffer.fromString(relocated);
			}
		}
		const current = await this.readMirrorFile(workspaceFolder, target);
		if (!current?.equals(next)) {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, target);
			await this.fileService.createFolder(dirname(target));
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, target);
			await baseHalfCommitMirrorFile(this.fileService, target, next, current);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, target);
		}
		await this.deleteMirrorFile(workspaceFolder, source, bytes);
	}

	/** Reads a mirror file, or `null` when it does not exist. */
	private async readMirrorFile(workspaceFolder: URI, resource: URI): Promise<VSBuffer | null> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		try {
			return (await this.fileService.readFile(resource, { atomic: true, limits: { size: MIRROR_FILE_MAX_BYTES } })).value;
		} catch (error) {
			if (isFileNotFound(error)) {
				return null;
			}
			throw error;
		}
	}

	/** Deletes one mirror file (never a directory); with `expected`, only while it still has those bytes. */
	private async deleteMirrorFile(workspaceFolder: URI, resource: URI, expected?: VSBuffer): Promise<void> {
		if (expected) {
			const current = await this.readMirrorFile(workspaceFolder, resource);
			if (current === null) {
				return;
			}
			if (!current.equals(expected)) {
				throw new FileOperationError(`${resource.toString()} changed before it could be moved`, FileOperationResult.FILE_MODIFIED_SINCE);
			}
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		try {
			await this.fileService.del(resource, { recursive: false, useTrash: false, atomic: false });
		} catch (error) {
			if (!isFileNotFound(error)) {
				throw error;
			}
		}
	}

	/** Case-only rename: the mirror directory already has the new casing, so
	 * give every badge below it the path of its (renamed) mirror location. */
	private async rewriteBadgeIdentities(workspaceFolder: URI, to: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, BADGE_FILE_NAME)) {
			if (!baseHalfIsMirrorSubtree(entry.relativePath, to)) {
				continue;
			}
			const bytes = await this.readMirrorFile(workspaceFolder, entry.resource);
			const relocated = bytes === null ? undefined : baseHalfRelocateBadgeText(bytes.toString(), entry.relativePath);
			if (bytes === null || relocated === undefined || relocated === bytes.toString()) {
				continue;
			}
			await baseHalfCommitMirrorFile(this.fileService, entry.resource, VSBuffer.fromString(relocated), bytes);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, entry.resource);
		}
	}

	/**
	 * Legacy pairs before migration: every badge's legacy `references` and
	 * `referenced_by` items that name the moved path, or a path below it, are
	 * renamed the way releases before D37 renamed badge graph endpoints, so an
	 * unmigrated pair stays complete. It runs after the badges themselves
	 * moved. Only legacy keys change, never an upstream value, and nothing is
	 * written in a folder marked with the source-tree marker, where no
	 * migration runs.
	 */
	private async renameLegacyConnectionPaths(workspaceFolder: URI, from: string, to: string): Promise<void> {
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			return;
		}
		const rename = (item: string) => baseHalfIsMirrorSubtree(item, from) ? baseHalfRemapSubtreeRel(item, from, to) : undefined;
		const { entries } = await this.badgeMirrorService.listLegacyReferences(workspaceFolder);
		for (const entry of entries) {
			if (![...entry.references ?? [], ...entry.referencedBy ?? []].some(item => rename(item) !== undefined)) {
				continue;
			}
			await this.badgeMirrorService.renameLegacyReferences(this.badgeNode(workspaceFolder, entry.relativePath, entry.kind ?? 'file'), rename);
		}
	}

	/** Retires the node's own badge and those below it. Nothing else is
	 * touched: no other badge is rewritten or scrubbed. */
	private async retireBadges(workspaceFolder: URI, subtree: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, BADGE_FILE_NAME)) {
			if (baseHalfIsMirrorSubtree(entry.relativePath, subtree)) {
				await this.retireBadge(workspaceFolder, entry.relativePath);
			}
		}
	}

	/** Clears the badge's description and orphan flag. The badge mirror keeps
	 * legacy reference keys verbatim until a migration removes them. A corrupt
	 * badge is left for the user to fix rather than blocking the operation. */
	private async retireBadge(workspaceFolder: URI, relativePath: string): Promise<void> {
		try {
			await this.badgeMirrorService.patchBadge(this.badgeNode(workspaceFolder, relativePath, 'file'), () => null);
		} catch (error) {
			if (!(error instanceof BaseHalfBadgeMirrorCorrupt)) {
				throw error;
			}
			this.logService.warn(`BaseHalf mirror cascade: left corrupt badge ${error.resource.toString()} in place: ${error.reason}`);
		}
	}

	/** Permanent delete: removes the upstream.yaml of the node and of every node below it. */
	private async removeUpstreamLists(workspaceFolder: URI, subtree: string): Promise<void> {
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			return;
		}
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, BASEHALF_UPSTREAM_SIDECAR_FILE_NAME)) {
			if (baseHalfIsMirrorSubtree(entry.relativePath, subtree)) {
				await this.deleteMirrorFile(workspaceFolder, entry.resource);
			}
		}
	}

	private async relocateMirrorDirectoryIdentity(workspaceFolder: URI, from: string, to: string): Promise<void> {
		const source = URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(from));
		const target = URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(to));
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, source);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, target);
			await this.fileService.move(source, target);
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, target);
		} catch (error) {
			if (!isFileNotFound(error)) {
				throw error;
			}
			// The mirror is sparse. A node with no mirror directory has no identity
			// bytes to relocate, and every following rewrite is naturally a no-op.
		}
	}

	/** A file/folder appeared on disk (in-app or external): if it has an
	 *  orphaned badge, the node is back — clear the flag so its description
	 *  rejoins the live overlay. Guarded by a cheap existence probe of the
	 *  badge.yaml so bulk file creations don't schedule badge work. */
	private handleAppeared(resource: URI): void {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return;
		}

		this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(location.workspaceFolder, async () => {
			const node = this.badgeNode(location.workspaceFolder, location.relativePath, 'file');
			if (!(await this.fileService.exists(this.badgeMirrorService.badgeResource(node)))) {
				return;
			}
			const badge = await this.badgeMirrorService.readBadge(node);
			if (badge?.orphan !== true) {
				return;
			}
			await this.badgeMirrorService.patchBadge(node, current => {
				if (current === null || current.orphan !== true) {
					return current;
				}
				const { orphan: _orphan, ...rest } = current;
				return rest;
			});
		}));
	}

	/** Marks every badge whose node is gone from disk as `orphan`, keeping its
	 * description. Folders marked with the source-tree marker are skipped. */
	private async sweepOrphans(workspaceFolder: URI): Promise<void> {
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			return;
		}
		const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
		const orphaned: string[] = [];
		for (const badge of badges.values()) {
			if (badge.orphan === true || await this.nodeExists(workspaceFolder, badge.path, badge.kind)) {
				continue;
			}
			await this.badgeMirrorService.patchBadge(
				this.badgeNode(workspaceFolder, badge.path, badge.kind),
				current => current === null ? null : { ...current, orphan: true }
			);
			orphaned.push(badge.path);
		}
		if (orphaned.length > 0) {
			this.logService.info(`BaseHalf mirror cascade: marked ${orphaned.length} badge(s) orphan (disk node gone): ${orphaned.join(', ')}`);
		}
	}

	private async nodeExists(workspaceFolder: URI, relativePath: string, kind: BaseHalfBadgeKind): Promise<boolean> {
		try {
			const stat = await this.fileService.stat(URI.joinPath(workspaceFolder, ...baseHalfMirrorPathSegments(relativePath)));
			return kind === 'folder' ? stat.isDirectory : stat.isFile;
		} catch {
			return false;
		}
	}

	/** Move every adhd.yaml under the subtree to the remapped location. Reading
	 * aids are authored user state, so an unreadable member is a required-stage
	 * failure with an explicit recovery cursor rather than a best-effort skip. */
	private async relocateAdhd(workspaceFolder: URI, from: string, to: string, sameResourceIdentity: boolean, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'adhd.yaml')) {
			const actualRoot = sameResourceIdentity ? to : from;
			if (!baseHalfIsMirrorSubtree(entry.relativePath, actualRoot)) {
				continue;
			}

			const oldRel = sameResourceIdentity
				? baseHalfRemapSubtreeRel(entry.relativePath, to, from)
				: entry.relativePath;
			const newRel = sameResourceIdentity
				? entry.relativePath
				: baseHalfRemapSubtreeRel(entry.relativePath, from, to);
			await this.adhdMirrorService.relocateAdhd(
				this.workspaceNode(workspaceFolder, oldRel),
				this.workspaceNode(workspaceFolder, newRel),
				{ sameResourceIdentity },
				lease
			);
		}
	}

	private async retireAdhd(workspaceFolder: URI, subtree: string, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'adhd.yaml')) {
			if (baseHalfIsMirrorSubtree(entry.relativePath, subtree)) {
				await this.adhdMirrorService.retireAdhd(this.workspaceNode(workspaceFolder, entry.relativePath), lease);
			}
		}
	}

	private async runCascadeStagesOrRecover(
		workspaceFolders: readonly URI[],
		description: string,
		stages: readonly IBaseHalfCascadeStage[],
		lease: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		try {
			await this.runCascadeStages(stages, 0, lease);
		} catch (error) {
			if (!(error instanceof BaseHalfMirrorCascadeStageError)) {
				throw error;
			}
			if (this.disposed) {
				// No notification/retry surface remains to resolve a deferred recovery.
				// Propagate so the reservation's finally path releases its lease.
				throw error;
			}

			let resolveCompletion!: () => void;
			let rejectCompletion!: (error: unknown) => void;
			const completion = new Promise<void>((resolve, reject) => {
				resolveCompletion = resolve;
				rejectCompletion = reject;
			});
			const recovery: IBaseHalfPendingCascadeRecovery = {
				workspaceFolders,
				description,
				stages,
				lease,
				completion,
				resolveCompletion,
				rejectCompletion,
				nextStage: error.stageIndex,
				lastFailure: error
			};
			this.pendingCascadeRecoveries.add(recovery);
			this.logService.error(`BaseHalf mirror cascade: ${description} stopped at required stage "${error.stageLabel}"`, error.failure);
			// The physical operation has committed, but the original structural lease
			// and editor fences remain held while this promise waits. Public outcomes,
			// later batch stages, and ordinary mirror mutations therefore cannot observe
			// or overtake half-reconciled metadata. Retry resumes on this SAME lease.
			this.showCascadeRecoveryFailure(recovery, error);
			await recovery.completion;
		}
	}

	private runCascadeStages(stages: readonly IBaseHalfCascadeStage[], startStage: number, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return baseHalfRunRequiredCascadeStages(
			stages.map(stage => ({ label: stage.label, run: () => stage.run(lease) })),
			startStage
		);
	}

	private async retryCascadeRecovery(recovery: IBaseHalfPendingCascadeRecovery): Promise<void> {
		if (this.disposed || !this.pendingCascadeRecoveries.has(recovery)) {
			return;
		}
		if (recovery.running) {
			await recovery.running;
			return;
		}

		this.closeCascadeRecoveryNotification(recovery);
		const running = (async () => {
			try {
				await this.runCascadeStages(recovery.stages, recovery.nextStage, recovery.lease);
				this.pendingCascadeRecoveries.delete(recovery);
				this.logService.info(`BaseHalf mirror cascade: recovered ${recovery.description}`);
				this.notificationService.info(`BaseHalf finished reconciling metadata for ${recovery.description}.`);
				recovery.resolveCompletion();
			} catch (error) {
				if (error instanceof BaseHalfMirrorCascadeStageError) {
					recovery.nextStage = error.stageIndex;
					this.logService.error(`BaseHalf mirror cascade recovery: ${recovery.description} still fails at "${error.stageLabel}"`, error.failure);
					this.showCascadeRecoveryFailure(recovery, error);
				} else {
					this.logService.error(`BaseHalf mirror cascade recovery failed for ${recovery.description}`, error);
					this.showCascadeRecoveryFailure(recovery, error);
				}
			}
		})();
		recovery.running = running;
		try {
			await running;
		} finally {
			if (recovery.running === running) {
				recovery.running = undefined;
			}
		}
	}

	private showCascadeRecoveryFailure(recovery: IBaseHalfPendingCascadeRecovery, error: unknown): void {
		if (this.disposed || !this.pendingCascadeRecoveries.has(recovery)) {
			return;
		}
		const stage = error instanceof BaseHalfMirrorCascadeStageError
			? error.stageLabel
			: recovery.stages[recovery.nextStage]?.label ?? 'unknown stage';
		recovery.lastFailure = error;
		this.closeCascadeRecoveryNotification(recovery);
		const handle = this.notificationService.prompt(
			Severity.Error,
			`The file operation ${recovery.description} completed on disk, but BaseHalf metadata stopped at “${stage}”. Concurrent .bh/mirror edits were preserved. Further file operations in this workspace are blocked until reconciliation succeeds.`,
			[{
				label: 'Retry metadata reconciliation',
				keepOpen: true,
				run: () => { void this.retryCascadeRecovery(recovery); }
			}],
			{ sticky: true }
		);
		const notification = { handle, suppressed: false };
		recovery.notification = notification;
		Event.once(handle.onDidClose)(() => {
			if (recovery.notification === notification) {
				recovery.notification = undefined;
			}
			this.scheduleCascadeRecoveryNotificationRepublish(recovery, notification.suppressed);
		});
	}

	private closeCascadeRecoveryNotification(recovery: IBaseHalfPendingCascadeRecovery): void {
		const notification = recovery.notification;
		if (!notification) {
			return;
		}
		notification.suppressed = true;
		recovery.notification = undefined;
		notification.handle.close();
	}

	private scheduleCascadeRecoveryNotificationRepublish(recovery: IBaseHalfPendingCascadeRecovery, closeWasSuppressed: boolean): void {
		const state = () => ({
			disposed: this.disposed,
			pending: this.pendingCascadeRecoveries.has(recovery),
			running: recovery.running !== undefined,
			hasNotification: recovery.notification !== undefined,
			closeWasSuppressed
		});
		if (!baseHalfShouldRepublishCascadeRecoveryPrompt(state()) || recovery.notificationRepublishQueued) {
			return;
		}
		recovery.notificationRepublishQueued = true;
		queueMicrotask(() => {
			recovery.notificationRepublishQueued = false;
			if (baseHalfShouldRepublishCascadeRecoveryPrompt(state())) {
				this.showCascadeRecoveryFailure(recovery, recovery.lastFailure);
			}
		});
	}

	private cancelCascadeRecovery(recovery: IBaseHalfPendingCascadeRecovery): void {
		this.closeCascadeRecoveryNotification(recovery);
		const reject = (): void => {
			if (!this.pendingCascadeRecoveries.delete(recovery)) {
				return;
			}
			recovery.rejectCompletion(new Error(`BaseHalf metadata recovery for ${recovery.description} was interrupted during workbench shutdown.`));
		};
		if (recovery.running) {
			void recovery.running.finally(reject);
		} else {
			reject();
		}
	}

	private pendingRecoveryFor(workspaces: readonly URI[]): IBaseHalfPendingCascadeRecovery | undefined {
		const keys = new Set(workspaces.map(workspace => workspace.toString()));
		return [...this.pendingCascadeRecoveries].find(recovery => recovery.workspaceFolders.some(workspace => keys.has(workspace.toString())));
	}

	private workspaceLocation(resource: URI): { workspaceFolder: URI; relativePath: string } | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		if (!folder) {
			return undefined;
		}

		const relative = getRelativePath(folder.uri, resource);
		if (!relative) {
			// The folder root itself, or an unrelated scheme — nothing to cascade.
			return undefined;
		}

		// Mirror-internal writes (the app or an agent editing `.bh/` itself) must
		// never recurse back into the cascade.
		if (relative === '.bh' || relative.startsWith('.bh/')) {
			return undefined;
		}

		return { workspaceFolder: folder.uri, relativePath: relative };
	}

	private operationWorkspaces(files: readonly SourceTargetPair[]): URI[] {
		const workspaces = new Map<string, URI>();
		for (const pair of files) {
			for (const resource of pair.source ? [pair.source, pair.target] : [pair.target]) {
				const folder = this.contextService.getWorkspaceFolder(resource);
				if (folder) {
					workspaces.set(folder.uri.toString(), folder.uri);
				}
			}
		}
		return [...workspaces.values()];
	}

	private operationAffectedPaths(files: readonly SourceTargetPair[]): Array<{ readonly workspace: URI; readonly relativePath: string }> {
		const affected = new Map<string, { readonly workspace: URI; readonly relativePath: string }>();
		for (const pair of files) {
			for (const resource of pair.source ? [pair.source, pair.target] : [pair.target]) {
				const location = this.workspaceLocation(resource);
				if (location) {
					affected.set(`${location.workspaceFolder.toString()}\0${location.relativePath}`, {
						workspace: location.workspaceFolder,
						relativePath: location.relativePath
					});
				}
			}
		}
		return [...affected.values()];
	}

	private workspaceNode(workspaceFolder: URI, relativePath: string): IBaseHalfWorkspaceResource {
		return {
			resource: URI.joinPath(workspaceFolder, ...baseHalfMirrorPathSegments(relativePath)),
			workspaceFolder,
			relativePath
		};
	}

	private badgeNode(workspaceFolder: URI, relativePath: string, kind: BaseHalfBadgeKind): IBaseHalfBadgeNode {
		return { ...this.workspaceNode(workspaceFolder, relativePath), kind };
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue
			.then(task)
			.catch(error => this.logService.error('BaseHalf mirror cascade step failed', error));
	}
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}

registerWorkbenchContribution2(BaseHalfMirrorCascadeContribution.ID, BaseHalfMirrorCascadeContribution, WorkbenchPhase.AfterRestored);
