/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { isEqualOrParent } from '../../../base/common/resources.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { FileOperation } from '../../../platform/files/common/files.js';
import { IBaseHalfCompletedStructuralMutation } from './basehalfWorkspaceMutation.js';

export interface IBaseHalfMirrorCascadeFilePair {
	readonly source?: URI;
	readonly target: URI;
}

export interface IBaseHalfRequiredCascadeStage {
	readonly label: string;
	run(): Promise<void>;
}

export interface IBaseHalfCascadeStageGroup<T> {
	readonly projectionStages: readonly T[];
	readonly semanticStages: readonly T[];
}

export interface IBaseHalfCascadeRecoveryPromptState {
	readonly disposed: boolean;
	readonly pending: boolean;
	readonly running: boolean;
	readonly hasNotification: boolean;
	readonly closeWasSuppressed: boolean;
}

/** A held structural lease must always retain a visible recovery entrance.
 * Only a USER close of the last prompt republishes it; programmatic close for
 * Retry/success/dispose, an active retry, or a settled recovery must not. */
export function baseHalfShouldRepublishCascadeRecoveryPrompt(state: IBaseHalfCascadeRecoveryPromptState): boolean {
	return !state.disposed
		&& state.pending
		&& !state.running
		&& !state.hasNotification
		&& !state.closeWasSuppressed;
}

/** Preserve physical batch-pair order within each phase while making semantic
 * owners the batch-wide commit point. Pair 1's canonical Badge graph must not
 * become visible before pair 2's Canvas/ADHD/focus projections can succeed. */
export function baseHalfOrderCascadeStages<T>(groups: readonly IBaseHalfCascadeStageGroup<T>[]): T[] {
	return [
		...groups.flatMap(group => group.projectionStages),
		...groups.flatMap(group => group.semanticStages)
	];
}

/** Identifies the exact stage a physical file operation still needs. Callers
 * can resume from `stageIndex` without replaying already-committed graph or
 * mirror stages whose verbs are intentionally not general inverses. */
export class BaseHalfMirrorCascadeStageError extends Error {
	override readonly name = 'BaseHalfMirrorCascadeStageError';

	constructor(
		readonly stageIndex: number,
		readonly stageLabel: string,
		readonly attempts: number,
		readonly failure: unknown
	) {
		super(`BaseHalf mirror cascade stage "${stageLabel}" failed after ${attempts} attempt(s)`, { cause: failure });
	}
}

/** Run required derived-state stages in order. A transient failure retries only
 * the current compensated/idempotent stage; a persistent failure reports the
 * exact resume cursor so recovery never replays successful predecessors. */
export async function baseHalfRunRequiredCascadeStages(
	stages: readonly IBaseHalfRequiredCascadeStage[],
	startIndex = 0,
	maxAttempts = 3
): Promise<void> {
	if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > stages.length) {
		throw new RangeError(`Invalid BaseHalf cascade start index: ${startIndex}`);
	}
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new RangeError(`Invalid BaseHalf cascade attempt count: ${maxAttempts}`);
	}

	for (let index = startIndex; index < stages.length; index++) {
		let failure: unknown;
		let succeeded = false;
		let attempts = 0;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			attempts = attempt;
			try {
				await stages[index].run();
				succeeded = true;
				break;
			} catch (error) {
				failure = error;
				// An AggregateError from a mirror transaction means its conditional
				// compensation also met a concurrent external change. Replaying that
				// semantic verb is not a safe generic retry.
				if (error instanceof AggregateError) {
					break;
				}
			}
		}
		if (!succeeded) {
			throw new BaseHalfMirrorCascadeStageError(index, stages[index].label, attempts, failure);
		}
	}
}

export function baseHalfMirrorCascadeCompletedMutations(
	operation: FileOperation.MOVE | FileOperation.DELETE,
	completedFiles: readonly IBaseHalfMirrorCascadeFilePair[]
): IBaseHalfCompletedStructuralMutation[] {
	return completedFiles.map(file => ({
		operation,
		...(file.source ? { source: file.source } : {}),
		target: file.target
	}));
}

export function baseHalfStructuralOperationAffectsResource(
	operation: FileOperation,
	files: readonly IBaseHalfMirrorCascadeFilePair[],
	resource: URI
): boolean {
	if (operation !== FileOperation.MOVE && operation !== FileOperation.DELETE) {
		return false;
	}
	return files.some(file =>
		(file.source !== undefined && isEqualOrParent(resource, file.source))
		|| isEqualOrParent(resource, file.target)
	);
}

export function baseHalfMoveCrossesWorkspaceRoots(
	files: readonly IBaseHalfMirrorCascadeFilePair[],
	workspaceForResource: (resource: URI) => URI | undefined
): boolean {
	return files.some(file => {
		if (!file.source) {
			return false;
		}
		const sourceWorkspace = workspaceForResource(file.source);
		const targetWorkspace = workspaceForResource(file.target);
		return !!sourceWorkspace && !!targetWorkspace && sourceWorkspace.toString() !== targetWorkspace.toString();
	});
}

export async function baseHalfFlushBeforeStructuralOperation(
	operation: FileOperation,
	files: readonly IBaseHalfMirrorCascadeFilePair[],
	openDetailResource: URI | undefined,
	flush: () => Promise<boolean>
): Promise<void> {
	if (!openDetailResource || !baseHalfStructuralOperationAffectsResource(operation, files, openDetailResource)) {
		return;
	}
	if (!await flush()) {
		throw new Error('The open BaseHalf card could not be saved, so the file operation was cancelled.');
	}
}

export async function baseHalfPrepareStructuralDetail(
	operation: FileOperation,
	files: readonly IBaseHalfMirrorCascadeFilePair[],
	openDetailResource: URI | undefined,
	acquireFence: () => IDisposable,
	flush: () => Promise<boolean>
): Promise<IDisposable | void> {
	if (operation !== FileOperation.MOVE && operation !== FileOperation.DELETE) {
		return;
	}
	const fence = acquireFence();
	try {
		if (openDetailResource) {
			await baseHalfFlushBeforeStructuralOperation(operation, files, openDetailResource, flush);
		}
		return fence;
	} catch (error) {
		fence.dispose();
		throw error;
	}
}
