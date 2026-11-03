/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The system's clipboard is the user's: a step that writes it runs only while
// it holds text alone, which the step puts back, or where the clipboard is
// the run's own (CI, or BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE=1).

import process from 'process';
import { app } from '../context.mts';

/** Whether the clipboard is the run's own, to write whatever it holds. */
function clipboardIsTheRuns(): boolean {
	return process.env.CI === 'true' || process.env.CI === '1' || process.env.BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE === '1';
}

/**
 * Runs `body`, which writes the system's clipboard, and puts the text the
 * clipboard held back after it. While the clipboard holds more than text, and
 * the clipboard is not the run's own, `body` does not run, and the log says
 * so with `name`.
 */
export async function withTheRunsClipboard(name: string, body: () => Promise<void>): Promise<void> {
	const state = await app.evaluate(({ clipboard }, overwrite) => {
		const textOnly = clipboard.availableFormats().every(format => format.toLowerCase().startsWith('text/plain'));
		return textOnly || overwrite ? { exercised: true, previousText: clipboard.readText() } : { exercised: false, previousText: '' };
	}, clipboardIsTheRuns());
	if (!state.exercised) {
		console.error(`[basehalf-smoke] skip ${name}: preserving non-text clipboard formats`);
		return;
	}
	try {
		await body();
	} finally {
		await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), state.previousText);
	}
}
