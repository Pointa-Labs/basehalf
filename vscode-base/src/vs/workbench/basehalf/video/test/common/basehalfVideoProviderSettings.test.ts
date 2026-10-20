/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BaseHalfVideoProviderSettingsError,
	baseHalfVideoProviderSecretAddress,
	isBaseHalfLoopbackHost,
	normalizeBaseHalfVideoCredentialValue,
	normalizeBaseHalfVideoEndpoint,
	parseBaseHalfVideoCredentialSecret,
	parseBaseHalfVideoProviderSettings,
	serializeBaseHalfVideoProviderSettings
} from '../../common/basehalfVideoProviderSettings.js';

suite('BaseHalfVideoProviderSettings', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stores the region, the endpoint, and the ids of the credentials that are set, and reads back only what is valid', () => {
		const raw = serializeBaseHalfVideoProviderSettings(new Map([
			['acme', { region: 'west', endpoint: 'https://relay.example.com/acme', credentials: ['apiKey'] }],
			['borealis', { credentials: ['secretKey', 'accessKey'] }],
			['empty', { credentials: [] }]
		]));
		const tampered = JSON.stringify({
			version: 1,
			providers: {
				acme: { region: 'west', endpoint: 'http://relay.example.com/acme', credentials: ['apiKey', 'apiKey', 3] },
				'Not An Id': { credentials: ['apiKey'] },
				borealis: 'set up'
			}
		});
		assert.deepStrictEqual({
			raw: JSON.parse(raw),
			read: Object.fromEntries(parseBaseHalfVideoProviderSettings(raw)),
			tampered: Object.fromEntries(parseBaseHalfVideoProviderSettings(tampered)),
			otherVersion: parseBaseHalfVideoProviderSettings(JSON.stringify({ version: 2, providers: {} })).size,
			notJson: parseBaseHalfVideoProviderSettings('{').size
		}, {
			raw: { version: 1, providers: { acme: { region: 'west', endpoint: 'https://relay.example.com/acme', credentials: ['apiKey'] }, borealis: { credentials: ['accessKey', 'secretKey'] } } },
			read: { acme: { region: 'west', endpoint: 'https://relay.example.com/acme', credentials: ['apiKey'] }, borealis: { credentials: ['accessKey', 'secretKey'] } },
			// An http endpoint on another computer is not used.
			tampered: { acme: { region: 'west', credentials: ['apiKey'] } },
			otherVersion: 0,
			notJson: 0
		});
	});

	test('keeps the credential values of a provider as one secret, and its address as the main process admits it', () => {
		assert.deepStrictEqual({
			values: parseBaseHalfVideoCredentialSecret(JSON.stringify({ apiKey: 'k-1', secretKey: '', 'bad id': 'x', count: 3 })),
			notJson: parseBaseHalfVideoCredentialSecret('k-1'),
			address: baseHalfVideoProviderSecretAddress('acme-video')
		}, {
			values: { apiKey: 'k-1' },
			notJson: {},
			address: 'basehalf.modelServices.video.acme-video.apiKey'
		});
		assert.throws(() => baseHalfVideoProviderSecretAddress('acme.video'), BaseHalfVideoProviderSettingsError);
		assert.throws(() => baseHalfVideoProviderSecretAddress('a'.repeat(59)), BaseHalfVideoProviderSettingsError);
	});

	test('takes an https endpoint, or http on this computer, without credentials, a query, or a trailing slash', () => {
		assert.deepStrictEqual([
			normalizeBaseHalfVideoEndpoint(' https://api.example.com/v1/ '),
			normalizeBaseHalfVideoEndpoint('http://localhost:8123/api/v3'),
			normalizeBaseHalfVideoEndpoint('http://[::1]:8123'),
			normalizeBaseHalfVideoEndpoint('http://127.0.0.2/x//')
		], ['https://api.example.com/v1', 'http://localhost:8123/api/v3', 'http://[::1]:8123', 'http://127.0.0.2/x']);
		for (const endpoint of ['ftp://api.example.com', 'api.example.com', 'http://api.example.com', 'https://user:pass@api.example.com', 'https://api.example.com/v1?key=x', 'https://api.example.com/#x', '']) {
			assert.throws(() => normalizeBaseHalfVideoEndpoint(endpoint), BaseHalfVideoProviderSettingsError, endpoint);
		}
		assert.deepStrictEqual(['localhost', 'app.localhost', '127.0.0.1', '[::1]', '128.0.0.1', 'example.com'].map(isBaseHalfLoopbackHost), [true, true, true, true, false, false]);
	});

	test('takes a credential value of visible characters and names the credential when it refuses one', () => {
		assert.strictEqual(normalizeBaseHalfVideoCredentialValue('  sk-01234  ', 'API Key'), 'sk-01234');
		assert.throws(() => normalizeBaseHalfVideoCredentialValue('   ', 'Secret Key'), (error: Error) => error.message === 'Paste the Secret Key from the provider\'s console.');
		assert.throws(() => normalizeBaseHalfVideoCredentialValue('two\nlines', 'API Key'), BaseHalfVideoProviderSettingsError);
		assert.throws(() => normalizeBaseHalfVideoCredentialValue('x'.repeat(16 * 1024 + 1), 'API Key'), /longer than any provider uses/);
	});
});
