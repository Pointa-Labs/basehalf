/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The lifecycle of a reviewed external plugin, refused while the plugin platform is frozen.

import fs from 'fs';
import path from 'path';
import { extensionsDir, opts } from '../../context.mts';
import { externalPluginFixturePath } from '../../fixture.mts';
import { quickOpen, shownFileName } from '../../lib/quickInput.mts';
import { step, waitUntil } from '../../lib/steps.mts';

export async function assertExternalPluginLifecycle(page) {
	await step('external-plugin-install', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'install');
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await closeExternalPluginLibrary(library);
	});
	await step('external-plugin-projection', async () => {
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	await step('external-plugin-disable-source-fallback', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'disable');
		await waitForExternalPluginAction(library, 'enable');
		await runNativePluginRuntimeActionIfVisible(page, library);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginSourceFallback(page);
	});
	await step('external-plugin-enable-projection', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'enable');
		await waitForExternalPluginAction(library, 'disable');
		await runNativePluginRuntimeActionIfVisible(page, library);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	await step('external-plugin-uninstall-preserves-data', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'uninstall');
		const dialog = page.locator('.monaco-dialog-box', { hasText: 'Existing project files and generated outputs stay on disk.' }).first();
		await dialog.waitFor({ state: 'visible', timeout: 20_000 });
		await dialog.locator('.monaco-button', { hasText: /^Uninstall$/ }).click();
		await dialog.waitFor({ state: 'hidden', timeout: 20_000 });
		await waitForExternalPluginAction(library, 'install');
		if (!fs.existsSync(externalPluginFixturePath()) || fs.readFileSync(externalPluginFixturePath(), 'utf8') !== '{"kept":true}\n') {
			throw new Error('Uninstall changed or removed the external plugin project file');
		}
		await closeExternalPluginLibrary(library);
	});
	return [
		'external-plugin-server-install',
		'external-plugin-projection',
		'external-plugin-disable-source-fallback',
		'external-plugin-enable-projection',
		'external-plugin-uninstall-data-retention'
	];
}

export async function assertExternalPluginUpdate(page) {
	await step('external-plugin-seeded-catalog-admission', async () => {
		const library = await openExternalPluginLibrary(page);
		await waitForExternalPluginAction(library, 'update');
		await closeExternalPluginLibrary(library);
	});
	await step('external-plugin-seeded-projection', async () => {
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, 'Your plugin owns this central project surface');
	});
	await step('external-plugin-native-update', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'update');
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await runNativePluginRuntimeActionIfVisible(page, library, true);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	return ['external-plugin-seeded-catalog-admission', 'external-plugin-seeded-version-active', 'external-plugin-native-restart-update'];
}

export async function assertExternalPluginUninstalled(page) {
	await step('external-plugin-relaunch-source-fallback', async () => {
		if (!fs.existsSync(externalPluginFixturePath()) || fs.readFileSync(externalPluginFixturePath(), 'utf8') !== '{"kept":true}\n') {
			throw new Error('The external plugin project file did not survive relaunch');
		}
		await waitUntil(
			() => !fs.readdirSync(extensionsDir).some(name => name.toLowerCase().startsWith(`${opts.externalPluginId}-`)),
			'VS Code extension management to delete the plugin marked for removal after relaunch',
			15_000
		);
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginSourceFallback(page);
	});
	return ['external-plugin-relaunch-source-fallback', 'external-plugin-user-data-preserved'];
}

export async function assertExternalPluginInstalledRelaunch(page) {
	await step('external-plugin-relaunch-cached-admission', async () => {
		const profile = JSON.parse(fs.readFileSync(path.join(extensionsDir, 'extensions.json'), 'utf8'));
		if (!profile.some(extension => extension.identifier?.id?.toLowerCase() === opts.externalPluginId && extension.version === opts.externalPluginVersion)) {
			throw new Error(`The expected installed plugin is absent from the VS Code extension profile: ${JSON.stringify(profile)}`);
		}
		const library = await openExternalPluginLibrary(page);
		await library.locator('.basehalf-plugin-library-catalog-status', { hasText: 'Signed remote catalog verified' }).waitFor({ state: 'visible', timeout: 45_000 });
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await closeExternalPluginLibrary(library);
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	return ['external-plugin-relaunch-cached-admission', 'external-plugin-relaunch-remote-refresh', 'external-plugin-relaunch-projection'];
}

async function openExternalPluginLibrary(page) {
	const productConfig = await page.evaluate(() => {
		const configuration = globalThis.vscode?.context?.configuration?.();
		return {
			basehalfPlugins: configuration?.product?.basehalfPlugins,
			basehalfProductKeys: Object.keys(configuration?.product ?? {}).filter(key => key.toLowerCase().includes('basehalf'))
		};
	});
	if (!productConfig.basehalfPlugins) {
		throw new Error(`Remote plugin distribution is absent from the renderer product configuration: ${JSON.stringify(productConfig)}`);
	}
	const pluginsAction = page.locator([
		'.part.activitybar .action-label[aria-label^="Plugins"]',
		'.part.activitybar .action-label.codicon-extensions',
		'.part.sidebar .composite-bar .action-label[aria-label^="Plugins"]',
		'.part.sidebar .composite-bar .action-label.codicon-extensions'
	].join(', ')).first();
	await pluginsAction.waitFor({ state: 'visible', timeout: 20_000 });
	await pluginsAction.click();
	const sidebarRow = page.locator(`.basehalf-plugins-view [data-extension-id="${opts.externalPluginId}"]`).first();
	await sidebarRow.waitFor({ state: 'visible', timeout: 45_000 });
	await sidebarRow.click();
	const library = page.locator('.basehalf-plugin-library').first();
	await library.waitFor({ state: 'visible', timeout: 20_000 });
	const row = library.locator(`[data-extension-id="${opts.externalPluginId}"]`).first();
	await row.waitFor({ state: 'visible', timeout: 20_000 });
	await row.click();
	await library.locator('.basehalf-plugin-library-detail code', { hasText: opts.externalPluginId }).waitFor({ state: 'visible', timeout: 20_000 });
	return library;
}

async function runExternalPluginAction(library, action) {
	const button = library.locator(`[data-plugin-action="${action}"][data-extension-id="${opts.externalPluginId}"]`).first();
	await button.waitFor({ state: 'visible', timeout: 30_000 });
	await button.click();
}

async function waitForExternalPluginAction(library, action) {
	await library.locator(`[data-plugin-action="${action}"][data-extension-id="${opts.externalPluginId}"]`).first().waitFor({ state: 'visible', timeout: 60_000 });
}

async function assertExternalPluginInstalledVersion(library) {
	const row = library.locator('.basehalf-plugin-library-meta-row', { hasText: 'Installed' }).filter({ hasText: opts.externalPluginVersion }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
}

async function closeExternalPluginLibrary(library) {
	await library.locator('[data-action="close"]').click();
	await library.waitFor({ state: 'detached', timeout: 20_000 });
}

async function runNativePluginRuntimeActionIfVisible(page, library, required = false) {
	const action = library.locator('.basehalf-plugin-library-actions .action-label', { hasText: /Restart Extensions|Reload Window/ }).first();
	const visible = await action.isVisible({ timeout: 5_000 }).catch(() => false);
	if (!visible) {
		if (required) {
			throw new Error('The native extension runtime action was not offered after updating an active plugin');
		}
		return;
	}
	await action.click();
	await page.waitForTimeout(1_500);
}

async function reopenExternalPluginFixture(page) {
	await quickOpen(page, 'README.md');
	await page.locator('.basehalf-card-detail-title', { hasText: shownFileName('README.md') }).waitFor({ state: 'visible', timeout: 20_000 });
	await quickOpen(page, path.basename(externalPluginFixturePath()));
}

async function waitForExternalPluginProjection(page, marker) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	const started = Date.now();
	while (Date.now() - started < 30_000) {
		for (const frame of page.frames()) {
			const text = await frame.locator('body').textContent().catch(() => '');
			if (text?.includes(marker)) {
				return;
			}
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`External plugin projection did not render marker: ${marker}`);
}

async function waitForExternalPluginSourceFallback(page) {
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-surface.active .basehalf-card-detail-source').waitFor({ state: 'visible', timeout: 30_000 });
}
