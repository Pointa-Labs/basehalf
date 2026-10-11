/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import process from 'process';

// Checks the packaged layout that built-in AI Video needs: it ships with the
// built-in extensions, there is no separate plugin payload folder, and the
// product configuration names neither the plugin registry nor the portal.
const appArgument = process.argv.indexOf('--app');
if (appArgument < 0 || !process.argv[appArgument + 1]) {
	throw new Error('Usage: npm run basehalf:plugin:layout-smoke -- --app <BaseHalf.app or resources/app path>');
}

const input = path.resolve(process.argv[appArgument + 1]);
const appRoot = input.endsWith('.app') ? path.join(input, 'Contents', 'Resources', 'app') : input;
const builtInExtension = path.join(appRoot, 'extensions', 'basehalf-ai-video');
const pluginPayloads = path.join(appRoot, 'plugins');
assert.equal(fs.existsSync(path.join(builtInExtension, 'package.json')), true, `AI Video is missing from the built-in extensions at ${builtInExtension}`);
assert.equal(fs.existsSync(path.join(builtInExtension, 'out', 'extension.js')), true, 'The built-in AI Video is not compiled.');
assert.equal(fs.existsSync(pluginPayloads), false, `The retired plugin payload folder is still packaged at ${pluginPayloads}`);
const manifest = JSON.parse(fs.readFileSync(path.join(builtInExtension, 'package.json'), 'utf8'));
assert.equal(`${manifest.publisher}.${manifest.name}`.toLowerCase(), 'pointa.basehalf-ai-video');
assert.equal(manifest.engines.basehalf, '^0.4.0');
assert.equal(manifest.enabledApiProposals, undefined, 'Stable BaseHalf APIs must not require a proposed API opt-in.');
const productConfiguration = fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8');
assert.equal(productConfiguration.includes('registry.basehalf.com'), false, 'The packaged product configuration names the plugin registry.');
assert.equal(productConfiguration.includes('plugins.basehalf.com'), false, 'The packaged product configuration names the publishing portal.');
assert.equal('basehalfPlugins' in JSON.parse(productConfiguration), false, 'The packaged product configuration still has a plugin catalog block.');
console.log(JSON.stringify({ ok: true, appRoot, builtInExtension: 'extensions/basehalf-ai-video', pluginPayloadFolderAbsent: true, namesNoRegistryOrPortal: true }));
