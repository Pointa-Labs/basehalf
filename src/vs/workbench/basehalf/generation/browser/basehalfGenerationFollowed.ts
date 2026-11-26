/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfVideoProviderAccess, IBaseHalfVideoSubmitRequest, IBaseHalfVideoGenerationChoice, IBaseHalfVideoTaskRef } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationRequest, BaseHalfGenerationKind } from '../common/basehalfGenerationInfo.js';
import { BaseHalfVideoGenerationPhase } from '../common/basehalfVideoGeneration.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';

// A generation that this window follows from Generate to its files: what the window keeps of it while it runs,
// what was prepared to send, and the times of following it (generation cards, "A generation").

/** The first question to the provider comes this long after it accepted the task. */
export const BASEHALF_VIDEO_FIRST_POLL_DELAY = 3_000;

/** Then the provider is asked this often. */
export const BASEHALF_VIDEO_POLL_INTERVAL = 5_000;

/** Network errors while asking are retried for this long in a row. */
export const BASEHALF_VIDEO_TRANSIENT_FAILURE_LIMIT = 30 * 60_000;

/** A generation that has not ended this long after its start fails. */
export const BASEHALF_VIDEO_TASK_TIME_LIMIT = 2 * 60 * 60_000;

/** How long a generation waits for the catalog while it loads. */
export const BASEHALF_VIDEO_CATALOG_WAIT = 30_000;

export interface IPreparedGeneration {
	readonly access: IBaseHalfVideoProviderAccess;
	readonly request: IBaseHalfVideoSubmitRequest;
	readonly record: IBaseHalfGenerationRequest;
	readonly sentPrompt: string;
	readonly lastUsed: IBaseHalfVideoGenerationChoice;
}

/** One generation this window follows: from Generate, or taken over from another window. */
export class FollowedGeneration {
	phase: BaseHalfVideoGenerationPhase = 'preparing';
	fraction: number | undefined;
	/** Where the provider is asked, with what, and about which catalog model. */
	access: IBaseHalfVideoProviderAccess | undefined;
	model: string | undefined;
	remoteId: string | undefined;
	/** The record has been written: from then on this window says it is alive. */
	recorded = false;
	/** What the generation used, remembered as the last values of its kind once a file lands. */
	lastUsed: IBaseHalfVideoGenerationChoice | undefined;
	stopped = false;
	ended = false;
	/**
	 * The request is on its way: until its answer is handled, a record that
	 * another window ended as failed meanwhile is not let go, since the answer
	 * may take the generation up again.
	 */
	receiving = false;
	cancelSent = false;
	transientSince: number | undefined;
	unreadableAnswers = 0;
	/** Downloads of each card that failed for a reason that may pass. */
	readonly downloadFailures = new Map<number, number>();
	/** The cards' paths as last known, for the cards' events. */
	paths: readonly string[];
	timer: IDisposable | undefined;
	landing: Promise<void> | undefined;
	readonly preparation = new CancellationTokenSource();

	constructor(
		readonly taskId: string,
		readonly folder: URI,
		readonly kind: BaseHalfGenerationKind,
		readonly startedAt: number,
		paths: readonly string[]
	) {
		this.paths = paths;
	}

	/** The task as the provider service is asked about it; a provider that answered at once gave no task id, and its outputs are found by their addresses. */
	taskRef(): IBaseHalfVideoTaskRef {
		return { ...this.access!, model: this.model!, remoteId: this.remoteId ?? '' };
	}

	/** The credential values, which no message may hold. */
	secrets(): readonly string[] {
		return this.access ? Object.values(this.access.credentials) : [];
	}
}
