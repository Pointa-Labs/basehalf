/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Linter } from 'eslint';
import { suite, test } from 'node:test';
import rule from '../../../.eslint-plugin-local/code-basehalf-folder-order.ts';

// The order of BaseHalf's folders in each layer (docs/harness/code-organization.md, D124).
const OPTIONS = {
	root: 'src/vs/workbench/basehalf',
	layers: ['common', 'browser', 'electron-browser'],
	order: {
		common: ['workspace', 'cardDetail', 'canvas', 'canvasContrib/*'],
		browser: ['workspace', 'canvas', 'cardDetail', 'canvasContrib/*'],
		'electron-browser': ['workspace', 'canvas', 'cardDetail', 'canvasContrib/*']
	}
};
const ROOT = '/repo/vscode-base/src/vs/workbench/basehalf';

function lint(file: string, specifier: string): string[] {
	const linter = new Linter({ configType: 'flat', cwd: '/repo/vscode-base' });
	const config: Linter.Config[] = [{
		files: ['**/*.ts'],
		plugins: { local: { rules: { 'code-basehalf-folder-order': rule } } },
		rules: { 'local/code-basehalf-folder-order': ['error', OPTIONS] }
	}];
	return linter.verify(`import { x } from '${specifier}';\nexport const y = x;\n`, config, { filename: file.startsWith('/') ? file : `${ROOT}/${file}` }).map(message => message.message);
}

suite('code-basehalf-folder-order', () => {

	test('a folder imports, in its layer, the folders before it', () => {
		assert.deepStrictEqual(lint('canvas/common/a.ts', '../../workspace/common/b.js'), []);
		assert.deepStrictEqual(lint('canvas/common/a.ts', '../../cardDetail/common/b.js'), []);
	});

	test('a folder does not import, in its layer, a folder after it', () => {
		const messages = lint('cardDetail/common/a.ts', '../../canvas/common/b.js');
		assert.strictEqual(messages.length, 1);
		assert.match(messages[0], /cardDetail\/common may not import canvas\/common/);
	});

	test('each layer has an order of its own', () => {
		// cardDetail comes after canvas among the views, and before it among the models.
		assert.deepStrictEqual(lint('cardDetail/browser/a.ts', '../../canvas/browser/b.js'), []);
		assert.strictEqual(lint('canvas/browser/a.ts', '../../cardDetail/browser/b.js').length, 1);
	});

	test('a folder imports the lower layers of any folder', () => {
		assert.deepStrictEqual(lint('workspace/browser/a.ts', '../../canvas/common/b.js'), []);
		assert.deepStrictEqual(lint('workspace/electron-browser/a.ts', '../../canvas/browser/b.js'), []);
	});

	test('what a folder imports of itself is not its to check', () => {
		assert.deepStrictEqual(lint('canvas/common/a.ts', './b.js'), []);
		assert.deepStrictEqual(lint('canvas/browser/view/a.ts', '../../common/b.js'), []);
	});

	test('a feature of the canvas imports no other feature of the canvas', () => {
		assert.deepStrictEqual(lint('canvasContrib/zoom/browser/a.ts', '../../../canvas/browser/b.js'), []);
		const messages = lint('canvasContrib/zoom/browser/a.ts', '../../snap/browser/b.js');
		assert.strictEqual(messages.length, 1);
		assert.match(messages[0], /canvasContrib\/zoom imports canvasContrib\/snap/);
	});

	test('a folder that is in no order is reported', () => {
		const messages = lint('newFolder/common/a.ts', '../../workspace/common/b.js');
		assert.strictEqual(messages.length, 1);
		assert.match(messages[0], /newFolder is not in the order of the common layer/);
	});

	test('tests are not bound by the order', () => {
		assert.deepStrictEqual(lint('workspace/test/common/a.test.ts', '../../../canvas/common/b.js'), []);
	});

	test('files outside BaseHalf and packages are not checked', () => {
		assert.deepStrictEqual(lint('/repo/vscode-base/src/vs/workbench/contrib/files/browser/a.ts', '../../../basehalf/canvas/browser/b.js'), []);
		assert.deepStrictEqual(lint('workspace/common/a.ts', 'vs/base/common/uri.js'), []);
	});
});
