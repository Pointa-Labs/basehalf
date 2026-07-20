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
import { BASEHALF_CURATED_PLUGINS } from '../../common/basehalfPluginCatalog.js';
import { BaseHalfPluginAdmissionService, hashBaseHalfPluginInstall, IBaseHalfPluginContributorIdentity } from '../../common/basehalfPluginAdmissionService.js';
import {
	BASEHALF_MODEL_SERVICES_SETTING,
	BaseHalfModelServiceService,
	baseHalfModelServiceSecretKey,
	sanitizeBaseHalfModelServiceConfiguration,
	sanitizeBaseHalfModelServicesConfiguration,
} from '../../common/basehalfModelServices.js';

suite('BaseHalfModelServices', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes global connection metadata without accepting a credential field', () => {
		const services = sanitizeBaseHalfModelServicesConfiguration({
			'STUDIO.API': {
				label: ' Studio account ',
				endpoint: 'https://models.example.com/v1/',
				capabilities: ['video', 'image', 'video', 'unknown'],
				authorization: 'bearer',
				apiKey: 'must-not-enter-the-descriptor'
			}
		});

		assert.deepStrictEqual(services, {
			'studio.api': {
				id: 'studio.api',
				label: 'Studio account',
				endpoint: 'https://models.example.com/v1',
				capabilities: ['video', 'image'],
				authorization: 'bearer'
			}
		});
		assert.strictEqual(Object.hasOwn(services['studio.api'], 'apiKey'), false);
	});

	test('allows local HTTP services but rejects unsafe remote endpoints and auth metadata', () => {
		assert.ok(sanitizeBaseHalfModelServiceConfiguration('local.media', {
			label: 'Local media',
			endpoint: 'http://127.0.0.1:8188',
			capabilities: ['image'],
			authorization: 'none'
		}));
		assert.strictEqual(sanitizeBaseHalfModelServiceConfiguration('remote.media', {
			label: 'Remote media',
			endpoint: 'http://models.example.com',
			capabilities: ['video'],
			authorization: 'bearer'
		}), undefined);
		assert.strictEqual(sanitizeBaseHalfModelServiceConfiguration('remote.media', {
			label: 'Remote\nmedia',
			endpoint: 'https://models.example.com',
			capabilities: ['video'],
			authorization: 'bearer'
		}), undefined);
		assert.strictEqual(sanitizeBaseHalfModelServiceConfiguration('remote.media', {
			label: 'Remote media',
			endpoint: 'https://models.example.com/v1?key=secret',
			capabilities: ['video'],
			authorization: 'bearer'
		}), undefined);
		assert.strictEqual(sanitizeBaseHalfModelServiceConfiguration('remote.media', {
			label: 'Remote media',
			endpoint: 'https://models.example.com',
			capabilities: ['video'],
			authorization: 'header',
			headerName: 'bad header'
		}), undefined);
	});

	test('keeps credentials application-global and limits reads to admitted plugins', () => {
		assert.strictEqual(baseHalfModelServiceSecretKey('Studio.API'), 'basehalf.modelServices.studio.api.apiKey');
	});

	test('stores the key outside configuration and exposes it only through admitted access', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const storageService = new InMemoryStorageService();
		const files = fileService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), files);
		const sha256 = 'a'.repeat(64);
		const extensionLocation = installedIdentity('community.workflow', '1.0.0').extensionLocation;
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, extensionLocation);
		admissionService.replaceVerifiedPlugins([{ extensionId: 'community.workflow', versions: [{ version: '1.0.0', sha256, installedContentSha256 }] }]);
		assert.ok(await admissionService.verifyAndRecordInstall({ extensionId: 'community.workflow', version: '1.0.0', sha256, extensionLocation, expectedInstalledContentSha256: installedContentSha256 }));
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, admissionService);
		try {
			await service.upsert({
				id: 'studio.media',
				label: 'Studio media',
				endpoint: 'https://models.example.com/v1',
				capabilities: ['image', 'video'],
				authorization: 'bearer'
			}, 'secret-value');
			await service.upsert({
				id: 'local.audio',
				label: 'Local audio',
				endpoint: 'http://localhost:9000',
				capabilities: ['audio'],
				authorization: 'none'
			});

			const stored = configurationService.getValue<Record<string, Record<string, unknown>>>(BASEHALF_MODEL_SERVICES_SETTING)!;
			assert.strictEqual(Object.hasOwn(stored['studio.media'], 'apiKey'), false);
			assert.strictEqual(Object.hasOwn(stored['studio.media'], 'id'), false);
			assert.strictEqual(Object.hasOwn(stored['local.audio'], 'id'), false);
			assert.notStrictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey('studio.media')), 'secret-value');
			const services = await service.getServices();
			assert.strictEqual(services.every(candidate => candidate.configured), true);
			const studio = services.find(candidate => candidate.id === 'studio.media')!;
			assert.match(studio.connectionIdentity, /^sha256:[A-Za-z0-9_-]{43}$/);
			const snapshot = {
				serviceId: studio.id,
				serviceLabel: studio.label,
				connectionIdentity: studio.connectionIdentity,
				capability: 'video' as const
			};
			assert.strictEqual((await service.getAccess(bundledOfficialIdentity(), snapshot))?.apiKey, 'secret-value');
			assert.strictEqual((await service.getAccess(installedIdentity('community.workflow', '1.0.0'), snapshot))?.apiKey, 'secret-value');
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), { ...snapshot, capability: 'audio' }), undefined);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), { ...snapshot, connectionIdentity: `sha256:${'A'.repeat(43)}` }), undefined);
			await assert.rejects(() => service.getAccess(installedIdentity('pointa.basehalf-ai-video', '0.1.0'), snapshot), /not admitted/);
			await assert.rejects(() => service.getAccess(installedIdentity('community.workflow', '1.0.1'), snapshot), /not admitted/);
			await assert.rejects(() => service.getAccess(installedIdentity('unknown.extension', '1.0.0'), snapshot), /not admitted/);

			await service.upsert({
				id: 'studio.media',
				label: 'Studio media',
				endpoint: 'https://models.example.com/v1',
				capabilities: ['image', 'video'],
				authorization: 'bearer'
			}, 'rotated-secret');
			const rotated = (await service.getServices()).find(candidate => candidate.id === 'studio.media')!;
			assert.strictEqual(rotated.connectionIdentity, snapshot.connectionIdentity);
			assert.strictEqual((await service.getAccess(bundledOfficialIdentity(), snapshot))?.apiKey, 'rotated-secret');

			await service.upsert({
				id: 'studio.media',
				label: 'Renamed media',
				endpoint: 'https://models.example.com/v1',
				capabilities: ['image', 'video', 'audio'],
				authorization: 'bearer'
			});
			const renamed = (await service.getServices()).find(candidate => candidate.id === 'studio.media')!;
			assert.strictEqual(renamed.connectionIdentity, snapshot.connectionIdentity);
			assert.strictEqual(renamed.configured, true);
			assert.strictEqual((await service.getAccess(bundledOfficialIdentity(), snapshot))?.apiKey, 'rotated-secret');

			await service.upsert({
				id: 'studio.media',
				label: 'Moved media',
				endpoint: 'https://other.example.com/v1',
				capabilities: ['image', 'video'],
				authorization: 'bearer'
			});
			const moved = (await service.getServices()).find(candidate => candidate.id === 'studio.media')!;
			assert.notStrictEqual(moved.connectionIdentity, snapshot.connectionIdentity);
			assert.strictEqual(moved.configured, false);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), snapshot), undefined);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), {
				serviceId: moved.id,
				serviceLabel: moved.label,
				connectionIdentity: moved.connectionIdentity,
				capability: 'video'
			}), undefined);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey('studio.media')), undefined);

			await service.upsert({
				id: 'studio.media',
				label: 'Moved media',
				endpoint: 'https://other.example.com/v1',
				capabilities: ['image', 'video'],
				authorization: 'bearer'
			}, 'new-endpoint-secret');
			await service.upsert({
				id: 'studio.media',
				label: 'Moved media',
				endpoint: 'https://other.example.com/v1',
				capabilities: ['image', 'video'],
				authorization: 'header',
				headerName: 'x-api-key'
			});
			const changedAuthorization = (await service.getServices()).find(candidate => candidate.id === 'studio.media')!;
			assert.strictEqual(changedAuthorization.configured, false);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey('studio.media')), undefined);

			await service.remove('studio.media');
			assert.deepStrictEqual((await service.getServices()).map(candidate => candidate.id), ['local.audio']);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey('studio.media')), undefined);
		} finally {
			service.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});

	test('does not reuse an unbound legacy key or a key after settings change outside the service', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const storageService = new InMemoryStorageService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, admissionService);
		try {
			const initial = {
				id: 'studio.media',
				label: 'Studio media',
				endpoint: 'https://models.example.com/v1',
				capabilities: ['video'] as const,
				authorization: 'bearer' as const
			};
			await service.upsert(initial, 'bound-secret');
			await configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, {
				'studio.media': {
					label: initial.label,
					endpoint: 'https://other.example.com/v1',
					capabilities: ['video'],
					authorization: 'bearer'
				}
			});
			const moved = (await service.getServices())[0];
			assert.strictEqual(moved.configured, false);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), {
				serviceId: moved.id,
				serviceLabel: moved.label,
				connectionIdentity: moved.connectionIdentity,
				capability: 'video'
			}), undefined);

			await secretStorageService.set(baseHalfModelServiceSecretKey(initial.id), 'legacy-unbound-secret');
			assert.strictEqual((await service.getServices())[0].configured, false);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), {
				serviceId: moved.id,
				serviceLabel: moved.label,
				connectionIdentity: moved.connectionIdentity,
				capability: 'video'
			}), undefined);
		} finally {
			service.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});

	test('does not hide a connection or reactivate its credential when secret deletion fails', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new DeleteFailingSecretStorageService();
		const storageService = new InMemoryStorageService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, admissionService);
		const configuration = {
			id: 'studio.media',
			label: 'Studio media',
			endpoint: 'https://models.example.com/v1',
			capabilities: ['video'] as const,
			authorization: 'bearer' as const
		};
		try {
			await service.upsert(configuration, 'bound-secret');
			const before = (await service.getServices())[0];
			secretStorageService.failNextDelete();
			await assert.rejects(() => service.remove(configuration.id), /fixture secret deletion failure/);

			const afterFailedRemoval = (await service.getServices())[0];
			assert.strictEqual(afterFailedRemoval.id, configuration.id);
			assert.strictEqual(afterFailedRemoval.configured, true);
			assert.strictEqual((await service.getAccess(bundledOfficialIdentity(), {
				serviceId: before.id,
				serviceLabel: before.label,
				connectionIdentity: before.connectionIdentity,
				capability: 'video'
			}))?.apiKey, 'bound-secret');

			await service.remove(configuration.id);
			assert.deepStrictEqual(await service.getServices(), []);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey(configuration.id)), undefined);

			await service.upsert(configuration);
			const readded = (await service.getServices())[0];
			assert.strictEqual(readded.configured, false);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), {
				serviceId: readded.id,
				serviceLabel: readded.label,
				connectionIdentity: readded.connectionIdentity,
				capability: 'video'
			}), undefined);
		} finally {
			service.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});

	test('does not reactivate an old credential when storing its replacement fails', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new SetFailingSecretStorageService();
		const storageService = new InMemoryStorageService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, admissionService);
		const original = {
			id: 'studio.media',
			label: 'Studio media',
			endpoint: 'https://models.example.com/v1',
			capabilities: ['video'] as const,
			authorization: 'bearer' as const
		};
		try {
			await service.upsert(original, 'old-secret');
			secretStorageService.failNextSet();
			await assert.rejects(() => service.upsert({
				...original,
				endpoint: 'https://other.example.com/v1'
			}, 'replacement-secret'), /fixture secret storage failure/);

			const moved = (await service.getServices())[0];
			assert.strictEqual(moved.endpoint, 'https://other.example.com/v1');
			assert.strictEqual(moved.configured, false);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey(original.id)), undefined);

			await service.upsert(original);
			const restored = (await service.getServices())[0];
			assert.strictEqual(restored.configured, false);
			assert.strictEqual(await service.getAccess(bundledOfficialIdentity(), {
				serviceId: restored.id,
				serviceLabel: restored.label,
				connectionIdentity: restored.connectionIdentity,
				capability: 'video'
			}), undefined);
		} finally {
			service.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});

	test('serializes global connection writes so concurrent additions do not overwrite each other', async () => {
		const configurationService = new DelayedMutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const storageService = new InMemoryStorageService();
		const admissionService = new BaseHalfPluginAdmissionService(storageService, environment(), fileService());
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, admissionService);
		try {
			await Promise.all([
				service.upsert({ id: 'studio.image', label: 'Studio image', endpoint: 'https://image.example.com', capabilities: ['image'], authorization: 'none' }),
				service.upsert({ id: 'studio.video', label: 'Studio video', endpoint: 'https://video.example.com', capabilities: ['video'], authorization: 'none' }),
			]);

			assert.deepStrictEqual((await service.getServices()).map(candidate => candidate.id), ['studio.image', 'studio.video']);
		} finally {
			service.dispose();
			admissionService.dispose();
			storageService.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});
});

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
	override async updateValue(key: string, value: unknown): Promise<void> {
		await this.setUserConfiguration(key, value);
	}
}

class DelayedMutableTestConfigurationService extends MutableTestConfigurationService {
	override async updateValue(key: string, value: unknown): Promise<void> {
		await new Promise(resolve => setTimeout(resolve, 5));
		await super.updateValue(key, value);
	}
}

class DeleteFailingSecretStorageService extends TestSecretStorageService {
	private remainingDeleteFailures = 0;

	failNextDelete(): void {
		this.remainingDeleteFailures++;
	}

	override async delete(key: string): Promise<void> {
		if (this.remainingDeleteFailures > 0) {
			this.remainingDeleteFailures--;
			throw new Error('fixture secret deletion failure');
		}
		await super.delete(key);
	}
}

class SetFailingSecretStorageService extends TestSecretStorageService {
	private remainingSetFailures = 0;

	failNextSet(): void {
		this.remainingSetFailures++;
	}

	override async set(key: string, value: string): Promise<void> {
		if (this.remainingSetFailures > 0) {
			this.remainingSetFailures--;
			throw new Error('fixture secret storage failure');
		}
		await super.set(key, value);
	}
}
