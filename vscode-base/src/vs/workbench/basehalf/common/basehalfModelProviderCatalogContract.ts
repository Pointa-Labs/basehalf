/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, versioned provider-connection contract shared by the workbench and the
 * release reviewer. Keep this module free of VS Code service imports so the
 * publishing pipeline can execute the exact host parser under Node.
 */

export const BASEHALF_MODEL_PROVIDER_CATALOG_SCHEMA_VERSION = 1 as const;

export const BASEHALF_MODEL_PROVIDER_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
export type BaseHalfModelProviderCapability = typeof BASEHALF_MODEL_PROVIDER_CAPABILITIES[number];

interface IBaseHalfModelProviderConnectionFieldBase {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly placeholder?: string;
	readonly required: boolean;
}

export interface IBaseHalfModelProviderSecretField extends IBaseHalfModelProviderConnectionFieldBase {
	readonly type: 'secret';
}

export interface IBaseHalfModelProviderUrlField extends IBaseHalfModelProviderConnectionFieldBase {
	readonly type: 'url';
	readonly default?: string;
}

export interface IBaseHalfModelProviderTextField extends IBaseHalfModelProviderConnectionFieldBase {
	readonly type: 'text';
	readonly default?: string;
}

export interface IBaseHalfModelProviderSelectOption {
	readonly value: string;
	readonly label: string;
}

export interface IBaseHalfModelProviderSelectField extends IBaseHalfModelProviderConnectionFieldBase {
	readonly type: 'select';
	readonly default?: string;
	readonly options: readonly IBaseHalfModelProviderSelectOption[];
}

export type IBaseHalfModelProviderConnectionField =
	| IBaseHalfModelProviderSecretField
	| IBaseHalfModelProviderUrlField
	| IBaseHalfModelProviderTextField
	| IBaseHalfModelProviderSelectField;

export interface IBaseHalfFixedModelProviderEndpointPolicy {
	readonly type: 'fixed';
	readonly endpoint: string;
}

export interface IBaseHalfFieldModelProviderEndpointPolicy {
	readonly type: 'field';
	readonly fieldId: string;
	readonly allowlist: {
		/** Canonical HTTPS origins, including an explicit port when one is allowed. */
		readonly exact: readonly string[];
		/** DNS suffixes whose strict HTTPS subdomains are allowed on the default port. */
		readonly subdomains: readonly string[];
	};
}

export type IBaseHalfModelProviderEndpointPolicy =
	| IBaseHalfFixedModelProviderEndpointPolicy
	| IBaseHalfFieldModelProviderEndpointPolicy;

export interface IBaseHalfModelProviderConnectionSpec {
	/** Globally unique id prefixed by the contributing extension id. */
	readonly id: string;
	readonly label: string;
	readonly providerLabel: string;
	readonly helpUrl: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly capabilities: readonly BaseHalfModelProviderCapability[];
	readonly authorization: 'bearer';
	readonly fields: readonly IBaseHalfModelProviderConnectionField[];
	readonly endpointPolicy: IBaseHalfModelProviderEndpointPolicy;
}

export interface IBaseHalfModelProviderCatalog {
	readonly schemaVersion: typeof BASEHALF_MODEL_PROVIDER_CATALOG_SCHEMA_VERSION;
	readonly connections: readonly IBaseHalfModelProviderConnectionSpec[];
}

export interface IBaseHalfModelProviderCatalogContribution {
	readonly id: string;
	readonly resource: string;
}

export interface IBaseHalfRegisteredModelProviderConnectionSpec extends IBaseHalfModelProviderConnectionSpec {
	readonly extensionId: string;
	readonly catalogId: string;
}

export type IBaseHalfModelProviderFieldValues = Readonly<Record<string, string | undefined>>;

export interface IBaseHalfResolvedModelProviderConnection {
	readonly specId: string;
	readonly label: string;
	readonly endpoint: string;
	readonly providerId: string;
	readonly deploymentId: string;
	readonly region: string;
	readonly capabilities: readonly BaseHalfModelProviderCapability[];
	readonly authorization: 'bearer';
	readonly publicValues: Readonly<Record<string, string>>;
	readonly secretValues: Readonly<Record<string, string>>;
}

export class BaseHalfModelProviderCatalogContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfModelProviderCatalogContractError';
	}
}

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const SCOPE_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const REGION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FIELD_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/;
const RESERVED_FIELD_IDS = new Set([
	'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'prototype',
	'toLocaleString', 'toString', 'valueOf'
]);
const DNS_NAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_CONNECTIONS = 64;
const MAX_FIELDS = 24;
const MAX_SELECT_OPTIONS = 64;
const MAX_VALUE_LENGTH = 16 * 1024;
const MAX_URL_LENGTH = 2 * 1024;
const MAX_ALLOWLIST_ENTRIES = 32;

/** Parse an untrusted, versioned provider catalog into a deep-frozen contract. */
export function parseBaseHalfModelProviderCatalog(value: unknown): IBaseHalfModelProviderCatalog {
	const catalog = requiredObject(value, 'catalog');
	assertOnlyKeys(catalog, ['schemaVersion', 'connections'], 'catalog');
	if (catalog.schemaVersion !== BASEHALF_MODEL_PROVIDER_CATALOG_SCHEMA_VERSION) {
		fail(`catalog.schemaVersion must be ${BASEHALF_MODEL_PROVIDER_CATALOG_SCHEMA_VERSION}.`);
	}
	const connections = requiredArray(catalog.connections, 'catalog.connections', 0, MAX_CONNECTIONS)
		.map((connection, index) => parseConnection(connection, `catalog.connections[${index}]`));
	assertUnique(connections.map(connection => connection.id), 'catalog.connections ids');
	return deepFreeze({ schemaVersion: BASEHALF_MODEL_PROVIDER_CATALOG_SCHEMA_VERSION, connections });
}

/**
 * Resolve and validate user-entered values without persisting them. Callers must
 * route `secretValues` to encrypted secret storage and keep them out of settings.
 */
export function resolveBaseHalfModelProviderConnection(
	spec: IBaseHalfModelProviderConnectionSpec,
	values: IBaseHalfModelProviderFieldValues
): IBaseHalfResolvedModelProviderConnection {
	const knownFieldIds = new Set(spec.fields.map(field => field.id));
	const unknownFieldId = Object.keys(values).find(fieldId => !knownFieldIds.has(fieldId));
	if (unknownFieldId) {
		fail(`values.${unknownFieldId} is not declared by connection '${spec.id}'.`);
	}

	const publicValues: Record<string, string> = {};
	const secretValues: Record<string, string> = {};
	for (const field of spec.fields) {
		const explicitValue = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
		const defaultValue = field.type === 'secret' ? undefined : field.default;
		const candidate = explicitValue ?? defaultValue;
		const normalized = normalizeFieldValue(field, candidate);
		if (normalized === undefined) {
			continue;
		}
		if (field.type === 'secret') {
			secretValues[field.id] = normalized;
		} else {
			publicValues[field.id] = normalized;
		}
	}

	const endpoint = spec.endpointPolicy.type === 'fixed'
		? publicHttpsUrl(spec.endpointPolicy.endpoint, `connection '${spec.id}' fixed endpoint`)
		: resolveFieldEndpoint(spec, spec.endpointPolicy, publicValues);
	return deepFreeze({
		specId: spec.id,
		label: spec.label,
		endpoint,
		providerId: spec.providerId,
		deploymentId: spec.deploymentId,
		region: spec.region,
		capabilities: [...spec.capabilities],
		authorization: spec.authorization,
		publicValues,
		secretValues
	});
}

function parseConnection(value: unknown, path: string): IBaseHalfModelProviderConnectionSpec {
	const connection = requiredObject(value, path);
	assertOnlyKeys(connection, [
		'id', 'label', 'providerLabel', 'helpUrl', 'providerId', 'deploymentId', 'region',
		'capabilities', 'authorization', 'fields', 'endpointPolicy'
	], path);
	const id = contributionIdentifier(connection.id, `${path}.id`);
	const fields = requiredArray(connection.fields, `${path}.fields`, 1, MAX_FIELDS)
		.map((field, index) => parseField(field, `${path}.fields[${index}]`));
	assertUnique(fields.map(field => field.id), `${path}.fields ids`);
	const capabilities = requiredArray(connection.capabilities, `${path}.capabilities`, 1, BASEHALF_MODEL_PROVIDER_CAPABILITIES.length)
		.map((capability, index) => providerCapability(capability, `${path}.capabilities[${index}]`));
	assertUnique(capabilities, `${path}.capabilities`);
	if (connection.authorization !== 'bearer') {
		fail(`${path}.authorization must be 'bearer'.`);
	}
	if (!fields.some(field => field.type === 'secret' && field.required)) {
		fail(`${path}.fields must declare at least one required secret for Bearer authorization.`);
	}
	const endpointPolicy = parseEndpointPolicy(connection.endpointPolicy, `${path}.endpointPolicy`);
	if (endpointPolicy.type === 'field') {
		const endpointField = fields.find(field => field.id === endpointPolicy.fieldId);
		if (endpointField?.type !== 'url') {
			fail(`${path}.endpointPolicy.fieldId must reference a declared URL field.`);
		}
		if (!endpointField.required) {
			fail(`${path}.endpointPolicy.fieldId must reference a required URL field.`);
		}
	}
	return {
		id,
		label: boundedText(connection.label, `${path}.label`, 80),
		providerLabel: boundedText(connection.providerLabel, `${path}.providerLabel`, 80),
		helpUrl: helpUrl(connection.helpUrl, `${path}.helpUrl`),
		providerId: scopeIdentifier(connection.providerId, `${path}.providerId`),
		deploymentId: scopeIdentifier(connection.deploymentId, `${path}.deploymentId`),
		region: regionIdentifier(connection.region, `${path}.region`),
		capabilities,
		authorization: 'bearer',
		fields,
		endpointPolicy
	};
}

function parseField(value: unknown, path: string): IBaseHalfModelProviderConnectionField {
	const field = requiredObject(value, path);
	const type = field.type;
	const common = {
		id: fieldIdentifier(field.id, `${path}.id`),
		label: boundedText(field.label, `${path}.label`, 80),
		...(field.description === undefined ? {} : { description: boundedText(field.description, `${path}.description`, 240) }),
		...(field.placeholder === undefined ? {} : { placeholder: boundedText(field.placeholder, `${path}.placeholder`, 120) }),
		required: requiredBoolean(field.required, `${path}.required`)
	};
	if (type === 'secret') {
		assertOnlyKeys(field, ['id', 'label', 'description', 'placeholder', 'required', 'type'], path);
		return { ...common, type };
	}
	if (type === 'url') {
		assertOnlyKeys(field, ['id', 'label', 'description', 'placeholder', 'required', 'type', 'default'], path);
		return { ...common, type, ...(field.default === undefined ? {} : { default: publicHttpsUrl(field.default, `${path}.default`) }) };
	}
	if (type === 'text') {
		assertOnlyKeys(field, ['id', 'label', 'description', 'placeholder', 'required', 'type', 'default'], path);
		return { ...common, type, ...(field.default === undefined ? {} : { default: boundedText(field.default, `${path}.default`, MAX_VALUE_LENGTH) }) };
	}
	if (type === 'select') {
		assertOnlyKeys(field, ['id', 'label', 'description', 'placeholder', 'required', 'type', 'default', 'options'], path);
		const options = requiredArray(field.options, `${path}.options`, 1, MAX_SELECT_OPTIONS).map((option, index) => {
			const parsed = requiredObject(option, `${path}.options[${index}]`);
			assertOnlyKeys(parsed, ['value', 'label'], `${path}.options[${index}]`);
			return {
				value: boundedText(parsed.value, `${path}.options[${index}].value`, 128),
				label: boundedText(parsed.label, `${path}.options[${index}].label`, 80)
			};
		});
		assertUnique(options.map(option => option.value), `${path}.options values`);
		const defaultValue = field.default === undefined ? undefined : boundedText(field.default, `${path}.default`, 128);
		if (defaultValue !== undefined && !options.some(option => option.value === defaultValue)) {
			fail(`${path}.default must match a declared option value.`);
		}
		return { ...common, type, options, ...(defaultValue === undefined ? {} : { default: defaultValue }) };
	}
	fail(`${path}.type must be 'secret', 'url', 'text', or 'select'.`);
}

function parseEndpointPolicy(value: unknown, path: string): IBaseHalfModelProviderEndpointPolicy {
	const policy = requiredObject(value, path);
	if (policy.type === 'fixed') {
		assertOnlyKeys(policy, ['type', 'endpoint'], path);
		return { type: 'fixed', endpoint: publicHttpsUrl(policy.endpoint, `${path}.endpoint`) };
	}
	if (policy.type === 'field') {
		assertOnlyKeys(policy, ['type', 'fieldId', 'allowlist'], path);
		const allowlist = requiredObject(policy.allowlist, `${path}.allowlist`);
		assertOnlyKeys(allowlist, ['exact', 'subdomains'], `${path}.allowlist`);
		const exact = requiredArray(allowlist.exact, `${path}.allowlist.exact`, 0, MAX_ALLOWLIST_ENTRIES)
			.map((origin, index) => exactHttpsOrigin(origin, `${path}.allowlist.exact[${index}]`));
		const subdomains = requiredArray(allowlist.subdomains, `${path}.allowlist.subdomains`, 0, MAX_ALLOWLIST_ENTRIES)
			.map((domain, index) => dnsSuffix(domain, `${path}.allowlist.subdomains[${index}]`));
		assertUnique(exact, `${path}.allowlist.exact`);
		assertUnique(subdomains, `${path}.allowlist.subdomains`);
		if (!exact.length && !subdomains.length) {
			fail(`${path}.allowlist must contain at least one exact origin or subdomain suffix.`);
		}
		return {
			type: 'field',
			fieldId: fieldIdentifier(policy.fieldId, `${path}.fieldId`),
			allowlist: { exact, subdomains }
		};
	}
	fail(`${path}.type must be 'fixed' or 'field'.`);
}

function resolveFieldEndpoint(
	spec: IBaseHalfModelProviderConnectionSpec,
	policy: IBaseHalfFieldModelProviderEndpointPolicy,
	publicValues: Readonly<Record<string, string>>
): string {
	const candidate = publicValues[policy.fieldId];
	if (!candidate) {
		fail(`Connection '${spec.id}' requires endpoint field '${policy.fieldId}'.`);
	}
	const endpoint = publicHttpsUrl(candidate, `values.${policy.fieldId}`);
	const url = new URL(endpoint);
	const exactMatch = policy.allowlist.exact.includes(url.origin);
	const subdomainMatch = !url.port && policy.allowlist.subdomains.some(suffix =>
		url.hostname.length > suffix.length && url.hostname.endsWith(`.${suffix}`));
	if (!exactMatch && !subdomainMatch) {
		fail(`values.${policy.fieldId} is outside the endpoint allowlist for connection '${spec.id}'.`);
	}
	return endpoint;
}

function normalizeFieldValue(field: IBaseHalfModelProviderConnectionField, value: string | undefined): string | undefined {
	if (value === undefined || !value.trim()) {
		if (field.required) {
			fail(`values.${field.id} is required.`);
		}
		return undefined;
	}
	const normalized = value.trim();
	if (field.type === 'url') {
		return publicHttpsUrl(normalized, `values.${field.id}`);
	}
	if (field.type === 'select' && !field.options.some(option => option.value === normalized)) {
		fail(`values.${field.id} must match a declared option value.`);
	}
	if (normalized.length > MAX_VALUE_LENGTH || containsControlCharacter(normalized)) {
		fail(`values.${field.id} must contain at most ${MAX_VALUE_LENGTH} safe characters.`);
	}
	return normalized;
}

function publicHttpsUrl(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > MAX_URL_LENGTH) {
		fail(`${path} must be a bounded HTTPS URL.`);
	}
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || isPrivateLiteralHost(url.hostname)) {
			fail(`${path} must be a public HTTPS URL without credentials, a query, or a fragment.`);
		}
		return url.href.replace(/\/$/, '');
	} catch (error) {
		if (error instanceof BaseHalfModelProviderCatalogContractError) {
			throw error;
		}
		fail(`${path} must be a valid public HTTPS URL.`);
	}
}

function exactHttpsOrigin(value: unknown, path: string): string {
	const endpoint = publicHttpsUrl(value, path);
	const url = new URL(endpoint);
	if (url.pathname !== '/' && url.pathname !== '') {
		fail(`${path} must be an exact HTTPS origin without a path.`);
	}
	return url.origin;
}

function helpUrl(value: unknown, path: string): string {
	return publicHttpsUrl(value, path);
}

function dnsSuffix(value: unknown, path: string): string {
	if (typeof value !== 'string' || value !== value.trim() || value !== value.toLowerCase()
		|| !DNS_NAME_PATTERN.test(value) || isPrivateLiteralHost(value)) {
		fail(`${path} must be a canonical public DNS suffix.`);
	}
	return value;
}

function isPrivateLiteralHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host.endsWith('.localhost')) {
		return true;
	}
	const octets = host.split('.');
	if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
		const values = octets.map(Number);
		return values[0] === 0
			|| values[0] === 10
			|| values[0] === 127
			|| (values[0] === 169 && values[1] === 254)
			|| (values[0] === 172 && values[1] >= 16 && values[1] <= 31)
			|| (values[0] === 192 && values[1] === 168)
			|| (values[0] === 100 && values[1] >= 64 && values[1] <= 127)
			|| values[0] >= 224;
	}
	if (host.includes(':')) {
		return host === '::' || host === '::1'
			|| host.startsWith('::ffff:')
			|| host.startsWith('fc') || host.startsWith('fd')
			|| /^fe[89ab]/.test(host) || host.startsWith('ff');
	}
	return false;
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requiredArray(value: unknown, path: string, minimum: number, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		fail(`${path} must contain between ${minimum} and ${maximum} items.`);
	}
	return value;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const allowed = new Set(keys);
	const unknownKey = Object.keys(value).find(key => !allowed.has(key));
	if (unknownKey) {
		fail(`${path}.${unknownKey} is not part of the model provider contract.`);
	}
}

function assertUnique(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length) {
		fail(`${path} contains duplicate identifiers or values.`);
	}
}

function contributionIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length > 128 || !CONTRIBUTION_ID_PATTERN.test(value)) {
		fail(`${path} must be a canonical complete contribution identifier.`);
	}
	return value;
}

function scopeIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || !SCOPE_ID_PATTERN.test(value)) {
		fail(`${path} must be a canonical lowercase provider or deployment identifier.`);
	}
	return value;
}

function regionIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || !REGION_PATTERN.test(value)) {
		fail(`${path} must be a canonical lowercase region identifier.`);
	}
	return value;
}

function fieldIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || !FIELD_ID_PATTERN.test(value) || RESERVED_FIELD_IDS.has(value)) {
		fail(`${path} must be a lower-camel-case field identifier.`);
	}
	return value;
}

function providerCapability(value: unknown, path: string): BaseHalfModelProviderCapability {
	if (typeof value !== 'string' || !(BASEHALF_MODEL_PROVIDER_CAPABILITIES as readonly string[]).includes(value)) {
		fail(`${path} must be a supported model capability.`);
	}
	return value as BaseHalfModelProviderCapability;
}

function boundedText(value: unknown, path: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || containsControlCharacter(value)) {
		fail(`${path} must be non-empty, trimmed text of at most ${maximum} characters.`);
	}
	return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') {
		fail(`${path} must be a boolean.`);
	}
	return value;
}

function containsControlCharacter(value: string): boolean {
	return /[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function fail(message: string): never {
	throw new BaseHalfModelProviderCatalogContractError(message);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}
