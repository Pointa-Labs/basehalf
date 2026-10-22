/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { BASEHALF_VIDEO_PROVIDER_ID_PATTERN } from './basehalfVideoCatalog.js';

/**
 * How the providers of the catalog are set up on this computer (D59, video
 * providers, "Credentials, regions, and endpoints"): how the region, the
 * endpoint, and the ids of the credentials that are set are stored, where
 * the credential values are kept, and the rules for endpoints and values.
 * Pure: the provider settings service and the Providers page share it.
 * A credential value is never part of the stored record; it lives in the
 * encrypted credential store under {@link baseHalfVideoProviderSecretAddress}.
 */

/** Opens Settings on the Providers page; with a provider id, on that provider. */
export const BASEHALF_VIDEO_PROVIDERS_COMMAND_ID = 'basehalf.video.providers';

/** The Settings section that holds the Providers page. It keeps the place of the former Models & Providers page. */
export const BASEHALF_VIDEO_PROVIDERS_SETTINGS_SECTION_ID = 'basehalf/models';

/** The region, the endpoint, and the ids of the credentials that are set, per provider. */
export const BASEHALF_VIDEO_PROVIDERS_STORAGE_KEY = 'basehalf.video.providers.v1';
/** The provider, model, mode, and values of the last generation of a video on this computer. */
export const BASEHALF_VIDEO_LAST_USED_STORAGE_KEY = 'basehalf.video.lastUsed.v2';
/** The provider, model, mode, and values of the last generation of an image on this computer. */
export const BASEHALF_IMAGE_LAST_USED_STORAGE_KEY = 'basehalf.image.lastUsed.v1';

const SETTINGS_VERSION = 1;
const MAX_PROVIDERS = 64;
const MAX_CREDENTIALS = 16;
export const BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH = 2048;
export const BASEHALF_VIDEO_CREDENTIAL_MAX_LENGTH = 16 * 1024;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** What this computer keeps of one provider. Without a region, the provider's first is used; without an endpoint, the region's base URL. */
export interface IBaseHalfVideoStoredProviderSettings {
	readonly region?: string;
	readonly endpoint?: string;
	/** The ids of the credential values that are set. The values are in the credential store. */
	readonly credentials: readonly string[];
}

/** An input the settings cannot take. The message is localized plain text for the page. */
export class BaseHalfVideoProviderSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoProviderSettingsError';
	}
}

/**
 * Where the credential values of a provider are kept in the credential store,
 * as one JSON object of the declared ids. The main process admits only
 * addresses of this shape (`basehalf.modelServices.<id>.apiKey`).
 */
export function baseHalfVideoProviderSecretAddress(providerId: string): string {
	if (!BASEHALF_VIDEO_PROVIDER_ID_PATTERN.test(providerId)) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.badId', "BaseHalf cannot store the credentials of the provider '{0}'.", providerId));
	}
	return `basehalf.modelServices.video.${providerId}.apiKey`;
}

/**
 * A complete `https://` address, or `http://` on this computer (a local relay
 * or test server). Without a user name, password, query, or fragment; without
 * a trailing slash.
 */
export function normalizeBaseHalfVideoEndpoint(value: string): string {
	const text = value.trim();
	const invalid = () => new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.endpointInvalid', "Enter a complete address that starts with https://, such as https://api.example.com/v1."));
	if (!text || text.length > BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH || hasControlCharacters(text) || /\s/.test(text)) {
		throw invalid();
	}
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw invalid();
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw invalid();
	}
	if (url.protocol === 'http:' && !isBaseHalfLoopbackHost(url.hostname)) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.endpointHttp', "Use an address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the credentials would travel unencrypted."));
	}
	if (url.username || url.password) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.endpointCredentials', "Remove the user name and password from the address. The credentials go in their own fields."));
	}
	if (url.search || url.hash || text.includes('?') || text.includes('#')) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.endpointQuery', "Remove the part after ? or # from the address."));
	}
	const path = url.pathname.replace(/\/+$/, '');
	return `${url.protocol}//${url.host}${path}`;
}

/** `localhost`, `127.0.0.1` and the rest of 127/8, and `::1`. */
export function isBaseHalfLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(?<inner>.*)\]$/, '$<inner>');
	return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** A credential travels in an HTTP header: visible ASCII characters, without spaces. */
export function normalizeBaseHalfVideoCredentialValue(value: string, label: string): string {
	const credential = value.trim();
	if (!credential) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.credentialEmpty', "Paste the {0} from the provider's console.", label));
	}
	if (credential.length > BASEHALF_VIDEO_CREDENTIAL_MAX_LENGTH) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.credentialLong', "This {0} is longer than any provider uses. Check that only the {0} was pasted.", label));
	}
	if (!/^[\x21-\x7E]+$/.test(credential)) {
		throw new BaseHalfVideoProviderSettingsError(localize('basehalf.video.providerSettings.credentialCharacters', "Use only letters, digits, and symbols for the {0}, without spaces or line breaks. Check that only the {0} was pasted.", label));
	}
	return credential;
}

/** Reads the stored settings. Entries that are not valid are left out; nothing here throws. */
export function parseBaseHalfVideoProviderSettings(raw: string | undefined): ReadonlyMap<string, IBaseHalfVideoStoredProviderSettings> {
	const settings = new Map<string, IBaseHalfVideoStoredProviderSettings>();
	const value = parseJson(raw);
	if (!isRecord(value) || value.version !== SETTINGS_VERSION || !isRecord(value.providers)) {
		return settings;
	}
	for (const [provider, entry] of Object.entries(value.providers)) {
		if (settings.size >= MAX_PROVIDERS || !BASEHALF_VIDEO_PROVIDER_ID_PATTERN.test(provider) || !isRecord(entry)) {
			continue;
		}
		const parsed = parseEntry(entry);
		if (parsed) {
			settings.set(provider, parsed);
		}
	}
	return settings;
}

export function serializeBaseHalfVideoProviderSettings(settings: ReadonlyMap<string, IBaseHalfVideoStoredProviderSettings>): string {
	const providers: Record<string, IBaseHalfVideoStoredProviderSettings> = {};
	for (const [provider, entry] of [...settings].sort(([left], [right]) => left.localeCompare(right))) {
		if (entry.region === undefined && entry.endpoint === undefined && entry.credentials.length === 0) {
			continue;
		}
		providers[provider] = {
			...(entry.region !== undefined ? { region: entry.region } : {}),
			...(entry.endpoint !== undefined ? { endpoint: entry.endpoint } : {}),
			credentials: [...entry.credentials].sort()
		};
	}
	return JSON.stringify({ version: SETTINGS_VERSION, providers });
}

/** Reads the credential values of a provider from its secret. Anything else than an object of text values is no value. */
export function parseBaseHalfVideoCredentialSecret(raw: string | undefined): Readonly<Record<string, string>> {
	const value = parseJson(raw);
	const values: Record<string, string> = {};
	if (isRecord(value)) {
		for (const [id, credential] of Object.entries(value)) {
			if (CREDENTIAL_ID_PATTERN.test(id) && typeof credential === 'string' && credential.length > 0 && credential.length <= BASEHALF_VIDEO_CREDENTIAL_MAX_LENGTH) {
				values[id] = credential;
			}
		}
	}
	return Object.freeze(values);
}

function parseEntry(entry: Record<string, unknown>): IBaseHalfVideoStoredProviderSettings | undefined {
	const region = typeof entry.region === 'string' && CREDENTIAL_ID_PATTERN.test(entry.region) ? entry.region : undefined;
	let endpoint: string | undefined;
	if (typeof entry.endpoint === 'string') {
		try {
			endpoint = normalizeBaseHalfVideoEndpoint(entry.endpoint);
		} catch {
			endpoint = undefined;
		}
	}
	const credentials = Array.isArray(entry.credentials)
		? [...new Set(entry.credentials.filter((id): id is string => typeof id === 'string' && CREDENTIAL_ID_PATTERN.test(id)))].slice(0, MAX_CREDENTIALS)
		: [];
	return Object.freeze({
		...(region !== undefined ? { region } : {}),
		...(endpoint !== undefined ? { endpoint } : {}),
		credentials: Object.freeze(credentials.sort())
	});
}

function parseJson(raw: string | undefined): unknown {
	if (!raw) {
		return undefined;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function hasControlCharacters(value: string): boolean {
	return /[\u0000-\u001F\u007F]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
