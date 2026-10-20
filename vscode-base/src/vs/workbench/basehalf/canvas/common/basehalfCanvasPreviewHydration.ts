/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfCanvasCardPresentation } from './basehalfCanvasCardPresentation.js';

export type BaseHalfCanvasPreviewHydrationPriority = 1 | 2;

interface IBaseHalfCanvasPreviewHydrationEntry {
	readonly priority: BaseHalfCanvasPreviewHydrationPriority;
}

export interface IBaseHalfCanvasPreviewHydrationBatch {
	readonly generation: number;
	readonly sceneKey: string;
	readonly paths: readonly string[];
}

export class BaseHalfCanvasPreviewHydrationQueue {
	private readonly entries = new Map<string, IBaseHalfCanvasPreviewHydrationEntry>();
	private generation = 0;
	private sceneKey = 'no-folder';

	get size(): number {
		return this.entries.size;
	}

	resetScene(sceneKey: string): void {
		this.sceneKey = sceneKey;
		this.generation++;
		this.entries.clear();
	}

	resetViewport(): void {
		for (const [path, entry] of this.entries) {
			if (entry.priority === 1) {
				this.entries.delete(path);
			}
		}
	}

	enqueue(path: string, priority: BaseHalfCanvasPreviewHydrationPriority): void {
		const current = this.entries.get(path);
		this.entries.set(path, {
			priority: current ? Math.max(priority, current.priority) as BaseHalfCanvasPreviewHydrationPriority : priority
		});
	}

	setPresentation(path: string, presentation: BaseHalfCanvasCardPresentation): void {
		if (presentation === 'shell') {
			this.entries.delete(path);
			return;
		}
		this.entries.set(path, {
			priority: presentation === 'interactive' ? 2 : 1
		});
	}

	delete(path: string): void {
		this.entries.delete(path);
	}

	clear(): void {
		this.entries.clear();
	}

	prune(retain: (path: string) => boolean): void {
		for (const path of this.entries.keys()) {
			if (!retain(path)) {
				this.entries.delete(path);
			}
		}
	}

	take(limit: number, rank: (path: string) => number = () => 0): IBaseHalfCanvasPreviewHydrationBatch | undefined {
		const paths = [...this.entries]
			.sort((left, right) => right[1].priority - left[1].priority || rank(left[0]) - rank(right[0]))
			.slice(0, limit)
			.map(([path]) => path);
		if (paths.length === 0) {
			return undefined;
		}
		for (const path of paths) {
			this.entries.delete(path);
		}
		return {
			generation: this.generation,
			sceneKey: this.sceneKey,
			paths
		};
	}

	isCurrent(batch: Pick<IBaseHalfCanvasPreviewHydrationBatch, 'generation' | 'sceneKey'>): boolean {
		return batch.generation === this.generation && batch.sceneKey === this.sceneKey;
	}
}

export class BaseHalfCanvasPreviewVerificationQueue {
	private generation = 0;
	private tail = Promise.resolve();

	reset(): void {
		this.generation++;
		this.tail = Promise.resolve();
	}

	enqueue(
		task: (isCurrent: () => boolean) => Promise<void>,
		onError: (error: unknown) => void
	): Promise<void> {
		const generation = this.generation;
		const isCurrent = () => generation === this.generation;
		const result = this.tail.then(() => task(isCurrent));
		this.tail = result.catch(onError);
		return result;
	}
}
