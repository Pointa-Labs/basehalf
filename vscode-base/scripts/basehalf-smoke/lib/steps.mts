/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Steps and waiting.

const passed = [];

export async function step(name, run) {
	console.error(`[basehalf-smoke] start ${name}`);
	await run();
	console.error(`[basehalf-smoke] pass ${name}`);
	passed.push(name);
}

/** The steps of this run that passed, in order. */
export function passedSteps() {
	return [...passed];
}

export async function waitUntil(predicate, description, timeoutMs = 10_000) {
	const started = Date.now();
	let lastError;
	while (Date.now() - started < timeoutMs) {
		try {
			if (predicate()) {
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${description}${lastError instanceof Error ? `; last observation failed: ${lastError.message}` : ''}`);
}
