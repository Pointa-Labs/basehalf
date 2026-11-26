/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'canvas-react-vendor-src');
const outDir = path.join(import.meta.dirname, 'canvas-react-vendor-out');

run({
	entryPoints: [
		path.join(srcDir, 'canvasReactVendor.ts'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['browser', 'module', 'default'],
		define: {
			'process.env.NODE_ENV': '"production"',
		},
		legalComments: 'eof',
	},
}, process.argv);
