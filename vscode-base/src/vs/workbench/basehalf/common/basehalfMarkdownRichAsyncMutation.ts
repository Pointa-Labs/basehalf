/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/** Tracks clipboard and other promise-backed editor commands whose eventual
 * DOM transaction can otherwise arrive after a structural freeze snapshot. */
export class BaseHalfMarkdownRichAsyncMutationBarrier {
	private readonly inFlight = new Set<Promise<void>>();
	private readonly idleWaiters = new Set<() => void>();

	run(task: () => Promise<void>): Promise<void> {
		let operation!: Promise<void>;
		operation = task().finally(() => {
			this.inFlight.delete(operation);
			if (this.inFlight.size === 0) {
				for (const resolve of this.idleWaiters) {
					resolve();
				}
				this.idleWaiters.clear();
			}
		});
		this.inFlight.add(operation);
		return operation;
	}

	async waitForIdle(): Promise<void> {
		while (this.inFlight.size > 0) {
			await new Promise<void>(resolve => this.idleWaiters.add(resolve));
		}
	}
}
