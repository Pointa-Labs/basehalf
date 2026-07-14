/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { promises as fs } from 'fs';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'content-viewer-src');
const outDir = path.join(import.meta.dirname, 'content-viewer-out');

run({
	entryPoints: [
		path.join(srcDir, 'pdfViewer.ts'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['browser', 'module', 'default'],
		legalComments: 'eof',
	},
}, process.argv, async outputDirectory => {
	// EmbedPDF's PDFium engine is intentionally self-hosted. Card Detail must
	// remain useful offline and must never send a user's document or font
	// requests to a third-party CDN.
	await fs.mkdir(outputDirectory, { recursive: true });
	await fs.copyFile(
		path.join(import.meta.dirname, '..', '..', 'node_modules', '@embedpdf', 'snippet', 'dist', 'pdfium.wasm'),
		path.join(outputDirectory, 'pdfium.wasm')
	);
	await fs.copyFile(
		path.join(import.meta.dirname, '..', '..', 'node_modules', '@embedpdf', 'fonts-sc', 'fonts', 'NotoSansHans-Regular.otf'),
		path.join(outputDirectory, 'NotoSansHans-Regular.otf')
	);
	await fs.copyFile(
		path.join(import.meta.dirname, '..', '..', 'node_modules', '@embedpdf', 'fonts-sc', 'LICENSE'),
		path.join(outputDirectory, 'NotoSansHans-LICENSE.txt')
	);
	await fs.rm(path.join(outputDirectory, 'pdfWorker.js'), { force: true });
});
