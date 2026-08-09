/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

interface IBaseHalfCanvasNoteFormatSelectionBarrierEntry {
	readonly owner: string;
	readonly settlement: Promise<boolean>;
}

export interface IBaseHalfCanvasNoteFormatOwner {
	readonly sceneKey: string;
	readonly path: string;
	readonly resourceKey: string;
}

export function baseHalfCanvasNoteFormatOwnersEqual(
	left: IBaseHalfCanvasNoteFormatOwner,
	right: IBaseHalfCanvasNoteFormatOwner
): boolean {
	return left.sceneKey === right.sceneKey
		&& left.path === right.path
		&& left.resourceKey === right.resourceKey;
}

export function baseHalfCanvasNoteFormatOwnerKey(owner: IBaseHalfCanvasNoteFormatOwner): string {
	return JSON.stringify([owner.sceneKey, owner.path, owner.resourceKey]);
}

/**
 * Owns the accepted formatting intents covered by one navigation guard. An
 * intent from another Note identity must acquire a different guard instead of
 * joining this guard's settlement or release lifecycle.
 */
export class BaseHalfCanvasNoteFormatNavigationOwnership<T> {
	private readonly pending = new Set<T>();
	private readonly completions: Promise<boolean>[] = [];

	constructor(readonly owner: IBaseHalfCanvasNoteFormatOwner) { }

	accept(owner: IBaseHalfCanvasNoteFormatOwner, intent: T, completion: Promise<boolean>): boolean {
		if (!baseHalfCanvasNoteFormatOwnersEqual(this.owner, owner)) {
			return false;
		}
		if (!this.pending.has(intent)) {
			this.pending.add(intent);
			this.completions.push(completion.catch(() => false));
		}
		return true;
	}

	settle(intent: T): void {
		this.pending.delete(intent);
	}

	get hasPending(): boolean {
		return this.pending.size > 0;
	}

	async wait(): Promise<boolean> {
		let applied = true;
		let observed = 0;
		while (observed < this.completions.length) {
			const completions = this.completions.slice(observed);
			observed = this.completions.length;
			const outcomes = await Promise.all(completions);
			applied = outcomes.every(Boolean) && applied;
		}
		return applied;
	}
}

/**
 * Keeps a programmatic Canvas selection behind the authoring intent that must
 * mount the inline Note projection first. Repeated renders reuse one waiter,
 * while an obsolete owner cannot replay its selection after the scene changes.
 */
export class BaseHalfCanvasNoteFormatSelectionBarrier {
	private current: IBaseHalfCanvasNoteFormatSelectionBarrierEntry | undefined;

	defer(
		owner: string,
		settle: () => Promise<boolean>,
		onSettled: (applied: boolean) => void
	): void {
		if (this.current?.owner === owner) {
			return;
		}
		const entry: IBaseHalfCanvasNoteFormatSelectionBarrierEntry = {
			owner,
			settlement: settle()
		};
		this.current = entry;
		void entry.settlement.then(
			applied => this.finish(entry, applied, onSettled),
			() => this.finish(entry, false, onSettled)
		);
	}

	reset(): void {
		this.current = undefined;
	}

	private finish(
		entry: IBaseHalfCanvasNoteFormatSelectionBarrierEntry,
		applied: boolean,
		onSettled: (applied: boolean) => void
	): void {
		if (this.current !== entry) {
			return;
		}
		this.current = undefined;
		onSettled(applied);
	}
}
