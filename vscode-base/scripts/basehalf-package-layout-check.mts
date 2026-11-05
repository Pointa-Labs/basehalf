/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { BASEHALF_PACKAGED_EXTENSION_IDS } from '../src/vs/workbench/basehalf/shell/common/basehalfBuiltInExtensions.ts';

// Checks a packaged build: it holds what BaseHalf runs and nothing else (D122), no AI Video
// extension and no plugin payload folder (D75, D76), and a product configuration that names
// neither the plugin registry nor the portal. The packaging script runs it before it makes
// an archive.
const appArgument = process.argv.indexOf('--app');
if (appArgument < 0 || !process.argv[appArgument + 1]) {
	throw new Error('Usage: npm run basehalf:package:layout-check -- --app <BaseHalf.app or resources/app path>');
}

const input = path.resolve(process.argv[appArgument + 1]);
const appRoot = input.endsWith('.app') ? path.join(input, 'Contents', 'Resources', 'app') : input;
const inApp = (...segments: string[]) => path.join(appRoot, ...segments);
const repositoryRoot = path.dirname(import.meta.dirname);

assert.equal(fs.existsSync(inApp('extensions', 'basehalf-ai-video')), false, 'The retired AI Video extension is still packaged.');
assert.equal(fs.existsSync(inApp('plugins')), false, 'The retired plugin payload folder is still packaged.');
const productConfiguration = fs.readFileSync(inApp('product.json'), 'utf8');
assert.equal(productConfiguration.includes('registry.basehalf.com'), false, 'The packaged product configuration names the plugin registry.');
assert.equal(productConfiguration.includes('plugins.basehalf.com'), false, 'The packaged product configuration names the publishing portal.');
assert.equal('basehalfPlugins' in JSON.parse(productConfiguration), false, 'The packaged product configuration still has a plugin catalog block.');
// One click installs an agent extension (D122): no question about these publishers.
assert.deepEqual(JSON.parse(productConfiguration).trustedExtensionPublishers, ['anthropic', 'openai'], 'The packaged product configuration does not name the publishers of the agent extensions.');

// No source map ships, whichever part of the package it would come from.
const sourceMaps: string[] = [];
let files = 0;
const walk = (folder: string) => {
	for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
		const entryPath = path.join(folder, entry.name);
		if (entry.isDirectory()) {
			walk(entryPath);
		} else {
			files++;
			if (entry.name.endsWith('.map')) {
				sourceMaps.push(path.relative(appRoot, entryPath));
			}
		}
	}
};
walk(appRoot);
assert.deepEqual(sourceMaps.slice(0, 5), [], `${sourceMaps.length} source maps are packaged.`);

// What runs is what ships, both ways.
const packagedExtensions = new Set<string>();
for (const entry of fs.readdirSync(inApp('extensions'), { withFileTypes: true })) {
	if (!entry.isDirectory()) {
		continue;
	}
	assert.notEqual(entry.name, 'node_modules', 'extensions/node_modules is packaged. The extensions that run have bundled what they need.');
	const manifestPath = inApp('extensions', entry.name, 'package.json');
	assert.ok(fs.existsSync(manifestPath), `extensions/${entry.name} is packaged without a manifest: a build of its media went past the list.`);
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
	assert.ok(BASEHALF_PACKAGED_EXTENSION_IDS.has(id), `extensions/${entry.name} (${id}) is packaged and is not on the allowlist.`);
	packagedExtensions.add(id);
}
for (const id of BASEHALF_PACKAGED_EXTENSION_IDS) {
	assert.ok(packagedExtensions.has(id), `${id} is on the allowlist and is not packaged.`);
}

// Only declared npm packages ship. The list is the production closure of the lockfile.
interface ILockEntry {
	readonly dependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
}
const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8')).packages as Record<string, ILockEntry>;
const resolveInLock = (from: string, name: string): string | undefined => {
	let folder = from;
	for (; ;) {
		const candidate = `${folder ? `${folder}/` : ''}node_modules/${name}`;
		if (lock[candidate]) {
			return candidate;
		}
		if (!folder) {
			return undefined;
		}
		const nested = folder.lastIndexOf('/node_modules/');
		folder = nested >= 0 ? folder.slice(0, nested) : '';
	}
};
const declared = new Set<string>();
const pending = [''];
while (pending.length) {
	const from = pending.pop()!;
	const entry = lock[from];
	for (const name of [...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {}), ...Object.keys(entry.peerDependencies ?? {})]) {
		const resolved = resolveInLock(from, name);
		if (resolved && !declared.has(resolved)) {
			declared.add(resolved);
			pending.push(resolved);
		}
	}
}
const packagedModules: string[] = [];
for (const entry of fs.readdirSync(inApp('node_modules'), { withFileTypes: true })) {
	if (entry.name.startsWith('.') || !entry.isDirectory()) {
		continue;
	}
	if (entry.name.startsWith('@')) {
		for (const scoped of fs.readdirSync(inApp('node_modules', entry.name))) {
			packagedModules.push(`${entry.name}/${scoped}`);
		}
	} else {
		packagedModules.push(entry.name);
	}
}
for (const name of packagedModules) {
	assert.ok(declared.has(`node_modules/${name}`), `node_modules/${name} is packaged and nothing declares it.`);
}

// What the specification names, also if someone declares it again.
const mustNotShip = /^(@embedpdf\/|@github\/copilot|@microsoft\/mxc-sdk$|@microsoft\/dev-tunnels-|@vscode\/copilot-api$|@vscode\/sandbox-runtime$|@vscode\/vsce$|@vscode\/vsce-sign|playwright-core$|@anthropic-ai\/sdk$|yjs$|lib0$)/;
for (const name of packagedModules) {
	assert.equal(mustNotShip.test(name), false, `node_modules/${name} must not ship (D122).`);
}

const prebuilds = fs.readdirSync(inApp('node_modules', 'node-pty', 'prebuilds')).filter(name => !name.startsWith('.'));
assert.equal(prebuilds.length, 1, `node-pty ships the programs of ${prebuilds.join(', ')}. It should ship the package's own.`);

assert.equal(fs.existsSync(inApp('out', 'vs', 'sessions')), false, 'The Agents window is packaged.');

// What was taken away has not gone too far: what really runs is there.
for (const required of [
	'extensions/basehalf/content-viewer-out/pdfViewer.js',
	'extensions/basehalf/content-viewer-out/pdfium.wasm',
	'extensions/basehalf/content-viewer-out/NotoSansHans-Regular.otf',
	'extensions/basehalf/content-viewer-out/NotoSansHans-LICENSE.txt',
	'extensions/basehalf/content-viewer-out/pdfViewerNotices.txt',
	'extensions/basehalf/content-viewer-out/bookReaderNotices.txt',
	'extensions/git/dist/main.js',
	'extensions/github-authentication/dist/extension.js',
	'node_modules/@vscode/ripgrep-universal/package.json',
	'node_modules/@vscode/spdlog/package.json',
	'node_modules/@vscode/sqlite3/package.json',
	'node_modules/@xterm/xterm/package.json',
	'out/vs/workbench/workbench.desktop.main.js',
	'out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js',
	'out/vs/platform/terminal/node/ptyHostMain.js',
]) {
	assert.ok(fs.existsSync(inApp(...required.split('/'))), `${required} is not packaged.`);
}

console.log(JSON.stringify({ ok: true, appRoot, files, extensions: packagedExtensions.size, npmPackages: packagedModules.length, nodePtyPrebuilds: prebuilds, sourceMaps: 0 }));
