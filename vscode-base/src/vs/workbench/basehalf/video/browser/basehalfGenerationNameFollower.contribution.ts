/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	IBaseHalfReferenceDependentEdit,
	IBaseHalfReferenceEditParticipant,
	IBaseHalfReferenceEditService,
	IBaseHalfReferenceListChange,
	IBaseHalfReferenceListEntry,
	IBaseHalfUpstreamEntryReplacement
} from '../../references/common/basehalfReferenceEdit.js';
import { baseHalfInputNameMapping, IBaseHalfInputListEntry, rewriteBaseHalfPromptNames } from '../common/basehalfGenerationInputNames.js';
import { baseHalfGenerationKindOfPath, setBaseHalfGenerationPrompt } from '../common/basehalfGenerationInfo.js';
import { baseHalfVideoInputKindOfPath } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardStore } from '../common/basehalfVideoGeneration.js';

/** One change of a draft's list as the names see it. */
interface INameChange {
	readonly before: readonly IBaseHalfInputListEntry[];
	readonly after: readonly IBaseHalfInputListEntry[];
	readonly replacements: readonly IBaseHalfUpstreamEntryReplacement[];
}

/**
 * Keeps the names in a draft's prompt with their inputs (generation cards,
 * "Names follow their inputs", D68). It takes part in every reference edit
 * that writes a draft's list: when a name of the prompt means an input that
 * moved or is gone, it writes the prompt again, and the edit's undo and redo
 * put the prompt back with the list.
 */
export class BaseHalfGenerationNameFollower extends Disposable implements IWorkbenchContribution, IBaseHalfReferenceEditParticipant {

	static readonly ID = 'workbench.contrib.basehalf.generationNameFollower';

	constructor(
		@IBaseHalfReferenceEditService referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfGenerationCardStore private readonly cardStore: IBaseHalfGenerationCardStore,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(referenceEditService.registerParticipant(this));
	}

	async participate(changes: readonly IBaseHalfReferenceListChange[]): Promise<readonly IBaseHalfReferenceDependentEdit[]> {
		const dependents: IBaseHalfReferenceDependentEdit[] = [];
		for (const change of changes) {
			const dependent = await this.follow(change);
			if (dependent) {
				dependents.push(dependent);
			}
		}
		return dependents;
	}

	private async follow(change: IBaseHalfReferenceListChange): Promise<IBaseHalfReferenceDependentEdit | undefined> {
		const resource = change.node.resource;
		// Only a generation card has names, and of those only a draft has a prompt to change (D67).
		if (!baseHalfGenerationKindOfPath(change.node.relativePath)) {
			return undefined;
		}
		const forward: INameChange = { before: entries(change.before), after: entries(change.after), replacements: change.replacements };
		// Adding an input last, as connecting does, gives no name another number.
		const mapping = baseHalfInputNameMapping(forward.before, forward.after, forward.replacements);
		if ([...mapping].every(([name, ordinal]) => name.endsWith(`:${ordinal}`))) {
			return undefined;
		}
		try {
			// A connection into an ordinary file, such as a captured frame, has no prompt to follow it.
			if (!await this.cardStore.isGenerationCard(resource)) {
				return undefined;
			}
			const snapshot = await this.cardStore.read(resource);
			if (snapshot.hasFile || !snapshot.infoReadable) {
				return undefined;
			}
			const prompt = snapshot.info.prompt;
			const next = rewriteBaseHalfPromptNames(prompt, forward.before, forward.after, forward.replacements);
			if (next === undefined) {
				return undefined;
			}
			const written = await this.write(resource, prompt, next, forward);
			if (written === undefined) {
				return undefined;
			}
			const backward: INameChange = { before: forward.after, after: forward.before, replacements: forward.replacements.map(replacement => ({ from: replacement.to, to: replacement.from })) };
			return {
				// The list is back to what it was: the prompt as it was, or, when it was
				// changed since, the change with the numbers of that list.
				undo: () => this.restore(resource, written, prompt, backward),
				redo: () => this.restore(resource, prompt, written, forward)
			};
		} catch (error) {
			this.report(resource, error);
			return undefined;
		}
	}

	/**
	 * Writes `next` when the prompt is still `prompt`, and otherwise its names
	 * for the change. Resolves with the prompt written, or `undefined` when
	 * nothing needed writing.
	 */
	private async write(resource: URI, prompt: string, next: string, change: INameChange): Promise<string | undefined> {
		let written: string | undefined;
		await this.cardStore.update(resource, info => {
			const current = info.prompt;
			const target = current === prompt ? next : rewriteBaseHalfPromptNames(current, change.before, change.after, change.replacements);
			written = target;
			return target === undefined ? info : setBaseHalfGenerationPrompt(info, target);
		});
		return written;
	}

	/** Puts `restore` back when the prompt is still `expected`, and otherwise gives its names the numbers of `change`'s list. */
	private async restore(resource: URI, expected: string, restore: string, change: INameChange): Promise<void> {
		try {
			if (!await this.cardStore.isGenerationCard(resource)) {
				return;
			}
			const snapshot = await this.cardStore.read(resource);
			if (snapshot.hasFile || !snapshot.infoReadable) {
				return;
			}
			await this.cardStore.update(resource, info => {
				const target = info.prompt === expected ? restore : rewriteBaseHalfPromptNames(info.prompt, change.before, change.after, change.replacements);
				return target === undefined ? info : setBaseHalfGenerationPrompt(info, target);
			});
		} catch (error) {
			this.report(resource, error);
		}
	}

	private report(resource: URI, error: unknown): void {
		this.logService.warn(`[BaseHalf generation] could not update the names in the prompt of ${resource.toString()}`, error);
		this.notificationService.warn(localize('basehalf.generation.names.failed', "BaseHalf could not update the names in the prompt of {0}.", basename(resource)));
	}
}

function entries(list: readonly IBaseHalfReferenceListEntry[]): readonly IBaseHalfInputListEntry[] {
	return list.map(entry => ({ key: entry.key, kind: baseHalfVideoInputKindOfPath(entry.path) }));
}

registerWorkbenchContribution2(BaseHalfGenerationNameFollower.ID, BaseHalfGenerationNameFollower, WorkbenchPhase.AfterRestored);
