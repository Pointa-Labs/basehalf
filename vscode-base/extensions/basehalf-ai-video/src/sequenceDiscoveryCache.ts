/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

interface SequenceDiscoveryEntry<T> {
	readonly generation: number;
	readonly promise: Promise<readonly T[]>;
}

/**
 * Shares only workspace discovery results. Callers still read and validate every
 * discovered document for each operation.
 */
export class SequenceDiscoveryCache<T> {
	private readonly generations = new Map<string, number>();
	private readonly entries = new Map<string, SequenceDiscoveryEntry<T>>();

	async get(key: string, discover: () => Promise<readonly T[]>): Promise<readonly T[]> {
		while (true) {
			const generation = this.generations.get(key) ?? 0;
			let entry = this.entries.get(key);
			if (!entry || entry.generation !== generation) {
				entry = {
					generation,
					promise: Promise.resolve().then(discover).then(items => Object.freeze([...items]))
				};
				this.entries.set(key, entry);
			}
			try {
				const items = await entry.promise;
				if ((this.generations.get(key) ?? 0) === generation && this.entries.get(key) === entry) {
					return items;
				}
			} catch (error) {
				if ((this.generations.get(key) ?? 0) !== generation || this.entries.get(key) !== entry) {
					continue;
				}
				this.entries.delete(key);
				throw error;
			}
		}
	}

	invalidate(key: string): void {
		this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
		this.entries.delete(key);
	}

	clear(): void {
		this.generations.clear();
		this.entries.clear();
	}
}
