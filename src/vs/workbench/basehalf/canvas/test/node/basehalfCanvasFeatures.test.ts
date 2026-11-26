/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from '../../../../../base/common/path.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('BaseHalf canvas features', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('basehalfCanvas.all loads the contribution of every canvas feature', () => {
		// A feature that nothing loads registers no command and draws no control, and its own tests, which load
		// it themselves, stay green. The sources are read, since compiled files of a removed feature may remain.
		const root = join(FileAccess.asFileUri('').fsPath, '..', 'src', 'vs', 'workbench', 'basehalf');
		const loader = readFileSync(join(root, 'canvas', 'basehalfCanvas.all.ts'), 'utf8');
		const contributions = readdirSync(join(root, 'canvasContrib'), { recursive: true, encoding: 'utf8' })
			.map(entry => entry.split(sep).join('/'))
			.filter(entry => /^[^/]+\/browser\/[^/]+\.contribution\.ts$/.test(entry))
			.sort();
		assert.deepStrictEqual({
			features: contributions.length > 0,
			notLoaded: contributions.filter(entry => !loader.includes(`import '../canvasContrib/${entry.replace(/\.ts$/, '.js')}';`))
		}, { features: true, notLoaded: [] });
	});
});
