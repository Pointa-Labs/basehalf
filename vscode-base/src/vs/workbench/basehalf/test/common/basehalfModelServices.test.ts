/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { Event } from '../../../../base/common/event.js';
import { IBaseHalfPluginCatalogService } from '../../common/basehalfPluginCatalogService.js';
import {
	BASEHALF_MODEL_SERVICES_SETTING,
	BaseHalfModelServiceService,
	baseHalfModelServiceSecretKey,
	isBaseHalfModelServiceConsumerAllowed,
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
		assert.strictEqual(isBaseHalfModelServiceConsumerAllowed('pointa.basehalf-ai-video'), true);
		assert.strictEqual(isBaseHalfModelServiceConsumerAllowed('unknown.extension'), false);
		assert.strictEqual(isBaseHalfModelServiceConsumerAllowed('community.workflow', ['community.workflow']), true);
	});

	test('stores the key outside configuration and exposes it only through admitted access', async () => {
		const configurationService = new MutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, pluginCatalog());
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
			assert.strictEqual((await service.getServices()).every(candidate => candidate.configured), true);
			assert.strictEqual((await service.getAccess('pointa.basehalf-ai-video', 'studio.media'))?.apiKey, 'secret-value');
			assert.strictEqual((await service.getAccess('community.workflow', 'studio.media'))?.apiKey, 'secret-value');
			await assert.rejects(() => service.getAccess('unknown.extension', 'studio.media'), /not admitted/);

			await service.remove('studio.media');
			assert.deepStrictEqual((await service.getServices()).map(candidate => candidate.id), ['local.audio']);
			assert.strictEqual(await secretStorageService.get(baseHalfModelServiceSecretKey('studio.media')), undefined);
		} finally {
			service.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});

	test('serializes global connection writes so concurrent additions do not overwrite each other', async () => {
		const configurationService = new DelayedMutableTestConfigurationService();
		const secretStorageService = new TestSecretStorageService();
		const service = new BaseHalfModelServiceService(configurationService, secretStorageService, pluginCatalog());
		try {
			await Promise.all([
				service.upsert({ id: 'studio.image', label: 'Studio image', endpoint: 'https://image.example.com', capabilities: ['image'], authorization: 'none' }),
				service.upsert({ id: 'studio.video', label: 'Studio video', endpoint: 'https://video.example.com', capabilities: ['video'], authorization: 'none' }),
			]);

			assert.deepStrictEqual((await service.getServices()).map(candidate => candidate.id), ['studio.image', 'studio.video']);
		} finally {
			service.dispose();
			secretStorageService.dispose();
			configurationService.onDidChangeConfigurationEmitter.dispose();
		}
	});
});

function pluginCatalog(): IBaseHalfPluginCatalogService {
	const plugins = [
		{ extensionId: 'pointa.basehalf-ai-video' },
		{ extensionId: 'community.workflow' }
	] as never;
	return {
		_serviceBrand: undefined,
		onDidChange: Event.None,
		getSnapshot: async () => ({ plugins, source: 'remote' }),
		refresh: async () => ({ plugins, source: 'remote' })
	};
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
