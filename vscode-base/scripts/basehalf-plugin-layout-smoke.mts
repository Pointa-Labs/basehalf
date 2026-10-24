/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import process from 'process';

// Checks the packaged layout of AI Video as BaseHalf's own code (D75): no AI
// Video extension among the built-in extensions, no separate plugin payload
// folder, and a product configuration that names neither the plugin registry
// nor the portal.
const appArgument = process.argv.indexOf('--app');
if (appArgument < 0 || !process.argv[appArgument + 1]) {
	throw new Error('Usage: npm run basehalf:plugin:layout-smoke -- --app <BaseHalf.app or resources/app path>');
}

const input = path.resolve(process.argv[appArgument + 1]);
const appRoot = input.endsWith('.app') ? path.join(input, 'Contents', 'Resources', 'app') : input;
const retiredExtension = path.join(appRoot, 'extensions', 'basehalf-ai-video');
const pluginPayloads = path.join(appRoot, 'plugins');
assert.equal(fs.existsSync(retiredExtension), false, `The retired AI Video extension is still packaged at ${retiredExtension}`);
assert.equal(fs.existsSync(pluginPayloads), false, `The retired plugin payload folder is still packaged at ${pluginPayloads}`);
const productConfiguration = fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8');
assert.equal(productConfiguration.includes('registry.basehalf.com'), false, 'The packaged product configuration names the plugin registry.');
assert.equal(productConfiguration.includes('plugins.basehalf.com'), false, 'The packaged product configuration names the publishing portal.');
assert.equal('basehalfPlugins' in JSON.parse(productConfiguration), false, 'The packaged product configuration still has a plugin catalog block.');
console.log(JSON.stringify({ ok: true, appRoot, aiVideoExtensionAbsent: true, pluginPayloadFolderAbsent: true, namesNoRegistryOrPortal: true }));
