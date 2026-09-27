/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

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
