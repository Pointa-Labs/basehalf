/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from '../../../../../base/common/path.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('BaseHalf without plugins (D76)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('no compiled module calls a provider command of the AI Video extension (D75)', () => {
		// The window calls the provider service of the shared process directly.
		const command = /basehalf\.video\.provider\.(?:catalog|check|submit|poll|download|cancel|place)\b/;
		const compiledRoot = FileAccess.asFileUri('').fsPath;
		const callers: string[] = [];
		for (const entry of readdirSync(join(compiledRoot, 'vs'), { recursive: true, encoding: 'utf8' })) {
			const segments = entry.split(sep);
			if (entry.endsWith('.js') && !segments.includes('test') && command.test(readFileSync(join(compiledRoot, 'vs', entry), 'utf8'))) {
				callers.push(segments.join('/'));
			}
		}
		assert.deepStrictEqual(callers, []);
	});

	test('names neither the plugin registry nor the publishing portal in the product configuration', () => {
		const productConfiguration = readFileSync(joinPath(FileAccess.asFileUri(''), '..', 'product.json').fsPath, 'utf8');
		const product = JSON.parse(productConfiguration);

		assert.deepStrictEqual({
			namesRegistry: productConfiguration.includes('registry.basehalf.com'),
			namesPortal: productConfiguration.includes('plugins.basehalf.com'),
			hasPluginCatalogBlock: Object.keys(product).includes('basehalfPlugins'),
			hasAdditionalControls: Object.keys(product.extensionsGallery ?? {}).includes('additionalControlUrls')
		}, {
			namesRegistry: false,
			namesPortal: false,
			hasPluginCatalogBlock: false,
			hasAdditionalControls: false
		});
	});
});
