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
		// The window's worker that draws the first page of a PDF for its card.
		path.join(srcDir, 'pdfCoverWorker.ts'),
		// The book reader of Card Detail (PDFs and books, "The book reader").
		path.join(srcDir, 'bookReader.ts'),
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		conditions: ['browser', 'module', 'default'],
		legalComments: 'eof',
		plugins: [{
			// The book reader never shows a PDF, which the PDF reader shows: the
			// PDF.js that foliate-js loads for one stays out of the bundle.
			name: 'basehalf-book-reader-without-pdf',
			setup(build) {
				build.onResolve({ filter: /^\.\/pdf\.js$/ }, args => args.importer.includes(`${path.sep}foliate-js${path.sep}`)
					? { path: 'foliate-js-pdf', namespace: 'basehalf-without-pdf' }
					: undefined);
				build.onLoad({ filter: /.*/, namespace: 'basehalf-without-pdf' }, () => ({
					contents: 'export const makePDF = () => { throw new Error("A PDF opens in the PDF reader."); };',
					loader: 'js'
				}));
			}
		}],
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
	// foliate-js and the zip.js and fflate it carries have no license comment
	// for the bundle to keep: their notices go beside it.
	await fs.copyFile(
		path.join(srcDir, 'bookReaderNotices.txt'),
		path.join(outputDirectory, 'bookReaderNotices.txt')
	);
	await fs.rm(path.join(outputDirectory, 'pdfWorker.js'), { force: true });
});
