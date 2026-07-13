/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import process from 'process';

const appArgument = process.argv.indexOf('--app');
if (appArgument < 0 || !process.argv[appArgument + 1]) {
	throw new Error('Usage: npm run basehalf:plugin:layout-smoke -- --app <BaseHalf.app or resources/app path>');
}

const input = path.resolve(process.argv[appArgument + 1]);
const appRoot = input.endsWith('.app') ? path.join(input, 'Contents', 'Resources', 'app') : input;
const plugin = path.join(appRoot, 'plugins', 'basehalf-ai-video');
const systemExtension = path.join(appRoot, 'extensions', 'basehalf-ai-video');
assert.equal(fs.existsSync(path.join(plugin, 'package.json')), true, `Missing on-demand AI Video payload at ${plugin}`);
assert.equal(fs.existsSync(path.join(plugin, 'out', 'extension.js')), true, 'AI Video payload is not compiled.');
assert.equal(fs.existsSync(systemExtension), false, 'AI Video was incorrectly packaged as a pre-scanned system extension.');
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'), 'utf8'));
assert.equal(`${manifest.publisher}.${manifest.name}`.toLowerCase(), 'pointa.basehalf-ai-video');
assert.deepStrictEqual(manifest.enabledApiProposals, ['basehalfDomainPlugins']);
console.log(JSON.stringify({ ok: true, appRoot, plugin: 'plugins/basehalf-ai-video', systemExtensionAbsent: true }));
