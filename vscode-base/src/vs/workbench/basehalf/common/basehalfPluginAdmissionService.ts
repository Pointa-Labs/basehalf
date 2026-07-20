/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { baseHalfBundledPluginLocation, baseHalfPluginLocationsEqual, baseHalfPluginPayloadLocation, BASEHALF_CURATED_PLUGINS } from './basehalfPluginCatalog.js';
import { baseHalfCanonicalInstalledFileBytes } from './basehalfPluginInstalledContent.js';

const LEGACY_VERIFIED_INSTALLS_STORAGE_KEY = 'basehalf.plugins.verifiedInstalls';
const VERIFIED_INSTALL_STORAGE_PREFIX = 'basehalf.plugins.verifiedInstall.v1.';
const MAX_VERIFIED_INSTALLS = 500;
const MAX_INSTALLED_PLUGIN_FILES = 4_096;
const MAX_INSTALLED_PLUGIN_FILE_BYTES = 128 * 1024 * 1024;
const MAX_INSTALLED_PLUGIN_BYTES = 500 * 1024 * 1024;

export interface IBaseHalfVerifiedPluginVersionAdmission {
	readonly version: string;
	readonly sha256: string;
	readonly installedContentSha256: string;
}

export interface IBaseHalfVerifiedPluginAdmission {
	readonly extensionId: string;
	readonly versions: readonly IBaseHalfVerifiedPluginVersionAdmission[];
}

export interface IBaseHalfVerifiedPluginInstall {
	readonly extensionId: string;
	readonly version: string;
	readonly sha256: string;
	readonly extensionLocation: URI;
	readonly installedContentSha256: string;
}

export interface IBaseHalfPluginInstallVerification {
	readonly extensionId: string;
	readonly version: string;
	readonly sha256: string;
	readonly extensionLocation: URI;
	readonly expectedInstalledContentSha256: string;
}

export interface IBaseHalfInstalledPluginState {
	readonly version: string;
	readonly extensionLocation: URI;
}

export interface IBaseHalfPluginContributorIdentity {
	readonly extensionId: string;
	readonly version: string;
	readonly extensionLocation: URI;
	readonly isBuiltin: boolean;
	readonly isUnderDevelopment: boolean;
}

export function baseHalfPluginContributorIdentity(description: IExtensionDescription): IBaseHalfPluginContributorIdentity {
	return {
		extensionId: description.identifier.value,
		version: description.version,
		extensionLocation: description.extensionLocation,
		isBuiltin: description.isBuiltin,
		isUnderDevelopment: description.isUnderDevelopment
	};
}

export const IBaseHalfPluginAdmissionService = createDecorator<IBaseHalfPluginAdmissionService>('basehalfPluginAdmissionService');

/**
 * Runtime admission derived from product-owned bundled locations and catalogs
 * that the catalog service has already signature-verified.
 */
export interface IBaseHalfPluginAdmissionService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	replaceVerifiedPlugins(plugins: readonly IBaseHalfVerifiedPluginAdmission[]): void;
	isAllowed(extensionId: string, version?: string): boolean;
	isAllowedContributor(identity: IBaseHalfPluginContributorIdentity): boolean;
	getVerifiedInstall(extensionId: string, version: string, extensionLocation: URI): IBaseHalfVerifiedPluginInstall | undefined;
	verifyAndRecordInstall(verification: IBaseHalfPluginInstallVerification): Promise<IBaseHalfVerifiedPluginInstall | undefined>;
	reverifyVerifiedInstalls(): Promise<void>;
	reconcileVerifiedInstalls(extensionId: string, installed: readonly IBaseHalfInstalledPluginState[]): Promise<void>;
	forgetVerifiedInstalls(extensionId: string): void;
}

interface IBaseHalfPendingInstallVerification {
	readonly extensionLocation: URI;
	generation: number;
	references: number;
}

type BaseHalfInstallContentVerificationResult =
	| { readonly kind: 'verified'; readonly installedContentSha256: string }
	| { readonly kind: 'contentMismatch' }
	| { readonly kind: 'untrusted' };

export class BaseHalfPluginAdmissionService extends Disposable implements IBaseHalfPluginAdmissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private verifiedVersions = new Map<string, ReadonlyMap<string, IBaseHalfVerifiedPluginVersionAdmission>>();
	private readonly verifiedInstalls = new Map<string, IBaseHalfVerifiedPluginInstall>();
	private readonly storedInstalls = new Map<string, IBaseHalfVerifiedPluginInstall>();
	private readonly pendingInstallVerifications = new Map<string, IBaseHalfPendingInstallVerification>();
	private admissionGeneration = 0;
	private reverifyTail: Promise<void> = Promise.resolve();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		this.restoreVerifiedInstalls();
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, undefined, this._store)(event => {
			if (event.key.startsWith(VERIFIED_INSTALL_STORAGE_PREFIX)) {
				const changed = this.synchronizeStoredInstall(event.key);
				if (changed) {
					this._onDidChange.fire();
				}
				this.queueReverify();
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => {
			let changed = false;
			for (const pending of this.pendingInstallVerifications.values()) {
				if (event.affects(pending.extensionLocation)) {
					pending.generation++;
				}
			}
			for (const [key, install] of this.storedInstalls) {
				if (event.affects(install.extensionLocation)) {
					this.storedInstalls.delete(key);
					this.verifiedInstalls.delete(key);
					this.storageService.remove(verifiedInstallStorageKey(install), StorageScope.APPLICATION);
					changed = true;
				}
			}
			if (changed) {
				this._onDidChange.fire();
			}
		}));
	}

	replaceVerifiedPlugins(plugins: readonly IBaseHalfVerifiedPluginAdmission[]): void {
		const next = new Map<string, ReadonlyMap<string, IBaseHalfVerifiedPluginVersionAdmission>>();
		for (const plugin of plugins) {
			const extensionId = plugin.extensionId.toLowerCase();
			if (!extensionId || plugin.versions.length === 0) {
				continue;
			}
			const versions = plugin.versions.filter(version =>
				!!version.version
				&& /^[a-f0-9]{64}$/.test(version.sha256)
				&& /^[a-f0-9]{64}$/.test(version.installedContentSha256)
			);
			if (versions.length) {
				next.set(extensionId, new Map(versions.map(version => [version.version, { ...version }])));
			}
		}

		if (equals(this.verifiedVersions, next)) {
			return;
		}
		this.verifiedVersions = next;
		this.admissionGeneration++;
		this._onDidChange.fire();
	}

	isAllowed(extensionId: string, version?: string): boolean {
		const versions = this.verifiedVersions.get(extensionId.toLowerCase());
		return !!versions && (version === undefined || versions.has(version));
	}

	isAllowedContributor(identity: IBaseHalfPluginContributorIdentity): boolean {
		const extensionId = identity.extensionId.trim().toLowerCase();
		if (identity.isUnderDevelopment
			&& this.environmentService.isExtensionDevelopment
			&& this.environmentService.extensionDevelopmentLocationURI?.some(location => baseHalfPluginLocationsEqual(location, identity.extensionLocation))) {
			return true;
		}
		const bundled = BASEHALF_CURATED_PLUGINS.find(plugin =>
			plugin.publisher.trust === 'official'
			&& plugin.extensionId.toLowerCase() === extensionId
		);
		if (identity.isBuiltin) {
			if (bundled && this.environmentService.isBuilt === false) {
				const developmentLocation = baseHalfPluginPayloadLocation(bundled, false);
				if (developmentLocation && baseHalfPluginLocationsEqual(identity.extensionLocation, developmentLocation)) {
					return true;
				}
			}
			return false;
		}
		if (bundled) {
			const bundledLocation = baseHalfBundledPluginLocation(bundled);
			if (bundledLocation && baseHalfPluginLocationsEqual(identity.extensionLocation, bundledLocation)) {
				return true;
			}
			if (this.environmentService.isBuilt === false) {
				const developmentLocation = baseHalfPluginPayloadLocation(bundled, false);
				if (developmentLocation && baseHalfPluginLocationsEqual(identity.extensionLocation, developmentLocation)) {
					return true;
				}
			}
		}

		const grant = this.verifiedVersions.get(extensionId)?.get(identity.version);
		if (!grant) {
			return false;
		}
		return [...this.verifiedInstalls.values()].some(install =>
			install.extensionId === extensionId
			&& install.version === identity.version
			&& install.sha256 === grant.sha256
			&& install.installedContentSha256 === grant.installedContentSha256
			&& baseHalfPluginLocationsEqual(install.extensionLocation, identity.extensionLocation)
		);
	}

	getVerifiedInstall(extensionId: string, version: string, extensionLocation: URI): IBaseHalfVerifiedPluginInstall | undefined {
		const normalizedId = extensionId.trim().toLowerCase();
		return [...this.verifiedInstalls.values()].find(install =>
			install.extensionId === normalizedId
			&& install.version === version
			&& baseHalfPluginLocationsEqual(install.extensionLocation, extensionLocation)
		);
	}

	async verifyAndRecordInstall(verification: IBaseHalfPluginInstallVerification): Promise<IBaseHalfVerifiedPluginInstall | undefined> {
		let recorded: IBaseHalfVerifiedPluginInstall | undefined;
		const result = await this.verifyInstallContent(verification, installedContentSha256 => {
			recorded = this.recordVerifiedInstall({
				extensionId: verification.extensionId,
				version: verification.version,
				sha256: verification.sha256,
				extensionLocation: verification.extensionLocation,
				installedContentSha256
			});
			return !!recorded;
		});
		return result.kind === 'verified' ? recorded : undefined;
	}

	private async verifyInstallContent(
		verification: IBaseHalfPluginInstallVerification,
		onVerified?: (installedContentSha256: string) => boolean
	): Promise<BaseHalfInstallContentVerificationResult> {
		const extensionId = verification.extensionId.trim().toLowerCase();
		const grant = this.verifiedVersions.get(extensionId)?.get(verification.version);
		if (!grant
			|| grant.sha256 !== verification.sha256
			|| !verification.extensionLocation.scheme
			|| !/^[a-f0-9]{64}$/.test(verification.expectedInstalledContentSha256)
			|| verification.expectedInstalledContentSha256 !== grant.installedContentSha256) {
			return { kind: 'untrusted' };
		}

		const pendingKey = pendingInstallVerificationKey(extensionId, verification.version, verification.extensionLocation);
		let pending = this.pendingInstallVerifications.get(pendingKey);
		if (!pending) {
			pending = { extensionLocation: verification.extensionLocation, generation: 0, references: 0 };
			this.pendingInstallVerifications.set(pendingKey, pending);
		}
		pending.references++;
		const pendingGeneration = pending.generation;
		const admissionGeneration = this.admissionGeneration;
		try {
			const installedContentSha256 = await hashBaseHalfPluginInstall(this.fileService, verification.extensionLocation);
			if (pending.generation !== pendingGeneration
				|| this.admissionGeneration !== admissionGeneration) {
				return { kind: 'untrusted' };
			}
			if (installedContentSha256 !== grant.installedContentSha256) {
				return { kind: 'contentMismatch' };
			}
			if (onVerified && !onVerified(installedContentSha256)) {
				return { kind: 'untrusted' };
			}
			if (pending.generation !== pendingGeneration || this.admissionGeneration !== admissionGeneration) {
				return { kind: 'untrusted' };
			}
			return { kind: 'verified', installedContentSha256 };
		} catch {
			return { kind: 'untrusted' };
		} finally {
			pending.references--;
			if (pending.references === 0 && this.pendingInstallVerifications.get(pendingKey) === pending) {
				this.pendingInstallVerifications.delete(pendingKey);
			}
		}
	}

	private recordVerifiedInstall(install: IBaseHalfVerifiedPluginInstall): IBaseHalfVerifiedPluginInstall | undefined {
		const extensionId = install.extensionId.trim().toLowerCase();
		const grant = this.verifiedVersions.get(extensionId)?.get(install.version);
		if (!grant || grant.sha256 !== install.sha256 || grant.installedContentSha256 !== install.installedContentSha256 || !install.extensionLocation.scheme) {
			return undefined;
		}
		const normalized: IBaseHalfVerifiedPluginInstall = {
			extensionId,
			version: install.version,
			sha256: install.sha256,
			extensionLocation: install.extensionLocation,
			installedContentSha256: install.installedContentSha256
		};
		const key = verifiedInstallKey(normalized);
		if (!this.storedInstalls.has(key) && this.storedInstalls.size >= MAX_VERIFIED_INSTALLS) {
			return undefined;
		}
		this.storageService.store(verifiedInstallStorageKey(normalized), serializeVerifiedInstall(normalized), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storedInstalls.set(key, normalized);
		this.verifiedInstalls.set(key, normalized);
		this._onDidChange.fire();
		return normalized;
	}

	async reverifyVerifiedInstalls(): Promise<void> {
		const results: { readonly key: string; readonly install: IBaseHalfVerifiedPluginInstall; readonly result: BaseHalfInstallContentVerificationResult }[] = [];
		for (const [key, install] of [...this.storedInstalls]) {
			const grant = this.verifiedVersions.get(install.extensionId)?.get(install.version);
			if (!grant) {
				results.push({ key, install, result: { kind: 'untrusted' } });
				continue;
			}
			if (grant.sha256 !== install.sha256 || grant.installedContentSha256 !== install.installedContentSha256) {
				results.push({ key, install, result: { kind: 'contentMismatch' } });
				continue;
			}
			results.push({
				key,
				install,
				result: await this.verifyInstallContent({
					extensionId: install.extensionId,
					version: install.version,
					sha256: install.sha256,
					extensionLocation: install.extensionLocation,
					expectedInstalledContentSha256: grant.installedContentSha256
				})
			});
		}

		let changed = false;
		let storedChanged = false;
		for (const { key, install, result } of results) {
			if (this.storedInstalls.get(key) !== install) {
				continue;
			}
			if (result.kind === 'verified') {
				if (this.verifiedInstalls.get(key) !== install) {
					this.verifiedInstalls.set(key, install);
					changed = true;
				}
			} else {
				changed = this.verifiedInstalls.delete(key) || changed;
			}
			if (result.kind === 'contentMismatch') {
				this.storedInstalls.delete(key);
				this.storageService.remove(verifiedInstallStorageKey(install), StorageScope.APPLICATION);
				storedChanged = true;
			}
		}
		if (changed || storedChanged) {
			this._onDidChange.fire();
		}
	}

	async reconcileVerifiedInstalls(extensionId: string, installed: readonly IBaseHalfInstalledPluginState[]): Promise<void> {
		const normalizedId = extensionId.trim().toLowerCase();
		const current = installed.filter(candidate => !!candidate.version && !!candidate.extensionLocation.scheme);
		const results: {
			readonly key: string;
			readonly install: IBaseHalfVerifiedPluginInstall;
			readonly isInstalled: boolean;
			readonly result?: BaseHalfInstallContentVerificationResult;
		}[] = [];
		for (const [key, install] of [...this.storedInstalls]) {
			if (install.extensionId !== normalizedId) {
				continue;
			}
			const isInstalled = current.some(candidate =>
				candidate.version === install.version
				&& baseHalfPluginLocationsEqual(candidate.extensionLocation, install.extensionLocation)
			);
			if (!isInstalled) {
				results.push({ key, install, isInstalled });
				continue;
			}
			const grant = this.verifiedVersions.get(normalizedId)?.get(install.version);
			if (!grant) {
				results.push({ key, install, isInstalled, result: { kind: 'untrusted' } });
				continue;
			}
			if (grant.sha256 !== install.sha256 || grant.installedContentSha256 !== install.installedContentSha256) {
				results.push({ key, install, isInstalled, result: { kind: 'contentMismatch' } });
				continue;
			}
			results.push({
				key,
				install,
				isInstalled,
				result: await this.verifyInstallContent({
					extensionId: install.extensionId,
					version: install.version,
					sha256: install.sha256,
					extensionLocation: install.extensionLocation,
					expectedInstalledContentSha256: install.installedContentSha256
				})
			});
		}

		let changed = false;
		for (const { key, install, isInstalled, result } of results) {
			if (this.storedInstalls.get(key) !== install) {
				continue;
			}
			if (!isInstalled || result?.kind === 'contentMismatch') {
				const pending = this.pendingInstallVerifications.get(pendingInstallVerificationKey(install.extensionId, install.version, install.extensionLocation));
				if (pending) {
					pending.generation++;
				}
				this.storedInstalls.delete(key);
				changed = this.verifiedInstalls.delete(key) || changed;
				this.storageService.remove(verifiedInstallStorageKey(install), StorageScope.APPLICATION);
				changed = true;
				continue;
			}
			if (result?.kind === 'verified') {
				if (this.verifiedInstalls.get(key) !== install) {
					this.verifiedInstalls.set(key, install);
					changed = true;
				}
			} else {
				changed = this.verifiedInstalls.delete(key) || changed;
			}
		}
		if (changed) {
			this._onDidChange.fire();
		}
	}

	forgetVerifiedInstalls(extensionId: string): void {
		const normalizedId = extensionId.trim().toLowerCase();
		this.admissionGeneration++;
		let changed = false;
		for (const [key, install] of this.verifiedInstalls) {
			if (install.extensionId === normalizedId) {
				this.verifiedInstalls.delete(key);
				this.storedInstalls.delete(key);
				this.storageService.remove(verifiedInstallStorageKey(install), StorageScope.APPLICATION);
				changed = true;
			}
		}
		for (const [key, install] of this.storedInstalls) {
			if (install.extensionId === normalizedId) {
				this.storedInstalls.delete(key);
				this.storageService.remove(verifiedInstallStorageKey(install), StorageScope.APPLICATION);
				changed = true;
			}
		}
		if (changed) {
			this._onDidChange.fire();
		}
	}

	private restoreVerifiedInstalls(): void {
		for (const key of this.storageService.keys(StorageScope.APPLICATION, StorageTarget.MACHINE)) {
			if (this.storedInstalls.size >= MAX_VERIFIED_INSTALLS) {
				break;
			}
			if (key.startsWith(VERIFIED_INSTALL_STORAGE_PREFIX)) {
				this.synchronizeStoredInstall(key);
			}
		}
		const raw = this.storageService.get(LEGACY_VERIFIED_INSTALLS_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}
		try {
			const records = JSON.parse(raw);
			if (!Array.isArray(records) || records.length > MAX_VERIFIED_INSTALLS) {
				return;
			}
			for (const value of records) {
				const install = parseVerifiedInstall(value);
				if (install) {
					const key = verifiedInstallKey(install);
					if (!this.storedInstalls.has(key) && this.storedInstalls.size >= MAX_VERIFIED_INSTALLS) {
						break;
					}
					this.storageService.store(verifiedInstallStorageKey(install), serializeVerifiedInstall(install), StorageScope.APPLICATION, StorageTarget.MACHINE);
					this.storedInstalls.set(key, install);
				}
			}
			this.storageService.remove(LEGACY_VERIFIED_INSTALLS_STORAGE_KEY, StorageScope.APPLICATION);
		} catch {
			// Invalid local state never grants plugin trust.
		}
	}

	private synchronizeStoredInstall(storageKey: string): boolean {
		const raw = this.storageService.get(storageKey, StorageScope.APPLICATION);
		const install = raw ? parseSerializedVerifiedInstall(raw) : undefined;
		if (!install || verifiedInstallStorageKey(install) !== storageKey) {
			let changed = false;
			for (const [key, candidate] of this.storedInstalls) {
				if (verifiedInstallStorageKey(candidate) === storageKey) {
					this.storedInstalls.delete(key);
					this.verifiedInstalls.delete(key);
					changed = true;
				}
			}
			return changed;
		}
		const key = verifiedInstallKey(install);
		const previous = this.storedInstalls.get(key);
		if (previous && sameVerifiedInstall(previous, install)) {
			return false;
		}
		if (!previous && this.storedInstalls.size >= MAX_VERIFIED_INSTALLS) {
			return false;
		}
		this.storedInstalls.set(key, install);
		this.verifiedInstalls.delete(key);
		return true;
	}

	private queueReverify(): void {
		this.reverifyTail = this.reverifyTail
			.then(() => this.reverifyVerifiedInstalls(), () => this.reverifyVerifiedInstalls())
			.then(() => undefined, () => undefined);
	}
}

function verifiedInstallKey(install: IBaseHalfVerifiedPluginInstall): string {
	return `${install.extensionId}\n${install.version}\n${install.extensionLocation.toString()}\n${install.sha256}\n${install.installedContentSha256}`;
}

function pendingInstallVerificationKey(extensionId: string, version: string, extensionLocation: URI): string {
	return `${extensionId}\n${version}\n${extUri.getComparisonKey(extensionLocation)}`;
}

function verifiedInstallStorageKey(install: IBaseHalfVerifiedPluginInstall): string {
	return `${VERIFIED_INSTALL_STORAGE_PREFIX}${encodeBase64(VSBuffer.fromString(verifiedInstallKey(install)), false, true)}`;
}

function serializeVerifiedInstall(install: IBaseHalfVerifiedPluginInstall): string {
	return JSON.stringify({
		extensionId: install.extensionId,
		version: install.version,
		sha256: install.sha256,
		extensionLocation: install.extensionLocation.toString(),
		installedContentSha256: install.installedContentSha256
	});
}

function parseSerializedVerifiedInstall(raw: string): IBaseHalfVerifiedPluginInstall | undefined {
	try {
		return parseVerifiedInstall(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function sameVerifiedInstall(first: IBaseHalfVerifiedPluginInstall, second: IBaseHalfVerifiedPluginInstall): boolean {
	return first.extensionId === second.extensionId
		&& first.version === second.version
		&& first.sha256 === second.sha256
		&& first.installedContentSha256 === second.installedContentSha256
		&& extUri.isEqual(first.extensionLocation, second.extensionLocation);
}

function parseVerifiedInstall(value: unknown): IBaseHalfVerifiedPluginInstall | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.extensionId !== 'string' || typeof record.version !== 'string' || typeof record.sha256 !== 'string' || typeof record.extensionLocation !== 'string' || typeof record.installedContentSha256 !== 'string') {
		return undefined;
	}
	const extensionId = record.extensionId.trim().toLowerCase();
	if (!extensionId || !record.version || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[a-f0-9]{64}$/.test(record.installedContentSha256) || record.extensionLocation.length > 4096) {
		return undefined;
	}
	try {
		const extensionLocation = URI.parse(record.extensionLocation);
		if (!extensionLocation.scheme) {
			return undefined;
		}
		return { extensionId, version: record.version, sha256: record.sha256, extensionLocation, installedContentSha256: record.installedContentSha256 };
	} catch {
		return undefined;
	}
}

export async function hashBaseHalfPluginInstall(fileService: IFileService, extensionLocation: URI): Promise<string> {
	const root = await fileService.stat(extensionLocation);
	if (!root.isDirectory || root.isSymbolicLink) {
		throw new Error('Installed plugin location must be a real directory.');
	}
	const directories = [extensionLocation];
	const entries: string[] = [];
	const canonicalPaths = new Set<string>();
	let fileCount = 0;
	let totalBytes = 0;
	let hasManifest = false;
	while (directories.length) {
		const directory = directories.pop()!;
		const resolved = await fileService.resolve(directory);
		if (!resolved.isDirectory || resolved.isSymbolicLink) {
			throw new Error('Installed plugin tree changed while it was being verified.');
		}
		for (const child of resolved.children ?? []) {
			if (child.isSymbolicLink) {
				throw new Error('Installed plugin content cannot contain symbolic links.');
			}
			const relative = extUri.relativePath(extensionLocation, child.resource);
			if (!relative || relative !== relative.normalize('NFC') || relative.startsWith('../')) {
				throw new Error('Installed plugin content contains an invalid path.');
			}
			const canonical = relative.toLowerCase();
			if (canonicalPaths.has(canonical)) {
				throw new Error('Installed plugin content contains an ambiguous path.');
			}
			canonicalPaths.add(canonical);
			if (child.isDirectory) {
				directories.push(child.resource);
				continue;
			}
			if (!child.isFile || ++fileCount > MAX_INSTALLED_PLUGIN_FILES) {
				throw new Error('Installed plugin content exceeds the file limit.');
			}
			const content = await fileService.readFile(child.resource, { limits: { size: MAX_INSTALLED_PLUGIN_FILE_BYTES } });
			totalBytes += content.value.byteLength;
			if (totalBytes > MAX_INSTALLED_PLUGIN_BYTES) {
				throw new Error('Installed plugin content exceeds the total size limit.');
			}
			hasManifest ||= relative === 'package.json';
			const installedBytes = baseHalfCanonicalInstalledFileBytes(relative, content.value.buffer);
			entries.push(JSON.stringify([relative, installedBytes.byteLength, await sha256Hex(installedBytes)]));
		}
	}
	if (!hasManifest) {
		throw new Error('Installed plugin content is missing package.json.');
	}
	entries.sort();
	return sha256Hex(new TextEncoder().encode(entries.join('\n')));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function equals(
	first: ReadonlyMap<string, ReadonlyMap<string, IBaseHalfVerifiedPluginVersionAdmission>>,
	second: ReadonlyMap<string, ReadonlyMap<string, IBaseHalfVerifiedPluginVersionAdmission>>
): boolean {
	if (first.size !== second.size) {
		return false;
	}
	for (const [extensionId, versions] of first) {
		const otherVersions = second.get(extensionId);
		if (!otherVersions || versions.size !== otherVersions.size || [...versions].some(([version, grant]) => {
			const other = otherVersions.get(version);
			return !other || other.sha256 !== grant.sha256 || other.installedContentSha256 !== grant.installedContentSha256;
		})) {
			return false;
		}
	}
	return true;
}

registerSingleton(IBaseHalfPluginAdmissionService, BaseHalfPluginAdmissionService, InstantiationType.Delayed);
