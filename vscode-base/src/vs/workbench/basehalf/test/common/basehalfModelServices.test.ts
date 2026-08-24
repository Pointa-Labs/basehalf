/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { FileAccess } from '../../../../base/common/network.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { TestExtensionService } from '../../../test/common/workbenchTestServices.js';
import { BASEHALF_CURATED_PLUGINS } from '../../common/basehalfPluginCatalog.js';
import { BaseHalfPluginAdmissionService, IBaseHalfPluginContributorIdentity } from '../../common/basehalfPluginAdmissionService.js';
import { IBaseHalfModelCredentialStore } from '../../common/basehalfModelCredentialStore.js';
import { IBaseHalfPluginStateStore } from '../../common/basehalfPluginStateStore.js';
import { BaseHalfModelProviderCatalogService, IBaseHalfModelProviderConnectionSpec } from '../../common/basehalfModelProviderCatalogs.js';
import {
	BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY,
	BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
	BASEHALF_MODEL_SERVICES_SETTING,
	BaseHalfModelServiceService,
	baseHalfModelServiceCredentialKey,
	baseHalfModelServiceSecretKey,
	cleanBaseHalfModelServicesConfigurationForStorage,
	sanitizeBaseHalfStoredModelConnections,
} from '../../common/basehalfModelServices.js';

suite('BaseHalfModelServices', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('clean-breaks every unversioned user-authored connection shape', () => {
		const legacy = {
			'studio.api': {
				label: 'Studio',
				endpoint: 'https://models.example.com',
				providerId: 'example',
				deploymentId: 'global',
				region: 'global',
				capabilities: ['video'],
				authorization: 'bearer'
			}
		};
		assert.deepStrictEqual(cleanBaseHalfModelServicesConfigurationForStorage(legacy), {
			schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
			connections: {}
		});
	});

	test('strictly parses only versioned spec-owned public metadata', () => {
		const valid = {
			schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
			connections: {
				'pointa.test.wan': {
					publicValues: { apiHost: 'https://dashscope-us.aliyuncs.com' },
					credentialRef: '01234567-89ab-4cde-8fab-0123456789ab'
				}
			}
		};
		assert.deepStrictEqual(sanitizeBaseHalfStoredModelConnections(valid), valid);
		assert.deepStrictEqual(sanitizeBaseHalfStoredModelConnections({
			...valid,
			connections: {
				...valid.connections,
				'pointa.test.bad': { ...valid.connections['pointa.test.wan'], secret: 'must not survive' }
			}
		}), {
			schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
			connections: { 'pointa.test.wan': valid.connections['pointa.test.wan'] }
		});
	});

	test('stores credentials outside configuration and exposes them only to admitted plugins', async () => {
		const harness = await createHarness();
		try {
			const saved = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: ' secret-value ' });
			assert.strictEqual(saved.specId, FIXED_SPEC.id);
			assert.strictEqual(saved.endpoint, FIXED_SPEC.endpointPolicy.type === 'fixed' ? FIXED_SPEC.endpointPolicy.endpoint : '');
			assert.strictEqual(saved.configured, true);
			assert.deepStrictEqual(saved.publicValues, {});

			const stored = connectionState(harness.pluginStateStore);
			assert.strictEqual(stored.schemaVersion, 1);
			assert.deepStrictEqual(stored.connections[FIXED_SPEC.id].publicValues, {});
			assert.strictEqual(JSON.stringify(stored).includes('secret-value'), false);
			const credentialKey = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, stored.connections[FIXED_SPEC.id].credentialRef);
			assert.notStrictEqual(await harness.credentialStore.get(credentialKey), 'secret-value');

			const snapshot = {
				serviceId: saved.id,
				serviceLabel: saved.label,
				connectionIdentity: saved.connectionIdentity,
				capability: 'video' as const
			};
			const access = await harness.service.getAccess(bundledOfficialIdentity(), snapshot);
			assert.strictEqual(access?.apiKey, 'secret-value');
			assert.deepStrictEqual(access?.credentialValues, { apiKey: 'secret-value' });
			assert.strictEqual(await harness.service.getAccess(bundledOfficialIdentity(), { ...snapshot, capability: 'audio' }), undefined);
			assert.strictEqual(await harness.service.getAccess(bundledOfficialIdentity(), { ...snapshot, connectionIdentity: `sha256:${'A'.repeat(43)}` }), undefined);
			await assert.rejects(() => harness.service.getAccess(installedIdentity('unknown.extension', '1.0.0'), snapshot), /not admitted/);
		} finally {
			await harness.dispose();
		}
	});

	test('derives an exact reviewed scope from an allowlisted API Host', async () => {
		const harness = await createHarness();
		try {
			const saved = await harness.service.saveConnection(WAN_SPEC.id, {
				apiKey: 'wan-secret',
				apiHost: 'https://dashscope-us.aliyuncs.com/'
			});
			assert.strictEqual(saved.endpoint, 'https://dashscope-us.aliyuncs.com');
			assert.strictEqual(saved.providerId, 'alibaba-cloud');
			assert.strictEqual(saved.deploymentId, 'us');
			assert.strictEqual(saved.region, 'us-east-1');
			assert.deepStrictEqual(saved.publicValues, { apiHost: 'https://dashscope-us.aliyuncs.com' });
			await assert.rejects(() => harness.service.saveConnection(WAN_SPEC.id, {
				apiKey: 'wan-secret',
				apiHost: 'https://attacker.example.com'
			}), /outside the endpoint allowlist/);
			assert.strictEqual((await harness.service.getServices()).find(service => service.id === WAN_SPEC.id)?.configured, true);
		} finally {
			await harness.dispose();
		}
	});

	test('redacts an echoed credential when provider verification fails before storage', async () => {
		const harness = await createHarness();
		try {
			const secret = 'provider-secret-123';
			harness.providerCatalogService.setValidator(FIXED_SPEC.id, async () => {
				throw new Error(`credential ${secret} rejected`);
			});
			await assert.rejects(
				() => harness.service.saveConnection(FIXED_SPEC.id, { apiKey: secret }),
				error => error instanceof Error && error.message === 'credential [REDACTED] rejected'
			);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).connections, {});
		} finally {
			await harness.dispose();
		}
	});

	test('revalidates a stored credential and durably blocks access while it needs attention', async () => {
		const harness = await createHarness();
		const secondWindow = harness.createService();
		try {
			const saved = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'stored-secret' });
			const stored = storedConnection(harness.pluginStateStore, FIXED_SPEC.id);
			const credentialKey = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, stored.credentialRef);
			const credentialBeforeTest = await harness.credentialStore.get(credentialKey);
			harness.providerCatalogService.setValidator(FIXED_SPEC.id, async () => {
				throw new Error('stored-secret was rejected');
			});

			await assert.rejects(
				() => harness.service.testConnection(FIXED_SPEC.id),
				error => error instanceof Error && error.message === '[REDACTED] was rejected'
			);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).attentionConnections, [FIXED_SPEC.id]);
			assert.strictEqual(await harness.credentialStore.get(credentialKey), credentialBeforeTest);
			assert.strictEqual((await secondWindow.getServices())[0]?.configured, false);
			assert.strictEqual(await secondWindow.getAccess(bundledOfficialIdentity(), {
				serviceId: saved.id,
				serviceLabel: saved.label,
				connectionIdentity: saved.connectionIdentity,
				capability: 'video'
			}), undefined);

			harness.providerCatalogService.setValidator(FIXED_SPEC.id, async () => undefined);
			const verified = await secondWindow.testConnection(FIXED_SPEC.id);
			assert.strictEqual(verified.configured, true);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).attentionConnections, []);
			assert.strictEqual((await harness.service.getServices())[0]?.configured, true);
			assert.strictEqual((await harness.service.getAccess(bundledOfficialIdentity(), {
				serviceId: saved.id,
				serviceLabel: saved.label,
				connectionIdentity: saved.connectionIdentity,
				capability: 'video'
			}))?.apiKey, 'stored-secret');
		} finally {
			secondWindow.dispose();
			await harness.dispose();
		}
	});

	test('rotates a key without changing attempt identity and deletes the superseded credential', async () => {
		const harness = await createHarness();
		try {
			const first = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'first-key' });
			const firstStored = storedConnection(harness.pluginStateStore, FIXED_SPEC.id);
			const firstKey = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, firstStored.credentialRef);
			const second = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'second-key' });
			assert.strictEqual(second.connectionIdentity, first.connectionIdentity);
			assert.notStrictEqual(storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef, firstStored.credentialRef);
			assert.strictEqual(await harness.credentialStore.get(firstKey), undefined);
			const access = await harness.service.getAccess(bundledOfficialIdentity(), {
				serviceId: first.id,
				serviceLabel: first.label,
				connectionIdentity: first.connectionIdentity,
				capability: 'video'
			});
			assert.strictEqual(access?.apiKey, 'second-key');
		} finally {
			await harness.dispose();
		}
	});

	test('durably stages a replacement before the Keychain write', async () => {
		const credentialStore = new ObservingCredentialStore();
		const harness = await createHarness(credentialStore);
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'first-key' });
			credentialStore.observeNextSet(nextKey => {
				assert.ok(connectionState(harness.pluginStateStore).stagedCredentials[nextKey]);
			});

			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'second-key' });
			assert.strictEqual(credentialStore.didObserve, true);
		} finally {
			await harness.dispose();
		}
	});

	test('startup reconciliation preserves live metadata and deletes only confirmed orphan credentials', async () => {
		const harness = await createHarness();
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'live-key' });
			const original = storedConnection(harness.pluginStateStore, FIXED_SPEC.id);
			const originalKey = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, original.credentialRef);
			const credentialEnvelope = await harness.credentialStore.get(originalKey);
			assert.ok(credentialEnvelope);
			const orphanKey = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, '11111111-1111-4111-8111-111111111111');
			await harness.credentialStore.set(orphanKey, credentialEnvelope);
			const state = connectionState(harness.pluginStateStore);
			harness.pluginStateStore.setRaw(BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY, JSON.stringify({
				...state,
				pendingCredentialCleanup: [originalKey, orphanKey]
			}));

			harness.service.dispose();
			harness.service = new BaseHalfModelServiceService(
				harness.configurationService,
				harness.secretStorageService,
				harness.storageService,
				harness.admissionService,
				harness.providerCatalogService.service,
				harness.pluginStateStore,
				harness.credentialStore,
				new TestExtensionService()
			);
			assert.strictEqual((await harness.service.getServices())[0]?.configured, true);
			assert.ok(await harness.credentialStore.get(originalKey));
			assert.strictEqual(await harness.credentialStore.get(orphanKey), undefined);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).pendingCredentialCleanup, []);
		} finally {
			await harness.dispose();
		}
	});

	test('does not replace a working connection when Keychain storage fails', async () => {
		const credentialStore = new SetFailingCredentialStore();
		const harness = await createHarness(credentialStore);
		try {
			const first = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'working-key' });
			const originalRef = storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef;
			credentialStore.failNextSet();
			await assert.rejects(() => harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'replacement-key' }), /fixture secret storage failure/);
			assert.strictEqual(storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef, originalRef);
			const access = await harness.service.getAccess(bundledOfficialIdentity(), {
				serviceId: first.id,
				serviceLabel: first.label,
				connectionIdentity: first.connectionIdentity,
				capability: 'video'
			});
			assert.strictEqual(access?.apiKey, 'working-key');
		} finally {
			await harness.dispose();
		}
	});

	test('cleans staged credentials when the atomic metadata commit fails', async () => {
		const credentialStore = new ObservingCredentialStore();
		const pluginStateStore = new CompareAndSwapFailingPluginStateStore();
		const harness = await createHarness(
			credentialStore,
			new MutableTestConfigurationService(),
			new InMemoryStorageService(),
			pluginStateStore
		);
		try {
			const first = await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'working-key' });
			const originalRef = storedConnection(pluginStateStore, FIXED_SPEC.id).credentialRef;
			let stagedKey: string | undefined;
			credentialStore.observeNextSet(key => {
				stagedKey = key;
				pluginStateStore.failNextCompareAndSwap();
			});

			await assert.rejects(
				() => harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'replacement-key' }),
				/fixture connection-state commit failure/
			);
			assert.strictEqual(storedConnection(pluginStateStore, FIXED_SPEC.id).credentialRef, originalRef);
			assert.ok(stagedKey);
			assert.strictEqual(await credentialStore.get(stagedKey!), undefined);
			assert.deepStrictEqual(connectionState(pluginStateStore).stagedCredentials, {});
			assert.deepStrictEqual(connectionState(pluginStateStore).pendingCredentialCleanup, []);
			assert.strictEqual((await harness.service.getAccess(bundledOfficialIdentity(), {
				serviceId: first.id,
				serviceLabel: first.label,
				connectionIdentity: first.connectionIdentity,
				capability: 'video'
			}))?.apiKey, 'working-key');
		} finally {
			await harness.dispose();
		}
	});

	test('keeps an undecryptable credential connection replaceable and removable', async () => {
		const credentialStore = new GetFailingCredentialStore();
		const harness = await createHarness(credentialStore);
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'secret' });
			credentialStore.failReads = true;
			const [descriptor] = await harness.service.getServices();
			assert.strictEqual(descriptor.configured, false);
			await harness.service.remove(FIXED_SPEC.id);
			assert.deepStrictEqual(await harness.service.getServices(), []);
		} finally {
			await harness.dispose();
		}
	});

	test('removes metadata first and tombstones a temporarily undeletable credential', async () => {
		const credentialStore = new DeleteFailingCredentialStore();
		const harness = await createHarness(credentialStore);
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'secret' });
			const ref = storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef;
			const key = baseHalfModelServiceCredentialKey(FIXED_SPEC.id, ref);
			credentialStore.failNextDelete();
			await harness.service.remove(FIXED_SPEC.id);
			assert.deepStrictEqual(await harness.service.getServices(), []);
			assert.strictEqual(await credentialStore.get(key) !== undefined, true);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).pendingCredentialCleanup, [key]);

			harness.service.dispose();
			harness.service = new BaseHalfModelServiceService(
				harness.configurationService,
				harness.secretStorageService,
				harness.storageService,
				harness.admissionService,
				harness.providerCatalogService.service,
				harness.pluginStateStore,
				harness.credentialStore,
				new TestExtensionService()
			);
			assert.deepStrictEqual(await harness.service.getServices(), []);
			assert.strictEqual(await credentialStore.get(key), undefined);
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).pendingCredentialCleanup, []);
		} finally {
			await harness.dispose();
		}
	});

	test('never writes the unregistered legacy setting while cleaning its secrets', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const storageService = new InMemoryStorageService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
		const providerCatalogService = providerCatalog();
		const pluginStateStore = new MemoryPluginStateStore();
		const credentialStore = new DeleteFailingCredentialStore();
		await configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, {
			legacy: {
				label: 'Legacy', endpoint: 'https://legacy.example.com', providerId: 'example', deploymentId: 'global', region: 'global',
				capabilities: ['video'], authorization: 'bearer'
			}
		});
		await credentialStore.set(baseHalfModelServiceSecretKey('legacy'), 'legacy-unbound-secret');
		credentialStore.failNextDelete();

		const first = new BaseHalfModelServiceService(configurationService, secretStorageService, storageService, admissionService, providerCatalogService.service, pluginStateStore, credentialStore, new TestExtensionService());
		assert.deepStrictEqual(await first.getServices(), []);
		assert.strictEqual(configurationService.updateCount, 1);
		assert.ok(configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
		assert.deepStrictEqual(connectionState(pluginStateStore).pendingLegacySecretCleanup, ['legacy']);
		first.dispose();

		const second = new BaseHalfModelServiceService(configurationService, secretStorageService, storageService, admissionService, providerCatalogService.service, pluginStateStore, credentialStore, new TestExtensionService());
		assert.deepStrictEqual(await second.getServices(), []);
		assert.strictEqual(await credentialStore.get(baseHalfModelServiceSecretKey('legacy')), undefined);
		assert.deepStrictEqual(connectionState(pluginStateStore).pendingLegacySecretCleanup, []);
		second.dispose();
		providerCatalogService.dispose();
		admissionService.dispose();
		storageService.dispose();
		secretStorageService.dispose();
		configurationService.onDidChangeConfigurationEmitter.dispose();
	});

	test('two window services CAS-merge concurrent saves without losing either connection', async () => {
		const harness = await createHarness();
		const secondWindow = harness.createService();
		try {
			await Promise.all([
				harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'byteplus' }),
				secondWindow.saveConnection(WAN_SPEC.id, { apiKey: 'wan', apiHost: 'https://dashscope-us.aliyuncs.com' })
			]);
			assert.deepStrictEqual((await secondWindow.getServices()).map(service => service.id), [FIXED_SPEC.id, WAN_SPEC.id]);
		} finally {
			secondWindow.dispose();
			await harness.dispose();
		}
	});

	test('two window services safely interleave rotate, remove, and save commits', async () => {
		const credentialStore = new PausingCredentialStore();
		const harness = await createHarness(credentialStore);
		const secondWindow = harness.createService();
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'initial-key' });
			const initialKey = baseHalfModelServiceCredentialKey(
				FIXED_SPEC.id,
				storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef
			);
			const releaseRotation = credentialStore.pauseNextSetContaining('rotated-key');
			const rotation = harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'rotated-key' });
			await credentialStore.whenPaused;

			await Promise.all([
				secondWindow.remove(FIXED_SPEC.id),
				secondWindow.saveConnection(WAN_SPEC.id, { apiKey: 'wan-key', apiHost: 'https://dashscope-us.aliyuncs.com' })
			]);
			releaseRotation();
			await rotation;

			assert.deepStrictEqual((await secondWindow.getServices()).map(service => service.id), [FIXED_SPEC.id, WAN_SPEC.id]);
			assert.strictEqual(await credentialStore.get(initialKey), undefined);
			assert.strictEqual((await secondWindow.getAccess(bundledOfficialIdentity(), {
				serviceId: FIXED_SPEC.id,
				serviceLabel: FIXED_SPEC.label,
				connectionIdentity: (await secondWindow.getServices()).find(service => service.id === FIXED_SPEC.id)!.connectionIdentity,
				capability: 'video'
			}))?.apiKey, 'rotated-key');
			assert.deepStrictEqual(connectionState(harness.pluginStateStore).pendingCredentialCleanup, []);
		} finally {
			secondWindow.dispose();
			await harness.dispose();
		}
	});

	test('keeps a stored connection fail-closed while its reviewed spec is unavailable', async () => {
		const harness = await createHarness();
		try {
			await harness.service.saveConnection(FIXED_SPEC.id, { apiKey: 'secret' });
			harness.providerCatalogService.registration.dispose();
			assert.deepStrictEqual(await harness.service.getServices(), []);
			assert.ok(await harness.credentialStore.get(baseHalfModelServiceCredentialKey(FIXED_SPEC.id, storedConnection(harness.pluginStateStore, FIXED_SPEC.id).credentialRef)));
		} finally {
			await harness.dispose();
		}
	});
});

const FIXED_SPEC: IBaseHalfModelProviderConnectionSpec = {
	id: 'pointa.test.byteplus',
	label: 'Seedance / BytePlus',
	providerLabel: 'BytePlus',
	helpUrl: 'https://www.byteplus.com/en/docs/ModelArk',
	providerId: 'byteplus',
	deploymentId: 'modelark',
	region: 'global',
	capabilities: ['video'],
	authorization: 'bearer',
	fields: [
		{ id: 'apiKey', label: 'API Key', required: true, type: 'secret' },
		{ id: 'accountToken', label: 'Account Token', required: false, type: 'secret' }
	],
	endpointPolicy: { type: 'fixed', endpoint: 'https://ark.ap-southeast.bytepluses.com' }
};

const WAN_SPEC: IBaseHalfModelProviderConnectionSpec = {
	id: 'pointa.test.wan',
	label: 'Wan (US)',
	providerLabel: 'Alibaba Cloud',
	helpUrl: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
	providerId: 'alibaba-cloud',
	deploymentId: 'us',
	region: 'us-east-1',
	capabilities: ['video'],
	authorization: 'bearer',
	fields: [
		{ id: 'apiKey', label: 'API Key', required: true, type: 'secret' },
		{ id: 'apiHost', label: 'API Host', required: true, type: 'url', default: 'https://dashscope-us.aliyuncs.com' }
	],
	endpointPolicy: {
		type: 'field',
		fieldId: 'apiHost',
		allowlist: { exact: ['https://dashscope-us.aliyuncs.com'], subdomains: [] }
	}
};

interface ITestHarness {
	service: BaseHalfModelServiceService;
	readonly configurationService: MutableTestConfigurationService;
	readonly secretStorageService: TestSecretStorageService;
	readonly storageService: InMemoryStorageService;
	readonly admissionService: BaseHalfPluginAdmissionService;
	readonly providerCatalogService: ReturnType<typeof providerCatalog>;
	readonly pluginStateStore: MemoryPluginStateStore;
	readonly credentialStore: MemoryCredentialStore;
	createService(): BaseHalfModelServiceService;
	dispose(): Promise<void>;
}

async function createHarness(
	credentialStore: MemoryCredentialStore = new MemoryCredentialStore(),
	configurationService: MutableTestConfigurationService = new MutableTestConfigurationService(),
	storageService: InMemoryStorageService = new InMemoryStorageService(),
	pluginStateStore: MemoryPluginStateStore = new MemoryPluginStateStore()
): Promise<ITestHarness> {
	const secretStorageService = new TestSecretStorageService();
	const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
	const providerCatalogService = providerCatalog();
	const createService = () => new BaseHalfModelServiceService(
		configurationService,
		secretStorageService,
		storageService,
		admissionService,
		providerCatalogService.service,
		pluginStateStore,
		credentialStore,
		new TestExtensionService()
	);
	const service = createService();
	const harness: ITestHarness = {
		service,
		configurationService,
		secretStorageService,
		storageService,
		admissionService,
		providerCatalogService,
		pluginStateStore,
		credentialStore,
		createService,
		async dispose() {
			harness.service.dispose();
			providerCatalogService.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	};
	return harness;
}

function providerCatalog(): {
	readonly service: BaseHalfModelProviderCatalogService;
	readonly registration: { dispose(): void };
	setValidator(specId: string, validate: () => Promise<void>): void;
	dispose(): void;
} {
	const service = new BaseHalfModelProviderCatalogService();
	const registration = service.registerCatalog('pointa.test', 'pointa.test.providers', {
		schemaVersion: 1,
		connections: [FIXED_SPEC, WAN_SPEC]
	});
	const validators = new Map<string, { dispose(): void }>();
	const setValidator = (specId: string, validate: () => Promise<void>) => {
		validators.get(specId)?.dispose();
		validators.set(specId, service.registerConnectionValidator(specId, 'pointa.test', { validate }));
	};
	for (const spec of [FIXED_SPEC, WAN_SPEC]) {
		setValidator(spec.id, async () => undefined);
	}
	return { service, registration, setValidator, dispose: () => { validators.forEach(validator => validator.dispose()); registration.dispose(); service.dispose(); } };
}

function storedConnection(pluginStateStore: MemoryPluginStateStore, specId: string): { publicValues: Record<string, string>; credentialRef: string } {
	return connectionState(pluginStateStore).connections[specId];
}

function connectionState(pluginStateStore: MemoryPluginStateStore): {
	schemaVersion: number;
	connections: Record<string, { publicValues: Record<string, string>; credentialRef: string }>;
	attentionConnections: string[];
	stagedCredentials: Record<string, number>;
	pendingCredentialCleanup: string[];
	pendingLegacySecretCleanup: string[];
} {
	return JSON.parse(pluginStateStore.getRaw(BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY) ?? '{}');
}

function bundledOfficialIdentity(): IBaseHalfPluginContributorIdentity {
	const plugin = BASEHALF_CURATED_PLUGINS[0];
	if (!plugin.bundledPath) {
		throw new Error('Expected an official bundled plugin fixture.');
	}
	return {
		extensionId: plugin.extensionId,
		version: '0.1.0',
		extensionLocation: joinPath(FileAccess.asFileUri(''), '..', ...plugin.bundledPath.split('/')),
		isBuiltin: false,
		isUnderDevelopment: false
	};
}

function installedIdentity(extensionId: string, version: string): IBaseHalfPluginContributorIdentity {
	return { extensionId, version, extensionLocation: URI.file(`/extensions/${extensionId}`), isBuiltin: false, isUnderDevelopment: false };
}

function environment(): IEnvironmentService {
	return { isExtensionDevelopment: false } as unknown as IEnvironmentService;
}

function fileService(): IFileService {
	return {
		onDidFilesChange: Event.None,
		stat: async (resource: URI) => ({ resource, name: resource.path.split('/').at(-1) ?? '', isDirectory: true, isFile: false, isSymbolicLink: false }),
		resolve: async (resource: URI) => ({
			resource,
			name: resource.path.split('/').at(-1) ?? '',
			isDirectory: true,
			isFile: false,
			isSymbolicLink: false,
			children: [{ resource: joinPath(resource, 'package.json'), name: 'package.json', isDirectory: false, isFile: true, isSymbolicLink: false }]
		}),
		readFile: async (resource: URI) => ({ resource, value: VSBuffer.fromString('{"name":"test"}\n') })
	} as unknown as IFileService;
}

class MutableTestConfigurationService extends TestConfigurationService {
	updateCount = 0;
	override async updateValue(key: string, value: unknown): Promise<void> {
		this.updateCount++;
		await this.setUserConfiguration(key, value);
	}
}

class MemoryCredentialStore implements IBaseHalfModelCredentialStore {
	declare readonly _serviceBrand: undefined;
	protected readonly values = new Map<string, string>();
	async get(key: string): Promise<string | undefined> { return this.values.get(key); }
	async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
	async delete(key: string): Promise<void> { this.values.delete(key); }
}

class DeleteFailingCredentialStore extends MemoryCredentialStore {
	private remainingDeleteFailures = 0;
	failNextDelete(): void { this.remainingDeleteFailures++; }
	override async delete(key: string): Promise<void> {
		if (this.remainingDeleteFailures > 0) {
			this.remainingDeleteFailures--;
			throw new Error('fixture secret deletion failure');
		}
		await super.delete(key);
	}
}

class GetFailingCredentialStore extends MemoryCredentialStore {
	failReads = false;
	override async get(key: string): Promise<string | undefined> {
		if (this.failReads) {
			throw new Error('fixture credential decrypt failure');
		}
		return super.get(key);
	}
}

class SetFailingCredentialStore extends MemoryCredentialStore {
	private remainingSetFailures = 0;
	failNextSet(): void { this.remainingSetFailures++; }
	override async set(key: string, value: string): Promise<void> {
		if (this.remainingSetFailures > 0) {
			this.remainingSetFailures--;
			throw new Error('fixture secret storage failure');
		}
		await super.set(key, value);
	}
}

class ObservingCredentialStore extends MemoryCredentialStore {
	private observer: ((key: string) => void) | undefined;
	didObserve = false;
	observeNextSet(observer: (key: string) => void): void { this.observer = observer; }
	override async set(key: string, value: string): Promise<void> {
		const observer = this.observer;
		this.observer = undefined;
		if (observer) {
			observer(key);
			this.didObserve = true;
		}
		await super.set(key, value);
	}
}

class PausingCredentialStore extends MemoryCredentialStore {
	private match: string | undefined;
	private resume: (() => void) | undefined;
	private paused: (() => void) | undefined;
	whenPaused: Promise<void> = Promise.resolve();

	pauseNextSetContaining(match: string): () => void {
		this.match = match;
		this.whenPaused = new Promise(resolve => this.paused = resolve);
		return () => {
			this.resume?.();
			this.resume = undefined;
		};
	}

	override async set(key: string, value: string): Promise<void> {
		if (this.match && value.includes(this.match)) {
			this.match = undefined;
			const resumed = new Promise<void>(resolve => this.resume = resolve);
			this.paused?.();
			this.paused = undefined;
			await resumed;
		}
		await super.set(key, value);
	}
}

class MemoryPluginStateStore implements IBaseHalfPluginStateStore {
	declare readonly _serviceBrand: undefined;
	private readonly values = new Map<string, string>();

	async read(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}

	async compareAndSwap(key: string, expected: string | undefined, value: string | undefined): Promise<{ swapped: boolean; current?: string }> {
		const current = this.values.get(key);
		if (current !== expected) {
			return { swapped: false, current };
		}
		if (value === undefined) {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}
		return { swapped: true, current: value };
	}

	getRaw(key: string): string | undefined {
		return this.values.get(key);
	}

	setRaw(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class CompareAndSwapFailingPluginStateStore extends MemoryPluginStateStore {
	private failNext = false;

	failNextCompareAndSwap(): void {
		this.failNext = true;
	}

	override async compareAndSwap(key: string, expected: string | undefined, value: string | undefined): Promise<{ swapped: boolean; current?: string }> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('fixture connection-state commit failure');
		}
		return super.compareAndSwap(key, expected, value);
	}
}
