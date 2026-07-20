/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export class SequenceConcurrencyLimiter {
	private active = 0;
	private readonly waiting: Array<() => void> = [];
	private readonly maximum: number;

	constructor(maximum: number) {
		if (!Number.isInteger(maximum) || maximum < 1) {
			throw new Error('Sequence concurrency must be a positive integer.');
		}
		this.maximum = maximum;
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.active < this.maximum) {
			this.active++;
			return;
		}
		await new Promise<void>(resolve => this.waiting.push(resolve));
	}

	private release(): void {
		const next = this.waiting.shift();
		if (next) {
			next();
			return;
		}
		this.active--;
	}
}
