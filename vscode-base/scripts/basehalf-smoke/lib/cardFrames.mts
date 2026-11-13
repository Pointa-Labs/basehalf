/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What the cards of the canvas show while a note is made, renamed, or a card is
// selected, sampled every frame inside the window (note title, "From the card's
// first frame" and "Nothing shows the rename"; canvas card interaction
// continuity, "Selecting keeps the face"): a card that shows a hint, a loading
// face, or no line for a frame passes every check of the state at the end.

/** Starts reading, every frame, what each card shows and which lines are drawn. */
export async function watchCardFrames(page) {
	await page.evaluate(() => {
		// A watch that a failed step left running stops here.
		if (globalThis.__basehalfCardFrames) {
			globalThis.__basehalfCardFrames.stop = true;
		}
		const frames = [];
		const watch = { frames, stop: false };
		globalThis.__basehalfCardFrames = watch;
		const elements = new WeakMap();
		let ticks = 0;
		const tick = () => {
			const cards = Array.from(document.querySelectorAll('.basehalf-canvas-card[data-basehalf-card-path]')).map(card => {
				if (!elements.has(card)) {
					elements.set(card, elements.size + ticks * 1000 + Math.random());
				}
				const editor = card.querySelector('.basehalf-canvas-note-editor.ready');
				const preview = card.querySelector('.basehalf-canvas-card-preview');
				const document = card.querySelector('.basehalf-canvas-card-document');
				const box = card.getBoundingClientRect();
				return {
					path: card.getAttribute('data-basehalf-card-path'),
					element: elements.get(card),
					editor: !!editor,
					titleLine: !editor && !!card.querySelector('.bh-md-preview .basehalf-canvas-note-title-line'),
					hint: !editor && !!card.querySelector('.basehalf-canvas-note-empty'),
					loading: !!preview?.classList.contains('kind-loading'),
					cover: document instanceof HTMLElement ? document.dataset.cover ?? null : null,
					text: ((editor ?? preview)?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
					x: Math.round(box.x),
					y: Math.round(box.y)
				};
			});
			const lines = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path')).map(line => line.getAttribute('data-edge-id') ?? '');
			frames.push({ cards, lines });
			// At most about ten seconds of frames, so that a step that fails before its check leaves no loop behind.
			if (!watch.stop && ++ticks < 1200) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
}

/** Stops reading, and gives the frames read. */
export async function stopCardFrames(page) {
	return page.evaluate(() => {
		const watch = globalThis.__basehalfCardFrames;
		watch.stop = true;
		return watch.frames;
	});
}

/**
 * The frames, from the first in which one of `paths` has a card on, that do not
 * pass `check(card, frame)` for the card of the first of `paths` the frame
 * shows, or that show none of them.
 */
export function cardFramesFailing(frames, paths, check) {
	const first = frames.findIndex(frame => frame.cards.some(card => paths.includes(card.path)));
	if (first < 0) {
		return { shown: 0, wrong: [{ reason: 'never shown' }] };
	}
	const wrong = [];
	for (const frame of frames.slice(first)) {
		const card = paths.map(path => frame.cards.find(candidate => candidate.path === path)).find(candidate => candidate);
		if (!card || !check(card, frame)) {
			wrong.push({ card: card ?? null, lines: frame.lines });
		}
	}
	return { shown: frames.length - first, wrong };
}
