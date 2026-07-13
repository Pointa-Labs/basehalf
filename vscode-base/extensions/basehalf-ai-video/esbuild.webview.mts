/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'webview-src');
const outDir = path.join(import.meta.dirname, 'dist');

run({
	entryPoints: [path.join(srcDir, 'main.tsx')],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['browser', 'module', 'default'],
		define: { 'process.env.NODE_ENV': '"production"' },
		legalComments: 'eof'
	}
}, process.argv);
