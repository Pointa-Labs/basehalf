/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfModelProviderCatalogContractError,
	BaseHalfModelProviderCatalogService,
	IBaseHalfModelProviderConnectionSpec,
	parseBaseHalfModelProviderCatalog,
	resolveBaseHalfModelProviderConnection
} from '../../common/basehalfModelProviderCatalogs.js';

suite('BaseHalfModelProviderCatalogs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('strictly parses every field kind and deep-freezes the versioned contract', () => {
		const parsed = parseBaseHalfModelProviderCatalog(catalog(connection()));

		assert.deepStrictEqual(parsed.connections[0].fields.map(field => field.type), ['secret', 'url', 'text', 'select']);
		assert.strictEqual(Object.isFrozen(parsed), true);
		assert.strictEqual(Object.isFrozen(parsed.connections), true);
		assert.strictEqual(Object.isFrozen(parsed.connections[0].fields), true);
		assert.strictEqual(Object.isFrozen(parsed.connections[0].fields[3]), true);
		assert.strictEqual(Object.isFrozen(parsed.connections[0].endpointPolicy), true);
	});

	test('resolves defaults, separates secrets, and admits exact or strict subdomain endpoints', () => {
		const spec = parsedConnection();
		const exact = resolveBaseHalfModelProviderConnection(spec, { apiKey: '  secret-value  ' });
		const subdomain = resolveBaseHalfModelProviderConnection(spec, {
			apiKey: 'secret-value',
			apiHost: 'https://tenant.models.example.net/v2',
			project: 'alternate-project',
			tier: 'batch'
		});

		assert.deepStrictEqual(exact, {
			specId: 'pointa.video.example-cloud',
			label: 'Example Cloud',
			endpoint: 'https://api.example.com/v1',
			providerId: 'example',
			deploymentId: 'international',
			region: 'global',
			capabilities: ['video'],
			authorization: 'bearer',
			publicValues: {
				apiHost: 'https://api.example.com/v1',
				project: 'default-project',
				tier: 'realtime'
			},
			secretValues: { apiKey: 'secret-value' }
		});
		assert.strictEqual(Object.isFrozen(exact), true);
		assert.strictEqual(Object.isFrozen(exact.secretValues), true);
		assert.strictEqual(subdomain.endpoint, 'https://tenant.models.example.net/v2');
		assert.deepStrictEqual(subdomain.publicValues, {
			apiHost: 'https://tenant.models.example.net/v2',
			project: 'alternate-project',
			tier: 'batch'
		});
	});

	test('resolves a fixed endpoint without accepting undeclared values', () => {
		const spec = parseBaseHalfModelProviderCatalog(catalog(fixedConnection())).connections[0];
		assert.strictEqual(resolveBaseHalfModelProviderConnection(spec, { apiKey: 'secret' }).endpoint, 'https://fixed.example.com/v1');
		assert.throws(
			() => resolveBaseHalfModelProviderConnection(spec, { apiKey: 'secret', endpoint: 'https://other.example.com' }),
			/values.endpoint is not declared/
		);
	});

	test('rejects malformed fields, unsafe policies, and unknown catalog data', () => {
		assert.throws(() => parseBaseHalfModelProviderCatalog({ ...catalog(connection()), undocumented: true }), BaseHalfModelProviderCatalogContractError);
		assert.throws(() => parseBaseHalfModelProviderCatalog({ ...catalog(connection()), schemaVersion: 2 }), /schemaVersion must be 1/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			fields: [connection().fields[0], connection().fields[0]]
		})), /duplicate identifiers/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			fields: [{ ...connection().fields[0], id: 'constructor' }, ...connection().fields.slice(1)]
		})), /lower-camel-case field identifier/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			fields: [{ ...connection().fields[0], default: 'catalog-secret' }, ...connection().fields.slice(1)]
		})), /default is not part of the model provider contract/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			fields: connection().fields.map(field => field.id === 'tier' ? { ...field, default: 'missing' } : field)
		})), /default must match a declared option/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			endpointPolicy: { type: 'field', fieldId: 'project', allowlist: { exact: ['https://api.example.com'], subdomains: [] } }
		})), /must reference a declared URL field/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			endpointPolicy: { type: 'field', fieldId: 'apiHost', allowlist: { exact: [], subdomains: [] } }
		})), /must contain at least one/);
		assert.throws(() => parseBaseHalfModelProviderCatalog(catalog({
			...connection(),
			helpUrl: 'http://example.com/help'
		})), /public HTTPS URL/);
	});

	test('fails endpoint resolution closed on lookalikes, apex domains, ports, and private literals', () => {
		const spec = parsedConnection();
		for (const apiHost of [
			'https://api.example.com.attacker.test',
			'https://models.example.net',
			'https://tenant.models.example.net:8443',
			'https://127.0.0.1',
			'https://tenant.models.example.net/v1?token=leak'
		]) {
			assert.throws(
				() => resolveBaseHalfModelProviderConnection(spec, { apiKey: 'secret', apiHost }),
				BaseHalfModelProviderCatalogContractError
			);
		}
	});

	test('registers globally unique owned specs and removes them with their catalog', () => {
		const service = new BaseHalfModelProviderCatalogService();
		try {
			const second = service.registerCatalog('pointa.video', 'pointa.video.second', catalog({
				...fixedConnection(),
				id: 'pointa.video.zeta',
				label: 'Zeta'
			}));
			const first = service.registerCatalog('pointa.video', 'pointa.video.first', catalog({
				...connection(),
				id: 'pointa.video.alpha',
				label: 'Alpha'
			}));

			assert.deepStrictEqual(service.getConnectionSpecs().map(spec => spec.id), ['pointa.video.alpha', 'pointa.video.zeta']);
			assert.deepStrictEqual({
				extensionId: service.getConnectionSpec('pointa.video.alpha')?.extensionId,
				catalogId: service.getConnectionSpec('pointa.video.alpha')?.catalogId
			}, {
				extensionId: 'pointa.video',
				catalogId: 'pointa.video.first'
			});
			assert.strictEqual(Object.isFrozen(service.getConnectionSpecs()), true);
			assert.strictEqual(Object.isFrozen(service.getConnectionSpec('pointa.video.alpha')), true);

			first.dispose();
			assert.strictEqual(service.getConnectionSpec('pointa.video.alpha'), undefined);
			second.dispose();
			assert.deepStrictEqual(service.getConnectionSpecs(), []);
		} finally {
			service.dispose();
		}
	});

	test('rejects foreign ownership and rolls back duplicate global spec ids', () => {
		const service = new BaseHalfModelProviderCatalogService();
		try {
			assert.throws(
				() => service.registerCatalog('pointa.video', 'pointa.video.foreign', catalog({ ...connection(), id: 'community.video.connection' })),
				/must use its extension id as a prefix/
			);
			const registration = service.registerCatalog('pointa.video', 'pointa.video.first', catalog(connection()));
			assert.throws(
				() => service.registerCatalog('pointa.video', 'pointa.video.second', catalog(connection())),
				/already registered/
			);
			assert.deepStrictEqual(service.getConnectionSpecs().map(spec => spec.id), ['pointa.video.example-cloud']);
			registration.dispose();
		} finally {
			service.dispose();
		}
	});

	test('validates only through the exact owning provider registration', async () => {
		const service = new BaseHalfModelProviderCatalogService();
		const catalogRegistration = service.registerCatalog('pointa.video', 'pointa.video.providers', catalog(connection()));
		try {
			const spec = service.getConnectionSpec('pointa.video.example-cloud')!;
			const resolved = resolveBaseHalfModelProviderConnection(spec, { apiKey: 'secret' });
			await assert.rejects(() => service.validateConnection(spec.id, resolved, CancellationToken.None), /No validator is registered/);
			assert.throws(
				() => service.registerConnectionValidator(spec.id, 'other.extension', { validate: async () => undefined }),
				/not declared by extension/
			);
			let calls = 0;
			const validator = service.registerConnectionValidator(spec.id, 'pointa.video', {
				validate: async candidate => {
					calls++;
					assert.strictEqual(candidate.secretValues.apiKey, 'secret');
				}
			});
			await service.validateConnection(spec.id, resolved, CancellationToken.None);
			assert.strictEqual(calls, 1);
			validator.dispose();
		} finally {
			catalogRegistration.dispose();
			service.dispose();
		}
	});
});

function parsedConnection(): IBaseHalfModelProviderConnectionSpec {
	return parseBaseHalfModelProviderCatalog(catalog(connection())).connections[0];
}

function catalog(candidate: object): object {
	return { schemaVersion: 1, connections: [candidate] };
}

function connection() {
	return {
		id: 'pointa.video.example-cloud',
		label: 'Example Cloud',
		providerLabel: 'Example',
		helpUrl: 'https://docs.example.com/video',
		providerId: 'example',
		deploymentId: 'international',
		region: 'global',
		capabilities: ['video'],
		authorization: 'bearer',
		fields: [
			{ id: 'apiKey', label: 'API Key', description: 'Provider credential.', placeholder: 'Paste an API key', required: true, type: 'secret' },
			{ id: 'apiHost', label: 'API Host', required: true, type: 'url', default: 'https://api.example.com/v1' },
			{ id: 'project', label: 'Project', required: false, type: 'text', default: 'default-project' },
			{
				id: 'tier', label: 'Tier', required: true, type: 'select', default: 'realtime',
				options: [{ value: 'realtime', label: 'Realtime' }, { value: 'batch', label: 'Batch' }]
			}
		],
		endpointPolicy: {
			type: 'field',
			fieldId: 'apiHost',
			allowlist: {
				exact: ['https://api.example.com'],
				subdomains: ['models.example.net']
			}
		}
	};
}

function fixedConnection() {
	return {
		...connection(),
		fields: [connection().fields[0]],
		endpointPolicy: { type: 'fixed', endpoint: 'https://fixed.example.com/v1' }
	};
}
