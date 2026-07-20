/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfReferenceRemoveTransition } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfCanvasEdge } from '../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasEdgeStateTransition } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResourceMutationStamp } from '../common/basehalfWorkspaceMutation.js';

export type BaseHalfBadgeDraftFailureDisposition = 'archive-missing' | 'archive-replaced' | 'retry' | 'retain';

export function baseHalfBadgeDraftFailureDisposition(
	resourceExists: boolean,
	identityCurrent: boolean,
	retryAttempt: number,
	retryLimit = 3
): BaseHalfBadgeDraftFailureDisposition {
	if (!resourceExists) {
		return 'archive-missing';
	}
	if (!identityCurrent) {
		return 'archive-replaced';
	}
	return retryAttempt < retryLimit ? 'retry' : 'retain';
}

export function baseHalfResourceMutationStampsEqual(
	left: IBaseHalfWorkspaceResourceMutationStamp,
	right: IBaseHalfWorkspaceResourceMutationStamp
): boolean {
	return left.workspaceKey === right.workspaceKey
		&& left.relativePath === right.relativePath
		&& left.structuralEpoch === right.structuralEpoch;
}

export function baseHalfTransitionBadgeDraftIdentity<T extends {
	readonly identityStamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly resourceIdentity: string;
}>(
	active: T | undefined,
	retained: readonly T[],
	incomingStamp: IBaseHalfWorkspaceResourceMutationStamp,
	incomingResourceIdentity: string
): { readonly active: T | undefined; readonly retained: readonly T[]; readonly identityChanged: boolean } {
	if (!active || (baseHalfResourceMutationStampsEqual(active.identityStamp, incomingStamp)
		&& active.resourceIdentity === incomingResourceIdentity)) {
		return { active, retained, identityChanged: false };
	}
	return {
		active: undefined,
		retained: retained.includes(active) ? retained : [...retained, active],
		identityChanged: true
	};
}

export function baseHalfDiscardRetainedBadgeDraft<T>(retained: readonly T[], draft: T): readonly T[] {
	return retained.filter(candidate => candidate !== draft);
}

export function baseHalfShouldVetoForBadgeDrafts(
	recoveryCount: number,
	decision: 'stay' | 'discard' | undefined
): boolean {
	return recoveryCount > 0 && decision !== 'discard';
}

export async function baseHalfCopyRetainedBadgeDraft(
	write: () => Promise<void>,
	reportFailure: (error: unknown) => void
): Promise<boolean> {
	try {
		await write();
		return true;
	} catch (error) {
		reportFailure(error);
		return false;
	}
}

export class BaseHalfCanvasInteractionRenderGate {
	private active = false;
	private queued = false;

	begin(): void {
		this.active = true;
	}

	defer(): boolean {
		if (!this.active) {
			return false;
		}
		this.queued = true;
		return true;
	}

	end(): boolean {
		this.active = false;
		const queued = this.queued;
		this.queued = false;
		return queued;
	}

	reset(): void {
		this.active = false;
		this.queued = false;
	}
}

export function baseHalfPersistedCanvasEdgeRemoval(
	edges: readonly IBaseHalfCanvasEdge[],
	from: string,
	to: string
): readonly IBaseHalfCanvasEdgeStateTransition[] {
	const persisted = edges.find(edge => edge.from === from && edge.to === to);
	return persisted ? [{ from, to, expected: persisted, next: null }] : [];
}

/**
 * A guarded canvas edit may remove only a complete two-sided reference. The
 * graph operation itself intentionally normalizes either state to absent, so a
 * concurrent one-sided state must be restored before the edit reports failure.
 */
export async function removeCompleteBaseHalfCanvasReference(
	remove: () => Promise<IBaseHalfReferenceRemoveTransition>,
	restore: (transition: IBaseHalfReferenceRemoveTransition) => Promise<void>,
	changedMessage: string,
	allowIncompleteRecovery = false
): Promise<IBaseHalfReferenceRemoveTransition> {
	const transition = await remove();
	if ((transition.before.forward && transition.before.backlink) || allowIncompleteRecovery) {
		return transition;
	}

	try {
		await restore(transition);
	} catch (restoreError) {
		throw new AggregateError([
			new Error(changedMessage),
			restoreError
		], 'The connection changed and its exact state could not be restored. Reopen the project before continuing.');
	}
	throw new Error(changedMessage);
}
