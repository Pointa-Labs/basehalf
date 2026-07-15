/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash, verify as verifySignature } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { createVSIX } from '@vscode/vsce';
import { compare, valid, validRange } from 'semver';

export const OFFICIAL_EXTENSION_ID = 'pointa.basehalf-ai-video';
const FORBIDDEN_CONTRIBUTION_POINTS = ['viewsContainers', 'views', 'customEditors', 'notebooks', 'chatParticipants', 'languageModelTools', 'authentication'] as const;
const MAX_VSIX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface ReleaseMetadata {
	extensionId: string;
	version: string;
	assetPath: string;
	sha256: string;
	size: number;
	vsixPath: string;
	label?: string;
	description?: string;
	category?: string;
	primaryCommand?: string;
	primaryCommandLabel?: string;
	publisher?: {
		slug: string;
		displayName: string;
		trust: 'official' | 'reviewed';
	};
	releaseNotes?: string;
}

export async function packagePlugin(options: { root: string; outputDirectory: string }): Promise<ReleaseMetadata> {
	const extensionRoot = path.join(options.root, 'extensions', 'basehalf-ai-video');
	const manifest = readJson(path.join(extensionRoot, 'package.json'));
	const extensionId = manifestId(manifest);
	if (extensionId !== OFFICIAL_EXTENSION_ID) {
		throw new Error(`AI Video package id must be ${OFFICIAL_EXTENSION_ID}; got ${extensionId}.`);
	}
	assertSemver(manifest.version, 'extension version');
	if (!fs.existsSync(path.join(extensionRoot, 'out', 'extension.js'))) {
		throw new Error('AI Video is not compiled. Run the extension compile task before packaging.');
	}
	for (const asset of ['main.js', 'main.css']) {
		if (!fs.existsSync(path.join(extensionRoot, 'dist', asset))) {
			throw new Error(`AI Video webview asset '${asset}' is missing. Run its webview build before packaging.`);
		}
	}
	fs.mkdirSync(options.outputDirectory, { recursive: true });
	const vsixPath = path.join(options.outputDirectory, `${extensionId}-${manifest.version}.vsix`);
	await createVSIX({ cwd: extensionRoot, packagePath: vsixPath, dependencies: false });
	const bytes = fs.readFileSync(vsixPath);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const packagedManifest = await readVsixManifest(vsixPath);
	if (manifestId(packagedManifest) !== extensionId || packagedManifest.version !== manifest.version) {
		throw new Error('The packaged VSIX manifest does not match its source manifest.');
	}
	return {
		extensionId,
		version: manifest.version,
		assetPath: `${extensionId}/${manifest.version}/${sha256}.vsix`,
		sha256,
		size: bytes.byteLength,
		vsixPath,
		label: manifest.displayName,
		description: manifest.description,
		category: 'Domain',
		publisher: { slug: manifest.publisher, displayName: 'BaseHalf', trust: 'official' },
		primaryCommand: manifest.basehalf?.primaryCommand,
		primaryCommandLabel: manifest.basehalf?.primaryCommandLabel
	};
}

export async function metadataFromVsix(options: {
	vsixPath: string;
	expectedExtensionId?: string;
	expectedVersion?: string;
	label?: string;
	description?: string;
	category?: string;
	primaryCommand?: string;
	primaryCommandLabel?: string;
	publisherSlug?: string;
	publisherDisplayName?: string;
	publisherTrust?: 'official' | 'reviewed';
	releaseNotes?: string;
}): Promise<ReleaseMetadata> {
	if (options.publisherTrust && options.publisherTrust !== 'official' && options.publisherTrust !== 'reviewed') {
		throw new Error('Publisher trust must be official or reviewed.');
	}
	const vsixPath = path.resolve(options.vsixPath);
	const bytes = fs.readFileSync(vsixPath);
	const inspection = await inspectVsixArchive(vsixPath);
	const manifest = inspection.manifest;
	const extensionId = manifestId(manifest);
	if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)) {
		throw new Error(`VSIX id '${extensionId}' is not a valid BaseHalf plugin identity.`);
	}
	assertSemver(manifest.version, 'extension version');
	if (options.expectedExtensionId && extensionId !== options.expectedExtensionId.toLowerCase()) {
		throw new Error(`VSIX id must be ${options.expectedExtensionId}; got ${extensionId}.`);
	}
	if (options.expectedVersion && manifest.version !== options.expectedVersion) {
		throw new Error(`VSIX version must be ${options.expectedVersion}; got ${manifest.version}.`);
	}
	validateReviewedVsixManifest(manifest, inspection.files, extensionId);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const publisherSlug = options.publisherSlug ?? String(manifest.publisher ?? '').toLowerCase();
	if (publisherSlug !== String(manifest.publisher ?? '').toLowerCase()) {
		throw new Error(`Publisher '${publisherSlug}' does not own VSIX id '${extensionId}'.`);
	}
	const primaryCommand = options.primaryCommand ?? manifest.basehalf?.primaryCommand;
	const primaryCommandLabel = options.primaryCommandLabel ?? manifest.basehalf?.primaryCommandLabel;
	if (typeof primaryCommand !== 'string' || !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
		throw new Error(`VSIX primary command must be owned by '${extensionId}'.`);
	}
	if (!Array.isArray(manifest.contributes?.commands) || !manifest.contributes.commands.some((candidate: any) => candidate?.command === primaryCommand)) {
		throw new Error(`VSIX primary command '${primaryCommand}' is not declared in contributes.commands.`);
	}
	if (typeof primaryCommandLabel !== 'string' || !primaryCommandLabel.trim()) {
		throw new Error('VSIX primary command label is missing.');
	}
	return {
		extensionId,
		version: manifest.version,
		assetPath: `${extensionId}/${manifest.version}/${sha256}.vsix`,
		sha256,
		size: bytes.byteLength,
		vsixPath,
		label: options.label ?? manifest.displayName ?? manifest.name,
		description: options.description ?? manifest.description ?? '',
		category: options.category ?? 'Community',
		primaryCommand,
		primaryCommandLabel: primaryCommandLabel.trim(),
		publisher: {
			slug: publisherSlug,
			displayName: options.publisherDisplayName ?? publisherSlug,
			trust: options.publisherTrust ?? 'reviewed'
		},
		releaseNotes: options.releaseNotes
	};
}

export function createCatalog(options: {
	metadata: ReleaseMetadata;
	sequence: number;
	outputPath: string;
	previousPath?: string;
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
	status: 'active' | 'withdrawn';
	generatedAt?: string;
}): Record<string, unknown> {
	if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
		throw new Error('Catalog sequence must be a positive safe integer.');
	}
	const previous = options.previousPath && fs.existsSync(options.previousPath) ? readJson(options.previousPath) : undefined;
	if (previous) {
		validateCatalogRoot(previous);
		if (options.sequence <= previous.sequence) {
			throw new Error(`Catalog sequence ${options.sequence} must be greater than previous sequence ${previous.sequence}.`);
		}
	}
	const previousPlugin = previous?.plugins.find((plugin: any) => plugin.extensionId === options.metadata.extensionId);
	const versions = Array.isArray(previousPlugin?.versions) ? [...previousPlugin.versions] : [];
	const existing = versions.find((candidate: any) => candidate.version === options.metadata.version);
	if (existing && (existing.sha256 !== options.metadata.sha256 || existing.assetPath !== options.metadata.assetPath || existing.size !== options.metadata.size)) {
		throw new Error(`Refusing to replace immutable ${options.metadata.extensionId}@${options.metadata.version} with different bytes.`);
	}
	const release = {
		version: options.metadata.version,
		basehalfRange: options.basehalfRange,
		vscodeRange: options.vscodeRange,
		targetPlatform: options.targetPlatform,
		assetPath: options.metadata.assetPath,
		sha256: options.metadata.sha256,
		size: options.metadata.size,
		publishedAt: options.generatedAt ?? new Date().toISOString(),
		status: options.status,
		...(options.metadata.releaseNotes ? { releaseNotes: options.metadata.releaseNotes } : {})
	};
	const nextVersions = [release, ...versions.filter((candidate: any) => candidate.version !== release.version)]
		.sort((a: any, b: any) => compareSemverDescending(a.version, b.version));
	const otherPlugins = (previous?.plugins ?? []).filter((plugin: any) => plugin.extensionId !== options.metadata.extensionId);
	const catalog = {
		schemaVersion: 1,
		sequence: options.sequence,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		plugins: [{
			extensionId: options.metadata.extensionId,
			label: options.metadata.label ?? previousPlugin?.label ?? options.metadata.extensionId,
			description: options.metadata.description ?? previousPlugin?.description ?? '',
			category: options.metadata.category ?? previousPlugin?.category ?? 'Community',
			...(options.metadata.primaryCommand || previousPlugin?.primaryCommand ? { primaryCommand: options.metadata.primaryCommand ?? previousPlugin.primaryCommand } : {}),
			...(options.metadata.primaryCommandLabel || previousPlugin?.primaryCommandLabel ? { primaryCommandLabel: options.metadata.primaryCommandLabel ?? previousPlugin.primaryCommandLabel } : {}),
			...(options.metadata.publisher || previousPlugin?.publisher ? { publisher: options.metadata.publisher ?? previousPlugin.publisher } : {}),
			versions: nextVersions
		}, ...otherPlugins]
	};
	writeJsonExact(options.outputPath, catalog);
	return catalog;
}

export function createSignatureFile(options: { keyId: string; signatureBase64: string; outputPath: string }): void {
	if (!options.keyId.trim() || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(options.signatureBase64)) {
		throw new Error('A key id and padded Base64 KMS signature are required.');
	}
	writeJsonExact(options.outputPath, {
		keyId: options.keyId,
		algorithm: 'ECDSA_P256_SHA256_DER',
		signature: options.signatureBase64
	});
}

export function createCatalogIndex(options: { sequence: number; outputPath: string }): Record<string, unknown> {
	if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
		throw new Error('Catalog index sequence must be a positive safe integer.');
	}
	const index = {
		schemaVersion: 1,
		sequence: options.sequence,
		catalogPath: `catalogs/${options.sequence}/catalog.json`,
		signaturePath: `catalogs/${options.sequence}/catalog.sig.json`
	};
	writeJsonExact(options.outputPath, index);
	return index;
}

export function updateCatalogStatus(options: {
	previousPath: string;
	outputPath: string;
	sequence: number;
	extensionId: string;
	version: string;
	mode: 'withdraw' | 'rollback';
	generatedAt?: string;
}): Record<string, unknown> {
	const previous = readJson(options.previousPath);
	validateCatalogRoot(previous);
	if (!Number.isSafeInteger(options.sequence) || options.sequence <= previous.sequence) {
		throw new Error(`Catalog sequence ${options.sequence} must be greater than previous sequence ${previous.sequence}.`);
	}
	const plugin = previous.plugins.find((candidate: any) => candidate.extensionId === options.extensionId);
	if (!plugin || !Array.isArray(plugin.versions) || !plugin.versions.some((candidate: any) => candidate.version === options.version)) {
		throw new Error(`Previous catalog does not contain ${options.extensionId}@${options.version}.`);
	}
	const versions = plugin.versions.map((candidate: any) => {
		if (options.mode === 'withdraw') {
			return candidate.version === options.version ? { ...candidate, status: 'withdrawn' } : candidate;
		}
		const comparison = compareSemver(candidate.version, options.version);
		return comparison > 0 ? { ...candidate, status: 'withdrawn' }
			: candidate.version === options.version ? { ...candidate, status: 'active' }
				: candidate;
	});
	const catalog = {
		...previous,
		sequence: options.sequence,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		plugins: previous.plugins.map((candidate: any) => candidate.extensionId === options.extensionId ? { ...candidate, versions } : candidate)
	};
	writeJsonExact(options.outputPath, catalog);
	return catalog;
}

export function updateExtensionControl(options: {
	previousPath?: string;
	outputPath: string;
	extensionId: string;
	blocked: boolean;
	learnMoreLink?: string;
}): Record<string, unknown> {
	const previous = options.previousPath && fs.existsSync(options.previousPath) ? readJson(options.previousPath) : {};
	const previousMalicious = Array.isArray(previous.malicious) ? previous.malicious.filter((value: unknown) => typeof value === 'string') : [];
	const malicious = options.blocked
		? [...new Set([...previousMalicious, options.extensionId])].sort()
		: previousMalicious.filter((extensionId: string) => extensionId !== options.extensionId);
	const previousLinks = previous.learnMoreLinks && typeof previous.learnMoreLinks === 'object' && !Array.isArray(previous.learnMoreLinks) ? previous.learnMoreLinks : {};
	const learnMoreLinks = { ...previousLinks };
	if (options.blocked && options.learnMoreLink) {
		learnMoreLinks[options.extensionId] = options.learnMoreLink;
	} else if (!options.blocked) {
		delete learnMoreLinks[options.extensionId];
	}
	const control = {
		malicious,
		...(Object.keys(learnMoreLinks).length ? { learnMoreLinks } : {}),
		deprecated: previous.deprecated ?? {},
		search: previous.search ?? [],
		autoUpdate: previous.autoUpdate ?? {}
	};
	writeJsonExact(options.outputPath, control);
	return control;
}

export async function verifyRelease(options: {
	catalogUrl: string;
	signatureUrl: string;
	assetBaseUrl: string;
	publicKeyPath: string;
	keyId: string;
	extensionId: string;
	version: string;
	expectedStatus?: 'active' | 'withdrawn';
	minimumSequence?: number;
	timeoutMs?: number;
}): Promise<ReleaseMetadata> {
	const [catalogBytes, signatureBytes] = await Promise.all([
		fetchBytes(options.catalogUrl, options.timeoutMs),
		fetchBytes(options.signatureUrl, options.timeoutMs)
	]);
	const signature = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(signatureBytes));
	if (signature.keyId !== options.keyId || signature.algorithm !== 'ECDSA_P256_SHA256_DER') {
		throw new Error('Catalog signature metadata does not match the configured key.');
	}
	const publicKey = fs.readFileSync(options.publicKeyPath, 'utf8');
	if (!verifySignature('sha256', catalogBytes, publicKey, Buffer.from(signature.signature, 'base64'))) {
		throw new Error('Catalog signature verification failed.');
	}
	const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(catalogBytes));
	validateCatalogRoot(catalog);
	if (options.minimumSequence !== undefined && catalog.sequence < options.minimumSequence) {
		throw new Error(`Catalog sequence ${catalog.sequence} is below required sequence ${options.minimumSequence}.`);
	}
	const plugin = catalog.plugins.find((candidate: any) => candidate.extensionId === options.extensionId);
	const release = plugin?.versions?.find((candidate: any) => candidate.version === options.version);
	if (!release) {
		throw new Error(`Catalog does not contain ${options.extensionId}@${options.version}.`);
	}
	if (options.expectedStatus && release.status !== options.expectedStatus) {
		throw new Error(`Catalog status for ${options.extensionId}@${options.version} is '${release.status}', expected '${options.expectedStatus}'.`);
	}
	validateAssetPath(release.assetPath);
	const expectedAssetPath = `${options.extensionId}/${options.version}/${release.sha256}.vsix`;
	if (release.assetPath !== expectedAssetPath) {
		throw new Error(`Catalog asset path mismatch: expected ${expectedAssetPath}.`);
	}
	if (!/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.size) || release.size < 1) {
		throw new Error('Catalog release digest or size is invalid.');
	}
	const assetUrl = resolveAssetUrl(options.assetBaseUrl, release.assetPath);
	const vsix = await fetchBytes(assetUrl.href, options.timeoutMs);
	const sha256 = createHash('sha256').update(vsix).digest('hex');
	if (vsix.byteLength !== release.size || sha256 !== release.sha256) {
		throw new Error('VSIX size or SHA-256 verification failed.');
	}
	const temporaryPath = path.join(path.dirname(options.publicKeyPath), `.basehalf-verify-${process.pid}-${Date.now()}.vsix`);
	try {
		fs.writeFileSync(temporaryPath, vsix);
		const manifest = await readVsixManifest(temporaryPath);
		if (manifestId(manifest) !== options.extensionId || manifest.version !== options.version) {
			throw new Error(`VSIX manifest mismatch: received ${manifestId(manifest)}@${manifest.version}.`);
		}
	} finally {
		fs.rmSync(temporaryPath, { force: true });
	}
	return { extensionId: options.extensionId, version: options.version, assetPath: release.assetPath, sha256, size: vsix.byteLength, vsixPath: assetUrl.href };
}

export async function readVsixManifest(vsixPath: string): Promise<any> {
	return (await inspectVsixArchive(vsixPath)).manifest;
}

async function inspectVsixArchive(vsixPath: string): Promise<{ manifest: any; files: ReadonlySet<string> }> {
	return new Promise((resolve, reject) => {
		yauzl.open(vsixPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
			if (openError || !zip) {
				reject(openError ?? new Error('Could not open VSIX.'));
				return;
			}
			let settled = false;
			let totalUncompressed = 0;
			let manifest: any;
			const files = new Set<string>();
			const canonicalFiles = new Set<string>();
			const fail = (error: unknown) => {
				if (!settled) {
					settled = true;
					zip.close();
					reject(error);
				}
			};
			zip.on('error', fail);
			zip.on('end', () => {
				if (!manifest) {
					fail(new Error('VSIX does not contain extension/package.json.'));
					return;
				}
				if (!settled) {
					settled = true;
					resolve({ manifest, files });
				}
			});
			zip.on('entry', entry => {
				if (!safeVsixEntryName(entry.fileName) || isVsixSymbolicLink(entry)) {
					fail(new Error(`VSIX contains unsafe entry '${entry.fileName}'.`));
					return;
				}
				const canonicalName = entry.fileName.toLowerCase();
				if (canonicalFiles.has(canonicalName)) {
					fail(new Error(`VSIX contains duplicate archive path '${entry.fileName}'.`));
					return;
				}
				canonicalFiles.add(canonicalName);
				files.add(entry.fileName);
				totalUncompressed += entry.uncompressedSize;
				if (totalUncompressed > MAX_VSIX_UNCOMPRESSED_BYTES) {
					fail(new Error('VSIX expands beyond the allowed size.'));
					return;
				}
				if (canonicalName !== 'extension/package.json') {
					zip.readEntry();
					return;
				}
				readVsixEntry(zip, entry, MAX_MANIFEST_BYTES).then(bytes => {
					try {
						manifest = JSON.parse(bytes.toString('utf8'));
						zip.readEntry();
					} catch (error) {
						fail(error);
					}
				}, fail);
			});
			zip.readEntry();
		});
	});
}

export function validateReviewedVsixManifest(manifest: any, files: ReadonlySet<string>, extensionId: string): void {
	if (manifest.enabledApiProposals !== undefined && (!Array.isArray(manifest.enabledApiProposals) || manifest.enabledApiProposals.length > 0)) {
		throw new Error('Reviewed plugins cannot depend on proposed APIs.');
	}
	const contributes = manifest.contributes;
	if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
		throw new Error('Reviewed plugin manifest must declare contributions.');
	}
	const forbidden = FORBIDDEN_CONTRIBUTION_POINTS.filter(point => Object.prototype.hasOwnProperty.call(contributes, point));
	if (forbidden.length > 0) {
		throw new Error(`Reviewed plugin changes the fixed application shell: ${forbidden.join(', ')}.`);
	}
	if (!validRange(manifest.engines?.vscode) || !validRange(manifest.engines?.basehalf)) {
		throw new Error('Reviewed plugin compatibility ranges are invalid.');
	}
	const main = requiredManifestText(manifest.main, 'main');
	const mainPath = packageRelativePath(main, 'main');
	if (!hasVsixFile(files, `extension/${mainPath}`)) {
		throw new Error(`Reviewed plugin entry point '${main}' is missing from the VSIX.`);
	}
	const projections = contributes.basehalfCardProjections;
	if (!Array.isArray(projections) || projections.length === 0) {
		throw new Error('Reviewed plugin must contribute at least one BaseHalf card projection.');
	}
	const projectionIds = new Set<string>();
	for (const candidate of projections) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new Error('Reviewed plugin card projection declaration is invalid.');
		}
		const projection = candidate as { id?: unknown; label?: unknown; extensions?: unknown };
		const id = requiredManifestText(projection.id, 'basehalfCardProjections[].id').toLowerCase();
		requiredManifestText(projection.label, 'basehalfCardProjections[].label');
		if (!id.startsWith(`${extensionId}.`) || projectionIds.has(id)) {
			throw new Error(`Reviewed plugin card projection '${id}' is not uniquely owned by '${extensionId}'.`);
		}
		projectionIds.add(id);
		if (!Array.isArray(projection.extensions) || projection.extensions.length === 0 || projection.extensions.some((extension: unknown) => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))) {
			throw new Error(`Reviewed plugin card projection '${id}' has invalid file extensions.`);
		}
	}
	if (!hasVsixFile(files, 'extension/readme.md')) {
		throw new Error('Reviewed plugin VSIX is missing README.md.');
	}
	const hasLicense = [...files].some(file => /^extension\/(license|license\.md|license\.txt)$/i.test(file));
	if (!hasLicense && (typeof manifest.license !== 'string' || !manifest.license.trim())) {
		throw new Error('Reviewed plugin VSIX is missing license information.');
	}
}

function readVsixEntry(zip: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zip.openReadStream(entry, (error, stream) => {
			if (error || !stream) {
				reject(error ?? new Error('Could not read VSIX entry.'));
				return;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			stream.on('data', chunk => {
				size += chunk.length;
				if (size > maximumBytes) {
					stream.destroy(new Error('VSIX manifest is too large.'));
					return;
				}
				chunks.push(Buffer.from(chunk));
			});
			stream.on('error', reject);
			stream.on('end', () => resolve(Buffer.concat(chunks)));
		});
	});
}

function safeVsixEntryName(name: string): boolean {
	return !!name && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/')
		&& name.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}

function isVsixSymbolicLink(entry: Entry): boolean {
	return ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000;
}

function hasVsixFile(files: ReadonlySet<string>, wanted: string): boolean {
	const lower = wanted.toLowerCase();
	return [...files].some(file => file.toLowerCase() === lower);
}

function packageRelativePath(value: string, field: string): string {
	const normalized = value.startsWith('./') ? value.slice(2) : value;
	if (!normalized || normalized.startsWith('/') || normalized.startsWith('\\') || normalized.includes('\\') || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
		throw new Error(`Reviewed plugin manifest ${field} path is invalid.`);
	}
	return normalized;
}

function requiredManifestText(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Reviewed plugin manifest is missing ${field}.`);
	}
	return value.trim();
}

async function fetchBytes(url: string, timeoutMs = 10_000): Promise<Uint8Array> {
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
		throw new Error('Plugin release endpoints must use HTTPS, except loopback fixtures.');
	}
	const response = await fetch(parsed, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) {
		throw new Error(`Plugin release endpoint returned ${response.status}.`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

function resolveAssetUrl(baseUrl: string, assetPath: string): URL {
	validateAssetPath(assetPath);
	const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
	if (base.protocol !== 'https:' && !(base.protocol === 'http:' && isLoopback(base.hostname))) {
		throw new Error('Plugin asset base URL must use HTTPS, except loopback fixtures.');
	}
	const result = new URL(assetPath, base);
	if (result.origin !== base.origin) {
		throw new Error('Plugin asset resolved outside the configured origin.');
	}
	return result;
}

function validateCatalogRoot(catalog: any): void {
	if (!catalog || catalog.schemaVersion !== 1 || !Number.isSafeInteger(catalog.sequence) || !Array.isArray(catalog.plugins)) {
		throw new Error('Invalid BaseHalf plugin catalog v1.');
	}
}

function validateAssetPath(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\') || value.includes('?') || value.includes('#')) {
		throw new Error('Invalid relative plugin asset path.');
	}
	if (value.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
		throw new Error('Invalid plugin asset path segment.');
	}
}

function manifestId(manifest: any): string {
	return `${manifest.publisher}.${manifest.name}`.toLowerCase();
}

function assertSemver(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !valid(value)) {
		throw new Error(`${label} must be semantic version text.`);
	}
}

function compareSemverDescending(a: string, b: string): number {
	return -compareSemver(a, b);
}

function compareSemver(a: string, b: string): number {
	assertSemver(a, 'catalog version');
	assertSemver(b, 'catalog version');
	return compare(a, b);
}

function readJson(file: string): any {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonExact(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function parseArgs(args: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith('--') || value === undefined) {
			throw new Error(`Expected --name value arguments; got '${key ?? ''}'.`);
		}
		result[key.slice(2)] = value;
	}
	return result;
}

async function main(): Promise<void> {
	const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
	const command = process.argv[2];
	const args = parseArgs(process.argv.slice(3));
	if (command === 'package') {
		const metadata = await packagePlugin({ root, outputDirectory: path.resolve(args.output ?? path.join(root, '.build', 'basehalf-plugins')) });
		console.log(JSON.stringify(metadata));
		return;
	}
	if (command === 'metadata') {
		const job = args['release-job'] ? readJson(path.resolve(args['release-job'])) : undefined;
		const metadata = await metadataFromVsix({
			vsixPath: required(args, 'vsix'),
			expectedExtensionId: job?.extension_id ?? args['extension-id'],
			expectedVersion: job?.version ?? args.version,
			label: job?.label ?? args.label,
			description: job?.description ?? args.description,
			category: job?.category ?? args.category,
			primaryCommand: job?.primary_command ?? args['primary-command'],
			primaryCommandLabel: job?.primary_command_label ?? args['primary-command-label'],
			publisherSlug: job?.publisher?.slug ?? args['publisher-slug'],
			publisherDisplayName: job?.publisher?.display_name ?? args['publisher-display-name'],
			publisherTrust: (job?.publisher?.trust ?? args['publisher-trust']) as 'official' | 'reviewed' | undefined,
			releaseNotes: job?.release_notes ?? args['release-notes']
		});
		writeJsonExact(path.resolve(required(args, 'output')), metadata);
		console.log(JSON.stringify(metadata));
		return;
	}
	if (command === 'catalog') {
		const metadata = readJson(path.resolve(required(args, 'metadata')));
		const catalog = createCatalog({
			metadata,
			sequence: Number(required(args, 'sequence')),
			outputPath: path.resolve(required(args, 'output')),
			previousPath: args.previous ? path.resolve(args.previous) : undefined,
			basehalfRange: required(args, 'basehalf-range'),
			vscodeRange: required(args, 'vscode-range'),
			targetPlatform: args['target-platform'] ?? 'universal',
			status: (args.status ?? 'active') as 'active' | 'withdrawn'
		});
		console.log(JSON.stringify({ sequence: catalog.sequence, output: path.resolve(required(args, 'output')) }));
		return;
	}
	if (command === 'signature') {
		createSignatureFile({ keyId: required(args, 'key-id'), signatureBase64: required(args, 'signature'), outputPath: path.resolve(required(args, 'output')) });
		return;
	}
	if (command === 'index') {
		const index = createCatalogIndex({ sequence: Number(required(args, 'sequence')), outputPath: path.resolve(required(args, 'output')) });
		console.log(JSON.stringify(index));
		return;
	}
	if (command === 'status') {
		const catalog = updateCatalogStatus({
			previousPath: path.resolve(required(args, 'previous')),
			outputPath: path.resolve(required(args, 'output')),
			sequence: Number(required(args, 'sequence')),
			extensionId: args['extension-id'] ?? OFFICIAL_EXTENSION_ID,
			version: required(args, 'version'),
			mode: required(args, 'mode') as 'withdraw' | 'rollback'
		});
		console.log(JSON.stringify({ sequence: catalog.sequence, output: path.resolve(required(args, 'output')) }));
		return;
	}
	if (command === 'control') {
		const mode = required(args, 'mode');
		if (mode !== 'block' && mode !== 'restore') {
			throw new Error('Control mode must be block or restore.');
		}
		const control = updateExtensionControl({
			previousPath: args.previous ? path.resolve(args.previous) : undefined,
			outputPath: path.resolve(required(args, 'output')),
			extensionId: args['extension-id'] ?? OFFICIAL_EXTENSION_ID,
			blocked: mode === 'block',
			learnMoreLink: args['learn-more-link']
		});
		console.log(JSON.stringify({ malicious: control.malicious, output: path.resolve(required(args, 'output')) }));
		return;
	}
	if (command === 'verify') {
		const result = await verifyRelease({
			catalogUrl: required(args, 'catalog-url'),
			signatureUrl: required(args, 'signature-url'),
			assetBaseUrl: required(args, 'asset-base-url'),
			publicKeyPath: path.resolve(required(args, 'public-key')),
			keyId: required(args, 'key-id'),
			extensionId: args['extension-id'] ?? OFFICIAL_EXTENSION_ID,
			version: required(args, 'version'),
			expectedStatus: args['expected-status'] as 'active' | 'withdrawn' | undefined,
			minimumSequence: args['minimum-sequence'] ? Number(args['minimum-sequence']) : undefined
		});
		console.log(JSON.stringify(result));
		return;
	}
	throw new Error('Usage: basehalf-plugin-release.mts package|metadata|catalog|status|control|signature|index|verify [--name value ...]');
}

function required(args: Record<string, string>, name: string): string {
	const value = args[name];
	if (!value) {
		throw new Error(`Missing --${name}.`);
	}
	return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
