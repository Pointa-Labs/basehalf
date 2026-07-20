/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { extUri, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService, IFileStatWithMetadata } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { ActivationKind, IExtensionService } from '../../services/extensions/common/extensions.js';
import { SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { baseHalfIsReservedOutputTreePath } from '../common/basehalfNodeDocument.js';
import { IBaseHalfPluginStructuralCleanupService } from '../common/basehalfPluginStructuralCleanup.js';
import { IBaseHalfProjectFileTransitionService, IBaseHalfStagedProjectFileTransition } from '../common/basehalfProjectFileTransitions.js';
import { IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';

const MAX_STRUCTURAL_CLEANUP_RESOURCES = 4096;
export const BASEHALF_STRUCTURAL_CLEANUP_MAX_SCAN_ENTRIES = 100_000;

interface IBaseHalfOwnedCleanupResource {
	readonly resource: URI;
	readonly ownerIndex: number;
}

export interface IBaseHalfOwnedStagedDeleteCleanup {
	readonly ownerIndex: number;
	readonly transition: IBaseHalfStagedProjectFileTransition;
}

export function settleBaseHalfStagedDeleteCleanups(
	cleanups: readonly IBaseHalfOwnedStagedDeleteCleanup[],
	completedFileCount: number,
	undoRedoGroup: UndoRedoGroup | undefined
): void {
	for (const cleanup of cleanups) {
		if (cleanup.ownerIndex >= completedFileCount) {
			continue;
		}
		if (undoRedoGroup) {
			cleanup.transition.commit(undoRedoGroup);
		} else {
			// The physical prefix is durable but the file operation did not
			// publish an undo element. Keep its matching cleanup without exposing
			// a standalone undo that could point at a missing input.
			cleanup.transition.accept();
		}
	}
}

export async function rollbackBaseHalfUncompletedDeleteCleanups(
	cleanups: readonly IBaseHalfOwnedStagedDeleteCleanup[],
	completedFileCount: number,
	lease: IBaseHalfWorkspaceMutationLease
): Promise<void> {
	const errors: unknown[] = [];
	for (let index = cleanups.length - 1; index >= 0; index--) {
		const cleanup = cleanups[index];
		if (cleanup.ownerIndex >= completedFileCount) {
			try {
				await cleanup.transition.rollback(lease);
			} catch (error) {
				errors.push(error);
			}
		}
	}
	if (errors.length === 1) {
		throw errors[0];
	}
	if (errors.length > 1) {
		throw new AggregateError(errors, 'Structural cleanup rollback did not fully complete. Review the affected project documents before continuing.');
	}
}

export const IBaseHalfPluginStructuralDeleteCleanupService = createDecorator<IBaseHalfPluginStructuralDeleteCleanupService>('baseHalfPluginStructuralDeleteCleanupService');

export interface IBaseHalfPluginStructuralDeleteCleanupService {
	readonly _serviceBrand: undefined;
	stageDelete(files: readonly SourceTargetPair[], token: CancellationToken, lease: IBaseHalfWorkspaceMutationLease): Promise<readonly IBaseHalfOwnedStagedDeleteCleanup[]>;
}

/**
 * Prepares plugin-owned reference cleanup for every DELETE entry before disk IO.
 * The caller owns the surrounding file-operation transaction and decides which
 * staged transitions commit, roll back, or join the file operation's undo group.
 */
export class BaseHalfPluginStructuralDeleteCleanupService implements IBaseHalfPluginStructuralDeleteCleanupService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IBaseHalfPluginStructuralCleanupService private readonly pluginStructuralCleanupService: IBaseHalfPluginStructuralCleanupService,
		@IBaseHalfProjectFileTransitionService private readonly projectFileTransitionService: IBaseHalfProjectFileTransitionService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) { }

	async stageDelete(files: readonly SourceTargetPair[], token: CancellationToken, lease: IBaseHalfWorkspaceMutationLease): Promise<readonly IBaseHalfOwnedStagedDeleteCleanup[]> {
		const staged: IBaseHalfOwnedStagedDeleteCleanup[] = [];
		try {
			const cleanupResources = await this.resolveCleanupResources(files, token);
			const activated = new Set<string>();
			for (const cleanupResource of cleanupResources) {
				this.throwIfCancelled(token);
				for (const activationEvent of this.pluginStructuralCleanupService.activationEvents(cleanupResource.resource)) {
					if (activated.has(activationEvent)) {
						continue;
					}
					await this.extensionService.activateByEvent(activationEvent, ActivationKind.Immediate);
					activated.add(activationEvent);
				}
			}

			const deletedRoots = files.map(file => file.target);
			// Preparation and staging stay interleaved. When two deleted resources
			// update the same domain document, the second provider observes the first
			// staged write instead of proposing a stale parallel transition.
			for (const cleanupResource of cleanupResources) {
				this.throwIfCancelled(token);
				const transitions = await this.pluginStructuralCleanupService.prepareDelete(cleanupResource.resource, token);
				for (const transition of transitions) {
					this.throwIfCancelled(token);
					// A domain document under a deleted root disappears in the same
					// physical operation and must not receive a companion undo element.
					if (deletedRoots.some(root => extUri.isEqualOrParent(transition.resource, root))) {
						continue;
					}
					const prepared = await this.projectFileTransitionService.stage(transition, lease);
					if (prepared.changed) {
						staged.push({ ownerIndex: cleanupResource.ownerIndex, transition: prepared });
					}
				}
			}
			return Object.freeze([...staged]);
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			for (let index = staged.length - 1; index >= 0; index--) {
				try {
					await staged[index].transition.rollback(lease);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError([error, ...rollbackErrors], 'Plugin structural cleanup could not be prepared or fully restored. Review the affected project documents before continuing.');
			}
			throw error;
		}
	}

	private async resolveCleanupResources(files: readonly SourceTargetPair[], token: CancellationToken): Promise<readonly IBaseHalfOwnedCleanupResource[]> {
		const result: IBaseHalfOwnedCleanupResource[] = [];
		const seen = new Set<string>();
		let scannedEntries = 0;
		const countScannedEntry = (): void => {
			scannedEntries++;
			if (scannedEntries > BASEHALF_STRUCTURAL_CLEANUP_MAX_SCAN_ENTRIES) {
				throw new Error(`A single file delete can inspect at most ${BASEHALF_STRUCTURAL_CLEANUP_MAX_SCAN_ENTRIES} entries for structural cleanup. Delete smaller folders separately.`);
			}
		};
		const isReservedOutput = (resource: URI): boolean => {
			const workspace = this.workspaceContextService.getWorkspaceFolder(resource);
			const relativePath = workspace ? getRelativePath(workspace.uri, resource) : undefined;
			return relativePath !== undefined && baseHalfIsReservedOutputTreePath(relativePath);
		};
		const add = (resource: URI, ownerIndex: number): void => {
			if (isReservedOutput(resource) || this.pluginStructuralCleanupService.activationEvents(resource).length === 0) {
				return;
			}
			const key = resource.toString();
			if (seen.has(key)) {
				return;
			}
			if (result.length >= MAX_STRUCTURAL_CLEANUP_RESOURCES) {
				throw new Error(`A single file delete can prepare structural cleanup for at most ${MAX_STRUCTURAL_CLEANUP_RESOURCES} resources.`);
			}
			seen.add(key);
			result.push({ resource, ownerIndex });
		};
		const visit = async (resource: URI, ownerIndex: number, knownStat?: IFileStatWithMetadata): Promise<void> => {
			this.throwIfCancelled(token);
			if (isReservedOutput(resource)) {
				return;
			}
			countScannedEntry();
			const stat = knownStat ?? await this.fileService.resolve(resource, { resolveMetadata: true });
			if (stat.isSymbolicLink) {
				return;
			}
			if (!stat.isDirectory) {
				add(resource, ownerIndex);
				return;
			}
			for (const child of stat.children ?? []) {
				this.throwIfCancelled(token);
				if (child.isDirectory && !child.isSymbolicLink) {
					await visit(child.resource, ownerIndex);
				} else {
					countScannedEntry();
					if (!child.isSymbolicLink) {
						add(child.resource, ownerIndex);
					}
				}
			}
		};

		for (let ownerIndex = 0; ownerIndex < files.length; ownerIndex++) {
			await visit(files[ownerIndex].target, ownerIndex);
		}
		return Object.freeze(result);
	}

	private throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
	}
}

registerSingleton(IBaseHalfPluginStructuralDeleteCleanupService, BaseHalfPluginStructuralDeleteCleanupService, InstantiationType.Delayed);
