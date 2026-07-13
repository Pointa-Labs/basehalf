/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash, verify as verifySignature } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import yauzl from 'yauzl';
import { createVSIX } from '@vscode/vsce';
import { compare, valid } from 'semver';

export const OFFICIAL_EXTENSION_ID = 'pointa.basehalf-ai-video';

export interface ReleaseMetadata {
	extensionId: string;
	version: string;
	assetPath: string;
	sha256: string;
	size: number;
	vsixPath: string;
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
		vsixPath
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
		status: options.status
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
			label: 'AI Video',
			description: 'Scripts, characters, scenes, shots, and provider-neutral local generation workflows.',
			category: 'Domain',
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
	return new Promise((resolve, reject) => {
		yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
			if (openError || !zip) {
				reject(openError ?? new Error('Could not open VSIX.'));
				return;
			}
			let settled = false;
			const fail = (error: unknown) => {
				if (!settled) {
					settled = true;
					zip.close();
					reject(error);
				}
			};
			zip.on('error', fail);
			zip.on('end', () => fail(new Error('VSIX does not contain extension/package.json.')));
			zip.on('entry', entry => {
				if (entry.fileName !== 'extension/package.json') {
					zip.readEntry();
					return;
				}
				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError || !stream) {
						fail(streamError ?? new Error('Could not read VSIX manifest.'));
						return;
					}
					const chunks: Buffer[] = [];
					stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
					stream.on('error', fail);
					stream.on('end', () => {
						if (settled) {
							return;
						}
						settled = true;
						zip.close();
						try {
							resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
						} catch (error) {
							reject(error);
						}
					});
				});
			});
			zip.readEntry();
		});
	});
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
			minimumSequence: args['minimum-sequence'] ? Number(args['minimum-sequence']) : undefined
		});
		console.log(JSON.stringify(result));
		return;
	}
	throw new Error('Usage: basehalf-plugin-release.mts package|catalog|status|control|signature|index|verify [--name value ...]');
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
