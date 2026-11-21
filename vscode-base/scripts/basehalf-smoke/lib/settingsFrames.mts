/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What BaseHalf's Settings paints while it opens at a page (BaseHalf's
// Settings, "Opening Settings"), sampled every frame inside the window: a page
// that shows a few frames late, after another page or an empty body, passes
// every check of the state at the end.

/** Starts reading, every frame, what Settings shows. */
export async function watchSettingsFrames(page) {
	await page.evaluate(() => {
		// A watch that a failed step left running stops here.
		if (globalThis.__basehalfSettingsFrames) {
			globalThis.__basehalfSettingsFrames.stop = true;
		}
		const frames = [];
		const watch = { frames, stop: false };
		globalThis.__basehalfSettingsFrames = watch;
		let ticks = 0;
		const tick = () => {
			const settings = Array.from(document.querySelectorAll('.basehalf-settings')).find(element => element.getClientRects().length > 0);
			if (settings) {
				const shown = Array.from(settings.querySelectorAll('.basehalf-settings-body > *')).filter(element => !element.hidden && element.getClientRects().length > 0);
				const known = ['basehalf-settings-general', 'basehalf-video-providers', 'basehalf-about'];
				frames.push({
					entry: settings.querySelector('.basehalf-settings-page-tab[aria-selected="true"]')?.textContent ?? null,
					page: shown.length === 1 ? known.find(name => shown[0].classList.contains(name)) ?? shown[0].className : `${shown.length} pages`
				});
			}
			// At most about ten seconds of frames, so that a step that fails before its check leaves no loop behind.
			if (!watch.stop && ++ticks < 1200) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
}

/**
 * Stops reading, and checks that Settings, closed before, showed the page from
 * its first frame on: the page chosen in the list, and that page alone shown.
 */
export async function assertSettingsFramesShowedOnly(page, entry, pageClass, description) {
	const frames = await page.evaluate(() => {
		const watch = globalThis.__basehalfSettingsFrames;
		watch.stop = true;
		return watch.frames;
	});
	const wrong = frames.filter(frame => frame.entry !== entry || frame.page !== pageClass);
	if (!frames.length || wrong.length) {
		throw new Error(`${description} must show ${entry} from the first frame of Settings on; of ${frames.length} frames, ${wrong.length} showed something else, first ${JSON.stringify(wrong[0] ?? null)}`);
	}
}
