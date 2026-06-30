/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export interface IBaseHalfKeyedMutex {
	runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedMutex(): IBaseHalfKeyedMutex {
	const pendingByKey = new Map<string, Promise<unknown>>();

	return {
		runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
			const previous = pendingByKey.get(key) ?? Promise.resolve();
			const next = previous
				.catch(() => undefined)
				.then(task);

			pendingByKey.set(key, next);
			const cleanup = () => {
				if (pendingByKey.get(key) === next) {
					pendingByKey.delete(key);
				}
			};
			void next.then(cleanup, cleanup);

			return next;
		}
	};
}
