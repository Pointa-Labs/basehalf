/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf's Settings, its About page, and the Providers page.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { root } from '../../context.mts';
import { chooseProviderKind, closeProvidersPage, openProvidersPage, readProviderEditor, readProviderKinds, readProviderLayout, readProviderRows, SMOKE_PROVIDER, SMOKE_REGION } from '../../lib/providers.mts';
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

// Providers and the model catalog, criteria 8, 13, 21, and 22: the page
// sorts the providers of the model catalog by card type, Image first; each
// type lists the providers that make it, none of them set up in a new
// profile, SMOKE_PROVIDER under Image and Video; each credential it declares
// is a masked field; a provider of several types says that its one key serves
// them, and names its models of the type chosen first, a line for each kind
// it has models of. The retired Models & Providers page is gone.
export async function assertProvidersPage(page) {
	const providers = await openProvidersPage(page);
	if (await page.locator('.basehalf-model-connections').count() !== 0) {
		throw new Error('The retired Models & Providers page is still mounted beside Providers');
	}
	await waitForReading(() => readProviderRows(providers), seen => seen.length > 0, 'the providers of the model catalog to be listed', 30_000);
	const kinds = await readProviderKinds(providers);
	if (JSON.stringify(kinds) !== JSON.stringify([{ kind: 'image', label: 'Image', chosen: true }, { kind: 'video', label: 'Video', chosen: false }, { kind: 'audio', label: 'Audio', chosen: false }])) {
		throw new Error(`Providers must offer Image, Video, and Audio, with Image chosen as it opens: ${JSON.stringify(kinds)}`);
	}
	const lists = {};
	for (const { kind } of kinds) {
		await chooseProviderKind(providers, kind);
		lists[kind] = await readProviderRows(providers);
	}
	const ids = kind => lists[kind].map(row => row.id);
	const expected = { image: [SMOKE_PROVIDER, 'openai'], video: [SMOKE_PROVIDER, 'pixverse'], audio: ['elevenlabs', 'mureka'] };
	const absent = { image: ['pixverse', 'elevenlabs'], video: ['openai', 'elevenlabs'], audio: [SMOKE_PROVIDER, 'pixverse', 'openai'] };
	if (Object.keys(expected).some(kind => expected[kind].some(id => !ids(kind).includes(id)) || absent[kind].some(id => ids(kind).includes(id)))
		|| Object.values(lists).flat().some(row => row.setUp !== 'false')) {
		throw new Error(`Each type must list the providers that make it, none set up in a new profile: ${JSON.stringify(lists)}`);
	}
	await chooseProviderKind(providers, 'image');
	await providers.locator(`.basehalf-video-provider-row[data-provider="${SMOKE_PROVIDER}"]`).click();
	const editor = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === SMOKE_PROVIDER, `the page to show ${SMOKE_PROVIDER}`);
	if (!editor.credentials.length || editor.credentials.some(credential => credential.set || credential.input !== 'password')
		|| !editor.regions.some(region => region.id === SMOKE_REGION) || !/^https:\/\//.test(editor.endpoint ?? '')) {
		throw new Error(`The page must offer a masked field for every credential of ${SMOKE_PROVIDER}, its regions, and its endpoint: ${JSON.stringify(editor)}`);
	}
	// The provider's models by name, those of the type chosen first, so that
	// the user can tell where to get credentials and what else the key makes.
	// A provider of images and videos has both lines; one of videos only, and
	// one of images only, have one.
	const lines = shown => shown.kinds.map(line => `${line.kind}:${line.label}`).join(' ');
	if (lines(editor) !== 'image:Images video:Videos' || editor.summary !== 'Not set up · One key for image and video cards'
		|| editor.kinds.some(line => !line.models.length || line.models.some(model => !model.id || !model.label))) {
		throw new Error(`Under Image, the page must say that ${SMOKE_PROVIDER}'s key serves image and video cards, and name its images first: ${JSON.stringify(editor)}`);
	}
	await chooseProviderKind(providers, 'video');
	const underVideo = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === SMOKE_PROVIDER && lines(seen) === 'video:Videos image:Images', `${SMOKE_PROVIDER} to stay, its videos first, under Video`);
	if (underVideo.summary !== editor.summary) {
		throw new Error(`${SMOKE_PROVIDER} must say the same of its key under each type: ${JSON.stringify(underVideo)}`);
	}
	for (const [kind, provider, expectedLines] of [['video', 'pixverse', 'video:Videos'], ['image', 'openai', 'image:Images']]) {
		await chooseProviderKind(providers, kind);
		await providers.locator(`.basehalf-video-provider-row[data-provider="${provider}"]`).click();
		const other = await waitForReading(() => readProviderEditor(providers), seen => seen.provider === provider, `the page to show ${provider}`);
		if (lines(other) !== expectedLines || other.kinds.some(line => !line.models.length) || !/^Not set up · \d+ models?$/.test(other.summary ?? '')) {
			throw new Error(`The page must name the models of ${provider} under the one kind it makes, ${expectedLines}, and count them: ${JSON.stringify(other)}`);
		}
	}
	// Every provider of more than one region makes images.
	await chooseProviderKind(providers, 'image');
	await assertRegionsEasyToFind(providers, lists.image);
	await closeProvidersPage(page, providers);
}

// Providers, criterion 19 (D94): a provider of more than one region shows the
// region with its hint, then the console of the region chosen, before the
// credentials, both in view as the provider opens; the region first listed
// is chosen in a new profile.
async function assertRegionsEasyToFind(providers, rows) {
	const hint = 'Each region has its own console, keys, and models. Choose the region your key comes from.';
	const seen = [];
	for (const row of rows) {
		await providers.locator(`.basehalf-video-provider-row[data-provider="${row.id}"]`).click();
		const editor = await waitForReading(() => readProviderEditor(providers), shown => shown.provider === row.id, `the page to show ${row.id}`);
		if (editor.regions.length < 2) {
			continue;
		}
		const layout = await readProviderLayout(providers);
		const order = layout.parts.join(' ');
		if (!/^heading region console( credential)+ endpoint$/.test(order) || layout.hint !== hint || !editor.regions[0].checked
			|| layout.scrollTop !== 0 || !layout.regionInView || !layout.consoleInView) {
			throw new Error(`${row.id} must show its region with the hint, then the console of the region chosen, before the credentials, both in view, with the first region chosen: ${JSON.stringify({ layout, regions: editor.regions })}`);
		}
		seen.push(row.id);
	}
	if (!seen.includes(SMOKE_PROVIDER)) {
		throw new Error(`${SMOKE_PROVIDER} has more than one region and must be among the providers checked: ${JSON.stringify(seen)}`);
	}
}
