/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What Settings paints while it opens at one of BaseHalf's pages (settings
// pages, "Opening Settings at a page"), sampled every frame inside the window:
// a page that shows a few frames late, after another entry or the settings
// list, passes every check of the state at the end.

/** Starts reading, every frame, what Settings shows. */
export async function watchSettingsFrames(page) {
	await page.evaluate(() => {
		const frames = [];
		const watch = { frames, stop: false };
		globalThis.__basehalfSettingsFrames = watch;
		const tick = () => {
			const editor = Array.from(document.querySelectorAll('.settings-editor')).find(element => element.getClientRects().length > 0);
			if (editor) {
				const list = editor.querySelector('.settings-tree-container > .monaco-list');
				const shownPage = Array.from(editor.querySelectorAll('.settings-custom-section-container:not([hidden]) > *')).find(element => !element.hidden);
				frames.push({
					entry: editor.querySelector('.settings-toc-container .monaco-list-row.selected .settings-toc-entry')?.textContent ?? null,
					list: !!list && !list.hidden && list.getClientRects().length > 0,
					page: shownPage ? shownPage.classList[0] ?? null : null
				});
			}
			if (!watch.stop) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
}

/**
 * Stops reading, and checks that Settings, closed before, showed the page from
 * its first frame on: its entry selected, the page shown, and no settings list.
 */
export async function assertSettingsFramesShowedOnly(page, entry, pageClass, description) {
	const frames = await page.evaluate(() => {
		const watch = globalThis.__basehalfSettingsFrames;
		watch.stop = true;
		return watch.frames;
	});
	const wrong = frames.filter(frame => frame.entry !== entry || frame.list || frame.page !== pageClass);
	if (!frames.length || wrong.length) {
		throw new Error(`${description} must show ${entry} from the first frame of Settings on; of ${frames.length} frames, ${wrong.length} showed something else, first ${JSON.stringify(wrong[0] ?? null)}`);
	}
}
