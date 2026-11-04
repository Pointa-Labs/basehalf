/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// One clock for a window and a page inside it, whose frames a check compares.
//
// `performance.timeOrigin + performance.now()` is no such clock. A document keeps the wall clock of the moment it was made,
// and the system corrects its wall clock: where this was measured every 16 minutes, by up to 330 ms, spread over a minute or
// two. A page made after a correction reads another time than the window made before it, for as long as both live, and
// a check then takes one's frame for the other's.

/**
 * Starts the clock of a window or of a page in it, which `globalThis.__bhFramesNow()` reads. The wall clock counts whole
 * milliseconds, so it is read as it turns: clocks started right after each other agree to 0.2 ms.
 */
export async function startFramesClock(target) {
	await target.evaluate(() => {
		const turning = Date.now();
		while (Date.now() === turning) {
			// To the next millisecond.
		}
		const zero = Date.now() - performance.now();
		globalThis.__bhFramesNow = () => zero + performance.now();
	});
}
