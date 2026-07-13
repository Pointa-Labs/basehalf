/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import { resolveBaseHalfPluginCatalogPublicKeys } from './pluginCatalogKeys.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('refuses to package an empty plugin catalog keyring', () => {
	assert.throws(() => resolveBaseHalfPluginCatalogPublicKeys([], {}), /Refusing to package/);
	assert.throws(() => resolveBaseHalfPluginCatalogPublicKeys([], { BASEHALF_PLUGIN_CATALOG_KEY_ID: 'release-2026' }), /must be provided together/);
});

test('validates and stamps a P-256 key while retaining rotation keys', () => {
	const directory = createTemporaryDirectory();
	const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const publicKeyPath = path.join(directory, 'public.pem');
	fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
	const keys = resolveBaseHalfPluginCatalogPublicKeys([{ keyId: 'release-2025', publicKey: 'old' }], {
		BASEHALF_PLUGIN_CATALOG_KEY_ID: 'release-2026',
		BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH: publicKeyPath
	});
	assert.deepStrictEqual(keys.map(key => key.keyId), ['release-2026', 'release-2025']);
});

test('rejects a non-P-256 catalog key', () => {
	const directory = createTemporaryDirectory();
	const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const publicKeyPath = path.join(directory, 'public.pem');
	fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
	assert.throws(() => resolveBaseHalfPluginCatalogPublicKeys([], {
		BASEHALF_PLUGIN_CATALOG_KEY_ID: 'invalid',
		BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH: publicKeyPath
	}), /P-256/);
});

function createTemporaryDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-plugin-key-'));
	temporaryDirectories.push(directory);
	return directory;
}
