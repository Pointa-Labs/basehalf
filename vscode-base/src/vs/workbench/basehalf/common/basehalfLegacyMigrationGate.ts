/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../base/common/async.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfLegacyMigrationGate = createDecorator<IBaseHalfLegacyMigrationGate>('baseHalfLegacyMigrationGate');

/**
 * Orders BaseHalf's legacy prompts. The reference migration prompt comes
 * first; the old agent-instructions notification waits until that prompt was
 * answered or closed in this session, and otherwise waits until the next
 * session (the returned promise then never resolves in this one).
 */
export interface IBaseHalfLegacyMigrationGate {
	readonly _serviceBrand: undefined;

	/** Resolves once no migration prompt is pending in this session. */
	whenMigrationPromptSettled(): Promise<void>;

	/**
	 * Closes the gate until the returned hold is disposed. The reference
	 * migration holds it while detection may still show its prompt, and while
	 * the prompt is open. A prompt that is never answered or closed keeps its
	 * hold, so the gate stays closed for the rest of the session.
	 */
	hold(): IDisposable;

	/**
	 * The gate starts closed, because workbench contributions start in any
	 * order during idle time. The reference migration calls this once, right
	 * after it took its own hold for the detection of the folders open at
	 * startup.
	 */
	releaseStartupHold(): void;
}

export class BaseHalfLegacyMigrationGate implements IBaseHalfLegacyMigrationGate {
	declare readonly _serviceBrand: undefined;

	private holds = 0;
	private settled: DeferredPromise<void> | undefined;
	private readonly startupHold = this.hold();

	releaseStartupHold(): void {
		this.startupHold.dispose();
	}

	whenMigrationPromptSettled(): Promise<void> {
		if (this.holds === 0) {
			return Promise.resolve();
		}
		this.settled ??= new DeferredPromise<void>();
		return this.settled.p;
	}

	hold(): IDisposable {
		this.holds++;
		let released = false;
		return toDisposable(() => {
			if (released) {
				return;
			}
			released = true;
			this.holds--;
			if (this.holds === 0 && this.settled) {
				const settled = this.settled;
				this.settled = undefined;
				settled.complete();
			}
		});
	}
}

registerSingleton(IBaseHalfLegacyMigrationGate, BaseHalfLegacyMigrationGate, InstantiationType.Delayed);
