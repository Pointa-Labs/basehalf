/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf's Settings: its General page, the advanced list, its About page, and the Providers page.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { logsPath, root, userDataDir } from '../../context.mts';
import { chooseProviderKind, closeProvidersPage, openProvidersPage, readProviderEditor, readProviderKinds, readProviderLayout, readProviderRows, SMOKE_PROVIDER, SMOKE_REGION } from '../../lib/providers.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { assertSettingsFramesShowedOnly, watchSettingsFrames } from '../../lib/settingsFrames.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

// Every setting that the base and the shipped extensions register has a class in the catalog (the settings
// BaseHalf offers, criterion 1): the window names the ones without in its log, once its extensions are registered.
export function assertEverySettingHasAClass() {
	const logs = fs.readdirSync(logsPath, { recursive: true }).map(String).filter(file => path.basename(file) === 'renderer.log');
	if (!logs.length) {
		throw new Error(`No log of a window under ${logsPath}`);
	}
	for (const log of logs) {
		const line = fs.readFileSync(path.join(logsPath, log), 'utf8').split('\n').find(candidate => candidate.includes('[BaseHalf] settings without a class:'));
		if (line) {
			throw new Error(`Settings without a class in the catalog: ${line.slice(line.indexOf('class:') + 6).trim()}`);
		}
	}
}

// Commands and menus, criterion 9: the window names in its log every command the base lists in the Command
// Palette under the category of a family BaseHalf does not have and that no pattern names. No window of the run
// has written the line.
export function assertHiddenFamiliesNameTheirCommands() {
	const logs = fs.readdirSync(logsPath, { recursive: true }).map(String).filter(file => path.basename(file) === 'renderer.log');
	if (!logs.length) {
		throw new Error(`No log of a window under ${logsPath}`);
	}
	for (const log of logs) {
		const lines = fs.readFileSync(path.join(logsPath, log), 'utf8').split('\n');
		const line = lines.find(candidate => candidate.includes('[BaseHalf] commands of a hidden family that no pattern names:'));
		if (line) {
			throw new Error(`Commands of a hidden family that no pattern names: ${line.slice(line.indexOf('names:') + 6).trim()}`);
		}
		// A command of BaseHalf's own that has a key has a name: Keyboard Shortcuts lists none by its id (D150).
		const keyed = lines.find(candidate => candidate.includes('[BaseHalf] commands of BaseHalf with a key and no name:'));
		if (keyed) {
			throw new Error(`Commands of BaseHalf with a key and no name: ${keyed.slice(keyed.indexOf('name:') + 5).trim()}`);
		}
	}
}

// BaseHalf's Settings, criteria 1, 2, 7, and 9: the key of Settings opens BaseHalf's own Settings at General, in
// the overlay, with its six pages and the rows of General under BaseHalf's names; a switch writes the user's
// settings at once and takes its line away again at the default; the arrow keys choose a page; Advanced Settings…
// shows the Settings editor of the base, which lists BaseHalf's settings in one group and nothing of the base's
// chat; and Escape closes Settings.
export async function assertBaseHalfSettings(page) {
	const settingsFile = path.join(userDataDir, 'User', 'settings.json');
	const written = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8') || '{}');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
	const settings = page.locator('.basehalf-settings').first();
	await settings.waitFor({ state: 'visible', timeout: 20_000 });
	const seen = await settings.evaluate(root => ({
		pages: Array.from(root.querySelectorAll('.basehalf-settings-page-tab')).map(tab => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`),
		advanced: root.querySelector('.basehalf-settings-advanced')?.textContent ?? null,
		keyboard: root.querySelector('.basehalf-settings-keyboard')?.textContent ?? null,
		rows: Array.from(root.querySelectorAll('.basehalf-settings-general .basehalf-settings-row-label')).map(label => label.textContent),
		overlay: !!root.closest('.modal-editor-part'),
		search: !!root.querySelector('input[type="search"], .suggest-input-container')
	}));
	const rows = ['Zoom', 'Font', 'Font Size', 'Wrap Long Lines', 'Show the .bh Folder'];
	if (JSON.stringify(seen.pages) !== JSON.stringify(['General*', 'Canvas', 'Notes', 'Agent Area', 'Providers', 'About']) || seen.advanced !== 'Advanced Settings…'
		|| seen.keyboard !== 'Keyboard Shortcuts…' || JSON.stringify(seen.rows) !== JSON.stringify(rows) || !seen.overlay || seen.search) {
		throw new Error(`Settings must open BaseHalf's own Settings at General, in the overlay, with its pages and rows: ${JSON.stringify(seen)}`);
	}

	// Each page of settings holds its rows under BaseHalf's names.
	const pageRows = {
		canvas: ['Zoom of a New Folder', 'Mouse Wheel', 'Snap to Cards', 'Background', 'Play Videos Under the Pointer'],
		notes: ['Font', 'Text Size', 'Opens In', 'Reading Aids'],
		agentArea: ['First Session', 'Reopen Sessions', 'Font', 'Font Size', 'Offer the BaseHalf Skill', 'Share the Selection']
	};
	for (const [name, expected] of Object.entries(pageRows)) {
		await settings.locator(`.basehalf-settings-page-tab[data-page="${name}"]`).click();
		const shown = await waitForReading(
			() => settings.locator(`.basehalf-settings-${name}:not([hidden]) .basehalf-settings-row-label`).allTextContents(),
			labels => labels.length > 0, `the page ${name} of Settings to show its rows`);
		if (JSON.stringify(shown) !== JSON.stringify(expected)) {
			throw new Error(`The page ${name} of Settings must hold its rows: ${JSON.stringify(shown)}`);
		}
	}

	await settings.locator('.basehalf-settings-page-tab[data-page="notes"]').click();
	const readingAids = settings.locator('[data-setting="basehalf.editor.readingMode"] [role="switch"]');
	const before = await readingAids.getAttribute('aria-checked');
	await readingAids.click();
	await waitUntil(() => written()['basehalf.editor.readingMode'] === (before !== 'true'), 'the switch of Reading Aids to be written to the user\'s settings', 10_000);
	await waitForReading(() => readingAids.getAttribute('aria-checked'), checked => checked === String(before !== 'true'), 'the switch of Reading Aids to show what was written');
	await readingAids.click();
	await waitUntil(() => !('basehalf.editor.readingMode' in written()), 'Reading Aids at its default to leave the user\'s settings', 10_000);

	// The arrow keys choose a page and keep the keyboard in the list.
	await settings.locator('.basehalf-settings-page-tab[data-page="general"]').focus();
	await page.keyboard.press('ArrowDown');
	await settings.locator('.basehalf-settings-page-tab[data-page="canvas"][aria-selected="true"]').waitFor({ state: 'visible', timeout: 10_000 });
	const inList = await page.evaluate(() => document.activeElement?.getAttribute('data-page'));
	if (inList !== 'canvas') {
		throw new Error(`Arrow Down in the list of pages must choose Canvas and keep the keyboard in the list: the focus is on ${inList}`);
	}

	await settings.locator('.basehalf-settings-advanced').click();
	const advanced = page.locator('.settings-editor').first();
	await advanced.waitFor({ state: 'visible', timeout: 20_000 });
	const groups = await waitForReading(
		() => advanced.locator('.settings-toc-container .settings-toc-entry').evaluateAll(entries => entries.map(entry => entry.textContent?.trim() ?? '')),
		entries => entries.includes('BaseHalf'), 'the advanced list to show its groups', 20_000);
	if (groups.includes('Chat') || groups.includes('Providers') || groups.includes('About')) {
		throw new Error(`The advanced list must hold no group of the base's chat and no page of BaseHalf's: ${JSON.stringify(groups)}`);
	}

	// The base keeps its Settings editor out of the overlay while its smoke driver runs, so here the advanced
	// list stands in the editor area, where a user has it in the overlay: it is closed as an editor is.
	if (await advanced.evaluate(element => !element.closest('.modal-editor-part'))) {
		await advanced.locator('.settings-toc-container').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
		await advanced.waitFor({ state: 'hidden', timeout: 15_000 });
	}

	// Settings of its key shows BaseHalf's Settings again, and Escape closes it.
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
	await settings.waitFor({ state: 'visible', timeout: 20_000 });
	await settings.locator('.basehalf-settings-page-tab[aria-selected="true"]').focus();
	await page.keyboard.press('Escape');
	await settings.waitFor({ state: 'hidden', timeout: 15_000 });
	if (await advanced.isVisible()) {
		await page.keyboard.press('Escape');
		await advanced.waitFor({ state: 'hidden', timeout: 15_000 });
	}
}

// The About page is a page of BaseHalf's Settings, and holds BaseHalf's own
// version and the way to the release notes (app update, "Where an update
// shows"). The smoke runs with updates switched off, so the state it shows
// is that one. Settings, closed, opens on the page from its first frame on
// (BaseHalf's Settings, criterion 5).
export async function assertBaseHalfAboutPage(page) {
	const settingsEditor = page.locator('.basehalf-settings').first();
	if (await settingsEditor.isVisible()) {
		await page.keyboard.press('Escape');
		await settingsEditor.waitFor({ state: 'hidden', timeout: 15_000 });
	}
	await watchSettingsFrames(page);
	await runCommand(page, 'About BaseHalf');
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const about = settingsEditor.locator('.basehalf-about').first();
	await about.waitFor({ state: 'visible', timeout: 20_000 });
	await about.locator('h1', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.basehalf-settings-page-tab[aria-selected="true"]', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });
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
	const hint = 'A key works in the region it comes from.';
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
