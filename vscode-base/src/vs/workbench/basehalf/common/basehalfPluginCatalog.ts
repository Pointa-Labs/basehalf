/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { rcompare, satisfies, valid, validRange } from '../../../base/common/semver/semver.js';
import { URI } from '../../../base/common/uri.js';

export const BASEHALF_MANAGE_PLUGINS_COMMAND_ID = 'basehalf.managePlugins';
export const BASEHALF_PLUGINS_VIEW_CONTAINER_ID = 'basehalf.view.plugins';
export const BASEHALF_PLUGINS_VIEW_ID = 'basehalf.plugins';
export const BASEHALF_PLUGIN_LIBRARY_EDITOR_ID = 'workbench.editors.basehalfPluginLibrary';
export const BASEHALF_PLUGIN_LIBRARY_RESOURCE_SCHEME = 'basehalf-plugin-library';

const BASEHALF_EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/;

export function parseBaseHalfPluginDeepLink(uri: URI, expectedScheme: string): string | undefined {
	if (uri.scheme !== expectedScheme || uri.authority !== 'plugins') {
		return undefined;
	}
	try {
		const extensionId = decodeURIComponent(uri.path).replace(/^\/+/, '').toLowerCase();
		if (!BASEHALF_EXTENSION_ID_PATTERN.test(extensionId)) {
			return undefined;
		}
		return extensionId;
	} catch {
		return undefined;
	}
}

export type BaseHalfPluginLifecycleState =
	| 'available'
	| 'installing'
	| 'enabled'
	| 'disabled'
	| 'updateAvailable'
	| 'updating'
	| 'incompatible'
	| 'withdrawn'
	| 'error';

export type BaseHalfRemotePluginVersionStatus = 'active' | 'withdrawn';

export interface IBaseHalfRemotePluginVersion {
	readonly version: string;
	readonly basehalfRange: string;
	readonly vscodeRange: string;
	readonly targetPlatform: string;
	readonly assetPath: string;
	readonly sha256: string;
	readonly size: number;
	readonly publishedAt: string;
	readonly status: BaseHalfRemotePluginVersionStatus;
	readonly releaseNotes?: string;
}

export interface IBaseHalfPluginPublisher {
	readonly slug: string;
	readonly displayName: string;
	readonly trust: 'official' | 'reviewed';
}

export interface IBaseHalfRemotePlugin {
	readonly extensionId: string;
	readonly label: string;
	readonly description: string;
	readonly category: string;
	readonly publisher?: IBaseHalfPluginPublisher;
	readonly primaryCommand?: string;
	readonly primaryCommandLabel?: string;
	readonly versions: readonly IBaseHalfRemotePluginVersion[];
}

export interface IBaseHalfRemotePluginCatalog {
	readonly schemaVersion: 1;
	readonly sequence: number;
	readonly generatedAt: string;
	readonly plugins: readonly IBaseHalfRemotePlugin[];
}

export interface IBaseHalfPluginCatalogSignature {
	readonly keyId: string;
	readonly algorithm: 'ECDSA_P256_SHA256_DER';
	readonly signature: string;
}

/**
 * Single mutable publication pointer. The referenced catalog and signature are
 * immutable objects under the same origin, so a client can never observe a
 * signature from one release paired with the catalog from another release.
 */
export interface IBaseHalfPluginCatalogIndex {
	readonly schemaVersion: 1;
	readonly sequence: number;
	readonly catalogPath: string;
	readonly signaturePath: string;
}

export interface IBaseHalfPluginCatalogPublicKey {
	readonly keyId: string;
	/** PEM encoded SubjectPublicKeyInfo P-256 public key. */
	readonly publicKey: string;
}

export interface IBaseHalfCuratedPlugin {
	readonly extensionId: string;
	/** Stable product-owned gallery identity used by VS Code's native extension renderer. */
	readonly galleryUuid?: string;
	readonly label: string;
	readonly description: string;
	readonly category: string;
	readonly publisher: IBaseHalfPluginPublisher;
	/** App-root-relative reviewed payload installed only when the user asks. */
	readonly bundledPath?: string;
	readonly primaryCommand?: string;
	readonly primaryCommandLabel?: string;
}

export interface IBaseHalfResolvedPlugin extends IBaseHalfCuratedPlugin {
	readonly remote?: IBaseHalfRemotePlugin;
	readonly remoteVersion?: IBaseHalfRemotePluginVersion;
}

/**
 * Product-owned catalog. This deliberately is not derived from Marketplace
 * search results: only reviewed BaseHalf plugins can appear in the product.
 */
export const BASEHALF_CURATED_PLUGINS: readonly IBaseHalfCuratedPlugin[] = [{
	extensionId: 'pointa.basehalf-ai-video',
	galleryUuid: 'a7e47f42-807f-4ac0-93e7-65d03c42c7df',
	label: 'AI Video',
	description: 'A node workflow canvas for scripts, characters, scenes, shots, and provider-neutral local generation.',
	category: 'Domain',
	publisher: { slug: 'pointa', displayName: 'BaseHalf', trust: 'official' },
	bundledPath: 'plugins/basehalf-ai-video',
	primaryCommand: 'pointa.basehalf-ai-video.createProject',
	primaryCommandLabel: 'Create AI Video Project…'
}];

export function parseBaseHalfRemotePluginCatalog(value: unknown, officialExtensionIds: readonly string[]): IBaseHalfRemotePluginCatalog {
	const root = record(value, 'catalog');
	if (root.schemaVersion !== 1) {
		throw new Error('Plugin catalog schemaVersion must be 1.');
	}
	const sequence = integer(root.sequence, 'catalog.sequence', 1);
	const generatedAt = isoDate(root.generatedAt, 'catalog.generatedAt');
	const official = new Set(officialExtensionIds.map(id => id.toLowerCase()));
	const seen = new Set<string>();
	const plugins: IBaseHalfRemotePlugin[] = [];
	for (const [index, rawPlugin] of array(root.plugins, 'catalog.plugins', 200).entries()) {
		const plugin = record(rawPlugin, `catalog.plugins[${index}]`);
		const extensionId = string(plugin.extensionId, `catalog.plugins[${index}].extensionId`).toLowerCase();
		if (!BASEHALF_EXTENSION_ID_PATTERN.test(extensionId)) {
			throw new Error(`Plugin catalog extension id '${extensionId}' is invalid.`);
		}
		if (seen.has(extensionId)) {
			throw new Error(`Plugin catalog contains duplicate extension id '${extensionId}'.`);
		}
		seen.add(extensionId);
		const versions = parseVersions(plugin.versions, extensionId);
		const publisher = plugin.publisher === undefined
			? undefined
			: parsePublisher(plugin.publisher, extensionId);
		if (!official.has(extensionId) && !publisher) {
			throw new Error(`Reviewed plugin '${extensionId}' must declare its Publisher.`);
		}
		if (!official.has(extensionId) && publisher?.trust !== 'reviewed') {
			throw new Error(`Community plugin '${extensionId}' cannot claim official trust.`);
		}
		const primaryCommand = plugin.primaryCommand === undefined ? undefined : boundedString(plugin.primaryCommand, `${extensionId}.primaryCommand`, 200);
		const primaryCommandLabel = plugin.primaryCommandLabel === undefined ? undefined : boundedString(plugin.primaryCommandLabel, `${extensionId}.primaryCommandLabel`, 100);
		if (!official.has(extensionId) && (!primaryCommand || !primaryCommandLabel)) {
			throw new Error(`Reviewed plugin '${extensionId}' must declare its primary action.`);
		}
		if (primaryCommand && !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
			throw new Error(`Plugin '${extensionId}' does not own primary command '${primaryCommand}'.`);
		}
		plugins.push({
			extensionId,
			label: boundedString(plugin.label, `${extensionId}.label`, 150),
			description: boundedString(plugin.description, `${extensionId}.description`, 4_000),
			category: boundedString(plugin.category, `${extensionId}.category`, 50),
			publisher,
			...(primaryCommand ? { primaryCommand } : {}),
			...(primaryCommandLabel ? { primaryCommandLabel } : {}),
			versions
		});
	}
	return { schemaVersion: 1, sequence, generatedAt, plugins };
}

export function parseBaseHalfPluginCatalogSignature(value: unknown): IBaseHalfPluginCatalogSignature {
	const signature = record(value, 'catalog signature');
	return {
		keyId: string(signature.keyId, 'catalog signature.keyId'),
		algorithm: literal(signature.algorithm, 'ECDSA_P256_SHA256_DER', 'catalog signature.algorithm'),
		signature: base64(signature.signature, 'catalog signature.signature')
	};
}

export function parseBaseHalfPluginCatalogIndex(value: unknown): IBaseHalfPluginCatalogIndex {
	const index = record(value, 'catalog index');
	const sequence = integer(index.sequence, 'catalog index.sequence', 1);
	const expectedPrefix = `catalogs/${sequence}`;
	const catalogPath = string(index.catalogPath, 'catalog index.catalogPath');
	const signaturePath = string(index.signaturePath, 'catalog index.signaturePath');
	validateAssetPath(catalogPath, 'catalog index.catalogPath');
	validateAssetPath(signaturePath, 'catalog index.signaturePath');
	if (catalogPath !== `${expectedPrefix}/catalog.json`) {
		throw new Error(`Plugin catalog index catalogPath must be '${expectedPrefix}/catalog.json'.`);
	}
	if (signaturePath !== `${expectedPrefix}/catalog.sig.json`) {
		throw new Error(`Plugin catalog index signaturePath must be '${expectedPrefix}/catalog.sig.json'.`);
	}
	return {
		schemaVersion: literal(index.schemaVersion, 1, 'catalog index.schemaVersion'),
		sequence,
		catalogPath,
		signaturePath
	};
}

export function resolveBaseHalfPluginCatalog(
	curated: readonly IBaseHalfCuratedPlugin[],
	remote: IBaseHalfRemotePluginCatalog | undefined,
	versions: { readonly basehalf: string; readonly vscode: string; readonly targetPlatform: string }
): readonly IBaseHalfResolvedPlugin[] {
	const remoteById = new Map(remote?.plugins.map(plugin => [plugin.extensionId, plugin]) ?? []);
	const official = curated.map(plugin => {
		const remotePlugin = remoteById.get(plugin.extensionId.toLowerCase());
		return {
			...plugin,
			remote: remotePlugin,
			remoteVersion: remotePlugin ? selectBaseHalfRemotePluginVersion(remotePlugin, versions) : undefined
		};
	});
	const curatedIds = new Set(curated.map(plugin => plugin.extensionId.toLowerCase()));
	const reviewed = (remote?.plugins ?? [])
		.filter(plugin => !curatedIds.has(plugin.extensionId))
		.map(plugin => ({
			extensionId: plugin.extensionId,
			label: plugin.label,
			description: plugin.description,
			category: plugin.category,
			publisher: plugin.publisher!,
			...(plugin.primaryCommand ? { primaryCommand: plugin.primaryCommand } : {}),
			...(plugin.primaryCommandLabel ? { primaryCommandLabel: plugin.primaryCommandLabel } : {}),
			remote: plugin,
			remoteVersion: selectBaseHalfRemotePluginVersion(plugin, versions)
		}));
	return [...official, ...reviewed];
}

export function selectBaseHalfRemotePluginVersion(
	plugin: IBaseHalfRemotePlugin,
	versions: { readonly basehalf: string; readonly vscode: string; readonly targetPlatform: string }
): IBaseHalfRemotePluginVersion | undefined {
	return plugin.versions.find(version => version.status === 'active'
		&& platformMatches(version.targetPlatform, versions.targetPlatform)
		&& satisfies(versions.basehalf, version.basehalfRange)
		&& satisfies(versions.vscode, version.vscodeRange));
}

export function resolveBaseHalfPluginAsset(baseUrl: string, assetPath: string): URL {
	const base = new URL(baseUrl);
	if (base.protocol !== 'https:' && !(base.protocol === 'http:' && isLoopback(base.hostname))) {
		throw new Error('Plugin asset base URL must use HTTPS. HTTP is allowed only for a loopback test server.');
	}
	validateAssetPath(assetPath, 'assetPath');
	const resolved = new URL(assetPath, base.href.endsWith('/') ? base.href : `${base.href}/`);
	if (resolved.origin !== base.origin) {
		throw new Error('Plugin asset path resolved outside the configured asset origin.');
	}
	return resolved;
}

export function resolveBaseHalfPluginCatalogIndexResource(indexUrl: string, resourcePath: string): URL {
	const index = new URL(indexUrl);
	if (index.protocol !== 'https:' && !(index.protocol === 'http:' && isLoopback(index.hostname))) {
		throw new Error('Plugin catalog index URL must use HTTPS. HTTP is allowed only for a loopback test server.');
	}
	validateAssetPath(resourcePath, 'catalog index resource path');
	const root = new URL('/', index);
	const resolved = new URL(resourcePath, root);
	if (resolved.origin !== index.origin) {
		throw new Error('Plugin catalog index resource resolved outside the configured index origin.');
	}
	return resolved;
}

function parseVersions(value: unknown, extensionId: string): readonly IBaseHalfRemotePluginVersion[] {
	const seen = new Set<string>();
	const versions = array(value, `${extensionId}.versions`, 50).map((rawVersion, index): IBaseHalfRemotePluginVersion => {
		const version = record(rawVersion, `${extensionId}.versions[${index}]`);
		const versionValue = string(version.version, `${extensionId}.versions[${index}].version`);
		if (!valid(versionValue)) {
			throw new Error(`Plugin catalog version '${versionValue}' for '${extensionId}' is invalid.`);
		}
		if (seen.has(versionValue)) {
			throw new Error(`Plugin catalog contains duplicate version '${extensionId}@${versionValue}'.`);
		}
		seen.add(versionValue);
		const sha256 = string(version.sha256, `${extensionId}@${versionValue}.sha256`).toLowerCase();
		if (!/^[a-f0-9]{64}$/.test(sha256)) {
			throw new Error(`Plugin catalog SHA-256 for '${extensionId}@${versionValue}' must be 64 lowercase hexadecimal characters.`);
		}
		const assetPath = string(version.assetPath, `${extensionId}@${versionValue}.assetPath`);
		validateAssetPath(assetPath, `${extensionId}@${versionValue}.assetPath`);
		const expectedAssetPath = `${extensionId}/${versionValue}/${sha256}.vsix`;
		if (assetPath !== expectedAssetPath) {
			throw new Error(`Plugin catalog asset path for '${extensionId}@${versionValue}' must be '${expectedAssetPath}'.`);
		}
		const basehalfRange = semverRange(version.basehalfRange, `${extensionId}@${versionValue}.basehalfRange`);
		const vscodeRange = semverRange(version.vscodeRange, `${extensionId}@${versionValue}.vscodeRange`);
		return {
			version: versionValue,
			basehalfRange,
			vscodeRange,
			targetPlatform: boundedString(version.targetPlatform, `${extensionId}@${versionValue}.targetPlatform`, 64),
			assetPath,
			sha256,
			size: integer(version.size, `${extensionId}@${versionValue}.size`, 1, 100 * 1024 * 1024),
			publishedAt: isoDate(version.publishedAt, `${extensionId}@${versionValue}.publishedAt`),
			status: enumValue(version.status, ['active', 'withdrawn'] as const, `${extensionId}@${versionValue}.status`),
			...(version.releaseNotes === undefined ? {} : { releaseNotes: boundedString(version.releaseNotes, `${extensionId}@${versionValue}.releaseNotes`, 100_000) })
		};
	});
	return versions.sort((a, b) => rcompare(a.version, b.version));
}

function parsePublisher(value: unknown, extensionId: string): IBaseHalfPluginPublisher {
	const publisher = record(value, `${extensionId}.publisher`);
	const slug = boundedString(publisher.slug, `${extensionId}.publisher.slug`, 50).toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) || !extensionId.startsWith(`${slug}.`)) {
		throw new Error(`Plugin '${extensionId}' does not match Publisher '${slug}'.`);
	}
	return {
		slug,
		displayName: boundedString(publisher.displayName, `${extensionId}.publisher.displayName`, 100),
		trust: enumValue(publisher.trust, ['official', 'reviewed'] as const, `${extensionId}.publisher.trust`)
	};
}

function validateAssetPath(value: string, field: string): void {
	if (!value || value.startsWith('/') || value.startsWith('\\') || value.includes('?') || value.includes('#')) {
		throw new Error(`Plugin catalog ${field} must be a relative path without a query or fragment.`);
	}
	const segments = value.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
		throw new Error(`Plugin catalog ${field} contains an invalid path segment.`);
	}
}

function platformMatches(candidate: string, current: string): boolean {
	return candidate === 'universal' || candidate === current;
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function record(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, field: string, maximumLength: number): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${field} must be an array.`);
	}
	if (value.length > maximumLength) {
		throw new Error(`${field} must contain no more than ${maximumLength} entries.`);
	}
	return value;
}

function string(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${field} must be a non-empty string.`);
	}
	return value;
}

function boundedString(value: unknown, field: string, maximumLength: number): string {
	const parsed = string(value, field);
	if (parsed.length > maximumLength) {
		throw new Error(`${field} must be no longer than ${maximumLength} characters.`);
	}
	return parsed;
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
	}
	return value as number;
}

function isoDate(value: unknown, field: string): string {
	const parsed = string(value, field);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || new Date(parsed).toISOString() !== parsed) {
		throw new Error(`${field} must be a canonical UTC ISO date.`);
	}
	return parsed;
}

function semverRange(value: unknown, field: string): string {
	const parsed = string(value, field);
	if (!validRange(parsed)) {
		throw new Error(`${field} must be a valid semantic version range.`);
	}
	return parsed;
}

function literal<T extends string | number>(value: unknown, expected: T, field: string): T {
	if (value !== expected) {
		throw new Error(`${field} must be '${expected}'.`);
	}
	return expected;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
	if (typeof value !== 'string' || !values.includes(value as T)) {
		throw new Error(`${field} must be one of ${values.join(', ')}.`);
	}
	return value as T;
}

function base64(value: unknown, field: string): string {
	const parsed = string(value, field);
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parsed) || parsed.length % 4 !== 0) {
		throw new Error(`${field} must be standard padded Base64.`);
	}
	return parsed;
}
