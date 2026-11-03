/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The system's browser in the smoke: a run must open nothing on the machine,
// so it stands in for the browser and records what BaseHalf opens there.

import { app } from '../context.mts';

interface IRun {
	basehalfSmokeOpened?: string[];
	basehalfSmokeOpenExternal?: unknown;
}

/** The addresses BaseHalf gave the system's browser since `withTheSystemBrowserStoodIn` began. */
function openedAddresses(): Promise<string[]> {
	return app.evaluate(() => (globalThis as unknown as IRun).basehalfSmokeOpened ?? []);
}

/**
 * Runs `body` with the main process's opener of the system's browser stood in
 * for: what BaseHalf opens there is recorded, and `body` reads it with
 * `opened`. The opener is put back after `body`.
 */
export async function withTheSystemBrowserStoodIn(body: (opened: () => Promise<string[]>) => Promise<void>): Promise<void> {
	await app.evaluate(({ shell }) => {
		const run = globalThis as unknown as IRun;
		run.basehalfSmokeOpened = [];
		run.basehalfSmokeOpenExternal ??= shell.openExternal;
		shell.openExternal = async url => {
			run.basehalfSmokeOpened?.push(url);
		};
	});
	try {
		await body(openedAddresses);
	} finally {
		await app.evaluate(({ shell }) => {
			const run = globalThis as unknown as IRun;
			if (run.basehalfSmokeOpenExternal) {
				shell.openExternal = run.basehalfSmokeOpenExternal as typeof shell.openExternal;
			}
		});
	}
}
