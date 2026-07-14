/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../platform/secrets/common/secrets.js';
import { BASEHALF_CURATED_PLUGINS } from './basehalfPluginCatalog.js';
import { IBaseHalfPluginCatalogService } from './basehalfPluginCatalogService.js';

export const BASEHALF_MODEL_SERVICES_SETTING = 'basehalf.models.services';
export const BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID = 'basehalf.models.manage';
export const BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID = 'basehalf.models.configure';

const BASEHALF_MODEL_SERVICE_SECRET_PREFIX = 'basehalf.modelServices.';

export const BASEHALF_MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
export type BaseHalfModelCapability = typeof BASEHALF_MODEL_CAPABILITIES[number];
export type BaseHalfModelServiceAuthorization = 'bearer' | 'header' | 'none';

export interface IBaseHalfModelServiceConfiguration {
	readonly id: string;
	readonly label: string;
	readonly endpoint: string;
	readonly capabilities: readonly BaseHalfModelCapability[];
	readonly authorization: BaseHalfModelServiceAuthorization;
	readonly headerName?: string;
}

export interface IBaseHalfModelServiceDescriptor extends IBaseHalfModelServiceConfiguration {
	/** Whether this connection currently has every credential its auth mode requires. */
	readonly configured: boolean;
}

/**
 * A short-lived connection snapshot returned only to an admitted executable
 * plugin. API keys never enter settings.json, project files, plugin catalogs,
 * telemetry, or the model-service descriptor list.
 */
export interface IBaseHalfModelServiceAccess extends IBaseHalfModelServiceConfiguration {
	readonly apiKey?: string;
}

export type BaseHalfModelServicesConfiguration = Readonly<Record<string, Omit<IBaseHalfModelServiceConfiguration, 'id'>>>;

export const IBaseHalfModelServiceService = createDecorator<IBaseHalfModelServiceService>('basehalfModelServiceService');

export interface IBaseHalfModelServiceService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getServices(extensionId?: string, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]>;
	getAccess(extensionId: string, serviceId: string): Promise<IBaseHalfModelServiceAccess | undefined>;
	upsert(configuration: IBaseHalfModelServiceConfiguration, apiKey?: string): Promise<void>;
	remove(serviceId: string): Promise<void>;
}

export class BaseHalfModelServiceService extends Disposable implements IBaseHalfModelServiceService {
	declare readonly _serviceBrand: undefined;

	private readonly mutationQueue = this._register(new Queue<void>());
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IBaseHalfPluginCatalogService private readonly pluginCatalogService: IBaseHalfPluginCatalogService,
	) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(BASEHALF_MODEL_SERVICES_SETTING)) {
				this._onDidChange.fire();
			}
		}));
		this._register(this.secretStorageService.onDidChangeSecret(key => {
			if (key.startsWith(BASEHALF_MODEL_SERVICE_SECRET_PREFIX)) {
				this._onDidChange.fire();
			}
		}));
	}

	async getServices(extensionId?: string, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]> {
		if (extensionId !== undefined) {
			await this.assertConsumer(extensionId);
		}
		if (capability !== undefined && !isBaseHalfModelCapability(capability)) {
			throw new Error(`Unknown BaseHalf model capability '${capability}'.`);
		}

		const configurations = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
		const descriptors = await Promise.all(Object.values(configurations).map(async configuration => ({
			...configuration,
			configured: configuration.authorization === 'none' || !!await this.secretStorageService.get(baseHalfModelServiceSecretKey(configuration.id))
		})));
		return descriptors
			.filter(service => capability === undefined || service.capabilities.includes(capability))
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	async getAccess(extensionId: string, serviceId: string): Promise<IBaseHalfModelServiceAccess | undefined> {
		await this.assertConsumer(extensionId);
		const id = normalizeBaseHalfModelServiceId(serviceId);
		const service = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING))[id];
		if (!service) {
			return undefined;
		}
		const apiKey = service.authorization === 'none' ? undefined : await this.secretStorageService.get(baseHalfModelServiceSecretKey(id));
		if (service.authorization !== 'none' && !apiKey) {
			return undefined;
		}
		return { ...service, apiKey };
	}

	async upsert(configuration: IBaseHalfModelServiceConfiguration, apiKey?: string): Promise<void> {
		const sanitized = sanitizeBaseHalfModelServiceConfiguration(configuration.id, configuration);
		if (!sanitized) {
			throw new Error('The model service connection is invalid. Check its id, HTTPS endpoint, capabilities, and authorization settings.');
		}
		if (sanitized.authorization !== 'none' && apiKey !== undefined && !apiKey.trim()) {
			throw new Error('API key cannot be empty.');
		}

		await this.mutationQueue.queue(async () => {
			const current = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
			const { id, ...stored } = sanitized;
			await this.configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, { ...toStoredModelServicesConfiguration(current), [id]: stored }, ConfigurationTarget.APPLICATION);
			if (sanitized.authorization === 'none') {
				await this.secretStorageService.delete(baseHalfModelServiceSecretKey(id));
			} else if (apiKey !== undefined) {
				await this.secretStorageService.set(baseHalfModelServiceSecretKey(id), apiKey.trim());
			}
		});
	}

	async remove(serviceId: string): Promise<void> {
		const id = normalizeBaseHalfModelServiceId(serviceId);
		await this.mutationQueue.queue(async () => {
			const current = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
			if (current[id]) {
				const next = toStoredModelServicesConfiguration(current);
				delete next[id];
				await this.configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, next, ConfigurationTarget.APPLICATION);
			}
			await this.secretStorageService.delete(baseHalfModelServiceSecretKey(id));
		});
	}

	private async assertConsumer(extensionId: string): Promise<void> {
		const snapshot = await this.pluginCatalogService.getSnapshot();
		if (!isBaseHalfModelServiceConsumerAllowed(extensionId, snapshot.plugins.map(plugin => plugin.extensionId))) {
			throw new Error(`Extension '${extensionId}' is not admitted to BaseHalf model services.`);
		}
	}
}

export function baseHalfModelServiceSecretKey(serviceId: string): string {
	return `${BASEHALF_MODEL_SERVICE_SECRET_PREFIX}${normalizeBaseHalfModelServiceId(serviceId)}.apiKey`;
}

export function normalizeBaseHalfModelServiceId(value: string): string {
	return value.trim().toLowerCase();
}

export function isBaseHalfModelCapability(value: unknown): value is BaseHalfModelCapability {
	return typeof value === 'string' && (BASEHALF_MODEL_CAPABILITIES as readonly string[]).includes(value);
}

export function isBaseHalfModelServiceConsumerAllowed(
	extensionId: string,
	admittedExtensionIds: readonly string[] = BASEHALF_CURATED_PLUGINS.map(plugin => plugin.extensionId)
): boolean {
	const id = extensionId.trim().toLowerCase();
	return admittedExtensionIds.some(candidate => candidate.trim().toLowerCase() === id);
}

export function sanitizeBaseHalfModelServicesConfiguration(value: unknown): Record<string, IBaseHalfModelServiceConfiguration> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const result: Record<string, IBaseHalfModelServiceConfiguration> = {};
	for (const [id, candidate] of Object.entries(value)) {
		const sanitized = sanitizeBaseHalfModelServiceConfiguration(id, candidate);
		if (sanitized) {
			result[sanitized.id] = sanitized;
		}
	}
	return result;
}

export function sanitizeBaseHalfModelServiceConfiguration(serviceId: string, value: unknown): IBaseHalfModelServiceConfiguration | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Partial<IBaseHalfModelServiceConfiguration>;
	const id = normalizeBaseHalfModelServiceId(serviceId);
	const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
	const endpoint = typeof candidate.endpoint === 'string' ? normalizeModelServiceEndpoint(candidate.endpoint) : undefined;
	const authorization = candidate.authorization;
	const capabilities = Array.isArray(candidate.capabilities)
		? [...new Set(candidate.capabilities.filter(isBaseHalfModelCapability))]
		: [];
	const headerName = typeof candidate.headerName === 'string' ? candidate.headerName.trim() : undefined;
	if (!/^[a-z][a-z0-9.-]{0,63}$/.test(id)
		|| !label || label.length > 80
		|| !endpoint
		|| !capabilities.length
		|| (authorization !== 'bearer' && authorization !== 'header' && authorization !== 'none')
		|| (authorization === 'header' && (!headerName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)))) {
		return undefined;
	}
	return {
		id,
		label,
		endpoint,
		capabilities,
		authorization,
		...(authorization === 'header' ? { headerName } : {})
	};
}

function normalizeModelServiceEndpoint(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
		if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) {
			return undefined;
		}
		return url.href.replace(/\/$/, '');
	} catch {
		return undefined;
	}
}

function toStoredModelServicesConfiguration(configurations: Readonly<Record<string, IBaseHalfModelServiceConfiguration>>): Record<string, Omit<IBaseHalfModelServiceConfiguration, 'id'>> {
	return Object.fromEntries(Object.values(configurations).map(configuration => {
		const { id, ...stored } = configuration;
		return [id, stored];
	}));
}

registerSingleton(IBaseHalfModelServiceService, BaseHalfModelServiceService, InstantiationType.Delayed);
