/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf's Settings, its About page, and the Providers page.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { root } from '../../context.mts';
import { closeProvidersPage, openProvidersPage, readProviderEditor, readProviderRows, SMOKE_PROVIDER, SMOKE_REGION } from '../../lib/providers.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { assertSettingsFramesShowedOnly, watchSettingsFrames } from '../../lib/settingsFrames.mts';
import { waitForReading } from '../../lib/steps.mts';

export async function assertBaseHalfSettingsCategory(page) {
	await runCommand(page, 'Open Settings (UI)');
	const editor = page.locator('.settings-editor').first();
	await editor.waitFor({ state: 'visible', timeout: 20_000 });

	const toc = editor.locator('.settings-toc-container').first();
	await toc.waitFor({ state: 'visible', timeout: 20_000 });
	const basehalfEntry = toc.locator('.settings-toc-entry', { hasText: /^BaseHalf$/ }).first();
	await basehalfEntry.waitFor({ state: 'visible', timeout: 20_000 });
	await basehalfEntry.click();

	await page.waitForFunction(() => {
		const settingsEditor = document.querySelector('.settings-editor');
		const text = (settingsEditor?.textContent ?? '').replace(/\s+/g, ' ');
		return text.includes('BaseHalf')
			&& text.includes('ADHD')
			&& (text.includes('Reading Mode') || text.includes('basehalf.editor.readingMode'));
	}, null, { timeout: 20_000 });
}

// The About page is in Settings below BaseHalf, and holds BaseHalf's own
// version and the way to the release notes (app update, "Where an update
// shows"). The smoke runs with updates switched off, so the state it shows
// is that one. Settings, closed, opens on the page from its first frame on
// (settings pages, criterion 1), also when it was open on another entry
// before: in the smoke, Settings keeps its place between openings.
export async function assertBaseHalfAboutPage(page) {
	const settingsEditor = page.locator('.settings-editor').first();
	if (await settingsEditor.isVisible()) {
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
		await settingsEditor.waitFor({ state: 'hidden', timeout: 15_000 });
	}
	await watchSettingsFrames(page);
	await runCommand(page, 'About BaseHalf');
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const about = settingsEditor.locator('.basehalf-about').first();
	await about.waitFor({ state: 'visible', timeout: 20_000 });
	await about.locator('h1', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await assertSettingsFramesShowedOnly(page, 'About', 'basehalf-about', 'The command About BaseHalf');

	const version = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8')).basehalfVersion;
	const shown = (await about.innerText()).replace(/\s+/g, ' ');
	if (!shown.includes(`Current Version: ${version}`) || !shown.includes('Release Notes') || !shown.includes('Updates Disabled')) {
		throw new Error(`The About page does not show BaseHalf's version ${version}, the release notes, and the state of updates: ${shown}`);
	}
	// It is what the main surface shows.
	const onTop = await page.evaluate(() => {
		const rect = document.querySelector('.basehalf-about h1')?.getBoundingClientRect();
		const top = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
		return top?.closest('.basehalf-about') ? 'the page' : `${top?.tagName.toLowerCase()}.${String(top?.className).split(/\s+/).slice(0, 3).join('.')}`;
	});
	if (onTop !== 'the page') {
		throw new Error(`The About page is open and not shown: on top of its title is ${onTop}.`);
	}
}

// Providers and the model catalog, criteria 8 and 13: the page lists the
// providers of the model catalog, none of them set up in a new profile,
// SMOKE_PROVIDER among them; each credential it declares is a masked field;
// and each provider's models are named under Images and Videos, a line for
// each kind it has models of. The retired Models & Providers page is gone.
export async function assertProvidersPage(page) {
	const providers = await openProvidersPage(page);
	if (await page.locator('.basehalf-model-connections').count() !== 0) {
		throw new Error('The retired Models & Providers page is still mounted beside Providers');
	}
	const rows = await waitForReading(() => readProviderRows(providers), seen => seen.length > 0, 'the providers of the model catalog to be listed', 30_000);
	if (!rows.some(row => row.id === SMOKE_PROVIDER) || rows.some(row => row.setUp !== 'false')) {
		throw new Error(`A new profile must list the catalog's providers, none set up, ${SMOKE_PROVIDER} among them: ${JSON.stringify(rows)}`);
	}
	await providers.locator(`.basehalf-video-provider-row[data-provider="${SMOKE_PROVIDER}"]`).click();
	const editor = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === SMOKE_PROVIDER, `the page to show ${SMOKE_PROVIDER}`);
	if (!editor.credentials.length || editor.credentials.some(credential => credential.set || credential.input !== 'password')
		|| !editor.regions.some(region => region.id === SMOKE_REGION) || !/^https:\/\//.test(editor.endpoint ?? '')) {
		throw new Error(`The page must offer a masked field for every credential of ${SMOKE_PROVIDER}, its regions, and its endpoint: ${JSON.stringify(editor)}`);
	}
	// The provider's models by name, under Images and then Videos, so that the
	// user can tell where to get credentials. A provider of images and videos
	// has both lines; one of videos only, and one of images only, have one.
	const lines = shown => shown.kinds.map(line => `${line.kind}:${line.label}`).join(' ');
	if (lines(editor) !== 'image:Images video:Videos' || editor.kinds.some(line => !line.models.length || line.models.some(model => !model.id || !model.label))) {
		throw new Error(`The page must name ${SMOKE_PROVIDER}'s models under Images and Videos: ${JSON.stringify(editor.kinds)}`);
	}
	for (const [provider, expected] of [['pixverse', 'video:Videos'], ['openai', 'image:Images']]) {
		if (!rows.some(row => row.id === provider)) {
			continue;
		}
		await providers.locator(`.basehalf-video-provider-row[data-provider="${provider}"]`).click();
		const other = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === provider, `the page to show ${provider}`);
		if (lines(other) !== expected || other.kinds.some(line => !line.models.length)) {
			throw new Error(`The page must name the models of ${provider} under the one kind it makes, ${expected}: ${JSON.stringify(other.kinds)}`);
		}
	}
	await closeProvidersPage(page, providers);
}
