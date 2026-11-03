/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The system's light and dark appearance, as BaseHalf sees it: the run sets
// the appearance of its own application alone, never the system's. The pages
// see the appearance as `prefers-color-scheme`, which the browser protocol
// sets for a run's pages, in light appearance unless told otherwise. The
// window keeps its dark theme in both (workbench appearance, rule 6).

import { app } from '../context.mts';

/** Waits until `target`, a page or a frame, sees the system in `appearance`. */
export async function waitForSystemAppearance(target, appearance: 'light' | 'dark'): Promise<void> {
	await target.waitForFunction(wanted => matchMedia(`(prefers-color-scheme: ${wanted})`).matches, appearance, { timeout: 10_000 });
}

/** Shows the application and its pages as if the system were in light or dark appearance. */
export async function showSystemAppearance(page, appearance: 'light' | 'dark'): Promise<void> {
	await app.evaluate(({ nativeTheme }, source) => {
		nativeTheme.themeSource = source;
	}, appearance);
	await page.emulateMedia({ colorScheme: appearance });
	await waitForSystemAppearance(page, appearance);
}

/** Gives the application the system's own appearance again, and its pages the run's light appearance. */
export async function restoreSystemAppearance(page): Promise<void> {
	await app.evaluate(({ nativeTheme }) => {
		nativeTheme.themeSource = 'system';
	});
	await page.emulateMedia({ colorScheme: 'light' });
}
