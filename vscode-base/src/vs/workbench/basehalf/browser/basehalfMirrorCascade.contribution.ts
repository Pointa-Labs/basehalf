/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperation, FileOperationResult, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkingCopyFileOperationPreconditionGuard, IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IBaseHalfAdhdMirrorService } from '../common/basehalfAdhdMirror.js';
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { BaseHalfBadgeKind } from '../common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import {
	baseHalfIsMirrorSubtree,
	baseHalfAssertMirrorPathComponentsNotSymbolicLink,
	baseHalfMirrorPathSegments,
	baseHalfMirrorResource,
	baseHalfMirrorRoot,
	baseHalfRemapSubtreeRel,
	baseHalfWalkMirror
} from '../common/basehalfMirrorTree.js';
import { BaseHalfMirrorCascadeStageError, baseHalfMirrorCascadeCompletedMutations, baseHalfMoveCrossesWorkspaceRoots, baseHalfOrderCascadeStages, baseHalfPrepareStructuralDetail, baseHalfRunRequiredCascadeStages, baseHalfShouldRepublishCascadeRecoveryPrompt, baseHalfStructuralOperationAffectsResource } from '../common/basehalfMirrorCascadeOperation.js';
import { IBaseHalfStructuralMutationReservation, IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';
import { baseHalfStructuralEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';

interface IBaseHalfPreparedStructuralOperation {
	readonly operation: FileOperation.MOVE | FileOperation.DELETE;
	readonly reservation: IBaseHalfStructuralMutationReservation;
	kinds: ReadonlyMap<string, BaseHalfBadgeKind>;
	finalized: boolean;
	published: boolean;
}

interface IBaseHalfCascadeStage {
	readonly label: string;
	run(lease: IBaseHalfWorkspaceMutationLease): Promise<void>;
}

interface IBaseHalfCascadePlan {
	readonly workspaceFolder: URI;
	readonly description: string;
	readonly projectionStages: readonly IBaseHalfCascadeStage[];
	readonly semanticStages: readonly IBaseHalfCascadeStage[];
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
 * DERIVED state addressed by workspace-relative path, so when a node moves or
 * dies its mirror data must follow or fall away — otherwise the human-authored
 * badge notes and reference graph silently go stale at the old path.
 *
 * In-app file operations (Explorer rename/delete, card renames, extension
 * `workspace.fs` calls) all flow through `IWorkingCopyFileService`; this
 * contribution listens there and cascades:
 *
 *  - MOVE   → badge graph rename (badge + descendants + both graph directions),
 *             canvas relocate (geometry + edge styling), adhd reading-aids
 *             relocate, stale focus mirrors dropped (they self-heal on the next
 *             view).
 *  - DELETE → badge graph purge (badge + descendants + backlink scrub), canvas
 *             purge, adhd + focus mirrors dropped.
 *
 * Operations that happen OUTSIDE the app (a terminal `mv`, an agent's tools)
 * don't pass through the working-copy service. Deletions are caught by the
 * orphan sweep — on workspace open every badge whose disk node is gone is
 * marked `orphan`, preserving the note — and a file reappearing (including the
 * "external rename looks like delete+add" case for the ADD half) clears the
 * flag again via file events. An external rename therefore degrades to
 * orphan-at-old-path rather than following the file; the note is never lost,
 * and adopting a rename heuristic over raw file events remains a possible
 * later refinement.
 *
 * All cascades run on one FIFO queue so two rapid operations (rename A→B, then
 * B→C) can never interleave their multi-file rewrites.
 */
class BaseHalfMirrorCascadeContribution extends Disposable implements IWorkbenchContribution {

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
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) {
		super();

		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: (files, operation) => this.prepareStructuralDetail(files, operation)
		}));

		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				this.handleAppeared(resource);
			}
		}));

		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const added of event.added) {
				this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(added.uri, lease => this.sweepOrphans(added.uri, lease)));
			}
		}));

		for (const folder of this.contextService.getWorkspace().folders) {
			this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(folder.uri, lease => this.sweepOrphans(folder.uri, lease)));
		}
	}

	private async prepareStructuralDetail(files: readonly SourceTargetPair[], operation: FileOperation): Promise<IWorkingCopyFileOperationPreconditionGuard | void> {
		if (operation !== FileOperation.MOVE && operation !== FileOperation.DELETE) {
			return;
		}
		if (operation === FileOperation.MOVE && baseHalfMoveCrossesWorkspaceRoots(files, resource => this.contextService.getWorkspaceFolder(resource)?.uri)) {
			throw new Error('Moving a BaseHalf node between workspace roots is not supported because its workspace-local badge graph cannot be migrated without data loss.');
		}
		const affectedPaths = this.operationAffectedPaths(files);
		const workspaces = this.operationWorkspaces(files);
		if (affectedPaths.length === 0 || workspaces.length === 0) {
			return;
		}
		const pendingRecovery = this.pendingRecoveryFor(workspaces);
		if (pendingRecovery) {
			throw new Error(`A file operation is still finalizing BaseHalf metadata for ${pendingRecovery.description}. Use the Retry action in Notifications before changing these paths again.`);
		}

		// This is deliberately the first await boundary in BaseHalf's prepare:
		// commit order is the order operations reach this hard barrier after VS
		// Code participants complete, not the order of un-awaited API calls.
		const context: IBaseHalfPreparedStructuralOperation = {
			operation,
			reservation: this.workspaceMutationCoordinator.reserveStructural(workspaces, affectedPaths),
			kinds: new Map(),
			finalized: false,
			published: false
		};
		try {
			await context.reservation.ready;
			if (this.disposed) {
				throw new Error('BaseHalf mirror cascade was disposed before the file operation reached its commit barrier.');
			}
			context.kinds = await this.captureOperationKinds(files);
			const detail = this.canvasNavigationService.state.cardDetail;
			const fence = await baseHalfPrepareStructuralDetail(
				operation,
				files,
				detail?.resource,
				() => {
					const fences = new DisposableStore();
					for (const path of affectedPaths) {
						fences.add(this.workspaceMutationCoordinator.acquireResourceMutationFence(path.workspace, path.relativePath));
					}
					return fences;
				},
				async () => this.flushAffectedActiveProjection(files, operation)
			);
			let disposed = false;
			return {
				didRun: completedFiles => this.finalizePreparedOperation(context, completedFiles, false),
				didFail: completedFiles => this.finalizePreparedOperation(context, completedFiles, true),
				afterPublicEvents: () => this.publishPreparedOperation(context),
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
				}
			};
		} catch (error) {
			await this.abortPreparedOperation(context);
			throw error;
		}
	}

	private async flushAffectedActiveProjection(files: readonly SourceTargetPair[], operation: FileOperation): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const detail = this.canvasNavigationService.state.cardDetail;
			if (!detail || !baseHalfStructuralOperationAffectsResource(operation, files, detail.resource)) {
				return true;
			}
			const identity = `${detail.resource.toString()}\0${detail.projection}`;
			if (!await this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, baseHalfStructuralEditorFlushOptions(detail.projection))) {
				return false;
			}
			const current = this.canvasNavigationService.state.cardDetail;
			if (`${current?.resource.toString()}\0${current?.projection}` === identity) {
				return true;
			}
		}
		return false;
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
		context.published = true;
		await context.reservation.publish();
	}

	private async finalizePreparedOperation(context: IBaseHalfPreparedStructuralOperation, completedFiles: readonly SourceTargetPair[], failed: boolean): Promise<void> {
		if (context.finalized) {
			return;
		}
		context.finalized = true;
		if (!failed) {
			await context.reservation.finishInternal(
				lease => this.handleOperation(context.operation, completedFiles, context.kinds, lease),
				baseHalfMirrorCascadeCompletedMutations(context.operation, completedFiles)
			);
		} else if (completedFiles.length === 0) {
			await context.reservation.abortInternal();
		} else {
			this.logService.warn(`BaseHalf mirror cascade: ${context.operation === FileOperation.MOVE ? 'move' : 'delete'} batch failed after ${completedFiles.length} member(s) reached disk; reconciling the completed prefix`);
			await context.reservation.reconcileInternal(
				baseHalfMirrorCascadeCompletedMutations(context.operation, completedFiles),
				lease => this.handleOperation(context.operation, completedFiles, context.kinds, lease)
			);
		}
	}

	private async abortPreparedOperation(context: IBaseHalfPreparedStructuralOperation): Promise<void> {
		if (context.finalized) {
			return;
		}
		context.finalized = true;
		await context.reservation.cancel();
	}

	private async handleOperation(operation: FileOperation.MOVE | FileOperation.DELETE, files: readonly SourceTargetPair[], kinds: ReadonlyMap<string, BaseHalfBadgeKind>, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		const plans: IBaseHalfCascadePlan[] = [];
		for (const pair of files) {
			if (operation === FileOperation.MOVE && pair.source) {
				const source = pair.source;
				const target = pair.target;
				const plan = this.planCascadeMove(source, target, kinds.get(source.toString()) ?? 'file', kinds.get(target.toString()));
				if (plan) {
					plans.push(plan);
				}
			} else if (operation === FileOperation.DELETE) {
				const target = pair.target;
				const plan = this.planCascadeDelete(target, kinds.get(target.toString()) ?? 'file');
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
			baseHalfOrderCascadeStages(plans),
			lease
		);
	}

	private planCascadeMove(source: URI, target: URI, sourceKind: BaseHalfBadgeKind, targetKind: BaseHalfBadgeKind | undefined): IBaseHalfCascadePlan | undefined {
		const from = this.workspaceLocation(source);
		const to = this.workspaceLocation(target);
		if (from && !to) {
			// Moved OUT of the workspace: the mirror cannot follow — same as a delete.
			return this.planCascadeDelete(source, sourceKind);
		}
		if (!from || !to || from.workspaceFolder.toString() !== to.workspaceFolder.toString()) {
			return undefined;
		}

		const workspaceFolder = from.workspaceFolder;
		const sameResourceIdentity = this.uriIdentityService.extUri.isEqual(source, target);
		if (sameResourceIdentity) {
			// The user-file provider has already committed the casing change. Mirror
			// files still contain the old logical paths, so first rename the ONE
			// physical mirror subtree and then rewrite every projection in place. Do
			// not route this branch through best-effort steps: half of a same-resource
			// identity rewrite would leave aliased YAML that cannot be repaired by a
			// later ordinary rename.
			return {
				workspaceFolder,
				description: `"${from.relativePath}" → "${to.relativePath}"`,
				projectionStages: [
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
					label: 'focus identity retirement',
					run: () => this.dropMirrorFiles(workspaceFolder, to.relativePath, 'focus.yaml')
				}
				],
				semanticStages: [
					// Badge is the semantic owner. Every projection for EVERY completed batch
					// pair commits before any canonical graph identity becomes visible.
					{
						label: 'badge identity rewrite',
						run: activeLease => this.badgeGraphService.replaceNodeIdentity(workspaceFolder, from.relativePath, to.relativePath, {
							incomingKind: sourceKind,
							sameResourceIdentity: true
						}, activeLease)
					}
				]
			};
		}

		const stages: IBaseHalfCascadeStage[] = [{
			label: 'canvas subtree relocation',
			run: activeLease => this.canvasMirrorService.relocateNode(
				workspaceFolder,
				from.relativePath,
				to.relativePath,
				{ retireDestination: true },
				activeLease
			)
		}];
		stages.push(
			{
				label: 'destination ADHD retirement',
				run: activeLease => this.retireAdhd(workspaceFolder, to.relativePath, activeLease)
			},
			{
				label: 'destination focus retirement',
				run: () => this.dropMirrorFiles(workspaceFolder, to.relativePath, 'focus.yaml')
			},
			{
				label: 'ADHD subtree relocation',
				run: activeLease => this.relocateAdhd(workspaceFolder, from.relativePath, to.relativePath, false, activeLease)
			},
			{
				label: 'source focus retirement',
				run: () => this.dropMirrorFiles(workspaceFolder, from.relativePath, 'focus.yaml')
			},
			{
				label: 'badge graph identity replacement',
				run: activeLease => this.badgeGraphService.replaceNodeIdentity(workspaceFolder, from.relativePath, to.relativePath, {
					incomingKind: sourceKind,
					...(targetKind !== undefined ? { replacedKind: targetKind } : {})
				}, activeLease)
			}
		);
		return {
			workspaceFolder,
			description: `"${from.relativePath}" → "${to.relativePath}"`,
			projectionStages: stages.slice(0, -1),
			semanticStages: stages.slice(-1)
		};
	}

	private planCascadeDelete(resource: URI, kind: BaseHalfBadgeKind = 'file'): IBaseHalfCascadePlan | undefined {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return undefined;
		}

		const { workspaceFolder, relativePath } = location;
		return {
			workspaceFolder,
			description: `delete "${relativePath}"`,
			projectionStages: [{
				label: 'canvas subtree retirement',
				run: activeLease => this.canvasMirrorService.purgeNode(workspaceFolder, relativePath, activeLease)
			},
			{
				label: 'ADHD subtree retirement',
				run: activeLease => this.retireAdhd(workspaceFolder, relativePath, activeLease)
			},
			{
				label: 'focus subtree retirement',
				run: () => this.dropMirrorFiles(workspaceFolder, relativePath, 'focus.yaml')
			}],
			semanticStages: [{
				label: 'badge graph retirement',
				run: activeLease => this.badgeGraphService.deleteNode(workspaceFolder, relativePath, kind, activeLease)
			}]
		};
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
	 *  orphaned badge, the node is back — clear the flag so the note rejoins
	 *  the live overlay. Guarded by a cheap existence probe of the badge.yaml
	 *  so bulk file creations don't schedule graph work. */
	private handleAppeared(resource: URI): void {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return;
		}

		this.enqueue(() => this.workspaceMutationCoordinator.runExclusive(location.workspaceFolder, async lease => {
			const badgeResource = baseHalfMirrorResource(location.workspaceFolder, location.relativePath, 'badge.yaml');
			if (!(await this.fileService.exists(badgeResource))) {
				return;
			}

			await this.badgeGraphService.clearOrphan({
				...this.workspaceNode(location.workspaceFolder, location.relativePath),
				kind: 'file'
			}, lease);
		}));
	}

	private async sweepOrphans(workspaceFolder: URI, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		const orphaned = await this.badgeGraphService.pruneDangling(workspaceFolder, lease);
		if (orphaned.length > 0) {
			this.logService.info(`BaseHalf mirror cascade: marked ${orphaned.length} badge(s) orphan (disk node gone): ${orphaned.join(', ')}`);
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

	/** Drop every `<fileName>` mirror file under the subtree. Used for focus
	 *  mirrors on move/delete (a viewport for a path that no longer exists is
	 *  stale data an agent must not read; it self-heals on the next view) and
	 *  for adhd mirrors on delete. */
	private async dropMirrorFiles(workspaceFolder: URI, subtree: string, fileName: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, fileName)) {
			if (baseHalfIsMirrorSubtree(entry.relativePath, subtree)) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, entry.resource);
				await this.deleteIgnoreMissing(entry.resource);
			}
		}
	}

	private async deleteIgnoreMissing(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource);
		} catch (error) {
			if (!isFileNotFound(error)) {
				throw error;
			}
		}
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

	private async captureOperationKinds(files: readonly SourceTargetPair[]): Promise<ReadonlyMap<string, BaseHalfBadgeKind>> {
		const kinds = new Map<string, BaseHalfBadgeKind>();
		const resources = new Map<string, URI>();
		for (const pair of files) {
			for (const resource of pair.source ? [pair.source, pair.target] : [pair.target]) {
				resources.set(resource.toString(), resource);
			}
		}
		for (const [key, resource] of resources) {
			try {
				const stat = await this.fileService.stat(resource);
				kinds.set(key, stat.isDirectory ? 'folder' : 'file');
				continue;
			} catch (error) {
				if (!isFileNotFound(error)) {
					throw error;
				}
			}

			// A destination can be physically absent but still own orphan mirror
			// identity. Preserve its recorded kind so replacement retirement covers
			// exactly the old folder subtree when necessary.
			const location = this.workspaceLocation(resource);
			if (location) {
				const badge = await this.badgeGraphService.readBadge({
					...this.workspaceNode(location.workspaceFolder, location.relativePath),
					kind: 'file'
				});
				if (badge) {
					kinds.set(key, badge.kind);
				}
			}
		}
		return kinds;
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
