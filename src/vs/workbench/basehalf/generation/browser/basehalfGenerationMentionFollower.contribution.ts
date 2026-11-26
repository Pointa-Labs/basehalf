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
import { rewriteBaseHalfPromptMentions } from '../common/basehalfGenerationMentions.js';
import { baseHalfGenerationKindOfPath, setBaseHalfGenerationPrompt } from '../common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationCardStore } from '../common/basehalfVideoGeneration.js';

/** One change of a draft's list as the mentions see it. */
interface IMentionChange {
	readonly before: readonly IBaseHalfReferenceListEntry[];
	readonly after: readonly IBaseHalfReferenceListEntry[];
	readonly replacements: readonly IBaseHalfUpstreamEntryReplacement[];
}

/**
 * Keeps the mentions in a draft's prompt with their inputs (generation cards,
 * "Mentions", D74). It takes part in every reference edit that writes a
 * draft's list, a rename's and a relink's too: when a mention names an entry
 * that a replace rewrote, it writes the new path into it, and when it names
 * one that is gone, it takes it out; the edit's undo and redo put the prompt
 * back with the list. Adding and reordering change no mention.
 */
export class BaseHalfGenerationMentionFollower extends Disposable implements IWorkbenchContribution, IBaseHalfReferenceEditParticipant {

	static readonly ID = 'workbench.contrib.basehalf.generationMentionFollower';

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
		// Only a generation card has mentions, and of those only a draft has a prompt to change (D67).
		if (!baseHalfGenerationKindOfPath(change.node.relativePath)) {
			return undefined;
		}
		const forward: IMentionChange = { before: change.before, after: change.after, replacements: change.replacements };
		// Adding and reordering keep every entry: no mention changes then.
		const kept = new Set(forward.after.map(entry => entry.key));
		if (forward.replacements.length === 0 && forward.before.every(entry => kept.has(entry.key))) {
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
			const next = rewrite(prompt, forward);
			if (next === undefined) {
				return undefined;
			}
			const written = await this.write(resource, prompt, next, forward);
			if (written === undefined) {
				return undefined;
			}
			const backward: IMentionChange = { before: forward.after, after: forward.before, replacements: forward.replacements.map(replacement => ({ from: replacement.to, to: replacement.from })) };
			return {
				// The list is back to what it was: the prompt as it was, or, when it was
				// changed since, the change with the mentions of that list.
				undo: () => this.restore(resource, written, prompt, backward),
				redo: () => this.restore(resource, prompt, written, forward)
			};
		} catch (error) {
			this.report(resource, error);
			return undefined;
		}
	}

	/**
	 * Writes `next` when the prompt is still `prompt`, and otherwise its
	 * mentions for the change. Resolves with the prompt written, or
	 * `undefined` when nothing needed writing.
	 */
	private async write(resource: URI, prompt: string, next: string, change: IMentionChange): Promise<string | undefined> {
		let written: string | undefined;
		await this.cardStore.update(resource, info => {
			const current = info.prompt;
			const target = current === prompt ? next : rewrite(current, change);
			written = target;
			return target === undefined ? info : setBaseHalfGenerationPrompt(info, target);
		});
		return written;
	}

	/**
	 * Puts `restore` back when the prompt is still `expected`, and otherwise
	 * writes its mentions for `change`'s list. A prompt that is `restore`
	 * already stays, as after the Undo of a rename's report.
	 */
	private async restore(resource: URI, expected: string, restore: string, change: IMentionChange): Promise<void> {
		try {
			if (!await this.cardStore.isGenerationCard(resource)) {
				return;
			}
			const snapshot = await this.cardStore.read(resource);
			if (snapshot.hasFile || !snapshot.infoReadable) {
				return;
			}
			await this.cardStore.update(resource, info => {
				if (info.prompt === restore) {
					return info;
				}
				const target = info.prompt === expected ? restore : rewrite(info.prompt, change);
				return target === undefined ? info : setBaseHalfGenerationPrompt(info, target);
			});
		} catch (error) {
			this.report(resource, error);
		}
	}

	private report(resource: URI, error: unknown): void {
		this.logService.warn(`[BaseHalf generation] could not update the mentions in the prompt of ${resource.toString()}`, error);
		this.notificationService.warn(localize('basehalf.generation.mentions.failed', "BaseHalf could not update the mentions in the prompt of {0}.", basename(resource)));
	}
}

function rewrite(prompt: string, change: IMentionChange): string | undefined {
	return rewriteBaseHalfPromptMentions(prompt, change.before, change.after, change.replacements);
}

registerWorkbenchContribution2(BaseHalfGenerationMentionFollower.ID, BaseHalfGenerationMentionFollower, WorkbenchPhase.AfterRestored);
