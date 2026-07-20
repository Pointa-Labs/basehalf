/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { combineUriFlags, getBaseHalfExtensionMutationError } from '../../node/cliArgs.js';

suite('combineUriFlags', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('rewrites --folder-uri and --file-uri followed by a URI into --flag=value', () => {
		assert.deepStrictEqual(
			combineUriFlags([
				'--wait',
				'--folder-uri', 'vscode-remote://ssh-remote+host/workspace',
				'--file-uri', 'vscode-remote://ssh-remote+host/file.txt',
				'--new-window',
				'--folder-uri=vscode-remote://already-joined/workspace',
				'--folder-uri', // trailing flag with no value
			]),
			[
				'--wait',
				'--folder-uri=vscode-remote://ssh-remote+host/workspace',
				'--file-uri=vscode-remote://ssh-remote+host/file.txt',
				'--new-window',
				'--folder-uri=vscode-remote://already-joined/workspace',
				'--folder-uri',
			]
		);
	});

	test('does not join when next argument is a flag', () => {
		assert.deepStrictEqual(
			combineUriFlags(['--folder-uri', '--wait', 'somepath']),
			['--folder-uri', '--wait', 'somepath']
		);
	});

	test('leaves unrelated arguments untouched', () => {
		assert.deepStrictEqual(
			combineUriFlags(['--wait', '--new-window', 'C:\\some\\path']),
			['--wait', '--new-window', 'C:\\some\\path']
		);
	});

	test('does not rewrite past the -- end-of-options marker', () => {
		assert.deepStrictEqual(
			combineUriFlags([
				'--wait',
				'--folder-uri', 'vscode-remote://host/before',
				'--',
				'--folder-uri', 'vscode-remote://host/after',
				'--file-uri', 'vscode-remote://host/file.txt',
			]),
			[
				'--wait',
				'--folder-uri=vscode-remote://host/before',
				'--',
				'--folder-uri', 'vscode-remote://host/after',
				'--file-uri', 'vscode-remote://host/file.txt',
			]
		);
	});
});

suite('getBaseHalfExtensionMutationError', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects every generic install and update command in BaseHalf', () => {
		for (const args of [
			{ 'install-extension': ['publisher.extension'] },
			{ 'install-builtin-extension': ['/tmp/extension.vsix'] },
			{ 'update-extensions': true },
		]) {
			assert.strictEqual(
				getBaseHalfExtensionMutationError(args, true),
				'BaseHalf installs and updates code plugins only through its reviewed Plugins library.'
			);
		}
	});

	test('allows non-mutating and uninstall commands in BaseHalf', () => {
		assert.strictEqual(getBaseHalfExtensionMutationError({
			'list-extensions': true,
			'locate-extension': ['publisher.extension'],
			'uninstall-extension': ['publisher.extension'],
		}, true), undefined);
	});

	test('preserves generic extension commands outside BaseHalf', () => {
		assert.strictEqual(getBaseHalfExtensionMutationError({ 'install-builtin-extension': ['/tmp/extension.vsix'], 'update-extensions': true }, false), undefined);
	});
});
