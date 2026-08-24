/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { AppResourcePath, FileAccess } from '../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalfPluginPlatformBoundary', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('loads plugin management only in the desktop workbench', () => {
		const commonMain = readCompiledModule('vs/workbench/workbench.common.main.js');
		const desktopMain = readCompiledModule('vs/workbench/workbench.desktop.main.js');
		const desktopPluginPlatform = readCompiledModule('vs/workbench/basehalf/electron-browser/basehalfPluginPlatform.contribution.js');

		for (const moduleName of [
			'basehalfPluginCatalogService.js',
			'basehalfPluginManagementService.js',
			'basehalfPluginManager.contribution.js',
			'basehalfPluginsView.js'
		]) {
			assert.ok(!commonMain.includes(moduleName), `${moduleName} must not load in the common workbench`);
			assert.ok(desktopPluginPlatform.includes(moduleName), `${moduleName} must load through the desktop plugin platform`);
		}

		assert.ok(desktopMain.includes('basehalfPluginPlatform.contribution.js'));
		assert.ok(desktopPluginPlatform.includes('basehalfPluginStateStore.js'));
		assert.ok(desktopPluginPlatform.includes('basehalfModelCredentialStore.js'));
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
