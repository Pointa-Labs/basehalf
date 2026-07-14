/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExpectedWorkbenchEntrypoint } from './preLaunch.ts';

test('accepts the ESM desktop workbench entrypoint', () => {
	assert.equal(isExpectedWorkbenchEntrypoint('import "./workbench.common.main.js";\nexport { main };'), true);
});

test('rejects CommonJS and incomplete desktop workbench entrypoints', () => {
	assert.equal(isExpectedWorkbenchEntrypoint('Object.defineProperty(exports, "__esModule", { value: true });\nrequire("./workbench.common.main.js");'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('import "./workbench.common.main.js";\nexports.main = main;'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('import "./workbench.common.main.js";\nmodule.exports = { main };'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('export { main };'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('// import "./workbench.common.main.js";\nexport { main };'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('/* import "./workbench.common.main.js"; */\nexport { main };'), false);
	assert.equal(isExpectedWorkbenchEntrypoint('/*\nimport "./workbench.common.main.js";\n*/\nexport { main };'), false);
});
