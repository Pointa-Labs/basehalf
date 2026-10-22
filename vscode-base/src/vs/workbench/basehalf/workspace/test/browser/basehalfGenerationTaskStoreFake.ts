/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { baseHalfGenerationClaimWinner, baseHalfGenerationTaskNamesCard, IBaseHalfGenerationTask, retargetBaseHalfGenerationTask } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationTaskStore } from '../../../video/common/basehalfVideoGeneration.js';

/**
 * A task record store for tests of moves and deletes: it records every move
 * it is told about, in order, so that a test sees that a move wrote the new
 * path of a card into the records that name it. Given the workspace folder,
 * it also holds the records a test puts in {@link records}: `list`, `get`,
 * and `forCard` answer from them, and a move changes their card paths.
 */
export class BaseHalfRecordingGenerationTaskStore implements IBaseHalfGenerationTaskStore {
	declare readonly _serviceBrand: undefined;

	readonly onDidChange = Event.None;
	readonly retargets: { readonly from: URI; readonly to: URI }[] = [];
	/** When set, a retarget fails with this error and records nothing. */
	failure: Error | undefined;
	/**
	 * Runs when a retarget is asked for, before it fails or is recorded: what
	 * a test looks at in the middle of a move. When it throws, the retarget
	 * fails with that error and records nothing.
	 */
	onRetarget: ((from: URI, to: URI) => Promise<void> | void) | undefined;
	/** The records of the workspace folder the store was given. */
	readonly records: IBaseHalfGenerationTask[] = [];

	constructor(private readonly folder?: URI) { }

	async whenReady(): Promise<void> { }

	async refresh(): Promise<void> { }

	list(): readonly IBaseHalfGenerationTask[] {
		return this.records;
	}

	get(taskId: string): IBaseHalfGenerationTask | undefined {
		return this.records.find(task => task.id === taskId);
	}

	folderOf(taskId: string): URI | undefined {
		return this.get(taskId) ? this.folder : undefined;
	}

	forCard(resource: URI): IBaseHalfGenerationTask | undefined {
		const path = this.folder ? relativePath(this.folder, resource) : undefined;
		const naming = path === undefined ? [] : this.records.filter(task => baseHalfGenerationTaskNamesCard(task, path));
		return baseHalfGenerationClaimWinner(naming) ?? naming[naming.length - 1];
	}

	async create(): Promise<void> { }

	async update(): Promise<IBaseHalfGenerationTask | undefined> {
		return undefined;
	}

	async write(): Promise<void> { }

	async remove(): Promise<void> { }

	async claimTakeover(): Promise<boolean> {
		return true;
	}

	partFile(task: IBaseHalfGenerationTask, index: number): URI {
		return URI.file(`/cache/${task.id}-${index + 1}.part`);
	}

	async retarget(from: URI, to: URI): Promise<void> {
		await this.onRetarget?.(from, to);
		if (this.failure) {
			throw this.failure;
		}
		this.retargets.push({ from, to });
		const source = this.folder ? relativePath(this.folder, from) : undefined;
		const target = this.folder ? relativePath(this.folder, to) : undefined;
		if (source !== undefined && target !== undefined) {
			for (const [index, task] of this.records.entries()) {
				this.records[index] = retargetBaseHalfGenerationTask(task, source, target);
			}
		}
	}
}
