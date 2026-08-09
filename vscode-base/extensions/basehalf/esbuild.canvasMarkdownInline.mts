/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'canvas-markdown-inline-src');
const outDir = path.join(import.meta.dirname, 'canvas-markdown-inline-out');

run({
	entryPoints: [
		path.join(srcDir, 'canvasMarkdownInline.ts'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['browser', 'module', 'default'],
		legalComments: 'eof',
	},
}, process.argv);
