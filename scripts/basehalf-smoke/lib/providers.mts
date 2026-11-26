/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The Providers page (providers and the model catalog, "Credentials, regions,
// and endpoints"), which Settings and the panel of a generation card both open.

import { runCommand } from './quickInput.mts';

/**
 * The provider of the catalog that the smoke sets up, and the region it uses:
 * its module answers the local test provider's API, and the region offers the
 * image models that make several images in one generation.
 */
export const SMOKE_PROVIDER = 'bytedance';
export const SMOKE_REGION = 'intl';

// The page is a page of BaseHalf's Settings, and opens from its command,
// BaseHalf: Providers. The command is named with its category: other commands
// have Providers in their names.
export async function openProvidersPage(page) {
	await runCommand(page, 'BaseHalf: Providers');
	return waitForProvidersPage(page);
}

// Providers inside BaseHalf's Settings, however it was opened: the page shown, and chosen in the list of pages.
export async function waitForProvidersPage(page) {
	const settings = page.locator('.basehalf-settings').first();
	await settings.waitFor({ state: 'visible', timeout: 20_000 });
	const providers = settings.locator('.basehalf-video-providers').first();
	await providers.waitFor({ state: 'visible', timeout: 20_000 });
	await providers.locator('h1', { hasText: /^Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settings.locator('.basehalf-settings-page-tab[aria-selected="true"]', { hasText: /^Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Providers remained inside QuickInput instead of opening inside Settings');
	}
	return providers;
}

// Escape closes Settings wherever in it the keyboard is; a field that takes Escape for itself, as one of a
// credential being replaced, takes it first.
export async function closeProvidersPage(page, providers) {
	for (let attempt = 0; attempt < 3 && await providers.isVisible(); attempt++) {
		await page.keyboard.press('Escape');
		await providers.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
	}
	await providers.waitFor({ state: 'hidden', timeout: 15_000 });
}

// The providers the page lists, in order: those of the card type chosen (D107).
export function readProviderRows(providers) {
	return providers.evaluate(root => Array.from(root.querySelectorAll('.basehalf-video-provider-row')).map(row => ({
		id: row.getAttribute('data-provider'),
		label: row.querySelector('.basehalf-video-provider-row-name')?.textContent ?? null,
		setUp: row.getAttribute('data-set-up'),
		selected: row.getAttribute('aria-current') === 'page'
	})), undefined, { timeout: 2_000 });
}

// The card types above the list (D107): each type by its name, and the one chosen.
export function readProviderKinds(providers) {
	return providers.evaluate(root => Array.from(root.querySelectorAll('.basehalf-video-providers-kind')).map(tab => ({
		kind: tab.getAttribute('data-kind'),
		label: tab.textContent,
		chosen: tab.getAttribute('aria-selected') === 'true'
	})), undefined, { timeout: 2_000 });
}

// Shows the providers of a card type, as a click on the type does (D107).
export async function chooseProviderKind(providers, kind) {
	const tab = providers.locator(`.basehalf-video-providers-kind[data-kind="${kind}"]`);
	if (await tab.getAttribute('aria-selected', { timeout: 10_000 }) !== 'true') {
		await tab.click();
	}
	await providers.locator(`.basehalf-video-providers-list[data-kind="${kind}"]`).waitFor({ state: 'attached', timeout: 10_000 });
}

// The provider the page shows: its regions, its credentials and whether each
// is set, its endpoint, what it says of its key, and its models under Images,
// Videos, and Audio.
export function readProviderEditor(providers) {
	return providers.evaluate(root => {
		const editor = root.querySelector('.basehalf-video-provider-editor');
		const endpoint = root.querySelector('.basehalf-video-provider-field.endpoint input');
		const row = root.querySelector('.basehalf-video-provider-row[aria-current="page"]');
		return {
			provider: editor?.getAttribute('data-provider') ?? null,
			rowSetUp: row?.getAttribute('data-set-up') ?? null,
			regions: Array.from(root.querySelectorAll('.basehalf-video-provider-region')).map(region => ({ id: region.getAttribute('data-region'), checked: region.getAttribute('aria-checked') === 'true' })),
			credentials: Array.from(root.querySelectorAll('.basehalf-video-provider-field.credential')).map(field => ({
				id: field.getAttribute('data-credential'),
				set: field.getAttribute('data-set') === 'true',
				input: field.querySelector('input')?.getAttribute('type') ?? null
			})),
			endpoint: endpoint?.value ?? null,
			customEndpoint: endpoint?.getAttribute('data-custom') === 'true',
			summary: root.querySelector('.basehalf-video-provider-summary')?.textContent ?? null,
			// The models by name, a line per kind, those of the card type chosen first.
			kinds: Array.from(root.querySelectorAll('p.basehalf-video-provider-models')).map(line => ({
				kind: line.getAttribute('data-kind'),
				label: line.querySelector('.basehalf-video-provider-models-kind')?.textContent ?? null,
				models: Array.from(line.querySelectorAll('.basehalf-video-provider-model')).map(model => ({
					id: model.getAttribute('data-model'),
					label: model.textContent,
					unavailable: model.classList.contains('unavailable'),
					description: model.getAttribute('aria-description')
				}))
			})),
			status: root.querySelector('.basehalf-video-providers-status')?.textContent ?? null
		};
	}, undefined, { timeout: 2_000 });
}

// Where the provider shown puts its parts (D94): the parts in order, the
// region's hint, and whether the region and the console link are in view in
// the editor as it opens, scrolled to its top, with the size of the window.
export function readProviderLayout(providers) {
	return providers.evaluate(root => {
		const editor = root.querySelector('.basehalf-video-provider-editor');
		const box = editor?.getBoundingClientRect();
		const inView = (element) => {
			const rect = element?.getBoundingClientRect();
			return !!rect && !!box && rect.height > 0 && rect.top >= box.top && rect.bottom <= box.bottom;
		};
		const parts = Array.from(editor?.children ?? []).map(child => child.classList.contains('basehalf-video-provider-editor-heading') ? 'heading'
			: child.classList.contains('region') ? 'region'
				: child.tagName === 'A' ? 'console'
					: child.classList.contains('credential') ? 'credential'
						: child.classList.contains('endpoint') ? 'endpoint' : child.className);
		const region = editor?.querySelector('.basehalf-video-provider-field.region') ?? null;
		return {
			provider: editor?.getAttribute('data-provider') ?? null,
			parts,
			hint: region?.querySelector('.basehalf-video-provider-field-hint')?.textContent ?? null,
			scrollTop: editor?.scrollTop ?? null,
			regionInView: inView(region),
			consoleInView: inView(editor?.querySelector('a.basehalf-video-provider-console')),
			window: `${window.innerWidth} × ${window.innerHeight}`
		};
	}, undefined, { timeout: 2_000 });
}
