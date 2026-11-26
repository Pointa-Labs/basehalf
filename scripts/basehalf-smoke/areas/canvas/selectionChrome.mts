/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// How the controls beside a selection show, hide, and move.

// Lets the window draw `count` frames; the adjacent chrome checks below sample after it.
async function waitForVideoChromeFrames(page, count = 2) {
	await page.evaluate(frames => new Promise<void>(resolve => {
		let remaining = frames;
		const next = () => {
			remaining--;
			if (remaining <= 0) {
				resolve();
				return;
			}
			requestAnimationFrame(next);
		};
		requestAnimationFrame(next);
	}), count);
}

export async function waitForAdjacentChromeAnimations(page, minimumSurfaceCount = 1) {
	await page.waitForFunction(minimumCount => {
		const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-adjacent-chrome'))
			.filter(surface => surface instanceof HTMLElement);
		return surfaces.length >= minimumCount
			&& surfaces.every(surface => surface.getAnimations().every(animation => animation.playState === 'finished'));
	}, minimumSurfaceCount, { timeout: 3_000 });
}

export function assertAdjacentChromeSurfaceState(surface, expectedState, context) {
	if (!surface) {
		throw new Error(`Adjacent chrome surface disappeared ${context}`);
	}
	const suppressed = expectedState === 'suppressed';
	const screenTranslateY = surface.translateY * surface.zoom;
	const directionalTravelIsWrong = suppressed && (
		(surface.placement === 'above' && screenTranslateY <= 0)
		|| (surface.placement === 'below' && screenTranslateY >= 0)
		|| Math.abs(Math.abs(screenTranslateY) - 6) > 0.75
	);
	if (surface.state !== expectedState
		|| surface.visible === suppressed
		|| Math.abs(surface.opacity - 1) > 0.001
		|| surface.visibility !== (suppressed ? 'hidden' : 'visible')
		|| surface.scale !== 'none'
		|| (surface.placement !== 'above' && surface.placement !== 'below')
		|| directionalTravelIsWrong
		|| (!suppressed && Math.abs(screenTranslateY) > 0.25)
		|| (suppressed ? surface.pointerEvents !== 'none' : surface.pointerEvents === 'none')
		|| (suppressed ? surface.ariaHidden !== 'true' : surface.ariaHidden === 'true')
		|| surface.inert !== suppressed
		|| Math.abs(surface.translateTransitionMs - 88) > 1
		|| surface.visibilityTransitionMs !== 0
		|| Math.abs(surface.visibilityTransitionDelayMs - (suppressed ? 88 : 0)) > 1
		|| surface.opacityTransitionMs !== 0) {
		throw new Error(`Adjacent chrome did not become ${expectedState} ${context}: ${JSON.stringify(surface)}`);
	}
}

export async function captureAdjacentChromeSurface(locator) {
	return locator.evaluate(element => {
		if (!(element instanceof HTMLElement)) {
			throw new Error('Adjacent chrome is not an HTMLElement');
		}
		const style = getComputedStyle(element);
		const parseTimes = value => value.split(',').map(part => {
			const token = part.trim();
			return token.endsWith('ms')
				? Number.parseFloat(token)
				: token.endsWith('s') ? Number.parseFloat(token) * 1_000 : 0;
		});
		const properties = style.transitionProperty.split(',').map(property => property.trim());
		const durations = parseTimes(style.transitionDuration);
		const delays = parseTimes(style.transitionDelay);
		const timingFor = property => {
			const index = properties.findIndex(candidate => candidate === property || candidate === 'all');
			return index < 0 ? { duration: 0, delay: 0 } : {
				duration: durations[index % durations.length] ?? 0,
				delay: delays[index % delays.length] ?? 0
			};
		};
		const translateNumbers = style.translate === 'none'
			? []
			: style.translate.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
		const translateTiming = timingFor('translate');
		const visibilityTiming = timingFor('visibility');
		const opacityTiming = timingFor('opacity');
		return {
			state: element.dataset.chromeState,
			placement: element.dataset.placement,
			ariaHidden: element.getAttribute('aria-hidden'),
			inert: element.inert,
			opacity: Number.parseFloat(style.opacity || '1'),
			visibility: style.visibility,
			pointerEvents: style.pointerEvents,
			translate: style.translate,
			translateY: translateNumbers.length >= 2 ? translateNumbers[1] : 0,
			scale: style.scale,
			zoom: Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1,
			travel: Number.parseFloat(style.getPropertyValue('--basehalf-adjacent-chrome-travel')) || 0,
			transitionProperty: style.transitionProperty,
			transitionDelay: style.transitionDelay,
			maxTransitionMs: Math.max(0, ...parseTimes(style.transitionDuration)),
			maxAnimationMs: Math.max(0, ...parseTimes(style.animationDuration)),
			translateTransitionMs: translateTiming.duration,
			visibilityTransitionMs: visibilityTiming.duration,
			visibilityTransitionDelayMs: visibilityTiming.delay,
			opacityTransitionMs: opacityTiming.duration,
			animationName: style.animationName,
			visible: style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& element.getClientRects().length > 0,
			identity: element.dataset.smokeAdjacentChromeIdentity,
			reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationCount: element.getAnimations().length
		};
	});
}

export async function assertAdjacentChromeMotionContract(page, locator, context) {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await waitForVideoChromeFrames(page);
	const regular = await captureAdjacentChromeSurface(locator);
	if (regular.reducedMotion
		|| regular.animationName !== 'basehalf-canvas-adjacent-chrome-emerge'
		|| Math.abs(regular.maxAnimationMs - 140) > 1
		|| Math.abs(regular.translateTransitionMs - 88) > 1
		|| regular.visibilityTransitionMs !== 0
		|| regular.visibilityTransitionDelayMs !== 0
		|| regular.opacityTransitionMs !== 0
		|| Math.abs(regular.opacity - 1) > 0.001
		|| regular.visibility !== 'visible'
		|| regular.scale !== 'none'
		|| Math.abs(regular.translateY * regular.zoom) > 0.25) {
		throw new Error(`Adjacent chrome has no restrained enter/exit motion ${context}: ${JSON.stringify(regular)}`);
	}
	try {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await waitForVideoChromeFrames(page);
		const reduced = await captureAdjacentChromeSurface(locator);
		if (!reduced.reducedMotion
			|| reduced.maxTransitionMs !== 0
			|| reduced.maxAnimationMs !== 0
			|| reduced.animationCount !== 0
			|| reduced.opacityTransitionMs !== 0
			|| Math.abs(reduced.opacity - 1) > 0.001
			|| reduced.visibility !== 'visible'
			|| reduced.scale !== 'none'
			|| Math.abs(reduced.translateY * reduced.zoom) > 0.25) {
			throw new Error(`Adjacent chrome ignored reduced motion ${context}: ${JSON.stringify(reduced)}`);
		}

		const originalState = await locator.evaluate(element => {
			if (!(element instanceof HTMLElement)) {
				throw new Error('Adjacent chrome is not an HTMLElement');
			}
			const state = {
				chromeState: element.dataset.chromeState,
				ariaHidden: element.getAttribute('aria-hidden'),
				inert: element.inert
			};
			element.dataset.chromeState = 'suppressed';
			element.setAttribute('aria-hidden', 'true');
			element.inert = true;
			return state;
		});
		try {
			await waitForVideoChromeFrames(page);
			const reducedSuppressed = await captureAdjacentChromeSurface(locator);
			if (!reducedSuppressed.reducedMotion
				|| reducedSuppressed.maxTransitionMs !== 0
				|| reducedSuppressed.maxAnimationMs !== 0
				|| reducedSuppressed.animationCount !== 0
				|| reducedSuppressed.opacityTransitionMs !== 0
				|| Math.abs(reducedSuppressed.opacity - 1) > 0.001
				|| reducedSuppressed.visibility !== 'hidden'
				|| reducedSuppressed.pointerEvents !== 'none'
				|| reducedSuppressed.ariaHidden !== 'true'
				|| !reducedSuppressed.inert
				|| reducedSuppressed.scale !== 'none'
				|| Math.abs(reducedSuppressed.translateY * reducedSuppressed.zoom) > 0.25) {
				throw new Error(`Suppressed adjacent chrome ignored reduced motion ${context}: ${JSON.stringify(reducedSuppressed)}`);
			}
		} finally {
			await locator.evaluate((element, state) => {
				if (!(element instanceof HTMLElement)) {
					return;
				}
				if (state.chromeState === undefined) {
					delete element.dataset.chromeState;
				} else {
					element.dataset.chromeState = state.chromeState;
				}
				if (state.ariaHidden === null) {
					element.removeAttribute('aria-hidden');
				} else {
					element.setAttribute('aria-hidden', state.ariaHidden);
				}
				element.inert = state.inert;
			}, originalState);
			await waitForVideoChromeFrames(page);
		}
	} finally {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await waitForVideoChromeFrames(page);
	}
}
