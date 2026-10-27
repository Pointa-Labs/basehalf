/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The Providers page (providers and the model catalog, "Credentials, regions,
// and endpoints"), which Settings and the panel of a generation card both open.

import process from 'process';
import { runCommand } from './quickInput.mts';

/**
 * The provider of the catalog that the smoke sets up, and the region it uses:
 * its module answers the local test provider's API, and the region offers the
 * image models that make several images in one generation.
 */
export const SMOKE_PROVIDER = 'bytedance';
export const SMOKE_REGION = 'intl';

// The page is in Settings below BaseHalf, in the place of the former Models &
// Providers page, and opens from its command, BaseHalf: Providers. The
// command is named with its category: other commands have Providers in
// their names.
export async function openProvidersPage(page) {
	await runCommand(page, 'BaseHalf: Providers');
	return waitForProvidersPage(page);
}

// Providers inside Settings, however it was opened.
export async function waitForProvidersPage(page) {
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const providers = settingsEditor.locator('.basehalf-video-providers').first();
	await providers.waitFor({ state: 'visible', timeout: 20_000 });
	await providers.locator('h1', { hasText: /^Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Providers remained inside QuickInput instead of opening inside Settings');
	}
	return providers;
}

export async function closeProvidersPage(page, providers) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	await providers.waitFor({ state: 'hidden', timeout: 15_000 });
}

// The providers the page lists, in order.
export function readProviderRows(providers) {
	return providers.evaluate(root => Array.from(root.querySelectorAll('.basehalf-video-provider-row')).map(row => ({
		id: row.getAttribute('data-provider'),
		label: row.querySelector('.basehalf-video-provider-row-name')?.textContent ?? null,
		setUp: row.getAttribute('data-set-up'),
		selected: row.getAttribute('aria-current') === 'page'
	})), undefined, { timeout: 2_000 });
}

// The provider the page shows: its regions, its credentials and whether each
// is set, its endpoint, and its models under Images and Videos.
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
				set: field.querySelector('.basehalf-video-provider-key-state')?.classList.contains('set') ?? false,
				state: field.querySelector('.basehalf-video-provider-key-state')?.textContent?.trim() ?? null,
				input: field.querySelector('input')?.getAttribute('type') ?? null
			})),
			endpoint: endpoint?.value ?? null,
			customEndpoint: endpoint?.getAttribute('data-custom') === 'true',
			// The models by name, a line per kind: Images, then Videos.
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
