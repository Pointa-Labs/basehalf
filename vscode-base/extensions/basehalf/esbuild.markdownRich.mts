/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'markdown-rich-src');
const outDir = path.join(import.meta.dirname, 'markdown-rich-out');

run({
	entryPoints: [
		path.join(srcDir, 'editor.tsx'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['style', 'browser', 'module', 'default'],
		loader: {
			'.woff': 'file',
			'.woff2': 'file',
			'.ttf': 'file',
			'.eot': 'file',
			'.svg': 'file',
		},
		assetNames: '[name]-[hash]',
	},
}, process.argv);
