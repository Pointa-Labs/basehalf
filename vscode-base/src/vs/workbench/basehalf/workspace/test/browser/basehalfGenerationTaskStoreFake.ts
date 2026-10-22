/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IBaseHalfGenerationTask } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationTaskStore } from '../../../video/common/basehalfVideoGeneration.js';

/**
 * A task record store for tests of moves: it keeps no records and records
 * every move it is told about, in order, so that a test sees that a move
 * wrote the new path of a card into the records that name it.
 */
export class BaseHalfRecordingGenerationTaskStore implements IBaseHalfGenerationTaskStore {
	declare readonly _serviceBrand: undefined;

	readonly onDidChange = Event.None;
	readonly retargets: { readonly from: URI; readonly to: URI }[] = [];
	/** When set, a retarget fails with this error and records nothing. */
	failure: Error | undefined;

	list(): readonly IBaseHalfGenerationTask[] {
		return [];
	}

	forCard(): IBaseHalfGenerationTask | undefined {
		return undefined;
	}

	async write(): Promise<void> { }

	async remove(): Promise<void> { }

	partFile(task: IBaseHalfGenerationTask, index: number): URI {
		return URI.file(`/cache/${task.id}-${index + 1}.part`);
	}

	async retarget(from: URI, to: URI): Promise<void> {
		if (this.failure) {
			throw this.failure;
		}
		this.retargets.push({ from, to });
	}
}
