/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail, and going back and forward between it and canvases.

import process from 'process';
import { waitForViewTransitions } from '../app.mts';
import { assertCanvasFolder } from './canvas.mts';
import { activeMarkdownRichFrame } from './markdownRich.mts';
import { shownFileName, visibleQuickInput, waitForQuickInputResult } from './quickInput.mts';

export async function assertCardDetail(page, title) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-card-detail-title', { hasText: shownFileName(title) }).waitFor({ state: 'visible', timeout: 20_000 });
	const activeSurface = page.locator('.basehalf-card-detail-surface.active');
	await activeSurface.waitFor({ state: 'visible', timeout: 8_000 });
	const richHost = activeSurface.locator('.basehalf-card-detail-markdown-rich-webview');
	if (await richHost.count()) {
		// A first rich surface is active immediately so its iframe loads at normal
		// priority. It is not interactive until the webview acknowledges both the
		// document commit and settled focus boundary.
		const renderedHost = activeSurface.locator(
			'[data-basehalf-rendered][data-basehalf-render-state="rendered"].basehalf-card-detail-markdown-rich-webview'
		);
		await renderedHost.waitFor({ state: 'visible', timeout: 8_000 });
		await page.waitForFunction(host => !host.inert && host.getAttribute('aria-busy') === null, await renderedHost.elementHandle(), { timeout: 8_000 });
		const lifecycle = await renderedHost.evaluate(host => ({
			hostInert: host.inert,
			hostBusy: host.getAttribute('aria-busy'),
			surfaceRendered: host.closest('.basehalf-card-detail-surface')?.getAttribute('data-basehalf-rendered'),
			surfaceState: host.closest('.basehalf-card-detail-surface')?.getAttribute('data-basehalf-render-state')
		}));
		if (lifecycle.hostInert || lifecycle.hostBusy !== null
			|| lifecycle.surfaceRendered === null || lifecycle.surfaceState !== 'rendered') {
			throw new Error(`The rich Card Detail first-frame lifecycle is incomplete: ${JSON.stringify(lifecycle)}`);
		}
		await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	}
}

export async function assertNativeBackOpensPreviousCanvas(page, expectedFolderPath) {
	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCanvasFolder(page, expectedFolderPath);
}

export async function assertNativeForwardOpensCardDetail(page, title, options = {}) {
	await clickCommandCenterNavigationButton(page, 'arrow-right', 'Go Forward');
	if (options.coldRichQuickInputQuery) {
		// The probe opens Quick Input while the cold rich generation boots, before
		// its first frame. Wait until that generation's iframe exists: a Quick
		// Input that is already open when the surface mounts pauses the boot
		// before any iframe is created, which is a different path and would make
		// this probe race the navigation itself.
		await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich-webview iframe')
			.first().waitFor({ state: 'attached', timeout: 20_000 });
		const focusBeforeQuickInput = await page.evaluate(() => {
			const active = document.activeElement;
			return active instanceof HTMLElement ? {
				tag: active.tagName,
				classes: active.className,
				id: active.id,
				ariaLabel: active.getAttribute('aria-label')
			} : undefined;
		});
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		const quickInput = visibleQuickInput(page);
		try {
			await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
		} catch (error) {
			const focusAfterQuickInput = await page.evaluate(() => {
				const active = document.activeElement;
				const widget = document.querySelector('.quick-input-widget');
				return {
					active: active instanceof HTMLElement ? {
						tag: active.tagName,
						classes: active.className,
						id: active.id,
						ariaLabel: active.getAttribute('aria-label')
					} : undefined,
					widgetDisplay: widget instanceof HTMLElement ? getComputedStyle(widget).display : undefined,
					hostState: document.querySelector('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich-webview')?.getAttribute('data-basehalf-render-state')
				};
			});
			throw new Error(`Cold rich Quick Input did not remain visible: ${JSON.stringify({ focusBeforeQuickInput, focusAfterQuickInput, cause: String(error) })}`);
		}

		await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
		await page.locator('.basehalf-card-detail-title', { hasText: shownFileName(title) }).waitFor({ state: 'visible', timeout: 20_000 });
		const activeSurface = page.locator('.basehalf-card-detail-surface.active');
		const richHost = activeSurface.locator('.basehalf-card-detail-markdown-rich-webview');
		await richHost.waitFor({ state: 'visible', timeout: 8_000 });
		const coldFrame = richHost.locator('iframe').first();
		await coldFrame.waitFor({ state: 'attached', timeout: 8_000 });
		const coldFrameName = await coldFrame.getAttribute('name');
		if (!coldFrameName) {
			throw new Error('The cold rich focus probe could not identify its iframe generation');
		}
		const initialLifecycle = await richHost.evaluate(host => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered')
		}));
		if (initialLifecycle.state === 'rendered') {
			throw new Error(`The cold rich focus probe missed the first-frame boundary: ${JSON.stringify(initialLifecycle)}`);
		}
		if ((initialLifecycle.state !== 'booting' && initialLifecycle.state !== 'settling' && initialLifecycle.state !== 'paused')
			|| !initialLifecycle.inert || initialLifecycle.busy !== 'true' || initialLifecycle.rendered) {
			throw new Error(`The cold rich Card Detail started with an invalid lifecycle: ${JSON.stringify(initialLifecycle)}`);
		}

		await page.waitForFunction(({ host, expectedFrameName }) => {
			const state = host.dataset.basehalfRenderState;
			const sameGeneration = [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName);
			return state === 'paused' || state === 'rendered' || !sameGeneration;
		}, { host: await richHost.elementHandle(), expectedFrameName: coldFrameName }, { timeout: 15_000 });
		const guardedLifecycle = await richHost.evaluate((host, expectedFrameName) => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered'),
			sameGeneration: [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName)
		}), coldFrameName);
		if (guardedLifecycle.state !== 'paused' || !guardedLifecycle.inert
			|| guardedLifecycle.busy !== 'true' || guardedLifecycle.rendered || !guardedLifecycle.sameGeneration) {
			throw new Error(`The cold rich focus probe did not settle behind Quick Input: ${JSON.stringify({ coldFrameName, guardedLifecycle })}`);
		}
		const quickInputFocusAtBoundary = await quickInput.evaluate(input => ({
			visible: input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden',
			focused: input.ownerDocument.activeElement === input
		})).catch(() => undefined);
		if (!quickInputFocusAtBoundary?.visible || !quickInputFocusAtBoundary.focused) {
			throw new Error(`The cold rich focus boundary displaced Quick Input: ${JSON.stringify(quickInputFocusAtBoundary)}`);
		}

		await quickInput.fill(options.coldRichQuickInputQuery);
		await waitForQuickInputResult(page, options.coldRichQuickInputQuery);
		const quickInputFocus = await quickInput.evaluate(input => ({
			visible: input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden',
			focused: input.ownerDocument.activeElement === input,
			value: input.value
		})).catch(() => undefined);
		if (!quickInputFocus?.visible || !quickInputFocus.focused || quickInputFocus.value !== options.coldRichQuickInputQuery) {
			throw new Error(`The cold rich Card Detail displaced Quick Input: ${JSON.stringify(quickInputFocus)}`);
		}
		const guardedAfterQuery = await richHost.evaluate((host, expectedFrameName) => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered'),
			sameGeneration: [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName)
		}), coldFrameName);
		if (guardedAfterQuery.state !== 'paused' || !guardedAfterQuery.inert
			|| guardedAfterQuery.busy !== 'true' || guardedAfterQuery.rendered || !guardedAfterQuery.sameGeneration) {
			throw new Error(`The cold rich generation escaped its focus guard while Quick Input still owned focus: ${JSON.stringify(guardedAfterQuery)}`);
		}

		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		const renderedHost = activeSurface.locator(
			'.basehalf-card-detail-markdown-rich-webview[data-basehalf-rendered][data-basehalf-render-state="rendered"]'
		);
		await renderedHost.waitFor({ state: 'visible', timeout: 15_000 });
		await page.waitForFunction(host => !host.inert, await renderedHost.elementHandle(), { timeout: 8_000 });
	}
	await assertCardDetail(page, title);
}

export async function clickCommandCenterNavigationButton(page, codicon, label) {
	const selector = `.command-center .action-item:not(.disabled) .action-label.codicon-${codicon}:not(.disabled):not([aria-disabled="true"])`;
	const button = page.locator(selector).filter({ visible: true }).last();
	await button.waitFor({ state: 'visible', timeout: 15_000 });
	const ariaLabel = await button.getAttribute('aria-label');
	if (ariaLabel && !ariaLabel.startsWith(label)) {
		throw new Error(`Expected ${label} navigation control, got ${ariaLabel}`);
	}
	await button.click();
}

export async function assertNoEditorTabFor(page, name) {
	let lastTabs = [];
	const started = Date.now();
	while (Date.now() - started < 5_000) {
		lastTabs = await page.locator('.monaco-workbench .part.editor .tabs-container .tab').evaluateAll(rows => rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim()));
		if (!lastTabs.some(tab => tab && tab.includes(name))) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Unexpected VS Code editor tab for ${name}: ${lastTabs.join(', ')}`);
}

export async function closeCardDetailIfOpen(page) {
	const detail = page.locator('.basehalf-card-detail.visible');
	const opened = await detail.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false);
	if (!opened) {
		return;
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
}

const MODE_BUTTON = '.basehalf-card-detail.visible .basehalf-card-detail-mode-button';

/** What Edit and Done of a video, an image, or a sound say now in the header of Card Detail; nothing where none shows (editing media, D96). */
export async function cardDetailModeLabel(page) {
	return page.evaluate(selector => {
		const button = document.querySelector(selector);
		return button && !button.hidden ? button.getAttribute('aria-label') : undefined;
	}, MODE_BUTTON);
}

async function pressCardDetailMode(page, from, to) {
	await page.waitForFunction(({ selector, from }) => {
		const button = document.querySelector(selector);
		return !!button && !button.hidden && button.getAttribute('aria-label') === from;
	}, { selector: MODE_BUTTON, from }, { timeout: 10_000 });
	// A locator's click scrolls its button into view first: during Card Detail's view transition that moved the
	// window's parts by a few pixels, which no user's press does. It waits for the transition, as a user sees it end.
	await waitForViewTransitions(page);
	await page.locator(MODE_BUTTON).click();
	await page.waitForFunction(({ selector, to }) => document.querySelector(selector)?.getAttribute('aria-label') === to, { selector: MODE_BUTTON, to }, { timeout: 5_000 });
}

/** Edit, in the header of Card Detail, shows the editor of the video, the image, or the sound that it views. */
export async function enterEditing(page) {
	await pressCardDetailMode(page, 'Edit', 'Done');
}

/** Done goes back to viewing the file. */
export async function leaveEditing(page) {
	await pressCardDetailMode(page, 'Done', 'Edit');
}
