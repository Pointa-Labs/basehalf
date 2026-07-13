/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { generateKeyPairSync, sign, webcrypto } from 'crypto';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ecdsaDerToP1363, sha256HexToChecksumBase64, verifyBaseHalfPluginCatalogSignature } from '../../common/basehalfPluginCatalogSecurity.js';
import { validateBaseHalfCatalogSequence } from '../../common/basehalfPluginCatalogService.js';

suite('BaseHalfPluginCatalogSecurity', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('verifies an exact catalog payload with a keyed P-256 DER signature', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const payload = new TextEncoder().encode('{"schemaVersion":1,"sequence":3}');
		const signature = sign('sha256', payload, privateKey).toString('base64');
		const keys = [{ keyId: 'release-2026', publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString() }];

		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(payload, {
			keyId: 'release-2026',
			algorithm: 'ECDSA_P256_SHA256_DER',
			signature
		}, keys, webcrypto as unknown as Crypto), true);
		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(new TextEncoder().encode('{"tampered":true}'), {
			keyId: 'release-2026',
			algorithm: 'ECDSA_P256_SHA256_DER',
			signature
		}, keys, webcrypto as unknown as Crypto), false);
	});

	test('converts DER signatures and expected hex checksums', () => {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const der = sign('sha256', Buffer.from('catalog'), privateKey);
		assert.strictEqual(ecdsaDerToP1363(der, 32).byteLength, 64);
		assert.strictEqual(sha256HexToChecksumBase64('00'.repeat(32)), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
		assert.throws(() => ecdsaDerToP1363(Uint8Array.of(1, 2, 3), 32), /DER sequence/);
	});

	test('rejects sequence rollback and same-sequence equivocation', () => {
		assert.doesNotThrow(() => validateBaseHalfCatalogSequence(8, 'same', 8, 'same'));
		assert.doesNotThrow(() => validateBaseHalfCatalogSequence(9, 'next', 8, 'same'));
		assert.throws(() => validateBaseHalfCatalogSequence(7, 'older', 8, 'same'), /older than/);
		assert.throws(() => validateBaseHalfCatalogSequence(8, 'different', 8, 'same'), /different content/);
	});
});
