/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// How a Note goes from its card to its editor and back, and stays in place while the canvas zooms: frames sampled from the window.

import { root } from '../../context.mts';
import { zoomCanvas } from '../../lib/canvas.mts';

export async function startCanvasNoteEditTransitionProbe(note, tokens, expectedPreviewIdentity, direction = 'enter', exactParagraph) {
	await note.evaluate((card, { expectedTokens, expectedPreviewIdentity, direction, exactParagraph, timeout, frameLimit }) => {
		type ProbePhase = 'static' | 'mounting' | 'ready' | 'missing';
		type ProbeFrame = {
			phase: ProbePhase;
			[key: string]: any;
		};
		type TransitionProbe = {
			direction: 'enter' | 'exit';
			frames: ProbeFrame[];
			finished: Promise<void>;
			outcome?: 'ready' | 'static' | 'deadline' | 'frame-limit' | 'cancelled';
			cancel: () => void;
		};
		if (direction !== 'enter' && direction !== 'exit') {
			throw new Error('Canvas Note transition probe received an invalid direction');
		}
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		scope.__basehalfSmokeNoteEditTransition?.cancel();
		const markedStaticPreview = card.querySelector('[data-smoke-preview-identity="' + CSS.escape(expectedPreviewIdentity) + '"]');
		const retainedExitFallback = direction === 'exit' ? card.querySelector('.basehalf-canvas-note-editor-fallback') : null;
		if (direction === 'exit' && !(retainedExitFallback instanceof HTMLElement)) {
			throw new Error('Canvas Note exit transition could not find the retained editing fallback');
		}
		if (retainedExitFallback instanceof HTMLElement) {
			if (markedStaticPreview && markedStaticPreview !== retainedExitFallback) {
				throw new Error('Canvas Note exit transition marker is not on the retained editing fallback');
			}
			const retainedIdentity = retainedExitFallback.getAttribute('data-smoke-preview-identity');
			if (retainedIdentity && retainedIdentity !== expectedPreviewIdentity) {
				throw new Error('Canvas Note exit transition retained fallback has an unexpected marker identity');
			}
			retainedExitFallback.setAttribute('data-smoke-preview-identity', expectedPreviewIdentity);
		}
		const originalStaticPreview = retainedExitFallback ?? markedStaticPreview;
		if (!(originalStaticPreview instanceof HTMLElement)) {
			throw new Error('Canvas Note transition probe could not find its marked static preview or retained editing fallback');
		}

		let animationFrame = 0;
		let targetFrames = 0;
		let sawInitialPhase = false;
		let settled = false;
		let deadlineTimer = 0;
		let settleProbe: (() => void) | undefined;
		const frames: ProbeFrame[] = [];
		const finished = new Promise<void>(resolve => settleProbe = resolve);
		let probe: TransitionProbe;
		const settle = (outcome: NonNullable<TransitionProbe['outcome']>) => {
			if (settled) {
				return;
			}
			settled = true;
			probe.outcome = outcome;
			cancelAnimationFrame(animationFrame);
			clearTimeout(deadlineTimer);
			settleProbe?.();
		};
		const visibleIntersection = (bounds: DOMRect, bodyBounds: DOMRect) => {
			const left = Math.max(bounds.left, bodyBounds.left, 0);
			const top = Math.max(bounds.top, bodyBounds.top, 0);
			const right = Math.min(bounds.right, bodyBounds.right, window.innerWidth);
			const bottom = Math.min(bounds.bottom, bodyBounds.bottom, window.innerHeight);
			return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : undefined;
		};
		const ancestorsAreVisible = (element: Element) => {
			for (let current: Element | null = element; current; current = current.parentElement) {
				const style = getComputedStyle(current);
				if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) <= 0) {
					return false;
				}
				if (current === card) {
					break;
				}
			}
			return true;
		};
		const topmostPointBelongsTo = (element: HTMLElement, bounds: { left: number; top: number; right: number; bottom: number }) => {
			const points = [
				[(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2],
				[bounds.left + (bounds.right - bounds.left) / 3, bounds.top + (bounds.bottom - bounds.top) / 3],
				[bounds.right - (bounds.right - bounds.left) / 3, bounds.bottom - (bounds.bottom - bounds.top) / 3]
			];
			return points.some(([x, y]) => {
				const hit = document.elementFromPoint(x, y);
				return hit === element || (hit !== null && element.contains(hit));
			});
		};
		const isActuallyVisible = (element: Element | null, body: HTMLElement): element is HTMLElement => {
			if (!(element instanceof HTMLElement) || !card.contains(element) || element.getClientRects().length === 0 || !ancestorsAreVisible(element)) {
				return false;
			}
			const visibleBounds = visibleIntersection(element.getBoundingClientRect(), body.getBoundingClientRect());
			return visibleBounds !== undefined && topmostPointBelongsTo(element, visibleBounds);
		};
		const isActuallyVisibleRange = (range: Range, parent: HTMLElement, surface: HTMLElement, body: HTMLElement) => {
			if (!ancestorsAreVisible(parent)) {
				return false;
			}
			const bodyBounds = body.getBoundingClientRect();
			return Array.from(range.getClientRects()).some(bounds => {
				const visibleBounds = visibleIntersection(bounds, bodyBounds);
				if (!visibleBounds) {
					return false;
				}
				const hit = document.elementFromPoint(
					(visibleBounds.left + visibleBounds.right) / 2,
					(visibleBounds.top + visibleBounds.bottom) / 2
				);
				return hit !== null
					&& surface.contains(hit)
					&& (hit === parent || parent.contains(hit) || hit.contains(parent));
			});
		};
		const relativeRect = (bounds: DOMRect, bodyBounds: DOMRect) => ({
			x: bounds.left - bodyBounds.left,
			y: bounds.top - bodyBounds.top,
			width: bounds.width,
			height: bounds.height
		});
		const captureExactParagraph = (surface: HTMLElement, body: HTMLElement) => {
			if (!exactParagraph) {
				return undefined;
			}
			const stablePrefix = exactParagraph.slice(0, 24);
			const paragraph = Array.from(surface.querySelectorAll('p')).find(candidate => candidate.textContent?.includes(stablePrefix));
			if (!(paragraph instanceof HTMLElement)) {
				return { text: undefined, visibleText: undefined, starCount: undefined, fullyVisible: false, glyphs: [] };
			}
			const bodyBounds = body.getBoundingClientRect();
			const paragraphBounds = paragraph.getBoundingClientRect();
			const glyphs = [];
			const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const parent = node.parentElement;
				if (!(parent instanceof HTMLElement)) {
					continue;
				}
				let offset = 0;
				for (const character of node.textContent ?? '') {
					const nextOffset = offset + character.length;
					const range = document.createRange();
					range.setStart(node, offset);
					range.setEnd(node, nextOffset);
					offset = nextOffset;
					if (!isActuallyVisibleRange(range, parent, surface, body)) {
						continue;
					}
					const bounds = range.getBoundingClientRect();
					const style = getComputedStyle(parent);
					glyphs.push({
						character,
						...relativeRect(bounds, bodyBounds),
						fontFamily: style.fontFamily,
						fontSize: style.fontSize,
						fontWeight: style.fontWeight,
						fontStyle: style.fontStyle,
						lineHeight: style.lineHeight,
						textDecorationLine: style.textDecorationLine
					});
				}
			}
			const text = paragraph.textContent ?? '';
			return {
				text,
				visibleText: glyphs.map(glyph => glyph.character).join(''),
				starCount: Array.from(text).filter(character => character === '*').length,
				fullyVisible: paragraphBounds.top >= bodyBounds.top - 1
					&& paragraphBounds.bottom <= bodyBounds.bottom + 1,
				rect: relativeRect(paragraphBounds, bodyBounds),
				glyphs
			};
		};
		const sample = () => {
			const node = card.closest('.react-flow__node');
			const isVisible = (element: Element) => {
				const style = getComputedStyle(element);
				return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
			};
			// The resize targets of a Note stay while it is edited and paint
			// nothing but a corner's indicator under the pointer (canvas card
			// resize, "While a Note is edited").
			const chrome = {
				noteEditing: card.dataset.noteEditing === 'true',
				resizeTargets: node?.querySelectorAll('.basehalf-canvas-node-resizer-handle').length ?? 0,
				visibleResizeIndicators: Array.from(node?.querySelectorAll('.basehalf-canvas-node-resize-corner-indicator') ?? []).filter(isVisible).length,
				liveConnectionHandles: Array.from(node?.querySelectorAll('.basehalf-canvas-card-connect-handle') ?? []).filter(handle => isVisible(handle) && getComputedStyle(handle).pointerEvents !== 'none').length
			};
			const body = card.querySelector('.basehalf-canvas-card-body');
			if (!(body instanceof HTMLElement)) {
				frames.push({
					...chrome,
					phase: 'missing',
					devicePixelRatio: window.devicePixelRatio,
					originalPreviewIdentity: card.contains(originalStaticPreview) ? originalStaticPreview.getAttribute('data-smoke-preview-identity') ?? undefined : undefined,
					staticPreviewIsOriginal: false,
					fallbackIsOriginalPreview: false,
					tokens: expectedTokens.map(token => ({ token }))
				});
			} else {
				const readyHost = card.querySelector('.basehalf-canvas-note-editor.ready');
				const readySurface = readyHost?.querySelector('.basehalf-canvas-markdown-inline') ?? null;
				const fallback = card.querySelector('.basehalf-canvas-note-editor-fallback');
				const staticPreview = card.querySelector('.basehalf-canvas-card-preview .bh-md-preview:not(.basehalf-canvas-markdown-inline)');
				const staticPreviewIsOriginal = staticPreview === originalStaticPreview;
				const fallbackIsOriginalPreview = fallback === originalStaticPreview;
				let phase: ProbePhase = 'missing';
				let surface: HTMLElement | undefined;
				if (isActuallyVisible(readyHost, body) && isActuallyVisible(readySurface, body)) {
					phase = 'ready';
					surface = readySurface;
				} else if (fallbackIsOriginalPreview
					&& fallback.getAttribute('aria-hidden') !== 'true'
					&& !fallback.hasAttribute('inert')
					&& isActuallyVisible(fallback, body)) {
					phase = 'mounting';
					surface = fallback;
				} else if (staticPreviewIsOriginal
					&& !originalStaticPreview.classList.contains('basehalf-canvas-note-editor-fallback')
					&& originalStaticPreview.getAttribute('aria-hidden') !== 'true'
					&& !originalStaticPreview.hasAttribute('inert')
					&& isActuallyVisible(originalStaticPreview, body)) {
					phase = 'static';
					surface = originalStaticPreview;
				}

				const bodyBounds = body.getBoundingClientRect();
				const frame: ProbeFrame = {
					...chrome,
					phase,
					devicePixelRatio: window.devicePixelRatio,
					originalPreviewIdentity: card.contains(originalStaticPreview) ? originalStaticPreview.getAttribute('data-smoke-preview-identity') ?? undefined : undefined,
					staticPreviewIsOriginal,
					fallbackIdentity: fallback?.getAttribute('data-smoke-preview-identity') ?? undefined,
					fallbackIsOriginalPreview,
					body: surface ? {
						x: bodyBounds.left,
						y: bodyBounds.top,
						width: bodyBounds.width,
						height: bodyBounds.height
					} : undefined,
					surface: surface ? (() => {
						const bounds = surface.getBoundingClientRect();
						const style = getComputedStyle(surface);
						return {
							...relativeRect(bounds, bodyBounds),
							clientWidth: surface.clientWidth,
							offsetWidth: surface.offsetWidth,
							layoutGutter: surface.offsetWidth - surface.clientWidth,
							scrollTop: surface.scrollTop,
							scrollHeight: surface.scrollHeight,
							clientHeight: surface.clientHeight,
							overflowY: style.overflowY,
							scrollbarGutter: style.scrollbarGutter,
							paddingLeft: style.paddingLeft,
							paddingRight: style.paddingRight
						};
					})() : undefined,
					tokens: expectedTokens.map(token => ({ token }))
				};
				let textBlock: Element | undefined;
				if (surface) {
					frame.tokens = expectedTokens.map(token => {
						const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
						let node;
						while ((node = walker.nextNode())) {
							const offset = node.textContent?.indexOf(token) ?? -1;
							const parent = node.parentElement;
							if (offset < 0 || !(parent instanceof HTMLElement)) {
								continue;
							}
							const range = document.createRange();
							range.setStart(node, offset);
							range.setEnd(node, offset + token.length);
							if (!isActuallyVisibleRange(range, parent, surface, body)) {
								continue;
							}
							const bounds = range.getBoundingClientRect();
							const style = getComputedStyle(parent);
							textBlock ??= parent.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote') ?? parent;
							return {
								token,
								...relativeRect(bounds, bodyBounds),
								font: {
									family: style.fontFamily,
									size: style.fontSize,
									lineHeight: style.lineHeight,
									weight: style.fontWeight,
									style: style.fontStyle,
									letterSpacing: style.letterSpacing,
									wordSpacing: style.wordSpacing
								}
							};
						}
						return { token };
					});
				}
				if (textBlock) {
					frame.textBlock = relativeRect(textBlock.getBoundingClientRect(), bodyBounds);
				}
				const alreadyCapturedPhase = frames.some(candidate => candidate.phase === phase && candidate.exactParagraph);
				if (surface && (phase === 'static' || phase === 'ready') && !alreadyCapturedPhase) {
					frame.exactParagraph = captureExactParagraph(surface, body);
				}
				frames.push(frame);
			}

			const phase = frames.at(-1)?.phase;
			const initialPhase: ProbePhase = direction === 'enter' ? 'static' : 'ready';
			const targetPhase: ProbePhase = direction === 'enter' ? 'ready' : 'static';
			sawInitialPhase ||= phase === initialPhase;
			targetFrames = sawInitialPhase && phase === targetPhase ? targetFrames + 1 : 0;
			if (targetFrames >= 4) {
				settle(targetPhase);
				return;
			}
			if (frames.length >= frameLimit) {
				settle('frame-limit');
				return;
			}
			animationFrame = requestAnimationFrame(sample);
		};
		probe = { direction, frames, finished, cancel: () => settle('cancelled') };
		scope.__basehalfSmokeNoteEditTransition = probe;
		deadlineTimer = window.setTimeout(() => settle('deadline'), timeout);
		sample();
	}, { expectedTokens: tokens, expectedPreviewIdentity, direction, exactParagraph, timeout: 5_000, frameLimit: 600 });
}

export async function finishCanvasNoteEditTransitionProbe(page) {
	return page.evaluate(async () => {
		type TransitionProbe = {
			direction: 'enter' | 'exit';
			frames: Array<Record<string, any>>;
			finished: Promise<void>;
			outcome?: 'ready' | 'static' | 'deadline' | 'frame-limit' | 'cancelled';
			cancel: () => void;
		};
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		const probe = scope.__basehalfSmokeNoteEditTransition;
		if (!probe) {
			throw new Error('Canvas Note transition probe was not installed');
		}
		try {
			await probe.finished;
			return { direction: probe.direction, frames: probe.frames, outcome: probe.outcome };
		} finally {
			probe.cancel();
			if (scope.__basehalfSmokeNoteEditTransition === probe) {
				delete scope.__basehalfSmokeNoteEditTransition;
			}
		}
	});
}

export async function cancelCanvasNoteEditTransitionProbe(page) {
	await page.evaluate(() => {
		type TransitionProbe = { cancel: () => void };
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		const probe = scope.__basehalfSmokeNoteEditTransition;
		try {
			probe?.cancel();
		} finally {
			if (scope.__basehalfSmokeNoteEditTransition === probe) {
				delete scope.__basehalfSmokeNoteEditTransition;
			}
		}
	});
}

function assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, direction) {
	const { frames, outcome } = result;
	const initialPhase = direction === 'enter' ? 'static' : 'ready';
	const targetPhase = direction === 'enter' ? 'ready' : 'static';
	if (result.direction !== direction || outcome !== targetPhase) {
		throw new Error('Canvas Note ' + direction + ' transition probe did not settle on ' + targetPhase + ': ' + JSON.stringify({
			direction: result.direction,
			outcome,
			phases: frames.map(frame => frame.phase)
		}));
	}
	const baseline = frames[0];
	if (!baseline || baseline.phase !== initialPhase || !baseline.body || !baseline.surface || !baseline.textBlock) {
		throw new Error('Canvas Note ' + direction + ' transition did not start from a measurable ' + initialPhase + ' frame: ' + JSON.stringify(baseline));
	}
	if (frames.length < 5 || frames.slice(-4).some(frame => frame.phase !== targetPhase)) {
		throw new Error('Canvas Note ' + direction + ' transition did not finish with four consecutive ' + targetPhase + ' frames: ' + JSON.stringify(frames.map(frame => frame.phase)));
	}

	const baselineTokens = new Map(baseline.tokens.map(metric => [metric.token, metric]));
	const numericFields = ['x', 'y', 'width', 'height'];
	const phaseOrder = direction === 'enter'
		? new Map([['static', 0], ['mounting', 1], ['ready', 2]])
		: new Map([['ready', 0], ['static', 1]]);
	const violations = [];
	let highestPhase = -1;
	for (const [frameIndex, frame] of frames.entries()) {
		const order = phaseOrder.get(frame.phase);
		if (order === undefined) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'no genuinely visible Note surface' });
		} else if (order < highestPhase) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'visible surface regressed after advancing', highestPhase });
		} else {
			highestPhase = order;
		}
		if (frame.noteEditing && (frame.visibleResizeIndicators !== 0 || frame.liveConnectionHandles !== 0)) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'structural card chrome remained visible after Note editing began',
				visibleResizeIndicators: frame.visibleResizeIndicators,
				liveConnectionHandles: frame.liveConnectionHandles
			});
		}
		const previous = frames[frameIndex - 1];
		if (frame.noteEditing && previous && frame.resizeTargets !== previous.resizeTargets) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'the resize targets changed when or while the Note was edited',
				resizeTargets: frame.resizeTargets,
				previousResizeTargets: previous.resizeTargets
			});
		}
		if (frame.originalPreviewIdentity !== expectedPreviewIdentity || !frame.staticPreviewIsOriginal) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'original static preview identity changed',
				expected: expectedPreviewIdentity,
				actual: frame.originalPreviewIdentity,
				staticPreviewIsOriginal: frame.staticPreviewIsOriginal
			});
		}
		if ((frame.phase === 'mounting' || frame.phase === 'ready')
			&& (frame.fallbackIdentity !== expectedPreviewIdentity || !frame.fallbackIsOriginalPreview)) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'editor fallback did not reuse the original static preview',
				expected: expectedPreviewIdentity,
				actual: frame.fallbackIdentity,
				fallbackIsOriginalPreview: frame.fallbackIsOriginalPreview
			});
		}
		if (!frame.body || !frame.textBlock) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'missing visible content geometry' });
			continue;
		}
		if (!frame.surface || Math.abs(frame.surface.scrollTop - baseline.surface.scrollTop) > 1) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'visible surface scroll position changed',
				expected: baseline.surface.scrollTop,
				actual: frame.surface?.scrollTop
			});
		}
		const pixelRatio = Math.max(baseline.devicePixelRatio, frame.devicePixelRatio);
		for (const [area, actual, expected] of [['body', frame.body, baseline.body], ['textBlock', frame.textBlock, baseline.textBlock]]) {
			for (const field of numericFields) {
				const physicalDelta = Math.abs(actual[field] - expected[field]) * pixelRatio;
				if (physicalDelta > 1) {
					violations.push({ frameIndex, phase: frame.phase, area, field, physicalDelta, expected: expected[field], actual: actual[field] });
				}
			}
		}
		for (const token of tokens) {
			const expected = baselineTokens.get(token);
			const actual = frame.tokens.find(metric => metric.token === token);
			if (!expected?.font || !actual?.font) {
				violations.push({ frameIndex, phase: frame.phase, token, issue: 'missing visible token or font metrics' });
				continue;
			}
			for (const field of numericFields) {
				const physicalDelta = Math.abs(Number(actual[field]) - Number(expected[field])) * pixelRatio;
				if (!Number.isFinite(physicalDelta) || physicalDelta > 1) {
					violations.push({ frameIndex, phase: frame.phase, token, field, physicalDelta, expected: expected[field], actual: actual[field] });
				}
			}
			if (JSON.stringify(actual.font) !== JSON.stringify(expected.font)) {
				violations.push({ frameIndex, phase: frame.phase, token, issue: 'font changed', expected: expected.font, actual: actual.font });
			}
		}
	}
	if (violations.length > 0) {
		const phases = frames.map(frame => frame.phase).filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
		throw new Error('Canvas Note ' + direction + ' transition exposed a visible geometry or font jump: ' + JSON.stringify({
			frameCount: frames.length,
			phases,
			surfaces: frames.map(frame => ({ phase: frame.phase, surface: frame.surface })),
			violationCount: violations.length,
			violations: violations.slice(0, 12)
		}));
	}
}

export function assertCanvasNoteEditTransitionFrames(result, tokens, expectedPreviewIdentity) {
	assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, 'enter');
}

export function assertCanvasMalformedParagraphTransition(result, exactParagraph) {
	const baselineFrame = result.frames.find(frame => frame.phase === 'static' && frame.exactParagraph);
	const firstReadyFrame = result.frames.find(frame => frame.phase === 'ready' && frame.exactParagraph);
	const baseline = baselineFrame?.exactParagraph;
	const firstReady = firstReadyFrame?.exactParagraph;
	if (!baseline || !firstReady
		|| !baseline.fullyVisible
		|| !firstReady.fullyVisible
		|| baseline.text !== exactParagraph
		|| firstReady.text !== exactParagraph
		|| baseline.visibleText !== exactParagraph
		|| firstReady.visibleText !== exactParagraph
		|| baseline.starCount !== 2
		|| firstReady.starCount !== 2) {
		throw new Error(`Canvas Note malformed emphasis changed between its static and first live frame: ${JSON.stringify({ baseline, firstReady })}`);
	}
	if (baseline.glyphs.length !== firstReady.glyphs.length) {
		throw new Error(`Canvas Note malformed emphasis changed its visible glyph count: ${JSON.stringify({ baseline: baseline.glyphs.length, firstReady: firstReady.glyphs.length })}`);
	}
	const pixelRatio = Math.max(baselineFrame.devicePixelRatio, firstReadyFrame.devicePixelRatio);
	const numericFields = ['x', 'y', 'width', 'height'];
	const mismatches = [];
	for (const field of numericFields) {
		const physicalDelta = Math.abs(baseline.rect[field] - firstReady.rect[field]) * pixelRatio;
		if (physicalDelta > 1) {
			mismatches.push({ area: 'paragraph', field, physicalDelta, baseline: baseline.rect[field], firstReady: firstReady.rect[field] });
		}
	}
	for (let index = 0; index < baseline.glyphs.length; index++) {
		const expected = baseline.glyphs[index];
		const actual = firstReady.glyphs[index];
		if (expected.character !== actual.character
			|| expected.fontFamily !== actual.fontFamily
			|| expected.fontSize !== actual.fontSize
			|| expected.fontWeight !== actual.fontWeight
			|| expected.fontStyle !== actual.fontStyle
			|| expected.lineHeight !== actual.lineHeight
			|| expected.textDecorationLine !== actual.textDecorationLine) {
			mismatches.push({ area: 'glyph-style', index, expected, actual });
			continue;
		}
		for (const field of numericFields) {
			const physicalDelta = Math.abs(expected[field] - actual[field]) * pixelRatio;
			if (physicalDelta > 1) {
				mismatches.push({ area: 'glyph-geometry', index, character: expected.character, field, physicalDelta, baseline: expected[field], firstReady: actual[field] });
			}
		}
	}
	if (mismatches.length > 0) {
		throw new Error(`Canvas Note malformed emphasis changed visible geometry on its first live frame: ${JSON.stringify({ mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 12) })}`);
	}
}

export async function startCanvasNoteExitTransitionProbe(note, tokens, expectedPreviewIdentity) {
	await startCanvasNoteEditTransitionProbe(note, tokens, expectedPreviewIdentity, 'exit');
}

export async function finishCanvasNoteExitTransitionProbe(page) {
	return finishCanvasNoteEditTransitionProbe(page);
}

export async function cancelCanvasNoteExitTransitionProbe(page) {
	await cancelCanvasNoteEditTransitionProbe(page);
}

export function assertCanvasNoteExitTransitionFrames(result, tokens, expectedPreviewIdentity) {
	assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, 'exit');
}

async function installCanvasNoteZoomProbe(surface, mode) {
	return surface.evaluate((root, expectedMode) => {
		type ZoomProbe = {
			root: HTMLElement;
			card: HTMLElement;
			editable?: HTMLElement;
			mutationCount: number;
			scrollEvents: number;
			observer: MutationObserver;
			dispose: () => void;
		};
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		scope.__basehalfSmokeNoteZoomProbe?.dispose();
		const card = root.closest('.basehalf-canvas-card');
		const editable = expectedMode === 'active' ? root.querySelector(':scope > .ProseMirror') : undefined;
		if (!(root instanceof HTMLElement)
			|| !(card instanceof HTMLElement)
			|| (expectedMode === 'active' && !(editable instanceof HTMLElement))) {
			throw new Error(`Could not install the ${expectedMode} Canvas Note zoom probe`);
		}
		const identity = `zoom-${expectedMode}-${Date.now()}-${Math.random()}`;
		const cardIdentity = `${identity}-card`;
		const editableIdentity = `${identity}-editable`;
		root.setAttribute('data-smoke-zoom-surface-identity', identity);
		card.setAttribute('data-smoke-zoom-card-identity', cardIdentity);
		editable?.setAttribute('data-smoke-zoom-editable-identity', editableIdentity);
		const probe: ZoomProbe = {
			root,
			card,
			editable: editable instanceof HTMLElement ? editable : undefined,
			mutationCount: 0,
			scrollEvents: 0,
			observer: undefined!,
			dispose: () => undefined
		};
		const observer = new MutationObserver(records => probe.mutationCount += records.length);
		const onScroll = () => probe.scrollEvents++;
		observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
		root.addEventListener('scroll', onScroll, { passive: true });
		probe.observer = observer;
		probe.dispose = () => {
			probe.mutationCount += observer.takeRecords().length;
			observer.disconnect();
			root.removeEventListener('scroll', onScroll);
			if (root.getAttribute('data-smoke-zoom-surface-identity') === identity) {
				root.removeAttribute('data-smoke-zoom-surface-identity');
			}
			if (card.getAttribute('data-smoke-zoom-card-identity') === cardIdentity) {
				card.removeAttribute('data-smoke-zoom-card-identity');
			}
			if (editable?.getAttribute('data-smoke-zoom-editable-identity') === editableIdentity) {
				editable.removeAttribute('data-smoke-zoom-editable-identity');
			}
		};
		scope.__basehalfSmokeNoteZoomProbe = probe;
		return { identity, cardIdentity, editableIdentity: probe.editable ? editableIdentity : undefined };
	}, mode);
}

async function captureCanvasNoteZoomState(page, mode, tokens, identities) {
	return page.evaluate(({ expectedMode, expectedTokens, identities }) => {
		type ZoomProbe = { root: HTMLElement; card: HTMLElement; editable?: HTMLElement };
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		const probe = scope.__basehalfSmokeNoteZoomProbe;
		if (!probe || !probe.card.contains(probe.root)) {
			throw new Error('Canvas Note zoom probe lost its original surface');
		}
		const surface = probe.root;
		const card = probe.card;
		const editable = probe.editable;
		const body = card.querySelector('.basehalf-canvas-card-body');
		const workbench = card.closest('.basehalf-canvas-workbench');
		if (!(body instanceof HTMLElement) || !(workbench instanceof HTMLElement)) {
			throw new Error('Canvas Note zoom probe lost its card body or workbench');
		}
		const cardBounds = card.getBoundingClientRect();
		const bodyBounds = body.getBoundingClientRect();
		const surfaceBounds = surface.getBoundingClientRect();
		const scale = card.offsetWidth > 0 ? cardBounds.width / card.offsetWidth : Number.NaN;
		const logicalRect = (bounds: DOMRect) => ({
			x: (bounds.left - bodyBounds.left) / scale,
			y: (bounds.top - bodyBounds.top) / scale,
			width: bounds.width / scale,
			height: bounds.height / scale
		});
		const tokens = expectedTokens.map(token => {
			const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + token.length);
				return { token, ...logicalRect(range.getBoundingClientRect()) };
			}
			return { token };
		});
		const selection = document.getSelection();
		const selectionInside = editable instanceof HTMLElement
			&& selection?.anchorNode !== null
			&& selection?.focusNode !== null
			&& editable.contains(selection.anchorNode)
			&& editable.contains(selection.focusNode);
		const documentOffset = (node: Node, offset: number) => {
			const range = document.createRange();
			range.selectNodeContents(editable!);
			range.setEnd(node, offset);
			return range.toString().length;
		};
		const unitFor = (node: Node | null) => {
			const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
			return element?.closest('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
		};
		let caret;
		if (selectionInside && selection?.isCollapsed && selection.anchorNode?.nodeType === Node.TEXT_NODE && selection.anchorOffset > 0) {
			const range = document.createRange();
			range.setStart(selection.anchorNode, selection.anchorOffset - 1);
			range.setEnd(selection.anchorNode, selection.anchorOffset);
			caret = logicalRect(range.getBoundingClientRect());
		}
		const surfaceStyle = getComputedStyle(surface);
		const scrollbarStyle = getComputedStyle(surface, '::-webkit-scrollbar');
		return {
			mode: expectedMode,
			zoom: Number(workbench.dataset.zoom),
			scale,
			devicePixelRatio: window.devicePixelRatio,
			cardIdentity: card.getAttribute('data-smoke-zoom-card-identity'),
			surfaceIdentity: surface.getAttribute('data-smoke-zoom-surface-identity'),
			editableIdentity: editable?.getAttribute('data-smoke-zoom-editable-identity'),
			identities,
			previewLevel: card.dataset.previewLevel,
			noteEditing: card.dataset.noteEditing,
			hostCount: card.querySelectorAll('[data-testid^="canvas-note-editor-"]').length,
			body: { width: bodyBounds.width / scale, height: bodyBounds.height / scale },
			surface: {
				...logicalRect(surfaceBounds),
				clientWidth: surface.clientWidth,
				clientHeight: surface.clientHeight,
				scrollWidth: surface.scrollWidth,
				scrollHeight: surface.scrollHeight,
				scrollLeft: surface.scrollLeft,
				scrollTop: surface.scrollTop,
				webkitScrollbarWidth: scrollbarStyle.width,
				overflowY: surfaceStyle.overflowY,
				paddingLeft: surfaceStyle.paddingLeft,
				paddingRight: surfaceStyle.paddingRight
			},
			text: surface.textContent ?? '',
			html: surface.innerHTML,
			tokens,
			focused: editable instanceof HTMLElement
				? document.activeElement === editable || editable.contains(document.activeElement)
				: document.activeElement === surface || surface.contains(document.activeElement),
			selectionInside: selectionInside === true,
			selection: selectionInside && selection ? {
				collapsed: selection.isCollapsed,
				anchor: documentOffset(selection.anchorNode!, selection.anchorOffset),
				head: documentOffset(selection.focusNode!, selection.focusOffset),
				anchorUnit: unitFor(selection.anchorNode),
				headUnit: unitFor(selection.focusNode)
			} : undefined,
			caret
		};
	}, { expectedMode: mode, expectedTokens: tokens, identities });
}

async function finishCanvasNoteZoomProbe(page) {
	return page.evaluate(() => {
		type ZoomProbe = { mutationCount: number; scrollEvents: number; observer: MutationObserver; dispose: () => void };
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		const probe = scope.__basehalfSmokeNoteZoomProbe;
		if (!probe) {
			throw new Error('Canvas Note zoom probe was not installed');
		}
		probe.mutationCount += probe.observer.takeRecords().length;
		const result = { mutationCount: probe.mutationCount, scrollEvents: probe.scrollEvents };
		probe.dispose();
		if (scope.__basehalfSmokeNoteZoomProbe === probe) {
			delete scope.__basehalfSmokeNoteZoomProbe;
		}
		return result;
	});
}

async function waitForCanvasNoteZoom(page, target) {
	await page.waitForFunction(expected => {
		const workbench = document.querySelector('.basehalf-canvas-workbench');
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		if (!(workbench instanceof HTMLElement) || !(card instanceof HTMLElement) || card.offsetWidth <= 0) {
			return false;
		}
		const renderedScale = card.getBoundingClientRect().width / card.offsetWidth;
		return Math.abs(Number(workbench.dataset.zoom) - expected) <= 0.001
			&& Math.abs(renderedScale - expected) <= 0.005;
	}, target, { timeout: 10_000 });
}

function assertCanvasNoteZoomStates(states, mode, identities) {
	const expectedZooms = [1, 0.7, 0.2, 1];
	if (states.length !== expectedZooms.length) {
		throw new Error(`Canvas Note ${mode} zoom probe returned an unexpected state count: ${states.length}`);
	}
	const baseline = states[0];
	const exactSurfaceFields = ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'];
	const approximateSurfaceFields = ['x', 'y', 'width', 'height', 'scrollLeft', 'scrollTop'];
	const exactSurfaceStyles = ['webkitScrollbarWidth', 'overflowY', 'paddingLeft', 'paddingRight'];
	const logicalRectFields = ['x', 'y', 'width', 'height'];
	const violations = [];
	for (let index = 0; index < states.length; index++) {
		const state = states[index];
		const expectedZoom = expectedZooms[index];
		if (Math.abs(state.zoom - expectedZoom) > 0.001 || Math.abs(state.scale - expectedZoom) > 0.005) {
			violations.push({ index, issue: 'zoom transform did not settle', expectedZoom, zoom: state.zoom, scale: state.scale });
		}
		if (state.cardIdentity !== identities.cardIdentity
			|| state.surfaceIdentity !== identities.identity
			|| state.editableIdentity !== identities.editableIdentity) {
			violations.push({ index, issue: 'zoom replaced a retained DOM owner', state, identities });
		}
		if (state.previewLevel !== 'preview'
			|| (mode === 'active' && (state.noteEditing !== 'true' || state.hostCount !== 1))
			|| (mode === 'resting' && (state.noteEditing !== undefined || state.hostCount !== 0))) {
			violations.push({ index, issue: 'zoom changed the Note projection state', previewLevel: state.previewLevel, noteEditing: state.noteEditing, hostCount: state.hostCount });
		}
		if (state.text !== baseline.text || state.html !== baseline.html) {
			violations.push({ index, issue: 'zoom mutated Note text or HTML', textMatches: state.text === baseline.text, htmlMatches: state.html === baseline.html });
		}
		for (const field of exactSurfaceFields) {
			if (state.surface[field] !== baseline.surface[field]) {
				violations.push({ index, area: 'surface', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		for (const field of approximateSurfaceFields) {
			if (Math.abs(state.surface[field] - baseline.surface[field]) > 1) {
				violations.push({ index, area: 'surface', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		for (const field of exactSurfaceStyles) {
			if (state.surface[field] !== baseline.surface[field]) {
				violations.push({ index, area: 'surface-style', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		const logicalScrollbarWidth = Number.parseFloat(state.surface.webkitScrollbarWidth);
		if ((mode === 'active' && (state.surface.overflowY !== 'scroll'
			|| !Number.isFinite(logicalScrollbarWidth)
			|| logicalScrollbarWidth < 8
			|| logicalScrollbarWidth > 12))
			|| (mode === 'resting' && state.surface.overflowY !== 'hidden')) {
			violations.push({ index, issue: 'zoom changed the fixed logical scroll contract', surface: state.surface });
		}
		for (const field of ['width', 'height']) {
			if (Math.abs(state.body[field] - baseline.body[field]) * state.scale * state.devicePixelRatio > 1) {
				violations.push({ index, area: 'body', field, expected: baseline.body[field], actual: state.body[field] });
			}
		}
		for (const expectedToken of baseline.tokens) {
			const actualToken = state.tokens.find(token => token.token === expectedToken.token);
			if (!actualToken || logicalRectFields.some(field => !Number.isFinite(actualToken[field]))) {
				violations.push({ index, token: expectedToken.token, issue: 'zoom lost a logical token range' });
				continue;
			}
			for (const field of logicalRectFields) {
				const physicalDelta = Math.abs(actualToken[field] - expectedToken[field]) * state.scale * state.devicePixelRatio;
				if (physicalDelta > 1) {
					violations.push({ index, token: expectedToken.token, field, physicalDelta, expected: expectedToken[field], actual: actualToken[field] });
				}
			}
		}
		if (mode === 'active') {
			if (!state.focused || !state.selectionInside || !state.selection?.collapsed
				|| JSON.stringify(state.selection) !== JSON.stringify(baseline.selection)) {
				violations.push({ index, issue: 'zoom moved the active caret or focus', expected: baseline.selection, actual: state.selection, focused: state.focused, selectionInside: state.selectionInside });
			}
			if (!baseline.caret || !state.caret) {
				violations.push({ index, issue: 'zoom lost the caret geometry', expected: baseline.caret, actual: state.caret });
			} else {
				for (const field of logicalRectFields) {
					const physicalDelta = Math.abs(state.caret[field] - baseline.caret[field]) * state.scale * state.devicePixelRatio;
					if (physicalDelta > 1) {
						violations.push({ index, area: 'caret', field, physicalDelta, expected: baseline.caret[field], actual: state.caret[field] });
					}
				}
			}
		} else if (state.focused || state.selectionInside) {
			violations.push({ index, issue: 'resting zoom created an editing focus or selection', focused: state.focused, selectionInside: state.selectionInside });
		}
	}
	if (violations.length > 0) {
		throw new Error(`Canvas Note ${mode} zoom changed fixed logical layout or editor state: ${JSON.stringify({ violationCount: violations.length, violations: violations.slice(0, 16), states })}`);
	}
}

export async function assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, surface, mode, tokens) {
	// Exercise the menu command without transferring DOM focus to its trigger or
	// dialog. Pointer ownership is covered by the controls tests; this probe
	// isolates the invariant that zoom itself cannot reflow or mutate a Note.
	await zoomCanvas(page, 'reset', { preserveFocus: true });
	await waitForCanvasNoteZoom(page, 1);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const identities = await installCanvasNoteZoomProbe(surface, mode);
	const states = [];
	let sequenceError;
	let cleanupError;
	let probeResult;
	try {
		states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
		for (const target of [0.7, 0.2]) {
			while (Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom')) > target + 0.001) {
				const current = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
				const next = Math.max(target, Math.round((current - 0.1) * 10) / 10);
				if (!await zoomCanvas(page, 'out', { preserveFocus: true })) {
					throw new Error(`Canvas zoom reached its minimum before ${target}`);
				}
				await waitForCanvasNoteZoom(page, next);
			}
			states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
		}
		await zoomCanvas(page, 'reset', { preserveFocus: true });
		await waitForCanvasNoteZoom(page, 1);
		states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
	} catch (error) {
		sequenceError = error;
	} finally {
		try {
			if (Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom')) !== 1) {
				await zoomCanvas(page, 'reset', { preserveFocus: true });
				await waitForCanvasNoteZoom(page, 1).catch(() => undefined);
			}
		} catch (error) {
			cleanupError = error;
		}
		try {
			probeResult = await finishCanvasNoteZoomProbe(page);
		} catch (error) {
			cleanupError ??= error;
		}
	}
	if (sequenceError) {
		throw sequenceError;
	}
	if (cleanupError) {
		throw cleanupError;
	}
	assertCanvasNoteZoomStates(states, mode, identities);
	if (probeResult.mutationCount !== 0 || probeResult.scrollEvents !== 0) {
		throw new Error(`Canvas Note ${mode} zoom caused internal DOM or scroll mutation: ${JSON.stringify(probeResult)}`);
	}
}
