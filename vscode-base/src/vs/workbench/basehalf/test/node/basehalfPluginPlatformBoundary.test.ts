/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from '../../../../base/common/path.js';
import { AppResourcePath, FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalfPluginPlatformBoundary', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('no live module loads the frozen plugin surface or catalog code', () => {
		// The frozen modules import one another. Nothing outside that set may
		// import any of them, or the Plugins view, the Plugin Library, and the
		// catalog fetch would register again.
		const frozenModules = [
			'basehalfPluginCatalogService.js',
			'basehalfPluginManagementService.js',
			'basehalfPluginManager.contribution.js',
			'basehalfPluginsView.js',
			'basehalfPluginLibrary.js',
			'basehalfPluginRuntimeAction.js',
			'basehalfPluginStateStore.js'
		];
		const compiledRoot = FileAccess.asFileUri('').fsPath;
		const importers: string[] = [];
		for (const entry of readdirSync(join(compiledRoot, 'vs'), { recursive: true, encoding: 'utf8' })) {
			const segments = entry.split(sep);
			const fileName = segments[segments.length - 1];
			if (!fileName.endsWith('.js') || segments.includes('test') || frozenModules.includes(fileName)) {
				continue;
			}
			const compiledModule = readFileSync(join(compiledRoot, 'vs', entry), 'utf8');
			if (!compiledModule.includes('basehalfPlugin')) {
				continue;
			}
			for (const specifier of importSpecifiers(compiledModule)) {
				if (frozenModules.some(frozenModule => specifier.endsWith(`/${frozenModule}`))) {
					importers.push(`${segments.join('/')} imports ${specifier}`);
				}
			}
		}
		assert.deepStrictEqual(importers, []);

		const desktopMain = readCompiledModule('vs/workbench/workbench.desktop.main.js');
		assert.ok(desktopMain.includes('basehalfPluginPlatform.contribution.js'));
		assert.deepStrictEqual(importSpecifiers(readCompiledModule('vs/workbench/basehalf/electron-browser/basehalfPluginPlatform.contribution.js')), [
			'./basehalfModelCredentialStore.js'
		]);
	});

	test('keeps frozen plugin management registered by its desktop module, not by the common one', () => {
		const common = readCompiledModule('vs/workbench/basehalf/common/basehalfPluginManagementService.js');
		const desktop = readCompiledModule('vs/workbench/basehalf/electron-browser/basehalfPluginManagementService.js');

		assert.deepStrictEqual({
			commonRegisters: common.includes('registerSingleton'),
			commonNamesDesktopEnvironment: common.includes('INativeEnvironmentService'),
			desktopRegisters: desktop.includes('registerSingleton')
		}, {
			commonRegisters: false,
			commonNamesDesktopEnvironment: false,
			desktopRegisters: true
		});
	});

	test('names neither the plugin registry nor the publishing portal in the product configuration', () => {
		const productConfiguration = readFileSync(joinPath(FileAccess.asFileUri(''), '..', 'product.json').fsPath, 'utf8');

		assert.deepStrictEqual({
			namesRegistry: productConfiguration.includes('registry.basehalf.com'),
			namesPortal: productConfiguration.includes('plugins.basehalf.com'),
			hasPluginCatalogBlock: Object.keys(JSON.parse(productConfiguration)).includes('basehalfPlugins')
		}, {
			namesRegistry: false,
			namesPortal: false,
			hasPluginCatalogBlock: false
		});
	});

	test('keeps the common state-store module free of desktop process services', () => {
		const commonStateStore = readCompiledModule('vs/workbench/basehalf/common/basehalfPluginStateStore.js');
		assert.ok(!commonStateStore.includes('mainProcessService'));
		assert.ok(!commonStateStore.includes('registerSingleton'));
	});
});

function readCompiledModule(path: AppResourcePath): string {
	return readFileSync(FileAccess.asFileUri(path).fsPath, 'utf8');
}

/** Every static, side-effect, and dynamic import specifier of a compiled module. */
function importSpecifiers(compiledModule: string): string[] {
	return [...compiledModule.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](?<specifier>[^'"]+)['"]/g)].map(match => match.groups?.specifier ?? '');
}
