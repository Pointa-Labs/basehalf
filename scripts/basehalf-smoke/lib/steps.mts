/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Steps and waiting.

const passed = [];

/** A step that has not finished in this time hangs: it fails, and the suite keeps its folder (README). */
const STEP_LIMIT_MS = 5 * 60_000;

export async function step(name, run) {
	console.error(`[basehalf-smoke] start ${name}`);
	let limit;
	try {
		await Promise.race([
			run(),
			new Promise((_, reject) => {
				limit = setTimeout(() => reject(new Error(`The step ${name} did not finish within ${STEP_LIMIT_MS / 60_000} minutes`)), STEP_LIMIT_MS);
			})
		]);
	} finally {
		clearTimeout(limit);
	}
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

// Reads with `read` until `accept` takes what it read; fails with the last reading.
export async function waitForReading(read, accept, description, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let value;
	let failure;
	for (; ;) {
		try {
			value = await read();
			failure = undefined;
			if (accept(value)) {
				return value;
			}
		} catch (error) {
			failure = error;
		}
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${description}; last read: ${failure ? `failed with ${failure instanceof Error ? failure.message : String(failure)}` : JSON.stringify(value)}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}
