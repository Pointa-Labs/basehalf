/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// A note's video or sound sampled on every frame, while the note is written
// from outside as an agent writes it (note rendering, rule 4b, criterion 13e).

import fs from 'fs';

const PROBE = 'basehalfSmokeProbe';

/**
 * Marks the media element under `selector` and reads it on every frame of the
 * window until `stop`: whether it is in a player that shows, whether it plays,
 * whether it has a frame to show, and its time. A player that another one
 * replaced would not be the marked one.
 */
export async function sampleNoteMediaEveryFrame(page, selector) {
	await page.evaluate(({ selector, probe }) => {
		const media = document.querySelector(selector);
		if (!media) {
			throw new Error(`No video or sound at ${selector}`);
		}
		media.dataset[probe] = 'true';
		const samples = [];
		const state = { samples, stop: false };
		window[`__${probe}`] = state;
		const started = performance.now();
		const read = () => {
			const marked = document.querySelector(`[data-basehalf-smoke-probe="true"]`);
			const box = marked?.closest('.basehalf-canvas-video-player')?.getBoundingClientRect();
			samples.push({
				at: Math.round(performance.now() - started),
				shown: !!marked && !marked.closest('.basehalf-note-media-waiting') && !!box && box.width > 1 && box.height > 1,
				paused: marked?.paused ?? true,
				ready: marked?.readyState ?? 0,
				time: marked ? marked.currentTime : undefined,
				muted: marked?.muted,
			});
			if (!state.stop) {
				requestAnimationFrame(read);
			}
		};
		requestAnimationFrame(read);
	}, { selector, probe: PROBE });
	return async () => page.evaluate(probe => {
		const state = window[`__${probe}`];
		state.stop = true;
		delete window[`__${probe}`];
		document.querySelector(`[data-basehalf-smoke-probe="true"]`)?.removeAttribute('data-basehalf-smoke-probe');
		return state.samples;
	}, PROBE);
}

/** Writes a line at the end of `file` `times` times, half a second apart, as an agent does, and waits for the last to be drawn. */
export async function writeNoteAsAnAgent(page, file, times = 4) {
	for (let index = 1; index <= times; index++) {
		await page.waitForTimeout(500);
		fs.appendFileSync(file, `\nA line an agent wrote, ${index}.\n`, 'utf8');
	}
	await page.waitForTimeout(800);
}

/**
 * What the frames say (criterion 13e): the frames on which the player did not
 * show, was paused while it should play, or had no frame to show; whether its
 * time ever went back; and how far it advanced against the time that passed.
 */
export function readNoteMediaFrames(samples, playing) {
	const missing = samples.filter(sample => !sample.shown || sample.ready < 2 || (playing && sample.paused));
	let backwards = 0;
	for (let index = 1; index < samples.length; index++) {
		if (samples[index].time < samples[index - 1].time - 0.0005) {
			backwards++;
		}
	}
	const first = samples[0];
	const last = samples[samples.length - 1];
	return {
		frames: samples.length,
		missing: missing.length,
		firstMissing: missing[0],
		backwards,
		advanced: Math.round((last.time - first.time) * 1000) / 1000,
		passed: Math.round(last.at - first.at) / 1000,
		mutedAtEnd: last.muted,
	};
}

/** Throws unless the frames read as criterion 13e asks: always shown, never paused while playing, never back, and as far on as the time that passed. */
export function assertNoteMediaPlayedOn(what, reading, playing) {
	const advancedEnough = playing ? reading.advanced >= reading.passed * 0.9 : reading.advanced === 0;
	if (reading.frames < 30 || reading.missing > 0 || reading.backwards > 0 || !advancedEnough) {
		throw new Error(`${what} should go on ${playing ? 'playing' : 'standing'} while its note is written from outside, on every frame: ${JSON.stringify(reading)}`);
	}
}
