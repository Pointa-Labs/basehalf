/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid, isUUID } from '../../../base/common/uuid.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope } from '../../../platform/storage/common/storage.js';
import { ActivationKind, IExtensionService } from '../../services/extensions/common/extensions.js';
import { IBaseHalfPluginAdmissionService, IBaseHalfPluginContributorIdentity } from './basehalfPluginAdmissionService.js';
import { IBaseHalfModelCredentialStore } from './basehalfModelCredentialStore.js';
import { IBaseHalfPluginStateStore } from './basehalfPluginStateStore.js';
import {
	IBaseHalfModelProviderConnectionValidator,
	IBaseHalfModelProviderCatalogService,
	IBaseHalfRegisteredModelProviderConnectionSpec,
	IBaseHalfResolvedModelProviderConnection,
	resolveBaseHalfModelProviderConnection
} from './basehalfModelProviderCatalogs.js';

export const BASEHALF_MODEL_SERVICES_SETTING = 'basehalf.models.services';
export const BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID = 'basehalf.models.manage';
export const BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID = 'basehalf.models.configure';

export const BASEHALF_MODEL_SERVICES_SCHEMA_VERSION = 2 as const;
const BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION = 2 as const;
const BASEHALF_LEGACY_MODEL_SERVICE_SECRET_PREFIX = 'basehalf.modelServices.';
const BASEHALF_MODEL_CONNECTION_CREDENTIAL_PREFIX = 'basehalf.modelConnections.';
export const BASEHALF_MODEL_SERVICE_PENDING_SECRET_CLEANUP_STORAGE_KEY = 'basehalf.modelServices.pendingSecretCleanup.v1';
export const BASEHALF_MODEL_CONNECTION_PENDING_CREDENTIAL_CLEANUP_STORAGE_KEY = 'basehalf.modelConnections.pendingCredentialCleanup.v2';
export const BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH = 16 * 1024;

export const BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY = 'basehalf.plugins.modelConnections.state.v1';
const BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION = 1 as const;
const BASEHALF_MODEL_CONNECTION_STAGED_CREDENTIAL_TTL = 5 * 60 * 1000;

export const BASEHALF_MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
export type BaseHalfModelCapability = typeof BASEHALF_MODEL_CAPABILITIES[number];

interface IBaseHalfStoredModelConnection {
	readonly publicValues: Readonly<Record<string, string>>;
	readonly credentialRef: string;
}

export interface IBaseHalfStoredModelConnections {
	readonly schemaVersion: typeof BASEHALF_MODEL_SERVICES_SCHEMA_VERSION;
	readonly connections: Readonly<Record<string, IBaseHalfStoredModelConnection>>;
}

interface IBaseHalfModelServiceCredential {
	readonly version: typeof BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION;
	readonly connectionIdentity: string;
	readonly values: Readonly<Record<string, string>>;
}

interface IBaseHalfStoredModelConnectionState {
	readonly schemaVersion: typeof BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION;
	readonly connections: Readonly<Record<string, IBaseHalfStoredModelConnection>>;
	readonly attentionConnections: readonly string[];
	readonly stagedCredentials: Readonly<Record<string, number>>;
	readonly pendingCredentialCleanup: readonly string[];
	readonly pendingLegacySecretCleanup: readonly string[];
}

interface IBaseHalfStoredModelConnectionStateSnapshot {
	readonly raw: string | undefined;
	readonly state: IBaseHalfStoredModelConnectionState;
}

export interface IBaseHalfModelServiceConfiguration {
	readonly id: string;
	readonly specId: string;
	readonly label: string;
	readonly endpoint: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly capabilities: readonly BaseHalfModelCapability[];
	readonly authorization: 'bearer';
	/** Normalized non-secret values entered for the reviewed connection contract. */
	readonly publicValues: Readonly<Record<string, string>>;
}

export interface IBaseHalfModelServiceDescriptor extends IBaseHalfModelServiceConfiguration {
	/** Stable digest of every request-affecting, non-secret connection setting. */
	readonly connectionIdentity: string;
	/** Whether all credentials required by the reviewed contract exist in Keychain. */
	readonly configured: boolean;
}

/** A short-lived connection snapshot returned only to an admitted executable plugin. */
export interface IBaseHalfModelServiceAccess extends IBaseHalfModelServiceConfiguration {
	readonly connectionIdentity: string;
	readonly credentialValues: Readonly<Record<string, string>>;
	/** Compatibility alias for providers whose reviewed credential field is `apiKey`. */
	readonly apiKey?: string;
}

export interface IBaseHalfModelServiceAttemptSnapshot {
	readonly serviceId: string;
	readonly serviceLabel: string;
	readonly connectionIdentity: string;
	readonly capability: BaseHalfModelCapability;
	readonly modelId?: string;
}

export const IBaseHalfModelServiceService = createDecorator<IBaseHalfModelServiceService>('basehalfModelServiceService');

export interface IBaseHalfModelServiceService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getServices(consumer?: IBaseHalfPluginContributorIdentity, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]>;
	getAccess(consumer: IBaseHalfPluginContributorIdentity, snapshot: IBaseHalfModelServiceAttemptSnapshot): Promise<IBaseHalfModelServiceAccess | undefined>;
	saveConnection(specId: string, values: Readonly<Record<string, string>>): Promise<IBaseHalfModelServiceDescriptor>;
	testConnection(specId: string): Promise<IBaseHalfModelServiceDescriptor>;
	registerConnectionValidator(specId: string, extensionId: string, validator: IBaseHalfModelProviderConnectionValidator): IDisposable;
	remove(serviceId: string): Promise<void>;
}

interface IBaseHalfResolvedStoredConnection {
	readonly stored: IBaseHalfStoredModelConnection;
	readonly spec: IBaseHalfRegisteredModelProviderConnectionSpec;
	readonly configuration: IBaseHalfModelServiceConfiguration;
	readonly connectionIdentity: string;
}

export class BaseHalfModelServiceService extends Disposable implements IBaseHalfModelServiceService {
	declare readonly _serviceBrand: undefined;

	private readonly mutationQueue = this._register(new Queue<void>());
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private readonly initialLegacyCleanup: Promise<void>;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IBaseHalfPluginAdmissionService private readonly pluginAdmissionService: IBaseHalfPluginAdmissionService,
		@IBaseHalfModelProviderCatalogService private readonly providerCatalogService: IBaseHalfModelProviderCatalogService,
		@IBaseHalfPluginStateStore private readonly pluginStateStore: IBaseHalfPluginStateStore,
		@IBaseHalfModelCredentialStore private readonly credentialStore: IBaseHalfModelCredentialStore,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super();
		this.initialLegacyCleanup = this.mutationQueue.queue(async () => {
			const rawConfiguration = this.configurationService.getValue(BASEHALF_MODEL_SERVICES_SETTING);
			await this.migrateLegacyConnectionMetadata(rawConfiguration);
			await this.retryPendingCredentialCleanup();
		});
		const stateListenerStore = this._register(new DisposableStore());
		this._register(this.storageService.onDidChangeValue(
			StorageScope.APPLICATION,
			BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY,
			stateListenerStore
		)(() => this._onDidChange.fire()));
		this._register(this.secretStorageService.onDidChangeSecret(key => {
			if (key.startsWith(BASEHALF_LEGACY_MODEL_SERVICE_SECRET_PREFIX)
				|| key.startsWith(BASEHALF_MODEL_CONNECTION_CREDENTIAL_PREFIX)) {
				this._onDidChange.fire();
			}
		}));
		this._register(this.providerCatalogService.onDidChange(() => this._onDidChange.fire()));
	}

	async getServices(consumer?: IBaseHalfPluginContributorIdentity, capability?: BaseHalfModelCapability): Promise<readonly IBaseHalfModelServiceDescriptor[]> {
		await this.initialLegacyCleanup;
		if (consumer !== undefined) {
			this.assertConsumer(consumer);
		}
		if (capability !== undefined && !isBaseHalfModelCapability(capability)) {
			throw new Error(`Unknown BaseHalf model capability '${capability}'.`);
		}
		const stored = (await this.readConnectionState()).state;
		const descriptors: IBaseHalfModelServiceDescriptor[] = [];
		for (const [specId, connection] of Object.entries(stored.connections)) {
			const resolved = await this.resolveStoredConnection(specId, connection);
			if (!resolved || (capability !== undefined && !resolved.configuration.capabilities.includes(capability))) {
				continue;
			}
			const credential = await this.readCredential(resolved);
			descriptors.push(Object.freeze({
				...resolved.configuration,
				connectionIdentity: resolved.connectionIdentity,
				configured: credential !== undefined && !stored.attentionConnections.includes(specId)
			}));
		}
		return Object.freeze(descriptors.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)));
	}

	async getAccess(consumer: IBaseHalfPluginContributorIdentity, snapshot: IBaseHalfModelServiceAttemptSnapshot): Promise<IBaseHalfModelServiceAccess | undefined> {
		await this.initialLegacyCleanup;
		this.assertConsumer(consumer);
		if (!isBaseHalfModelCapability(snapshot.capability)) {
			return undefined;
		}
		const id = normalizeBaseHalfModelServiceId(snapshot.serviceId);
		const state = (await this.readConnectionState()).state;
		const stored = state.connections[id];
		if (!stored) {
			return undefined;
		}
		if (state.attentionConnections.includes(id)) {
			return undefined;
		}
		const resolved = await this.resolveStoredConnection(id, stored);
		if (!resolved
			|| !resolved.configuration.capabilities.includes(snapshot.capability)
			|| resolved.connectionIdentity !== snapshot.connectionIdentity) {
			return undefined;
		}
		const credential = await this.readCredential(resolved);
		if (!credential) {
			return undefined;
		}
		return Object.freeze({
			...resolved.configuration,
			connectionIdentity: resolved.connectionIdentity,
			credentialValues: credential.values,
			...(credential.values.apiKey ? { apiKey: credential.values.apiKey } : {})
		});
	}

	registerConnectionValidator(specId: string, extensionId: string, validator: IBaseHalfModelProviderConnectionValidator): IDisposable {
		return this.providerCatalogService.registerConnectionValidator(specId, extensionId, validator);
	}

	async saveConnection(specId: string, values: Readonly<Record<string, string>>): Promise<IBaseHalfModelServiceDescriptor> {
		await this.initialLegacyCleanup;
		const spec = this.providerCatalogService.getConnectionSpec(specId);
		if (!spec) {
			throw new Error('This official model provider is no longer installed or reviewed.');
		}
		const resolved = resolveBaseHalfModelProviderConnection(spec, values);
		await this.extensionService.activateByEvent(`onBaseHalfModelProviderCatalog:${spec.catalogId}`, ActivationKind.Immediate);
		try {
			await this.providerCatalogService.validateConnection(spec.id, resolved, CancellationToken.None);
		} catch (error) {
			throw new Error(redactBaseHalfModelConnectionSecrets(getErrorMessage(error), resolved.secretValues));
		}
		const configuration = configurationFromResolvedConnection(resolved);
		const connectionIdentity = await baseHalfModelServiceConnectionIdentity(configuration);
		const credentialRef = generateUuid();
		const credentialKey = baseHalfModelServiceCredentialKey(configuration.id, credentialRef);
		const serializedCredential = serializeBaseHalfModelServiceCredential(connectionIdentity, resolved.secretValues);
		let descriptor: IBaseHalfModelServiceDescriptor | undefined;

		await this.mutationQueue.queue(async () => {
			await this.updateConnectionState(state => ({
				...state,
				stagedCredentials: { ...state.stagedCredentials, [credentialKey]: Date.now() + BASEHALF_MODEL_CONNECTION_STAGED_CREDENTIAL_TTL }
			}));
			try {
				await this.credentialStore.set(credentialKey, serializedCredential);
			} catch (error) {
				await this.abandonStagedCredential(credentialKey);
				await this.retryPendingCredentialCleanup();
				throw error;
			}
			try {
				await this.updateConnectionState(state => {
					if (state.stagedCredentials[credentialKey] === undefined) {
						throw new Error('The staged model credential expired before it could be committed.');
					}
					const previous = state.connections[configuration.id];
					const previousCredentialKey = previous
						? baseHalfModelServiceCredentialKey(configuration.id, previous.credentialRef)
						: undefined;
					const stagedCredentials = { ...state.stagedCredentials };
					delete stagedCredentials[credentialKey];
					return {
						...state,
						connections: {
							...state.connections,
							[configuration.id]: Object.freeze({ publicValues: resolved.publicValues, credentialRef })
						},
						attentionConnections: state.attentionConnections.filter(id => id !== configuration.id),
						stagedCredentials,
						pendingCredentialCleanup: previousCredentialKey && previousCredentialKey !== credentialKey
							? uniqueStrings([...state.pendingCredentialCleanup, previousCredentialKey])
							: state.pendingCredentialCleanup.filter(key => key !== credentialKey)
					};
				});
			} catch (error) {
				await this.abandonStagedCredential(credentialKey);
				await this.retryPendingCredentialCleanup();
				throw error;
			}
			await this.retryPendingCredentialCleanup();
			descriptor = Object.freeze({ ...configuration, connectionIdentity, configured: true });
		});

		if (!descriptor) {
			throw new Error('The model connection was not saved.');
		}
		return descriptor;
	}

	async testConnection(specId: string): Promise<IBaseHalfModelServiceDescriptor> {
		await this.initialLegacyCleanup;
		const id = normalizeBaseHalfModelServiceId(specId);
		const snapshot = (await this.readConnectionState()).state;
		const stored = snapshot.connections[id];
		if (!stored) {
			throw new Error('This model connection is not configured.');
		}
		const connection = await this.resolveStoredConnection(id, stored);
		if (!connection) {
			await this.setConnectionAttention(id, stored.credentialRef, true);
			throw new Error('This model connection no longer matches an installed reviewed provider.');
		}
		const credential = await this.readCredential(connection);
		if (!credential) {
			await this.setConnectionAttention(id, stored.credentialRef, true);
			throw new Error('The stored model credential is unavailable. Replace the key or remove the connection.');
		}
		const values = { ...connection.configuration.publicValues, ...credential.values };
		try {
			const resolved = resolveBaseHalfModelProviderConnection(connection.spec, values);
			await this.extensionService.activateByEvent(`onBaseHalfModelProviderCatalog:${connection.spec.catalogId}`, ActivationKind.Immediate);
			await this.providerCatalogService.validateConnection(connection.spec.id, resolved, CancellationToken.None);
		} catch (error) {
			await this.setConnectionAttention(id, stored.credentialRef, true);
			throw new Error(redactBaseHalfModelConnectionSecrets(getErrorMessage(error), credential.values));
		}
		const current = await this.setConnectionAttention(id, stored.credentialRef, false);
		if (current.connections[id]?.credentialRef !== stored.credentialRef) {
			throw new Error('The model connection changed while it was being tested.');
		}
		return Object.freeze({ ...connection.configuration, connectionIdentity: connection.connectionIdentity, configured: true });
	}

	async remove(serviceId: string): Promise<void> {
		await this.initialLegacyCleanup;
		const id = normalizeBaseHalfModelServiceId(serviceId);
		await this.mutationQueue.queue(async () => {
			await this.updateConnectionState(state => {
				const previous = state.connections[id];
				if (!previous) {
					return state;
				}
				const connections = { ...state.connections };
				delete connections[id];
				return {
					...state,
					connections,
					attentionConnections: state.attentionConnections.filter(candidate => candidate !== id),
					pendingCredentialCleanup: uniqueStrings([
						...state.pendingCredentialCleanup,
						baseHalfModelServiceCredentialKey(id, previous.credentialRef)
					])
				};
			});
			await this.retryPendingCredentialCleanup();
		});
	}

	private async setConnectionAttention(
		id: string,
		credentialRef: string,
		needsAttention: boolean
	): Promise<IBaseHalfStoredModelConnectionState> {
		let result: IBaseHalfStoredModelConnectionState | undefined;
		await this.mutationQueue.queue(async () => {
			result = await this.updateConnectionState(state => {
				if (state.connections[id]?.credentialRef !== credentialRef) {
					return state;
				}
				return {
					...state,
					attentionConnections: needsAttention
						? uniqueStrings([...state.attentionConnections, id])
						: state.attentionConnections.filter(candidate => candidate !== id)
				};
			});
		});
		if (!result) {
			throw new Error('The model connection attention state was not updated.');
		}
		return result;
	}

	private assertConsumer(consumer: IBaseHalfPluginContributorIdentity): void {
		if (!this.pluginAdmissionService.isAllowedContributor(consumer)) {
			throw new Error(`Extension '${consumer.extensionId}' is not admitted to BaseHalf model services.`);
		}
	}

	private async resolveStoredConnection(specId: string, stored: IBaseHalfStoredModelConnection): Promise<IBaseHalfResolvedStoredConnection | undefined> {
		const spec = this.providerCatalogService.getConnectionSpec(specId);
		if (!spec) {
			return undefined;
		}
		try {
			const values: Record<string, string> = { ...stored.publicValues };
			for (const field of spec.fields) {
				if (field.type === 'secret' && values[field.id] === undefined) {
					values[field.id] = '__basehalf_keychain_secret__';
				}
			}
			const resolved = resolveBaseHalfModelProviderConnection(spec, values);
			const configuration = configurationFromResolvedConnection(resolved);
			return { stored, spec, configuration, connectionIdentity: await baseHalfModelServiceConnectionIdentity(configuration) };
		} catch {
			return undefined;
		}
	}

	private async readCredential(connection: IBaseHalfResolvedStoredConnection): Promise<IBaseHalfModelServiceCredential | undefined> {
		const key = baseHalfModelServiceCredentialKey(connection.configuration.id, connection.stored.credentialRef);
		let stored: string | undefined;
		try {
			stored = await this.credentialStore.get(key);
		} catch {
			// A temporarily unavailable or undecryptable credential must not prevent
			// the connection editor from listing, replacing, or removing its metadata.
			return undefined;
		}
		if (!stored) {
			return undefined;
		}
		try {
			if (stored.length > (BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH * 24) + 1024) {
				throw new Error('Credential envelope exceeds the reviewed field bound.');
			}
			const candidate = JSON.parse(stored) as Partial<IBaseHalfModelServiceCredential>;
			const secretFields = connection.spec.fields.filter(field => field.type === 'secret');
			if (!candidate || typeof candidate !== 'object'
				|| candidate.version !== BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION
				|| candidate.connectionIdentity !== connection.connectionIdentity
				|| !candidate.values || typeof candidate.values !== 'object' || Array.isArray(candidate.values)) {
				throw new Error('Credential envelope does not match this connection.');
			}
			const values: Record<string, string> = {};
			const secretIds = new Set(secretFields.map(field => field.id));
			if (Object.keys(candidate.values).some(id => !secretIds.has(id))) {
				throw new Error('Credential envelope contains an undeclared secret.');
			}
			for (const field of secretFields) {
				const value = candidate.values[field.id];
				if (value === undefined) {
					if (field.required) {
						throw new Error('Credential envelope is incomplete.');
					}
					continue;
				}
				if (typeof value !== 'string' || !value.trim() || value.length > BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH) {
					throw new Error('Credential envelope is incomplete.');
				}
				values[field.id] = value;
			}
			return Object.freeze({ version: BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION, connectionIdentity: candidate.connectionIdentity, values: Object.freeze(values) });
		} catch {
			try {
				await this.credentialStore.delete(key);
			} catch {
				// The invalid live envelope remains fail-closed and is retried on the
				// next read. Orphan cleanup is reserved for globally non-live refs.
			}
			return undefined;
		}
	}

	private async migrateLegacyConnectionMetadata(rawConfiguration: unknown): Promise<void> {
		const legacyStored = sanitizeBaseHalfStoredModelConnections(rawConfiguration);
		const droppedKeys = droppedStoredCredentialKeys(rawConfiguration);
		const oldPending = readPendingCredentialCleanup(this.storageService);
		const oldLegacyPending = readPendingLegacySecretCleanup(this.storageService);
		const legacyIds = legacyModelServiceIds(rawConfiguration);
		await this.updateConnectionState(state => {
			const connections = { ...state.connections };
			const pending = new Set([...state.pendingCredentialCleanup, ...droppedKeys, ...oldPending]);
			for (const [id, connection] of Object.entries(legacyStored.connections)) {
				const key = baseHalfModelServiceCredentialKey(id, connection.credentialRef);
				const current = connections[id];
				if (!current && !pending.has(key) && state.stagedCredentials[key] === undefined) {
					connections[id] = connection;
				} else if (current?.credentialRef !== connection.credentialRef) {
					pending.add(key);
				}
			}
			return {
				...state,
				connections,
				pendingCredentialCleanup: [...pending],
				pendingLegacySecretCleanup: uniqueStrings([
					...state.pendingLegacySecretCleanup,
					...oldLegacyPending,
					...legacyIds
				])
			};
		});
		this.storageService.remove(BASEHALF_MODEL_CONNECTION_PENDING_CREDENTIAL_CLEANUP_STORAGE_KEY, StorageScope.APPLICATION);
		this.storageService.remove(BASEHALF_MODEL_SERVICE_PENDING_SECRET_CLEANUP_STORAGE_KEY, StorageScope.APPLICATION);
	}

	private async abandonStagedCredential(key: string): Promise<void> {
		await this.updateConnectionState(state => {
			const stagedCredentials = { ...state.stagedCredentials };
			delete stagedCredentials[key];
			return {
				...state,
				stagedCredentials,
				pendingCredentialCleanup: uniqueStrings([...state.pendingCredentialCleanup, key])
			};
		});
	}

	private async retryPendingCredentialCleanup(): Promise<void> {
		for (const id of (await this.readConnectionState()).state.pendingLegacySecretCleanup) {
			try {
				await this.credentialStore.delete(baseHalfModelServiceSecretKey(id));
				await this.updateConnectionState(state => ({
					...state,
					pendingLegacySecretCleanup: state.pendingLegacySecretCleanup.filter(candidate => candidate !== id)
				}));
			} catch {
				// Keep the machine-local tombstone for the next startup.
			}
		}
		const now = Date.now();
		await this.updateConnectionState(state => {
			const stagedCredentials = { ...state.stagedCredentials };
			const pending = new Set(state.pendingCredentialCleanup);
			const live = storedCredentialKeys(state);
			for (const [key, expiresAt] of Object.entries(stagedCredentials)) {
				if (live.has(key)) {
					delete stagedCredentials[key];
				} else if (expiresAt <= now) {
					delete stagedCredentials[key];
					pending.add(key);
				}
			}
			for (const key of live) {
				pending.delete(key);
			}
			return { ...state, stagedCredentials, pendingCredentialCleanup: [...pending] };
		});

		for (const key of (await this.readConnectionState()).state.pendingCredentialCleanup) {
			try {
				await this.credentialStore.delete(key);
				await this.updateConnectionState(state => ({
					...state,
					pendingCredentialCleanup: state.pendingCredentialCleanup.filter(candidate => candidate !== key)
				}));
			} catch {
				// Keep the durable application-state tombstone for the next startup.
			}
		}
	}

	private async readConnectionState(): Promise<IBaseHalfStoredModelConnectionStateSnapshot> {
		const raw = await this.pluginStateStore.read(BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY);
		return { raw, state: sanitizeStoredModelConnectionState(raw) };
	}

	private async updateConnectionState(
		mutate: (state: IBaseHalfStoredModelConnectionState) => IBaseHalfStoredModelConnectionState
	): Promise<IBaseHalfStoredModelConnectionState> {
		for (;;) {
			const snapshot = await this.readConnectionState();
			const next = normalizeStoredModelConnectionState(mutate(snapshot.state));
			const serialized = JSON.stringify(next);
			if (serialized === snapshot.raw) {
				return next;
			}
			const result = await this.pluginStateStore.compareAndSwap(
				BASEHALF_MODEL_CONNECTION_STATE_STORAGE_KEY,
				snapshot.raw,
				serialized
			);
			if (result.swapped) {
				return next;
			}
		}
	}
}

function redactBaseHalfModelConnectionSecrets(message: string, secretValues: Readonly<Record<string, string>>): string {
	let redacted = message;
	for (const value of Object.values(secretValues)) {
		if (value) {
			redacted = redacted.replaceAll(value, '[REDACTED]');
		}
	}
	return redacted;
}

function configurationFromResolvedConnection(resolved: IBaseHalfResolvedModelProviderConnection): IBaseHalfModelServiceConfiguration {
	return Object.freeze({
		id: normalizeBaseHalfModelServiceId(resolved.specId),
		specId: normalizeBaseHalfModelServiceId(resolved.specId),
		label: resolved.label,
		endpoint: resolved.endpoint,
		providerId: resolved.providerId,
		deploymentId: resolved.deploymentId,
		region: resolved.region,
		capabilities: Object.freeze([...resolved.capabilities]) as readonly BaseHalfModelCapability[],
		authorization: resolved.authorization,
		publicValues: resolved.publicValues
	});
}

/** Legacy key address retained only so clean-break startup can delete it. */
export function baseHalfModelServiceSecretKey(serviceId: string): string {
	return `${BASEHALF_LEGACY_MODEL_SERVICE_SECRET_PREFIX}${normalizeBaseHalfModelServiceId(serviceId)}.apiKey`;
}

export function baseHalfModelServiceCredentialKey(serviceId: string, credentialRef: string): string {
	const id = normalizeBaseHalfModelServiceId(serviceId);
	if (!isCompleteContributionId(id) || !isUUID(credentialRef)) {
		throw new Error('Cannot address an invalid model connection credential.');
	}
	return `${BASEHALF_MODEL_CONNECTION_CREDENTIAL_PREFIX}${id}.${credentialRef}.credentials`;
}

function serializeBaseHalfModelServiceCredential(connectionIdentity: string, values: Readonly<Record<string, string>>): string {
	return JSON.stringify({ version: BASEHALF_MODEL_SERVICE_CREDENTIAL_VERSION, connectionIdentity, values } satisfies IBaseHalfModelServiceCredential);
}

export function normalizeBaseHalfModelServiceId(value: string): string {
	return value.trim().toLowerCase();
}

export function isBaseHalfModelCapability(value: unknown): value is BaseHalfModelCapability {
	return typeof value === 'string' && (BASEHALF_MODEL_CAPABILITIES as readonly string[]).includes(value);
}

export async function baseHalfModelServiceConnectionIdentity(configuration: IBaseHalfModelServiceConfiguration): Promise<string> {
	const canonicalPublicValues = Object.fromEntries(Object.entries(configuration.publicValues).sort(([left], [right]) => left.localeCompare(right)));
	const canonical = JSON.stringify({
		specId: normalizeBaseHalfModelServiceId(configuration.specId),
		endpoint: configuration.endpoint,
		providerId: configuration.providerId,
		deploymentId: configuration.deploymentId,
		region: configuration.region,
		authorization: configuration.authorization,
		publicValues: canonicalPublicValues
	});
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	return `sha256:${encodeBase64(VSBuffer.wrap(new Uint8Array(digest)), false, true)}`;
}

/** Strong transport profile required by the reviewed cloud video adapters. */
export function isBaseHalfPublicHttpsBearerModelServiceConfiguration(value: Pick<IBaseHalfModelServiceConfiguration, 'endpoint' | 'authorization'>): boolean {
	if (value.authorization !== 'bearer') {
		return false;
	}
	try {
		const url = new URL(value.endpoint);
		return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !isPrivateLiteralHost(url.hostname);
	} catch {
		return false;
	}
}

export function sanitizeBaseHalfStoredModelConnections(value: unknown): IBaseHalfStoredModelConnections {
	const empty = emptyStoredModelConnections();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return empty;
	}
	const root = value as Record<string, unknown>;
	if (root.schemaVersion !== BASEHALF_MODEL_SERVICES_SCHEMA_VERSION
		|| !root.connections || typeof root.connections !== 'object' || Array.isArray(root.connections)
		|| Object.keys(root).some(key => key !== 'schemaVersion' && key !== 'connections')) {
		return empty;
	}
	const connections: Record<string, IBaseHalfStoredModelConnection> = {};
	for (const [rawSpecId, rawConnection] of Object.entries(root.connections as Record<string, unknown>).slice(0, 256)) {
		const specId = normalizeBaseHalfModelServiceId(rawSpecId);
		if (!isCompleteContributionId(specId) || specId !== rawSpecId || !rawConnection || typeof rawConnection !== 'object' || Array.isArray(rawConnection)) {
			continue;
		}
		const candidate = rawConnection as Record<string, unknown>;
		if (Object.keys(candidate).some(key => key !== 'publicValues' && key !== 'credentialRef')
			|| typeof candidate.credentialRef !== 'string' || !isUUID(candidate.credentialRef)
			|| !candidate.publicValues || typeof candidate.publicValues !== 'object' || Array.isArray(candidate.publicValues)) {
			continue;
		}
		const publicValues: Record<string, string> = {};
		let valid = true;
		const entries = Object.entries(candidate.publicValues as Record<string, unknown>);
		if (entries.length > 24) {
			valid = false;
		}
		for (const [id, fieldValue] of entries) {
			if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(id) || typeof fieldValue !== 'string'
				|| !fieldValue.trim() || fieldValue !== fieldValue.trim()
				|| fieldValue.length > BASEHALF_MODEL_SERVICE_API_KEY_MAX_LENGTH
				|| /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(fieldValue)) {
				valid = false;
				break;
			}
			publicValues[id] = fieldValue;
		}
		if (valid) {
			connections[specId] = Object.freeze({ publicValues: Object.freeze(publicValues), credentialRef: candidate.credentialRef });
		}
	}
	return Object.freeze({ schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION, connections: Object.freeze(connections) });
}

/** Clean break: only the versioned, provider-owned connection shape survives. */
export function cleanBaseHalfModelServicesConfigurationForStorage(value: unknown): IBaseHalfStoredModelConnections {
	return sanitizeBaseHalfStoredModelConnections(value);
}

function emptyStoredModelConnections(): IBaseHalfStoredModelConnections {
	return Object.freeze({ schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION, connections: Object.freeze({}) });
}

function legacyModelServiceIds(value: unknown): ReadonlySet<string> {
	const ids = new Set<string>();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return ids;
	}
	const root = value as Record<string, unknown>;
	if (root.schemaVersion === BASEHALF_MODEL_SERVICES_SCHEMA_VERSION && root.connections && typeof root.connections === 'object') {
		return ids;
	}
	for (const rawId of Object.keys(root)) {
		const id = normalizeBaseHalfModelServiceId(rawId);
		if (/^[a-z][a-z0-9.-]{0,63}$/.test(id)) {
			ids.add(id);
		}
	}
	return ids;
}

function droppedStoredCredentialKeys(value: unknown): ReadonlySet<string> {
	const keys = new Set<string>();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return keys;
	}
	const root = value as Record<string, unknown>;
	if (root.schemaVersion !== BASEHALF_MODEL_SERVICES_SCHEMA_VERSION
		|| !root.connections || typeof root.connections !== 'object' || Array.isArray(root.connections)) {
		return keys;
	}
	const retained = sanitizeBaseHalfStoredModelConnections(value).connections;
	for (const [rawId, rawConnection] of Object.entries(root.connections as Record<string, unknown>)) {
		const id = normalizeBaseHalfModelServiceId(rawId);
		if (retained[id] || !isCompleteContributionId(id) || !rawConnection || typeof rawConnection !== 'object' || Array.isArray(rawConnection)) {
			continue;
		}
		const credentialRef = (rawConnection as Record<string, unknown>).credentialRef;
		if (typeof credentialRef === 'string' && isUUID(credentialRef)) {
			keys.add(baseHalfModelServiceCredentialKey(id, credentialRef));
		}
	}
	return keys;
}

function storedCredentialKeys(stored: Pick<IBaseHalfStoredModelConnections, 'connections'>): ReadonlySet<string> {
	return new Set(Object.entries(stored.connections).map(([id, connection]) =>
		baseHalfModelServiceCredentialKey(id, connection.credentialRef)
	));
}

function sanitizeStoredModelConnectionState(raw: string | undefined): IBaseHalfStoredModelConnectionState {
	if (!raw || raw.length > 6 * 1024 * 1024) {
		return emptyStoredModelConnectionState();
	}
	try {
		const candidate = JSON.parse(raw) as Record<string, unknown>;
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
			|| candidate.schemaVersion !== BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION
			|| Object.keys(candidate).some(key => !['schemaVersion', 'connections', 'attentionConnections', 'stagedCredentials', 'pendingCredentialCleanup', 'pendingLegacySecretCleanup'].includes(key))) {
			return emptyStoredModelConnectionState();
		}
		const stored = sanitizeBaseHalfStoredModelConnections({
			schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
			connections: candidate.connections
		});
		const stagedCredentials: Record<string, number> = {};
		if (candidate.stagedCredentials && typeof candidate.stagedCredentials === 'object' && !Array.isArray(candidate.stagedCredentials)) {
			for (const [key, expiresAt] of Object.entries(candidate.stagedCredentials as Record<string, unknown>).slice(0, 256)) {
				if (isCredentialStorageKey(key) && typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) && expiresAt > 0) {
					stagedCredentials[key] = expiresAt;
				}
			}
		}
		const pendingCredentialCleanup = Array.isArray(candidate.pendingCredentialCleanup)
			? candidate.pendingCredentialCleanup.filter(isCredentialStorageKey).slice(0, 4096)
			: [];
		const pendingLegacySecretCleanup = Array.isArray(candidate.pendingLegacySecretCleanup)
			? candidate.pendingLegacySecretCleanup.filter((value): value is string => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value)).slice(0, 4096)
			: [];
		const attentionConnections = Array.isArray(candidate.attentionConnections)
			? candidate.attentionConnections.filter((value): value is string => typeof value === 'string' && isCompleteContributionId(value)).slice(0, 256)
			: [];
		return normalizeStoredModelConnectionState({
			schemaVersion: BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION,
			connections: stored.connections,
			attentionConnections,
			stagedCredentials,
			pendingCredentialCleanup,
			pendingLegacySecretCleanup
		});
	} catch {
		return emptyStoredModelConnectionState();
	}
}

function normalizeStoredModelConnectionState(state: IBaseHalfStoredModelConnectionState): IBaseHalfStoredModelConnectionState {
	const stored = sanitizeBaseHalfStoredModelConnections({
		schemaVersion: BASEHALF_MODEL_SERVICES_SCHEMA_VERSION,
		connections: state.connections
	});
	const live = storedCredentialKeys(stored);
	const stagedCredentials = Object.fromEntries(Object.entries(state.stagedCredentials)
		.filter(([key, expiresAt]) => isCredentialStorageKey(key) && !live.has(key) && Number.isSafeInteger(expiresAt) && expiresAt > 0)
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, 256));
	const staged = new Set(Object.keys(stagedCredentials));
	const pendingCredentialCleanup = uniqueStrings(state.pendingCredentialCleanup)
		.filter(key => isCredentialStorageKey(key) && !live.has(key) && !staged.has(key))
		.slice(0, 4096);
	const attentionConnections = uniqueStrings(state.attentionConnections)
		.filter(id => stored.connections[id] !== undefined)
		.slice(0, 256);
	return Object.freeze({
		schemaVersion: BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION,
		connections: stored.connections,
		attentionConnections: Object.freeze(attentionConnections),
		stagedCredentials: Object.freeze(stagedCredentials),
		pendingCredentialCleanup: Object.freeze(pendingCredentialCleanup),
		pendingLegacySecretCleanup: Object.freeze(uniqueStrings(state.pendingLegacySecretCleanup).filter(id => /^[a-z][a-z0-9.-]{0,63}$/.test(id)).slice(0, 4096))
	});
}

function emptyStoredModelConnectionState(): IBaseHalfStoredModelConnectionState {
	return Object.freeze({
		schemaVersion: BASEHALF_MODEL_CONNECTION_STATE_SCHEMA_VERSION,
		connections: Object.freeze({}),
		attentionConnections: Object.freeze([]),
		stagedCredentials: Object.freeze({}),
		pendingCredentialCleanup: Object.freeze([]),
		pendingLegacySecretCleanup: Object.freeze([])
	});
}

function isCredentialStorageKey(value: unknown): value is string {
	return typeof value === 'string'
		&& value.startsWith(BASEHALF_MODEL_CONNECTION_CREDENTIAL_PREFIX)
		&& value.endsWith('.credentials')
		&& value.length <= 512;
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function readPendingLegacySecretCleanup(storageService: IStorageService): Set<string> {
	return readBoundedStringSet(storageService.get(BASEHALF_MODEL_SERVICE_PENDING_SECRET_CLEANUP_STORAGE_KEY, StorageScope.APPLICATION), value => /^[a-z][a-z0-9.-]{0,63}$/.test(value));
}

function readPendingCredentialCleanup(storageService: IStorageService): Set<string> {
	return readBoundedStringSet(
		storageService.get(BASEHALF_MODEL_CONNECTION_PENDING_CREDENTIAL_CLEANUP_STORAGE_KEY, StorageScope.APPLICATION),
		value => value.startsWith(BASEHALF_MODEL_CONNECTION_CREDENTIAL_PREFIX) && value.endsWith('.credentials') && value.length <= 512
	);
}

function readBoundedStringSet(raw: string | undefined, predicate: (value: string) => boolean): Set<string> {
	if (!raw) {
		return new Set();
	}
	try {
		const candidate = JSON.parse(raw);
		return new Set(Array.isArray(candidate)
			? candidate.filter((value): value is string => typeof value === 'string' && predicate(value)).slice(0, 4096)
			: []);
	} catch {
		return new Set();
	}
}

function isCompleteContributionId(value: string): boolean {
	return value.length <= 128 && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(value);
}

function isPrivateLiteralHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host.endsWith('.localhost')) {
		return true;
	}
	const octets = host.split('.');
	if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
		const values = octets.map(Number);
		return values[0] === 0 || values[0] === 10 || values[0] === 127
			|| (values[0] === 169 && values[1] === 254)
			|| (values[0] === 172 && values[1] >= 16 && values[1] <= 31)
			|| (values[0] === 192 && values[1] === 168)
			|| (values[0] === 100 && values[1] >= 64 && values[1] <= 127)
			|| values[0] >= 224;
	}
	if (host.includes(':')) {
		return host === '::' || host === '::1' || host.startsWith('::ffff:')
			|| host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('ff');
	}
	return false;
}

registerSingleton(IBaseHalfModelServiceService, BaseHalfModelServiceService, InstantiationType.Delayed);
