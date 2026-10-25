/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage } from '../../../../base/common/errors.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { baseHalfGenerationInfoChangedFields, IBaseHalfGenerationInfo } from '../common/basehalfGenerationInfo.js';
import { IBaseHalfDraftOperations, IBaseHalfDraftSnapshot, IBaseHalfGenerationCardSnapshot } from '../common/basehalfVideoGeneration.js';

/** What the steps of drafts on the canvas undo stack need. */
export interface IBaseHalfDraftUndoServices {
	readonly draftOperations: IBaseHalfDraftOperations;
	readonly undoRedoService: IUndoRedoService;
	readonly notificationService: INotificationService;
	/** Whether a generation that has not ended lands on the card. */
	isGenerating(card: URI): boolean;
	/** The card as it is now; rejects when it is no generation card. */
	read(card: URI): Promise<IBaseHalfGenerationCardSnapshot>;
}

/**
 * What a step did to drafts: `made` drafts (undo deletes them, redo writes
 * them back), `deleted` them (undo writes them back, redo deletes them
 * again), or `moved` one (undo moves it back, redo moves it again).
 */
export type BaseHalfDraftUndoChange =
	| { readonly kind: 'made'; readonly drafts: readonly URI[] }
	| { readonly kind: 'deleted'; readonly snapshots: readonly IBaseHalfDraftSnapshot[] }
	| { readonly kind: 'moved'; readonly from: URI; readonly to: URI };

/** Where a step leaves its drafts: as it did them, or as before it. */
type BaseHalfDraftUndoState = 'done' | 'undone';

/**
 * Why the next undo or redo of a step changes nothing: a draft of it that
 * generates (`wait`: the step can be undone once the generation ended), or a
 * draft that has its file or changed since the step (`done`: the step is done
 * with).
 */
interface IBaseHalfDraftUndoRefusal {
	readonly kind: 'wait' | 'done';
	readonly message: string;
}

/**
 * One step of the canvas undo stack over drafts (generation cards, "Moving,
 * renaming, copying, and undo"). A draft has no file, so the step keeps all of
 * its card information: a draft that is deleted is kept as its snapshot, and
 * written back from it. While a draft of the step generates, undo refuses,
 * says why, and keeps the step for later. Once a draft has its file, or its
 * prompt or settings changed since the step (compared field by field), or
 * its path is taken, the step is done with: undo and redo change nothing and
 * say why, and the next undo goes to the step before. A generation itself is
 * not undone.
 */
export class BaseHalfDraftUndoElement implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly resources: readonly URI[];
	/** The prompt and settings of each draft as the step left them, by resource. */
	private captured: ReadonlyMap<string, IBaseHalfGenerationInfo> = new Map();
	private snapshots: readonly IBaseHalfDraftSnapshot[];

	private constructor(
		readonly label: string,
		readonly code: string,
		resources: readonly URI[],
		private readonly change: BaseHalfDraftUndoChange,
		private readonly services: IBaseHalfDraftUndoServices,
		private state: BaseHalfDraftUndoState
	) {
		this.resources = resources;
		this.snapshots = change.kind === 'deleted' ? change.snapshots : [];
	}

	/**
	 * Pushes the step onto the canvas undo stack once the prompt and settings
	 * of the drafts it made or moved are known, so that a later change of them
	 * is seen: from `captured` when the caller knows them, which pushes the
	 * step at once, or read from the drafts. With `group`, one undo takes it
	 * back with the other steps of the group (exact undo, "Deleting").
	 */
	static async push(label: string, code: string, resources: readonly URI[], change: BaseHalfDraftUndoChange, services: IBaseHalfDraftUndoServices, captured?: ReadonlyMap<string, IBaseHalfGenerationInfo>, group = UndoRedoGroup.None): Promise<void> {
		const element = new BaseHalfDraftUndoElement(label, code, resources, change, services, 'done');
		if (captured) {
			element.captured = captured;
		} else {
			await element.capture();
		}
		services.undoRedoService.pushElement(element, group, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
	}

	async undo(): Promise<void> {
		if (this.state !== 'done') {
			return;
		}
		const refusal = await this.refusal(this.present());
		if (refusal) {
			this.services.notificationService.info(refusal.message);
			if (refusal.kind === 'wait') {
				// The step stays the one to undo next, for when the generation ended.
				const again = new BaseHalfDraftUndoElement(this.label, this.code, this.resources, this.change, this.services, 'done');
				again.captured = this.captured;
				again.snapshots = this.snapshots;
				this.services.undoRedoService.pushElement(again, UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
			}
			// Otherwise the step is done with, and a redo of it changes nothing either.
			return;
		}
		await this.apply(false);
	}

	async redo(): Promise<void> {
		if (this.state !== 'undone') {
			return;
		}
		const refusal = await this.refusal(this.present());
		if (refusal) {
			this.services.notificationService.info(refusal.message);
			return;
		}
		await this.apply(true);
	}

	/** The drafts that are there before the next undo or redo: what it deletes or moves. */
	private present(): readonly URI[] {
		const done = this.state === 'done';
		switch (this.change.kind) {
			case 'made':
				return done ? this.change.drafts : [];
			case 'deleted':
				return done ? [] : this.snapshots.map(snapshot => snapshot.resource);
			case 'moved':
				return [done ? this.change.to : this.change.from];
		}
	}

	/** Does the step (`forward`) or takes it back. Nothing changes when the draft operations refuse. */
	private async apply(forward: boolean): Promise<void> {
		const { draftOperations, notificationService } = this.services;
		try {
			switch (this.change.kind) {
				case 'made':
				case 'deleted': {
					if ((this.change.kind === 'made') === forward) {
						// Each draft comes back where its path is free; one whose path is taken says so.
						const refused: string[] = [];
						for (const snapshot of this.snapshots) {
							try {
								await draftOperations.restore(snapshot);
							} catch (error) {
								refused.push(getErrorMessage(error));
							}
						}
						if (refused.length) {
							notificationService.info(refused[0]);
							if (refused.length === this.snapshots.length) {
								return;
							}
						}
					} else {
						const snapshots: IBaseHalfDraftSnapshot[] = [];
						for (const draft of this.present()) {
							snapshots.push(await draftOperations.delete(draft));
						}
						this.snapshots = snapshots;
					}
					break;
				}
				case 'moved':
					await draftOperations.move(forward ? this.change.from : this.change.to, forward ? this.change.to : this.change.from);
					break;
			}
		} catch (error) {
			// The draft operations refuse with the reason in plain words.
			notificationService.info(getErrorMessage(error));
			return;
		}
		this.state = forward ? 'done' : 'undone';
		await this.capture();
	}

	/** Why the next undo or redo cannot delete or move these drafts, if it cannot. */
	private async refusal(drafts: readonly URI[]): Promise<IBaseHalfDraftUndoRefusal | undefined> {
		const generating = drafts.find(draft => this.services.isGenerating(draft));
		if (generating) {
			return { kind: 'wait', message: localize('basehalf.video.generation.undoGenerating', "{0} is generating. Stop it first.", basename(generating)) };
		}
		for (const draft of drafts) {
			const snapshot = await this.services.read(draft).catch(() => undefined);
			if (snapshot && (snapshot.hasFile || snapshot.made || snapshot.madeUnreadable)) {
				return { kind: 'done', message: localize('basehalf.video.generation.undoHasFile', "{0} has its file now, so it is left as it is.", basename(draft)) };
			}
			// The prompt and settings field by field, in whatever order an agent wrote them.
			const captured = this.captured.get(draft.toString());
			if (!snapshot || !captured || baseHalfGenerationInfoChangedFields(captured, snapshot.info).length) {
				return { kind: 'done', message: localize('basehalf.video.generation.undoChanged', "{0} changed since this step, so it is left as it is.", basename(draft)) };
			}
		}
		return undefined;
	}

	/** Reads the prompt and settings of the drafts that are there now. */
	private async capture(): Promise<void> {
		const captured = new Map<string, IBaseHalfGenerationInfo>();
		for (const draft of this.present()) {
			const snapshot = await this.services.read(draft).catch(() => undefined);
			if (snapshot) {
				captured.set(draft.toString(), snapshot.info);
			}
		}
		this.captured = captured;
	}
}
