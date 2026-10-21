/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The Video Providers page, which Settings and the Video node both open.

import process from 'process';
import { root } from '../context.mts';
import { runCommand } from './quickInput.mts';

export const VIDEO_PROVIDER = 'bytedance';
export const VIDEO_REGION = 'cn';

// The Video Providers page (D59, video providers, "Credentials, regions, and
// endpoints") is in Settings below BaseHalf, in the place of the former Models
// & Providers page, and opens from its command.
export async function openVideoProvidersPage(page) {
	await runCommand(page, 'Video Providers');
	return waitForVideoProvidersPage(page);
}

// Video Providers inside Settings, however it was opened.
export async function waitForVideoProvidersPage(page) {
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const providers = settingsEditor.locator('.basehalf-video-providers').first();
	await providers.waitFor({ state: 'visible', timeout: 20_000 });
	await providers.locator('h1', { hasText: /^Video Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^Video Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Video Providers remained inside QuickInput instead of opening inside Settings');
	}
	return providers;
}

export async function closeVideoProvidersPage(page, providers) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	await providers.waitFor({ state: 'hidden', timeout: 15_000 });
}

// The providers the page lists, in order.
export function readVideoProviderRows(providers) {
	return providers.evaluate(root => Array.from(root.querySelectorAll('.basehalf-video-provider-row')).map(row => ({
		id: row.getAttribute('data-provider'),
		label: row.querySelector('.basehalf-video-provider-row-name')?.textContent ?? null,
		setUp: row.getAttribute('data-set-up'),
		selected: row.getAttribute('aria-current') === 'page'
	})), undefined, { timeout: 2_000 });
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

// The provider the page shows: its regions, its credentials and whether each is set, and its endpoint.
export function readVideoProviderEditor(providers) {
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
			models: Array.from(root.querySelectorAll('.basehalf-video-provider-model')).map(model => ({ id: model.getAttribute('data-model'), label: model.textContent, unavailable: model.classList.contains('unavailable') })),
			status: root.querySelector('.basehalf-video-providers-status')?.textContent ?? null
		};
	}, undefined, { timeout: 2_000 });
}
