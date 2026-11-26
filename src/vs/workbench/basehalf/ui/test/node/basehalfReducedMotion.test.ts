/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from '../../../../../base/common/path.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('BaseHalf: reduced motion follows the setting', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('nothing of BaseHalf asks the system whether motion is reduced', () => {
		// `workbench.reduceMotion` decides, and the system's preference is only its value `auto`. The window asks
		// `IAccessibilityService.isMotionReduced()` or styles under `.monaco-reduce-motion`, a page under
		// `.vscode-reduce-motion` (architecture invariants, "Product shell"). A media query or a `matchMedia` of
		// the system's preference would ignore the setting's `on` and `off`. The sources are read, not the output.
		const repository = join(FileAccess.asFileUri('').fsPath, '..');
		const roots = [
			join(repository, 'src', 'vs', 'workbench', 'basehalf'),
			...readdirSync(join(repository, 'src', 'vs', 'platform'), { encoding: 'utf8' }).filter(name => name.startsWith('basehalf')).map(name => join(repository, 'src', 'vs', 'platform', name)),
			...readdirSync(join(repository, 'extensions', 'basehalf'), { encoding: 'utf8' }).filter(name => name.endsWith('-src')).map(name => join(repository, 'extensions', 'basehalf', name))
		];
		const asking: string[] = [];
		let read = 0;
		for (const root of roots) {
			for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
				const path = entry.split(sep).join('/');
				if (!/\.(ts|tsx|css|html)$/.test(path) || /(^|\/)test\//.test(path) || /(^|\/)node_modules\//.test(path)) {
					continue;
				}
				read++;
				if (readFileSync(join(root, entry), 'utf8').includes('prefers-reduced-motion')) {
					asking.push(path);
				}
			}
		}
		assert.deepStrictEqual({ read: read > 500, asking }, { read: true, asking: [] });
	});
});
