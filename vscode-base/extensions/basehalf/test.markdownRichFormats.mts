/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Rich's bundle test: the editor of a note in Card Detail, with its real
// schema, reader, writer, and undo, in a headless browser. The page and its
// parts are in test/markdownRichFormats.entry.ts; this runner bundles it in
// memory, serves it from an address of its own, gives the parts real keys and
// pointer events, and asserts their checks.
//
//   node test.markdownRichFormats.mts [--part <name>]... [--verbose]
//
// --part runs the named parts only; --verbose prints all that the page logs.
// BASEHALF_FORMATS_BASELINE=1 runs the parts on BlockNote's own reader and
// writer and without D110's extensions, as Rich ran before D110.

import assert from 'node:assert/strict';
import path from 'node:path';

import { chromium, type Page } from '@playwright/test';
import { build } from '../node_modules/esbuild/lib/main.js';

interface IPartResult {
	readonly checks: readonly { readonly name: string; readonly actual: unknown; readonly expected: unknown }[];
	readonly logs: readonly { readonly name: string; readonly value: unknown }[];
	readonly error?: string;
	readonly milliseconds: number;
}

interface IPageApi {
	readonly baseHalfFormats: {
		readonly parts: readonly string[];
		run(name: string, mode: string): Promise<IPartResult>;
	};
}

const USAGE = 'Usage: node test.markdownRichFormats.mts [--part <name>]... [--verbose]';
const started = performance.now();
const ORIGIN = 'http://basehalf.test';
const PART_TIMEOUT_MS = 120_000;
const entryPath = path.join(import.meta.dirname, 'test', 'markdownRichFormats.entry.ts');
// Where the bundle's files would be: nothing is written there, they are served from memory.
const outdir = path.join(import.meta.dirname, 'test', 'markdownRichFormats.out');
const mode = process.env.BASEHALF_FORMATS_BASELINE === '1' ? 'baseline' : 'basehalf';
const options = optionsFromArguments(process.argv.slice(2));

function optionsFromArguments(args: readonly string[]): { readonly parts?: readonly string[]; readonly verbose: boolean } {
	const parts: string[] = [];
	let verbose = false;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--part' && index + 1 < args.length) {
			parts.push(args[++index]);
		} else if (args[index] === '--verbose') {
			verbose = true;
		} else {
			console.error(`Unknown argument "${args[index]}". ${USAGE}`);
			process.exit(2);
		}
	}
	return { ...(parts.length > 0 ? { parts } : {}), verbose };
}

// Built as esbuild.markdownRich.mts and esbuild-webview-common.mts build Rich,
// not minified, and with React in its production build, as there.
const bundle = await build({
	entryPoints: [entryPath],
	outdir,
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'browser',
	target: ['es2024'],
	conditions: ['style', 'browser', 'module', 'default'],
	loader: {
		'.woff': 'file',
		'.woff2': 'file',
		'.ttf': 'file',
		'.eot': 'file',
		'.svg': 'file',
	},
	assetNames: '[name]-[hash]',
	logOverride: { 'import-is-undefined': 'error' },
	define: { 'process.env.NODE_ENV': '"production"' },
	logLevel: 'silent',
});
const bundled = performance.now();
const files = new Map<string, Uint8Array>(bundle.outputFiles.map(file => [`/${path.relative(outdir, file.path).split(path.sep).join('/')}`, file.contents]));
files.set('/index.html', Buffer.from(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/markdownRichFormats.entry.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/markdownRichFormats.entry.js"></script>
</body>
</html>
`));

const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.svg': 'image/svg+xml',
};

const INPUT_METHODS: Record<string, readonly string[]> = {
	keyboard: ['type', 'press', 'down', 'up'],
	mouse: ['click', 'move', 'down', 'up'],
};

/** Runs one step of input that a part asks for, with the browser's own events. */
async function input(page: Page, step: { readonly device: string; readonly method: string; readonly args: readonly unknown[] }): Promise<void> {
	if (!INPUT_METHODS[step.device]?.includes(step.method)) {
		throw new Error(`There is no input ${step.device}.${step.method}.`);
	}
	const device = step.device === 'keyboard' ? page.keyboard : page.mouse;
	await Reflect.apply(device[step.method as keyof typeof device] as (...args: unknown[]) => Promise<void>, device, [...step.args]);
}

let passed = 0;
const failures: string[] = [];
const fail = (message: string) => {
	failures.push(message);
	console.log(`FAIL ${message}`);
};

const browser = await chromium.launch();
const browserVersion = browser.version();
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
	// What the page reports while a part runs: an uncaught error or a console
	// error fails that part. The pictures, videos, and sounds of a note are not
	// served, and the browser's report that one did not load is no error of a part.
	let problems: string[] = [];
	page.on('pageerror', error => problems.push(`page error: ${error.stack ?? error.message}`));
	page.on('console', message => {
		const address = message.location().url;
		if (options.verbose) {
			console.log(`     page console ${message.type()}: ${message.text()}${address ? ` (${address})` : ''}`);
		}
		const unserved = message.text().startsWith('Failed to load resource') && !(address.startsWith(`${ORIGIN}/`) && files.has(new URL(address).pathname));
		if (message.type() === 'error' && !unserved) {
			problems.push(`console error: ${message.text()}`);
		}
	});
	// The test never reaches the network: the bundle is served from memory, and anything else is not found.
	await page.route('**/*', route => {
		const url = new URL(route.request().url());
		const body = url.origin === ORIGIN ? files.get(url.pathname) : undefined;
		return body
			? route.fulfill({ body: Buffer.from(body), contentType: CONTENT_TYPES[path.extname(url.pathname)] ?? 'application/octet-stream' })
			: route.fulfill({ status: 404, body: '' });
	});
	await page.exposeFunction('baseHalfFormatsInput', (step: Parameters<typeof input>[1]) => input(page, step));
	await page.goto(`${ORIGIN}/index.html`);
	await page.waitForFunction(() => 'baseHalfFormats' in globalThis, undefined, { timeout: 15_000 }).catch((error: Error) => {
		throw new Error(`The page did not start.\n${problems.join('\n') || error.message}`);
	});
	if (problems.length > 0) {
		fail(`the page did not load cleanly:\n${problems.join('\n')}`);
	}
	const available = await page.evaluate(() => (globalThis as unknown as IPageApi).baseHalfFormats.parts);
	for (const name of options.parts ?? available) {
		problems = [];
		let timer: ReturnType<typeof setTimeout> | undefined;
		const result = await Promise.race([
			page.evaluate(([part, partMode]) => (globalThis as unknown as IPageApi).baseHalfFormats.run(part, partMode), [name, mode] as const),
			new Promise<undefined>(resolve => timer = setTimeout(() => resolve(undefined), PART_TIMEOUT_MS)),
		]);
		clearTimeout(timer);
		if (!result) {
			fail(`part ${name}: did not finish within ${PART_TIMEOUT_MS / 1000} s`);
			break;
		}
		for (const check of result.checks) {
			try {
				assert.deepStrictEqual(check.actual, check.expected);
				passed++;
				console.log(`ok   part ${name}: ${check.name}`);
			} catch (error) {
				fail(`part ${name}: ${check.name}\n${(error as Error).message}`);
			}
		}
		for (const log of result.logs) {
			console.log(`     part ${name}: ${log.name}: ${JSON.stringify(log.value)}`);
		}
		if (result.error) {
			fail(`part ${name}: ${result.error}`);
		}
		if (problems.length > 0) {
			fail(`part ${name}: the page reported\n${problems.join('\n')}`);
		}
		console.log(`     part ${name}: ${result.checks.length} checks in ${result.milliseconds} ms`);
	}
} finally {
	await browser.close();
}

const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)} s`;
console.log(`Rich bundle test (${mode}, Chromium ${browserVersion}): ${passed} checks passed, ${failures.length} failed; bundle ${seconds(bundled - started)}, total ${seconds(performance.now() - started)}.`);
if (failures.length > 0) {
	process.exitCode = 1;
}
