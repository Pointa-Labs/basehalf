/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export class SequenceProjectionRefreshState {
	private hiddenChange = false;
	private visible: boolean;

	constructor(visible: boolean) {
		this.visible = visible;
	}

	markChanged(): boolean {
		if (this.visible) {
			return true;
		}
		this.hiddenChange = true;
		return false;
	}

	setVisible(visible: boolean): boolean {
		this.visible = visible;
		if (!visible || !this.hiddenChange) {
			return false;
		}
		this.hiddenChange = false;
		return true;
	}
}

export class SequenceProjectionRenderQueue {
	private running: Promise<void> | undefined;
	private queued = false;
	private disposed = false;
	private readonly render: () => Promise<void>;

	constructor(render: () => Promise<void>) {
		this.render = render;
	}

	request(): Promise<void> {
		if (this.disposed) {
			return Promise.resolve();
		}
		this.queued = true;
		if (!this.running) {
			const running = this.drain().finally(() => {
				if (this.running === running) {
					this.running = undefined;
				}
				if (this.queued && !this.disposed) {
					void this.request();
				}
			});
			this.running = running;
		}
		return this.running;
	}

	dispose(): void {
		this.disposed = true;
		this.queued = false;
	}

	private async drain(): Promise<void> {
		while (this.queued && !this.disposed) {
			this.queued = false;
			await this.render();
		}
	}
}

export interface SequenceProjectionWindow<T> {
	readonly items: readonly T[];
	readonly totalItems: number;
	readonly truncated: boolean;
}

/**
 * Keeps Card Detail work bounded independently from the portable document
 * limit. Larger Sequences remain readable and editable as local JSON, while
 * the projection shows a deterministic prefix instead of freezing the
 * Extension Host to inspect and render the entire file.
 */
export function sequenceProjectionWindow<T>(items: readonly T[], maximumVisibleItems: number): SequenceProjectionWindow<T> {
	if (!Number.isInteger(maximumVisibleItems) || maximumVisibleItems < 1) {
		throw new Error('The Sequence projection limit must be a positive integer.');
	}
	return Object.freeze({
		items: Object.freeze(items.slice(0, maximumVisibleItems)),
		totalItems: items.length,
		truncated: items.length > maximumVisibleItems
	});
}

export class SequenceProjectionNodePaths {
	private resources = new Set<string>();
	private readonly maximumPaths: number;

	constructor(maximumPaths: number) {
		if (!Number.isInteger(maximumPaths) || maximumPaths < 1) {
			throw new Error('The Sequence node watch limit must be a positive integer.');
		}
		this.maximumPaths = maximumPaths;
	}

	reconcile(resourceKeys: readonly string[]): void {
		if (resourceKeys.length > this.maximumPaths) {
			throw new Error(`Sequence has more than ${this.maximumPaths} node paths to watch.`);
		}
		this.resources = new Set(resourceKeys.filter(resourceKey => !!resourceKey));
	}

	hasResource(resourceKey: string): boolean {
		return this.resources.has(resourceKey);
	}

	clear(): void {
		this.resources.clear();
	}
}

export interface SequenceProjectionArtifactBinding {
	readonly pinKey: string;
	readonly verifiedResourceKey?: string;
}

/**
 * Playback of the saved order is available only when every exact Sequence pin
 * resolves to a verified local artifact. Individual verified clips remain
 * previewable while an incomplete order is repaired.
 */
export function canPlayEntireSequence(totalItems: number, playableItems: number): boolean {
	return totalItems > 0 && playableItems === totalItems;
}

export interface SequenceProjectionPlayableItem {
	readonly index: number;
	readonly itemId: string;
	readonly src: string;
}

export interface SequenceProjectionPlaybackRestore {
	readonly playableIndex: number;
	readonly currentTime: number;
	readonly shouldPlay: boolean;
	readonly playAll: boolean;
}

/**
 * Restores a refreshed projection by stable Sequence item identity. A changed
 * or missing artifact remains selected when possible, but playback resumes
 * only when the exact preview source is unchanged.
 */
export function resolveSequencePlaybackRestore(
	playable: readonly SequenceProjectionPlayableItem[],
	state: unknown
): SequenceProjectionPlaybackRestore {
	if (playable.length === 0) {
		return { playableIndex: -1, currentTime: 0, shouldPlay: false, playAll: false };
	}
	const record = state && typeof state === 'object' && !Array.isArray(state)
		? state as Record<string, unknown>
		: {};
	let playableIndex = typeof record.activeItemId === 'string'
		? playable.findIndex(item => item.itemId === record.activeItemId)
		: -1;
	if (playableIndex < 0 && Number.isInteger(record.sequenceIndex) && (record.sequenceIndex as number) >= 0) {
		const oldSequenceIndex = record.sequenceIndex as number;
		playableIndex = playable.findIndex(item => item.index >= oldSequenceIndex);
		if (playableIndex < 0) {
			playableIndex = playable.length - 1;
		}
	}
	if (playableIndex < 0) {
		playableIndex = 0;
	}
	const selected = playable[playableIndex]!;
	const sameSource = typeof record.activeSource === 'string' && record.activeSource === selected.src;
	const currentTime = sameSource && typeof record.currentTime === 'number' && Number.isFinite(record.currentTime) && record.currentTime >= 0
		? record.currentTime
		: 0;
	const shouldPlay = sameSource && record.wasPlaying === true;
	return {
		playableIndex,
		currentTime,
		shouldPlay,
		playAll: shouldPlay && record.playAll === true
	};
}

export interface SequencePreviewMediaElement {
	removeAttribute(name: string): void;
	setAttribute(name: string, value: string): void;
	load(): void;
}

/**
 * Reloads only the already verified resource selected by the Sequence item.
 * The caller supplies that immutable pin's source instead of consulting node
 * Current state or asking an executor for another result.
 */
export function reloadSequencePreview(media: SequencePreviewMediaElement, verifiedSource: string | undefined): boolean {
	if (!verifiedSource) {
		return false;
	}
	media.removeAttribute('src');
	media.load();
	media.setAttribute('src', verifiedSource);
	media.load();
	return true;
}

/**
 * Retains only the last verified artifact resource for each Sequence pin. An
 * unavailable pin keeps its prior path so replacing the file at that exact
 * location can trigger a fresh inspection.
 */
export class SequenceProjectionArtifactPaths {
	private byPin = new Map<string, string>();
	private resources = new Set<string>();
	private readonly maximumPins: number;

	constructor(maximumPins: number) {
		if (!Number.isInteger(maximumPins) || maximumPins < 1) {
			throw new Error('The Sequence artifact watch limit must be a positive integer.');
		}
		this.maximumPins = maximumPins;
	}

	reconcile(bindings: readonly SequenceProjectionArtifactBinding[]): void {
		if (bindings.length > this.maximumPins) {
			throw new Error(`Sequence has more than ${this.maximumPins} artifact paths to watch.`);
		}
		const next = new Map<string, string>();
		const seenPins = new Set<string>();
		for (const binding of bindings) {
			if (!binding.pinKey) {
				throw new Error('A Sequence artifact watch binding is missing its pin identity.');
			}
			if (seenPins.has(binding.pinKey)) {
				throw new Error(`Sequence artifact pin '${binding.pinKey}' is duplicated.`);
			}
			seenPins.add(binding.pinKey);
			const resourceKey = binding.verifiedResourceKey || this.byPin.get(binding.pinKey);
			if (resourceKey) {
				next.set(binding.pinKey, resourceKey);
			}
		}
		this.byPin = next;
		this.resources = new Set(next.values());
	}

	hasResource(resourceKey: string): boolean {
		return this.resources.has(resourceKey);
	}

	get size(): number {
		return this.resources.size;
	}

	clear(): void {
		this.byPin.clear();
		this.resources.clear();
	}
}
