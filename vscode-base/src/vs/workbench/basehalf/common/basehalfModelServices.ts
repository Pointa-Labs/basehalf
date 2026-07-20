/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../platform/secrets/common/secrets.js';
import { IBaseHalfPluginAdmissionService, IBaseHalfPluginContributorIdentity } from './basehalfPluginAdmissionService.js';

export const BASEHALF_MODEL_SERVICES_SETTING = 'basehalf.models.services';
export const BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID = 'basehalf.models.manage';
export const BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID = 'basehalf.models.configure';

const BASEHALF_MODEL_SERVICE_SECRET_PREFIX = 'basehalf.modelServices.';
const BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION = 1;
export const BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH = 16 * 1024;

interface IBaseHalfModelServiceCredential {
	readonly version: typeof BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION;
	readonly connectionIdentity: string;
	readonly apiKey: string;
}

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
	/** Stable digest of the non-secret connection settings used for run audits. */
	readonly connectionIdentity: string;
	/** Whether this connection currently has every credential its auth mode requires. */
	readonly configured: boolean;
}

/**
 * A short-lived connection snapshot returned only to an admitted executable
 * plugin. API keys never enter settings.json, project files, plugin catalogs,
 * telemetry, or the model-service descriptor list.
 */
export interface IBaseHalfModelServiceAccess extends IBaseHalfModelServiceConfiguration {
	readonly connectionIdentity: string;
	readonly apiKey?: string;
}

export interface IBaseHalfModelServiceRunSnapshot {
	readonly serviceId: string;
	readonly serviceLabel: string;
	readonly connectionIdentity: string;
	readonly capability: BaseHalfModelCapability;
	readonly modelId?: string;
}

export type BaseHalfModelServicesConfiguration = Readonly<Record<string, Omit<IBaseHalfModelServiceConfiguration, 'id'>>>;

export const IBaseHalfModelServiceService = createDecorator<IBaseHalfModelServiceService>('basehalfModelServiceService');

export interface IBaseHalfModelServiceService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getServices(consumer?: IBaseHalfPluginContributorIdentity, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]>;
	getAccess(consumer: IBaseHalfPluginContributorIdentity, snapshot: IBaseHalfModelServiceRunSnapshot): Promise<IBaseHalfModelServiceAccess | undefined>;
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
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService,
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

	async getServices(consumer?: IBaseHalfPluginContributorIdentity, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]> {
		if (consumer !== undefined) {
			this.assertConsumer(consumer);
		}
		if (capability !== undefined && !isBaseHalfModelCapability(capability)) {
			throw new Error(`Unknown BaseHalf model capability '${capability}'.`);
		}

		const configurations = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
		const descriptors = await Promise.all(Object.values(configurations).map(async configuration => {
			const connectionIdentity = await baseHalfModelServiceConnectionIdentity(configuration);
			return {
				...configuration,
				connectionIdentity,
				configured: configuration.authorization === 'none'
					|| !!await readBaseHalfModelServiceApiKey(this.secretStorageService, configuration.id, connectionIdentity)
			};
		}));
		return descriptors
			.filter(service => capability === undefined || service.capabilities.includes(capability))
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	async getAccess(consumer: IBaseHalfPluginContributorIdentity, snapshot: IBaseHalfModelServiceRunSnapshot): Promise<IBaseHalfModelServiceAccess | undefined> {
		this.assertConsumer(consumer);
		const id = normalizeBaseHalfModelServiceId(snapshot.serviceId);
		const service = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING))[id];
		if (!service || !isBaseHalfModelCapability(snapshot.capability) || !service.capabilities.includes(snapshot.capability)) {
			return undefined;
		}
		const connectionIdentity = await baseHalfModelServiceConnectionIdentity(service);
		if (connectionIdentity !== snapshot.connectionIdentity) {
			return undefined;
		}
		const apiKey = service.authorization === 'none'
			? undefined
			: await readBaseHalfModelServiceApiKey(this.secretStorageService, id, connectionIdentity);
		if (service.authorization !== 'none' && !apiKey) {
			return undefined;
		}
		return { ...service, connectionIdentity, apiKey };
	}

	async upsert(configuration: IBaseHalfModelServiceConfiguration, apiKey?: string): Promise<void> {
		const sanitized = sanitizeBaseHalfModelServiceConfiguration(configuration.id, configuration);
		if (!sanitized) {
			throw new Error('The model service connection is invalid. Check its id, HTTPS endpoint, capabilities, and authorization settings.');
		}
		if (sanitized.authorization !== 'none' && apiKey !== undefined
			&& (!apiKey.trim() || apiKey.trim().length > BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH)) {
			throw new Error(`API key must contain between 1 and ${BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH.toLocaleString()} characters.`);
		}

		await this.mutationQueue.queue(async () => {
			const current = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
			const previous = current[sanitized.id];
			const [previousConnectionIdentity, connectionIdentity] = await Promise.all([
				previous ? baseHalfModelServiceConnectionIdentity(previous) : undefined,
				baseHalfModelServiceConnectionIdentity(sanitized)
			]);
			const { id, ...stored } = sanitized;
			const mustDiscardCredential = sanitized.authorization === 'none'
				|| !previous
				|| previousConnectionIdentity !== connectionIdentity;
			if (mustDiscardCredential) {
				await this.secretStorageService.delete(baseHalfModelServiceSecretKey(id));
			}
			await this.configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, { ...toStoredModelServicesConfiguration(current), [id]: stored }, ConfigurationTarget.APPLICATION);
			if (sanitized.authorization !== 'none' && apiKey !== undefined) {
				await this.secretStorageService.set(
					baseHalfModelServiceSecretKey(id),
					serializeBaseHalfModelServiceCredential(connectionIdentity, apiKey)
				);
			}
		});
	}

	async remove(serviceId: string): Promise<void> {
		const id = normalizeBaseHalfModelServiceId(serviceId);
		await this.mutationQueue.queue(async () => {
			const current = sanitizeBaseHalfModelServicesConfiguration(this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING));
			await this.secretStorageService.delete(baseHalfModelServiceSecretKey(id));
			if (current[id]) {
				const next = toStoredModelServicesConfiguration(current);
				delete next[id];
				await this.configurationService.updateValue(BASEHALF_MODEL_SERVICES_SETTING, next, ConfigurationTarget.APPLICATION);
			}
		});
	}

	private assertConsumer(consumer: IBaseHalfPluginContributorIdentity): void {
		if (!this.pluginAdmissionService.isAllowedContributor(consumer)) {
			throw new Error(`Extension '${consumer.extensionId}' is not admitted to BaseHalf model services.`);
		}
	}
}

export function baseHalfModelServiceSecretKey(serviceId: string): string {
	return `${BASEHALF_MODEL_SERVICE_SECRET_PREFIX}${normalizeBaseHalfModelServiceId(serviceId)}.apiKey`;
}

function serializeBaseHalfModelServiceCredential(connectionIdentity: string, apiKey: string): string {
	return JSON.stringify({
		version: BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION,
		connectionIdentity,
		apiKey: apiKey.trim()
	} satisfies IBaseHalfModelServiceCredential);
}

async function readBaseHalfModelServiceApiKey(
	secretStorageService: ISecretStorageService,
	serviceId: string,
	expectedConnectionIdentity: string
): Promise<string | undefined> {
	const stored = await secretStorageService.get(baseHalfModelServiceSecretKey(serviceId));
	if (!stored || stored.length > BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH + 256) {
		return undefined;
	}
	try {
		const candidate = JSON.parse(stored) as Partial<IBaseHalfModelServiceCredential>;
		if (!candidate || typeof candidate !== 'object'
			|| candidate.version !== BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION
			|| candidate.connectionIdentity !== expectedConnectionIdentity
			|| typeof candidate.apiKey !== 'string'
			|| !candidate.apiKey.trim()
			|| candidate.apiKey.length > BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH) {
			return undefined;
		}
		return candidate.apiKey;
	} catch {
		// Unbound legacy values are deliberately not reused. The user must enter
		// the key once so it can be tied to the connection identity.
		return undefined;
	}
}

export function normalizeBaseHalfModelServiceId(value: string): string {
	return value.trim().toLowerCase();
}

export function isBaseHalfModelCapability(value: unknown): value is BaseHalfModelCapability {
	return typeof value === 'string' && (BASEHALF_MODEL_CAPABILITIES as readonly string[]).includes(value);
}

export async function baseHalfModelServiceConnectionIdentity(configuration: IBaseHalfModelServiceConfiguration): Promise<string> {
	const sanitized = sanitizeBaseHalfModelServiceConfiguration(configuration.id, configuration);
	if (!sanitized) {
		throw new Error('Cannot identify invalid model service settings.');
	}
	const canonical = JSON.stringify({
		endpoint: sanitized.endpoint,
		authorization: sanitized.authorization,
		headerName: sanitized.headerName ?? null
	});
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return `sha256:${encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true)}`;
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
		|| !label || label.length > 80 || /[\u0000-\u001F\u007F-\u009F]/.test(label)
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
