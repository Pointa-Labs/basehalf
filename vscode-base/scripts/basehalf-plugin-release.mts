/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash, verify as verifySignature } from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import { isDeepStrictEqual } from 'util';
import { crc32 } from 'zlib';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import yazl from 'yazl';
import { createVSIX } from '@vscode/vsce';
import { compare, valid, validRange } from 'semver';
import { BASEHALF_OFFICIAL_PLUGIN_IDENTITIES, BASEHALF_RESERVED_OFFICIAL_PLUGIN_PUBLISHERS } from '../src/vs/workbench/basehalf/common/basehalfPluginIdentities.ts';
import { baseHalfCanonicalInstalledFileBytes } from '../src/vs/workbench/basehalf/common/basehalfPluginInstalledContent.ts';

export const OFFICIAL_EXTENSION_ID = BASEHALF_OFFICIAL_PLUGIN_IDENTITIES[0].extensionId;
const OFFICIAL_PRIMARY_COMMAND = 'pointa.basehalf-ai-video.createWorkflow';
const OFFICIAL_PRIMARY_COMMAND_LABEL = 'Create Video Workflow…';
const OFFICIAL_PUBLISHER = Object.freeze({ slug: BASEHALF_OFFICIAL_PLUGIN_IDENTITIES[0].publisher, displayName: 'BaseHalf', trust: 'official' as const });
const ALLOWED_CONTRIBUTION_POINTS = new Set([
	'commands',
	'configuration',
	'jsonValidation',
	'basehalfAgentCapabilities',
	'basehalfCardProjections',
	'basehalfCanvasRecipes',
	'basehalfCanvasTemplates',
	'basehalfStructuralCleanups'
]);
const CANVAS_CONTENT_KINDS = ['text', 'code', 'file', 'folder', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;
const OUTPUT_CONTENT_KINDS = ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;
const MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
const MAX_VSIX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_VSIX_BYTES = 100 * 1024 * 1024;
const MAX_VSIX_ENTRIES = 4_096;
const MAX_VSIX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_TEMPLATE_RESOURCES = 64;
const MAX_TEMPLATE_ENTRIES = 100;
const MAX_TEMPLATE_TEXT_FILE_BYTES = 256 * 1024;
const MAX_TEMPLATE_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_PARAMETER_VALUES = 128;
const MAX_TEMPLATE_PARAMETER_DEPTH = 12;
export const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;
const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;
const MAX_RELEASE_JOB_BYTES = 1024 * 1024;
const MAX_BOOTSTRAP_INVENTORY_BYTES = 5 * 1024 * 1024;
const MAX_EXTENSION_CONTROL_IDS = 10_000;
const DETERMINISTIC_VSIX_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);
// Catalog publication fails at this safety bound. It must never silently
// discard a signed version because installed receipts rely on that grant.
export const CATALOG_VERSION_LIMIT = 4_096;
const TARGET_PLATFORMS = new Set([
	'universal',
	'win32-x64',
	'win32-arm64',
	'linux-x64',
	'linux-arm64',
	'linux-armhf',
	'alpine-x64',
	'alpine-arm64',
	'darwin-x64',
	'darwin-arm64',
	'web'
]);

export interface ReleaseMetadata {
	extensionId: string;
	version: string;
	assetPath: string;
	sha256: string;
	installedContentSha256: string;
	size: number;
	vsixPath: string;
	label: string;
	description: string;
	category: string;
	primaryCommand: string;
	primaryCommandLabel: string;
	basehalfRange: string;
	vscodeRange: string;
	publisher: {
		slug: string;
		displayName: string;
		trust: 'official' | 'reviewed';
	};
	releaseNotes?: string;
}

export interface ReleaseIdentity {
	schemaVersion: 1;
	extensionId: string;
	version: string;
	sha256: string;
	size: number;
	assetPath: string;
}

export interface ReviewedReleaseJob {
	job_id: string;
	submission_id: string;
	lease_expires_at: string;
	download_url: string;
	extension_id: string;
	publisher: {
		slug: string;
		display_name: string;
		trust: 'reviewed';
	};
	version: string;
	sha256: string;
	byte_size: number;
	label: string;
	description: string;
	category: string;
	primary_command: string;
	primary_command_label: string;
	basehalf_range: string;
	vscode_range: string;
	target_platform: string;
	release_notes: string;
}

export type VerifiedReleaseArtifact = Pick<
	ReleaseMetadata,
	'extensionId' | 'version' | 'assetPath' | 'sha256' | 'installedContentSha256' | 'size' | 'vsixPath'
>;

const OFFICIAL_EXTENSION_IDS = new Set<string>(BASEHALF_OFFICIAL_PLUGIN_IDENTITIES.map(identity => identity.extensionId));
const RESERVED_OFFICIAL_PUBLISHERS = new Set<string>(BASEHALF_RESERVED_OFFICIAL_PLUGIN_PUBLISHERS);

export function assertReviewedIdentityIsNotReserved(extensionId: string): void {
	const publisher = extensionId.split('.')[0];
	if (OFFICIAL_EXTENSION_IDS.has(extensionId)) {
		throw new Error(`Reviewed plugin identity '${extensionId}' is reserved for an official plugin.`);
	}
	if (RESERVED_OFFICIAL_PUBLISHERS.has(publisher)) {
		throw new Error(`Reviewed Publisher namespace '${publisher}' is reserved for official plugins.`);
	}
}

export function validateReviewedReleaseJob(value: unknown, options: {
	submissionBucket: string;
	awsRegion: string;
	now?: Date;
}): ReviewedReleaseJob {
	const job = manifestRecord(value, 'reviewed release job');
	assertOnlyManifestKeys(job, [
		'job_id', 'submission_id', 'lease_expires_at', 'download_url', 'extension_id', 'publisher',
		'version', 'sha256', 'byte_size', 'label', 'description', 'category', 'primary_command',
		'primary_command_label', 'basehalf_range', 'vscode_range', 'target_platform', 'release_notes'
	], 'reviewed release job');
	const jobId = releaseJobId(job.job_id, 'job_id');
	const submissionId = releaseJobId(job.submission_id, 'submission_id');
	const leaseExpiresAt = canonicalIsoDate(job.lease_expires_at, 'reviewed release job lease_expires_at');
	if (new Date(leaseExpiresAt).getTime() <= (options.now ?? new Date()).getTime()) {
		throw new Error('Reviewed release job lease is expired.');
	}
	const extensionId = releaseJobText(job.extension_id, 'extension_id', 150);
	if (extensionId !== extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)) {
		throw new Error('Reviewed release job extension id is invalid.');
	}
	assertReviewedIdentityIsNotReserved(extensionId);
	const publisherValue = manifestRecord(job.publisher, 'reviewed release job publisher');
	assertOnlyManifestKeys(publisherValue, ['slug', 'display_name', 'trust'], 'reviewed release job publisher');
	const publisherSlug = releaseJobText(publisherValue.slug, 'publisher.slug', 50);
	const publisherDisplayName = releaseJobText(publisherValue.display_name, 'publisher.display_name', 100);
	if (publisherValue.trust !== 'reviewed' || publisherSlug !== extensionId.split('.')[0]) {
		throw new Error('Reviewed release job publisher is invalid.');
	}
	const version = releaseJobText(job.version, 'version', 100);
	assertSemver(version, 'reviewed release job version');
	const sha256 = releaseJobText(job.sha256, 'sha256', 64);
	if (!/^[a-f0-9]{64}$/.test(sha256)) {
		throw new Error('Reviewed release job SHA-256 is invalid.');
	}
	const byteSize = releaseJobByteSize(job.byte_size);
	const label = releaseJobText(job.label, 'label', 150);
	const description = releaseJobText(job.description, 'description', 4_000, true);
	const category = releaseJobText(job.category, 'category', 50);
	const primaryCommand = releaseJobText(job.primary_command, 'primary_command', 200);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(primaryCommand) || !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
		throw new Error('Reviewed release job primary command is invalid.');
	}
	const primaryCommandLabel = releaseJobText(job.primary_command_label, 'primary_command_label', 100);
	const basehalfRange = releaseJobText(job.basehalf_range, 'basehalf_range', 200);
	const vscodeRange = releaseJobText(job.vscode_range, 'vscode_range', 200);
	if (!validRange(basehalfRange) || !validRange(vscodeRange)) {
		throw new Error('Reviewed release job compatibility ranges are invalid.');
	}
	const targetPlatform = releaseJobText(job.target_platform, 'target_platform', 50);
	if (!TARGET_PLATFORMS.has(targetPlatform)) {
		throw new Error('Reviewed release job target platform is invalid.');
	}
	if (typeof job.release_notes !== 'string' || job.release_notes.includes('\0') || Buffer.byteLength(job.release_notes, 'utf8') > 100_000) {
		throw new Error('Reviewed release job release notes are invalid.');
	}
	const downloadUrl = validateSubmissionDownloadUrl(job.download_url, {
		submissionBucket: options.submissionBucket,
		awsRegion: options.awsRegion,
		submissionId,
		sha256
	});
	return {
		job_id: jobId,
		submission_id: submissionId,
		lease_expires_at: leaseExpiresAt,
		download_url: downloadUrl,
		extension_id: extensionId,
		publisher: { slug: publisherSlug, display_name: publisherDisplayName, trust: 'reviewed' },
		version,
		sha256,
		byte_size: byteSize,
		label,
		description,
		category,
		primary_command: primaryCommand,
		primary_command_label: primaryCommandLabel,
		basehalf_range: basehalfRange,
		vscode_range: vscodeRange,
		target_platform: targetPlatform,
		release_notes: job.release_notes
	};
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
	const rawVsixPath = path.join(options.outputDirectory, `.${extensionId}-${manifest.version}-${process.pid}-${Date.now()}.raw.vsix`);
	try {
		await createVSIX({ cwd: extensionRoot, packagePath: rawVsixPath, dependencies: false });
		fs.rmSync(vsixPath, { force: true });
		await normalizeVsixArchive(rawVsixPath, vsixPath);
	} finally {
		fs.rmSync(rawVsixPath, { force: true });
	}
	const bytes = readBoundedFile(vsixPath, MAX_VSIX_BYTES, 'Packaged VSIX');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const inspection = await inspectVsixArchive(vsixPath);
	const packagedManifest = inspection.manifest;
	if (manifestId(packagedManifest) !== extensionId || packagedManifest.version !== manifest.version) {
		throw new Error('The packaged VSIX manifest does not match its source manifest.');
	}
	for (const field of [
		'publisher', 'name', 'version', 'displayName', 'description', 'license', 'repository',
		'main', 'engines', 'basehalf', 'contributes', 'activationEvents', 'enabledApiProposals'
	] as const) {
		if (!isDeepStrictEqual(packagedManifest[field], manifest[field])) {
			throw new Error(`The packaged VSIX manifest field '${field}' does not match its source manifest.`);
		}
	}
	validateReviewedVsixManifest(packagedManifest, inspection.files, extensionId, inspection.templateResources);
	return await validateReleaseMetadata({
		extensionId,
		version: manifest.version,
		assetPath: `${extensionId}/${manifest.version}/${sha256}.vsix`,
		sha256,
		installedContentSha256: inspection.installedContentSha256,
		size: bytes.byteLength,
		vsixPath,
		label: manifest.displayName,
		description: manifest.description,
		category: 'Domain',
		publisher: { slug: manifest.publisher, displayName: 'BaseHalf', trust: 'official' },
		primaryCommand: manifest.basehalf?.primaryCommand,
		primaryCommandLabel: manifest.basehalf?.primaryCommandLabel,
		basehalfRange: manifest.engines?.basehalf,
		vscodeRange: manifest.engines?.vscode
	});
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
	const bytes = readBoundedFile(vsixPath, MAX_VSIX_BYTES, 'VSIX');
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
	validateReviewedVsixManifest(manifest, inspection.files, extensionId, inspection.templateResources);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const publisherSlug = options.publisherSlug ?? String(manifest.publisher ?? '').toLowerCase();
	if (publisherSlug !== String(manifest.publisher ?? '').toLowerCase()) {
		throw new Error(`Publisher '${publisherSlug}' does not own VSIX id '${extensionId}'.`);
	}
	if ((options.publisherTrust ?? 'reviewed') === 'reviewed') {
		assertReviewedIdentityIsNotReserved(extensionId);
	}
	const manifestPrimaryCommand = requiredManifestText(manifest.basehalf?.primaryCommand, 'basehalf.primaryCommand');
	const manifestPrimaryCommandLabel = requiredManifestText(manifest.basehalf?.primaryCommandLabel, 'basehalf.primaryCommandLabel');
	if (options.primaryCommand !== undefined && options.primaryCommand !== manifestPrimaryCommand) {
		throw new Error('Release metadata primary command does not match the VSIX manifest.');
	}
	if (options.primaryCommandLabel !== undefined && options.primaryCommandLabel.trim() !== manifestPrimaryCommandLabel) {
		throw new Error('Release metadata primary command label does not match the VSIX manifest.');
	}
	const primaryCommand = manifestPrimaryCommand;
	const primaryCommandLabel = manifestPrimaryCommandLabel;
	if (typeof primaryCommand !== 'string' || !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
		throw new Error(`VSIX primary command must be owned by '${extensionId}'.`);
	}
	if (!Array.isArray(manifest.contributes?.commands) || !manifest.contributes.commands.some((candidate: any) => candidate?.command === primaryCommand)) {
		throw new Error(`VSIX primary command '${primaryCommand}' is not declared in contributes.commands.`);
	}
	if (typeof primaryCommandLabel !== 'string' || !primaryCommandLabel.trim()) {
		throw new Error('VSIX primary command label is missing.');
	}
	return await validateReleaseMetadata({
		extensionId,
		version: manifest.version,
		assetPath: `${extensionId}/${manifest.version}/${sha256}.vsix`,
		sha256,
		installedContentSha256: inspection.installedContentSha256,
		size: bytes.byteLength,
		vsixPath,
		label: options.label ?? manifest.displayName ?? manifest.name,
		description: options.description ?? manifest.description ?? '',
		category: options.category ?? 'Community',
		primaryCommand,
		primaryCommandLabel: primaryCommandLabel.trim(),
		basehalfRange: manifest.engines.basehalf,
		vscodeRange: manifest.engines.vscode,
		publisher: {
			slug: publisherSlug,
			displayName: options.publisherDisplayName ?? publisherSlug,
			trust: options.publisherTrust ?? 'reviewed'
		},
		releaseNotes: options.releaseNotes
	});
}

async function validateReleaseMetadata(value: ReleaseMetadata): Promise<ReleaseMetadata> {
	const metadata = manifestRecord(value, 'release metadata') as unknown as ReleaseMetadata;
	assertOnlyManifestKeys(metadata as unknown as Record<string, unknown>, [
		'extensionId', 'version', 'assetPath', 'sha256', 'installedContentSha256', 'size', 'vsixPath', 'label', 'description', 'category',
		'primaryCommand', 'primaryCommandLabel', 'basehalfRange', 'vscodeRange', 'publisher', 'releaseNotes'
	], 'release metadata');
	if (typeof metadata.extensionId !== 'string' || metadata.extensionId !== metadata.extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(metadata.extensionId)) {
		throw new Error('Release metadata extension id is invalid.');
	}
	assertSemver(metadata.version, 'release metadata version');
	if (typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
		throw new Error('Release metadata SHA-256 is invalid.');
	}
	if (typeof metadata.installedContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.installedContentSha256)) {
		throw new Error('Release metadata installed-content SHA-256 is invalid.');
	}
	if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > MAX_VSIX_BYTES) {
		throw new Error('Release metadata byte size is invalid.');
	}
	const expectedAssetPath = `${metadata.extensionId}/${metadata.version}/${metadata.sha256}.vsix`;
	if (metadata.assetPath !== expectedAssetPath) {
		throw new Error(`Release metadata asset path must be '${expectedAssetPath}'.`);
	}
	validateAssetPath(metadata.assetPath);
	boundedManifestText(metadata.label, 'release metadata.label', 150);
	boundedManifestText(metadata.description, 'release metadata.description', 4_000);
	boundedManifestText(metadata.category, 'release metadata.category', 50);
	const primaryCommand = requiredManifestText(metadata.primaryCommand, 'release metadata.primaryCommand');
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(primaryCommand) || !primaryCommand.toLowerCase().startsWith(`${metadata.extensionId}.`)) {
		throw new Error('Release metadata primary command is invalid.');
	}
	boundedManifestText(metadata.primaryCommandLabel, 'release metadata.primaryCommandLabel', 100);
	if (!validRange(metadata.basehalfRange) || !validRange(metadata.vscodeRange)) {
		throw new Error('Release metadata compatibility ranges are invalid.');
	}
	const publisher = manifestRecord(metadata.publisher, 'release metadata.publisher');
	assertOnlyManifestKeys(publisher, ['slug', 'displayName', 'trust'], 'release metadata.publisher');
	if (publisher.slug !== metadata.extensionId.split('.')[0] || typeof publisher.displayName !== 'string' || !publisher.displayName.trim() || publisher.displayName.length > 100 || (publisher.trust !== 'official' && publisher.trust !== 'reviewed')) {
		throw new Error('Release metadata publisher is invalid.');
	}
	if (publisher.trust === 'reviewed') {
		assertReviewedIdentityIsNotReserved(metadata.extensionId);
	} else if (!OFFICIAL_EXTENSION_IDS.has(metadata.extensionId)) {
		throw new Error(`Official plugin identity '${metadata.extensionId}' is not product-owned.`);
	}
	if (metadata.releaseNotes !== undefined && (typeof metadata.releaseNotes !== 'string' || Buffer.byteLength(metadata.releaseNotes, 'utf8') > 100_000)) {
		throw new Error('Release metadata notes exceed the publishing limit.');
	}
	const vsixPath = requiredManifestText(metadata.vsixPath, 'release metadata.vsixPath');
	const bytes = readBoundedFile(vsixPath, MAX_VSIX_BYTES, 'Release metadata VSIX');
	if (bytes.byteLength !== metadata.size || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
		throw new Error('Release metadata does not match its VSIX bytes.');
	}
	const verificationPath = path.join(path.dirname(vsixPath), `.basehalf-metadata-verify-${process.pid}-${Date.now()}.vsix`);
	try {
		fs.writeFileSync(verificationPath, bytes, { flag: 'wx' });
		const inspection = await inspectVsixArchive(verificationPath);
		if (inspection.installedContentSha256 !== metadata.installedContentSha256) {
			throw new Error('Release metadata installed-content SHA-256 does not match its VSIX.');
		}
	} finally {
		fs.rmSync(verificationPath, { force: true });
	}
	return metadata;
}

export async function assertBootstrapRegistryInventory(options: {
	inventory: unknown;
	metadata: ReleaseMetadata;
	sequence: number;
}): Promise<readonly string[]> {
	const metadata = await validateReleaseMetadata(options.metadata);
	if (options.sequence !== 1) {
		throw new Error('Registry bootstrap is valid only for catalog sequence 1.');
	}
	const inventory = manifestRecord(options.inventory, 'bootstrap bucket inventory');
	if (inventory.IsTruncated !== undefined && inventory.IsTruncated !== false) {
		throw new Error('Bootstrap bucket inventory is incomplete.');
	}
	const versions = inventory.Versions ?? [];
	const deleteMarkers = inventory.DeleteMarkers ?? [];
	if (!Array.isArray(versions) || !Array.isArray(deleteMarkers)) {
		throw new Error('Bootstrap bucket inventory has an invalid shape.');
	}
	if (deleteMarkers.length > 0) {
		throw new Error('Registry bootstrap refuses a bucket with deleted object history.');
	}
	const identityPath = `identities/${metadata.extensionId}/${metadata.version}.json`;
	const catalogPath = 'catalogs/1/catalog.json';
	const signaturePath = 'catalogs/1/catalog.sig.json';
	const allowedKeys = new Set([
		'v1/extensions-control.json',
		catalogPath,
		signaturePath,
		identityPath,
		metadata.assetPath
	]);
	const observedKeys = new Set<string>();
	for (const [index, value] of versions.entries()) {
		const objectVersion = manifestRecord(value, `bootstrap bucket inventory.Versions[${index}]`);
		const key = requiredManifestText(objectVersion.Key, `bootstrap bucket inventory.Versions[${index}].Key`);
		if (objectVersion.IsLatest !== true) {
			throw new Error(`Registry bootstrap refuses non-current history for '${key}'.`);
		}
		if (!allowedKeys.has(key)) {
			throw new Error(`Registry bootstrap refuses unexpected object '${key}'.`);
		}
		if (observedKeys.has(key)) {
			throw new Error(`Registry bootstrap refuses multiple versions of '${key}'.`);
		}
		observedKeys.add(key);
	}
	if (observedKeys.has(signaturePath) && !observedKeys.has(catalogPath)) {
		throw new Error('Registry bootstrap refuses an orphaned catalog signature.');
	}
	return [...observedKeys].sort();
}

export async function createReleaseIdentity(options: {
	metadata: ReleaseMetadata;
	outputPath: string;
}): Promise<ReleaseIdentity> {
	const identity = releaseIdentityFromMetadata(await validateReleaseMetadata(options.metadata));
	writeReleaseIdentity(options.outputPath, identity);
	return identity;
}

export function validateReleaseIdentity(value: unknown): ReleaseIdentity {
	const identity = manifestRecord(value, 'release identity');
	assertOnlyManifestKeys(identity, ['schemaVersion', 'extensionId', 'version', 'sha256', 'size', 'assetPath'], 'release identity');
	if (identity.schemaVersion !== 1) {
		throw new Error('Release identity schema version is invalid.');
	}
	const extensionId = requiredManifestText(identity.extensionId, 'release identity.extensionId');
	if (extensionId !== extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)) {
		throw new Error('Release identity extension id is invalid.');
	}
	assertSemver(identity.version, 'release identity version');
	const version = identity.version;
	const sha256 = requiredManifestText(identity.sha256, 'release identity.sha256');
	if (!/^[a-f0-9]{64}$/.test(sha256)) {
		throw new Error('Release identity SHA-256 is invalid.');
	}
	if (!Number.isSafeInteger(identity.size) || (identity.size as number) < 1 || (identity.size as number) > MAX_VSIX_BYTES) {
		throw new Error('Release identity byte size is invalid.');
	}
	const assetPath = requiredManifestText(identity.assetPath, 'release identity.assetPath');
	const expectedAssetPath = `${extensionId}/${version}/${sha256}.vsix`;
	if (assetPath !== expectedAssetPath) {
		throw new Error(`Release identity asset path must be '${expectedAssetPath}'.`);
	}
	validateAssetPath(assetPath);
	return { schemaVersion: 1, extensionId, version, sha256, size: identity.size as number, assetPath };
}

export function serializeReleaseIdentity(value: unknown): string {
	return `${JSON.stringify(validateReleaseIdentity(value), null, 2)}\n`;
}

export function createReleaseIdentitiesFromCatalog(options: {
	catalogPath: string;
	outputDirectory: string;
}): readonly ReleaseIdentity[] {
	const catalog = readBoundedJson(options.catalogPath, MAX_CATALOG_BYTES, 'Plugin catalog identity seed');
	validateCatalogRoot(catalog, { allowLegacy: true });
	const outputDirectory = path.resolve(options.outputDirectory);
	const identities = catalog.plugins.flatMap((plugin: any) => plugin.versions.map((release: any) => validateReleaseIdentity({
		schemaVersion: 1,
		extensionId: plugin.extensionId,
		version: release.version,
		sha256: release.sha256,
		size: release.size,
		assetPath: release.assetPath
	})) as ReleaseIdentity[])
		.sort((left: ReleaseIdentity, right: ReleaseIdentity) => left.extensionId.localeCompare(right.extensionId) || compare(left.version, right.version));
	for (const identity of identities) {
		const outputPath = path.resolve(outputDirectory, identity.extensionId, `${identity.version}.json`);
		const relativePath = path.relative(outputDirectory, outputPath);
		if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
			throw new Error(`Release identity output path for ${identity.extensionId}@${identity.version} escapes its output directory.`);
		}
		writeReleaseIdentity(outputPath, identity);
	}
	return identities;
}

export async function assertReleaseIdentityMatches(value: unknown, metadata: ReleaseMetadata): Promise<ReleaseIdentity> {
	const recorded = validateReleaseIdentity(value);
	const expected = releaseIdentityFromMetadata(await validateReleaseMetadata(metadata));
	if (
		recorded.extensionId !== expected.extensionId
		|| recorded.version !== expected.version
		|| recorded.sha256 !== expected.sha256
		|| recorded.size !== expected.size
		|| recorded.assetPath !== expected.assetPath
	) {
		throw new Error(`Release identity conflict for immutable ${expected.extensionId}@${expected.version}.`);
	}
	return recorded;
}

function releaseIdentityFromMetadata(metadata: ReleaseMetadata): ReleaseIdentity {
	return {
		schemaVersion: 1,
		extensionId: metadata.extensionId,
		version: metadata.version,
		sha256: metadata.sha256,
		size: metadata.size,
		assetPath: metadata.assetPath
	};
}

function writeReleaseIdentity(file: string, identity: ReleaseIdentity): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, serializeReleaseIdentity(identity), 'utf8');
}

export async function createCatalog(options: {
	metadata: ReleaseMetadata;
	sequence: number;
	outputPath: string;
	previousPath?: string;
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
	status: 'active' | 'withdrawn';
	generatedAt?: string;
}): Promise<Record<string, unknown>> {
	const metadata = await validateReleaseMetadata(options.metadata);
	if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
		throw new Error('Catalog sequence must be a positive safe integer.');
	}
	if (!validRange(options.basehalfRange) || !validRange(options.vscodeRange)) {
		throw new Error('Catalog compatibility ranges are invalid.');
	}
	if (metadata.basehalfRange !== options.basehalfRange || metadata.vscodeRange !== options.vscodeRange) {
		throw new Error('Catalog compatibility ranges do not match the VSIX manifest.');
	}
	if (!TARGET_PLATFORMS.has(options.targetPlatform)) {
		throw new Error(`Catalog target platform '${options.targetPlatform}' is invalid.`);
	}
	if (options.status !== 'active' && options.status !== 'withdrawn') {
		throw new Error(`Catalog status '${String(options.status)}' is invalid.`);
	}
	const previous = options.previousPath && fs.existsSync(options.previousPath) ? readBoundedJson(options.previousPath, MAX_CATALOG_BYTES, 'Previous plugin catalog') : undefined;
	if (previous) {
		validateCatalogRoot(previous, { allowLegacy: true });
		if (options.sequence <= previous.sequence) {
			throw new Error(`Catalog sequence ${options.sequence} must be greater than previous sequence ${previous.sequence}.`);
		}
	}
	const previousPlugin = previous?.plugins.find((plugin: any) => plugin.extensionId === metadata.extensionId);
	const versions = Array.isArray(previousPlugin?.versions) ? [...previousPlugin.versions] : [];
	const existing = versions.find((candidate: any) => candidate.version === metadata.version);
	if (existing) {
		throw new Error(`Refusing to republish immutable ${metadata.extensionId}@${metadata.version}; publish a new version or use a catalog status operation.`);
	}
	const release = {
		version: metadata.version,
		basehalfRange: options.basehalfRange,
		vscodeRange: options.vscodeRange,
		targetPlatform: options.targetPlatform,
		assetPath: metadata.assetPath,
		sha256: metadata.sha256,
		installedContentSha256: metadata.installedContentSha256,
		size: metadata.size,
		publishedAt: options.generatedAt ?? new Date().toISOString(),
		status: options.status,
		...(metadata.releaseNotes ? { releaseNotes: metadata.releaseNotes } : {})
	};
	const retainedPreviousVersions = versions
		.filter((candidate: any) => candidate.version !== release.version)
		.sort((a: any, b: any) => compareSemverDescending(a.version, b.version));
	if (retainedPreviousVersions.length >= CATALOG_VERSION_LIMIT) {
		throw new Error(`Plugin catalog '${metadata.extensionId}' reached its signed version limit; refusing to discard an existing grant.`);
	}
	const nextVersions = [release, ...retainedPreviousVersions]
		.sort((a: any, b: any) => compareSemverDescending(a.version, b.version));
	const otherPlugins = (previous?.plugins ?? []).filter((plugin: any) => plugin.extensionId !== metadata.extensionId);
	const catalog = {
		schemaVersion: 1,
		sequence: options.sequence,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		plugins: [{
			extensionId: metadata.extensionId,
			label: metadata.label ?? previousPlugin?.label ?? metadata.extensionId,
			description: metadata.description ?? previousPlugin?.description ?? '',
			category: metadata.category ?? previousPlugin?.category ?? 'Community',
			primaryCommand: metadata.primaryCommand,
			primaryCommandLabel: metadata.primaryCommandLabel,
			publisher: metadata.publisher,
			versions: nextVersions
		}, ...otherPlugins]
	};
	validateCatalogRoot(catalog);
	writeCatalogExact(options.outputPath, catalog);
	return catalog;
}

export interface IReleaseCatalogReconciliation {
	readonly state: 'absent' | 'published';
	readonly sequence: number;
	readonly extensionId: string;
	readonly version: string;
	readonly sha256: string;
	readonly assetPath: string;
}

export function assertCatalogCandidateMatchesPublish(options: {
	requestedCatalogPath: string;
	candidateCatalogPath: string;
	extensionId: string;
	version: string;
}): void {
	if (options.extensionId !== options.extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(options.extensionId)) {
		throw new Error('Catalog candidate extension id is invalid.');
	}
	assertSemver(options.version, 'catalog candidate version');
	const requested = readBoundedJson(options.requestedCatalogPath, MAX_CATALOG_BYTES, 'Requested plugin catalog');
	const candidate = readBoundedJson(options.candidateCatalogPath, MAX_CATALOG_BYTES, 'Existing plugin catalog candidate');
	validateCatalogRoot(requested);
	validateCatalogRoot(candidate);
	if (requested.sequence !== candidate.sequence) {
		throw new Error('Existing plugin catalog candidate has a different sequence.');
	}
	const normalize = (catalog: any) => {
		const copy = structuredClone(catalog);
		copy.generatedAt = '<generated-at>';
		const plugin = copy.plugins.find((value: any) => value.extensionId === options.extensionId);
		const release = plugin?.versions.find((value: any) => value.version === options.version);
		if (!plugin || !release) {
			throw new Error(`Plugin catalog candidate does not contain ${options.extensionId}@${options.version}.`);
		}
		release.publishedAt = '<published-at>';
		return copy;
	};
	if (!isDeepStrictEqual(normalize(requested), normalize(candidate))) {
		throw new Error('Existing plugin catalog candidate does not match the requested publish content.');
	}
}

export async function assertCatalogReleaseMatchesPublish(options: {
	metadata: ReleaseMetadata;
	catalogPath: string;
	sequence: number;
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
	outputPath?: string;
}): Promise<IReleaseCatalogReconciliation> {
	const metadata = await validateReleaseMetadata(options.metadata);
	if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
		throw new Error('Published catalog sequence must be a positive safe integer.');
	}
	validateCatalogReleaseDecision(metadata, options);
	const catalog = readBoundedJson(options.catalogPath, MAX_CATALOG_BYTES, 'Published plugin catalog');
	validateCatalogRoot(catalog);
	if (catalog.sequence !== options.sequence) {
		throw new Error(`Published catalog sequence ${catalog.sequence} does not match requested sequence ${options.sequence}.`);
	}
	const plugin = catalog.plugins.find((candidate: any) => candidate.extensionId === metadata.extensionId);
	const release = plugin?.versions.find((candidate: any) => candidate.version === metadata.version);
	if (!plugin || !release) {
		throw new Error(`Published catalog does not contain ${metadata.extensionId}@${metadata.version}.`);
	}
	if (!catalogReleaseMatchesDecision(plugin, release, metadata, options)) {
		throw new Error(`Published ${metadata.extensionId}@${metadata.version} does not match the requested publish content.`);
	}
	const result: IReleaseCatalogReconciliation = {
		state: 'published',
		sequence: catalog.sequence,
		extensionId: metadata.extensionId,
		version: metadata.version,
		sha256: metadata.sha256,
		assetPath: metadata.assetPath
	};
	if (options.outputPath) {
		writeJsonExact(options.outputPath, result);
	}
	return result;
}

/**
 * Reconciles a claimed immutable build with the current signed catalog. A
 * previous worker may have switched the catalog index before its completion
 * acknowledgement reached the control plane, so retries must recognize the
 * exact published build instead of attempting to create it again.
 */
export async function reconcileCatalogRelease(options: {
	metadata: ReleaseMetadata;
	catalogPath: string;
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
	outputPath?: string;
}): Promise<IReleaseCatalogReconciliation> {
	const metadata = await validateReleaseMetadata(options.metadata);
	validateCatalogReleaseDecision(metadata, options);
	const catalog = readBoundedJson(options.catalogPath, MAX_CATALOG_BYTES, 'Published plugin catalog');
	validateCatalogRoot(catalog, { allowLegacy: true });
	const plugin = catalog.plugins.find((candidate: any) => candidate.extensionId === metadata.extensionId);
	const release = plugin?.versions.find((candidate: any) => candidate.version === metadata.version);
	if (release && !catalogReleaseMatchesDecision(plugin, release, metadata, options)) {
		throw new Error(`Published ${metadata.extensionId}@${metadata.version} does not match the claimed publication decision.`);
	}
	const result: IReleaseCatalogReconciliation = {
		state: release ? 'published' : 'absent',
		sequence: catalog.sequence,
		extensionId: metadata.extensionId,
		version: metadata.version,
		sha256: metadata.sha256,
		assetPath: metadata.assetPath
	};
	if (options.outputPath) {
		writeJsonExact(options.outputPath, result);
	}
	return result;
}

function validateCatalogReleaseDecision(metadata: ReleaseMetadata, options: {
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
}): void {
	if (!validRange(options.basehalfRange) || !validRange(options.vscodeRange) || metadata.basehalfRange !== options.basehalfRange || metadata.vscodeRange !== options.vscodeRange) {
		throw new Error('Published catalog compatibility ranges do not match the requested package.');
	}
	if (!TARGET_PLATFORMS.has(options.targetPlatform)) {
		throw new Error(`Published catalog target platform '${options.targetPlatform}' is invalid.`);
	}
}

function catalogReleaseMatchesDecision(plugin: any, release: any, metadata: ReleaseMetadata, options: {
	basehalfRange: string;
	vscodeRange: string;
	targetPlatform: string;
}): boolean {
	return plugin.label === metadata.label
		&& plugin.description === metadata.description
		&& plugin.category === metadata.category
		&& plugin.primaryCommand === metadata.primaryCommand
		&& plugin.primaryCommandLabel === metadata.primaryCommandLabel
		&& isDeepStrictEqual(plugin.publisher, metadata.publisher)
		&& release.sha256 === metadata.sha256
		&& release.installedContentSha256 === metadata.installedContentSha256
		&& release.assetPath === metadata.assetPath
		&& release.size === metadata.size
		&& release.basehalfRange === options.basehalfRange
		&& release.vscodeRange === options.vscodeRange
		&& release.targetPlatform === options.targetPlatform
		&& release.status === 'active'
		&& release.releaseNotes === (metadata.releaseNotes || undefined);
}

export function createSignatureFile(options: { keyId: string; signatureBase64: string; outputPath: string }): void {
	if (!options.keyId.trim() || options.keyId.length > 200 || containsControlCharacter(options.keyId) || options.signatureBase64.length > MAX_SIGNATURE_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(options.signatureBase64)) {
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
	if (options.mode !== 'withdraw' && options.mode !== 'rollback') {
		throw new Error(`Catalog status mode '${String(options.mode)}' is invalid.`);
	}
	if (options.extensionId !== options.extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(options.extensionId)) {
		throw new Error('Catalog status extension id is invalid.');
	}
	assertSemver(options.version, 'catalog status version');
	const previous = readBoundedJson(options.previousPath, MAX_CATALOG_BYTES, 'Previous plugin catalog');
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
	validateCatalogRoot(catalog);
	writeCatalogExact(options.outputPath, catalog);
	return catalog;
}

export function assertCatalogStatus(options: {
	catalogPath: string;
	extensionId: string;
	version: string;
	mode: 'withdraw' | 'rollback';
}): Record<string, unknown> {
	if (options.mode !== 'withdraw' && options.mode !== 'rollback') {
		throw new Error(`Catalog status mode '${String(options.mode)}' is invalid.`);
	}
	if (options.extensionId !== options.extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(options.extensionId)) {
		throw new Error('Catalog status extension id is invalid.');
	}
	assertSemver(options.version, 'catalog status version');
	const catalog = readBoundedJson(options.catalogPath, MAX_CATALOG_BYTES, 'Published plugin catalog status');
	validateCatalogRoot(catalog);
	const plugin = catalog.plugins.find((candidate: any) => candidate.extensionId === options.extensionId);
	const release = plugin?.versions.find((candidate: any) => candidate.version === options.version);
	if (!plugin || !release) {
		throw new Error(`Published catalog does not contain ${options.extensionId}@${options.version}.`);
	}
	if (options.mode === 'withdraw') {
		if (release.status !== 'withdrawn') {
			throw new Error(`${options.extensionId}@${options.version} is not withdrawn in the published catalog.`);
		}
	} else {
		if (release.status !== 'active') {
			throw new Error(`${options.extensionId}@${options.version} is not active in the published rollback catalog.`);
		}
		const activeNewer = plugin.versions.find((candidate: any) => compareSemver(candidate.version, options.version) > 0 && candidate.status !== 'withdrawn');
		if (activeNewer) {
			throw new Error(`Newer ${options.extensionId}@${activeNewer.version} is not withdrawn in the published rollback catalog.`);
		}
	}
	return catalog;
}

export function updateExtensionControl(options: {
	previousPath?: string;
	outputPath: string;
	extensionId: string;
	blocked: boolean;
}): Record<string, unknown> {
	if (options.extensionId !== options.extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(options.extensionId)) {
		throw new Error('Extension control id is invalid.');
	}
	if (Object.prototype.hasOwnProperty.call(options, 'learnMoreLink')) {
		throw new Error('Emergency extension control manifests do not support learn-more links.');
	}
	const previous = options.previousPath && fs.existsSync(options.previousPath)
		? validateEmergencyExtensionControl(readBoundedJson(options.previousPath, MAX_CATALOG_BYTES, 'Previous extension control'), 'Previous extension control')
		: { malicious: [], deprecated: {}, search: [], autoUpdate: {} };
	const malicious = options.blocked
		? [...new Set([...previous.malicious, options.extensionId])].sort()
		: previous.malicious.filter(extensionId => extensionId !== options.extensionId).sort();
	const control = validateEmergencyExtensionControl({
		malicious,
		deprecated: {},
		search: [],
		autoUpdate: {}
	}, 'Generated extension control');
	writeJsonExact(options.outputPath, control);
	return control;
}

function validateEmergencyExtensionControl(value: unknown, label: string): {
	malicious: string[];
	deprecated: Record<string, never>;
	search: never[];
	autoUpdate: Record<string, never>;
} {
	const control = manifestRecord(value, label);
	const allowedKeys = ['malicious', 'deprecated', 'search', 'autoUpdate'];
	if (Object.keys(control).length !== allowedKeys.length || allowedKeys.some(key => !Object.prototype.hasOwnProperty.call(control, key))) {
		throw new Error(`${label} must contain only the emergency extension control fields.`);
	}
	assertOnlyManifestKeys(control, allowedKeys, label);
	if (!Array.isArray(control.malicious) || control.malicious.length > MAX_EXTENSION_CONTROL_IDS) {
		throw new Error(`${label} has an invalid malicious list.`);
	}
	const malicious: string[] = [];
	const seen = new Set<string>();
	for (const candidate of control.malicious) {
		if (typeof candidate !== 'string'
			|| candidate !== candidate.toLowerCase()
			|| !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(candidate)
			|| seen.has(candidate)) {
			throw new Error(`${label} must contain unique lowercase extension identities.`);
		}
		seen.add(candidate);
		malicious.push(candidate);
	}
	if (!isManifestRecord(control.deprecated) || Object.keys(control.deprecated).length
		|| !Array.isArray(control.search) || control.search.length
		|| !isManifestRecord(control.autoUpdate) || Object.keys(control.autoUpdate).length) {
		throw new Error(`${label} may only contain emergency extension identities.`);
	}
	return { malicious, deprecated: {}, search: [], autoUpdate: {} };
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
}): Promise<VerifiedReleaseArtifact> {
	const [catalogBytes, signatureBytes] = await Promise.all([
		fetchBytes(options.catalogUrl, options.timeoutMs, MAX_CATALOG_BYTES),
		fetchBytes(options.signatureUrl, options.timeoutMs, MAX_SIGNATURE_BYTES)
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
	if (!/^[a-f0-9]{64}$/.test(release.sha256) || !/^[a-f0-9]{64}$/.test(release.installedContentSha256) || !Number.isSafeInteger(release.size) || release.size < 1) {
		throw new Error('Catalog release digest or size is invalid.');
	}
	const assetUrl = resolveAssetUrl(options.assetBaseUrl, release.assetPath);
	const vsix = await fetchBytes(assetUrl.href, options.timeoutMs, Math.min(MAX_VSIX_BYTES, release.size));
	const sha256 = createHash('sha256').update(vsix).digest('hex');
	if (vsix.byteLength !== release.size || sha256 !== release.sha256) {
		throw new Error('VSIX size or SHA-256 verification failed.');
	}
	const temporaryPath = path.join(path.dirname(options.publicKeyPath), `.basehalf-verify-${process.pid}-${Date.now()}.vsix`);
	try {
		fs.writeFileSync(temporaryPath, vsix);
		const inspection = await inspectVsixArchive(temporaryPath);
		if (inspection.installedContentSha256 !== release.installedContentSha256) {
			throw new Error('Installed-content SHA-256 verification failed.');
		}
		const manifest = inspection.manifest;
		if (manifestId(manifest) !== options.extensionId || manifest.version !== options.version) {
			throw new Error(`VSIX manifest mismatch: received ${manifestId(manifest)}@${manifest.version}.`);
		}
		validateReviewedVsixManifest(manifest, inspection.files, options.extensionId, inspection.templateResources);
		if (plugin.primaryCommand !== manifest.basehalf?.primaryCommand || plugin.primaryCommandLabel !== manifest.basehalf?.primaryCommandLabel) {
			throw new Error('Catalog command metadata does not match the VSIX manifest.');
		}
		if (release.basehalfRange !== manifest.engines?.basehalf || release.vscodeRange !== manifest.engines?.vscode) {
			throw new Error('Catalog compatibility ranges do not match the VSIX manifest.');
		}
		if (plugin.publisher?.slug !== undefined && plugin.publisher.slug !== manifest.publisher) {
			throw new Error('Catalog publisher metadata does not match the VSIX manifest.');
		}
	} finally {
		fs.rmSync(temporaryPath, { force: true });
	}
	return {
		extensionId: options.extensionId,
		version: options.version,
		assetPath: release.assetPath,
		sha256,
		installedContentSha256: release.installedContentSha256,
		size: vsix.byteLength,
		vsixPath: assetUrl.href
	};
}

export async function readVsixManifest(vsixPath: string): Promise<any> {
	return (await inspectVsixArchive(vsixPath)).manifest;
}

export async function backfillCatalogInstalledContentHashes(options: {
	catalogPath: string;
	assetBaseUrl: string;
	outputPath: string;
	timeoutMs?: number;
}): Promise<Record<string, unknown>> {
	const catalog = readBoundedJson(options.catalogPath, MAX_CATALOG_BYTES, 'Plugin catalog hash migration');
	validateCatalogRoot(catalog, { allowLegacy: true });
	const migrated = structuredClone(catalog);
	const outputPath = path.resolve(options.outputPath);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	for (const plugin of migrated.plugins) {
		if (plugin.extensionId === OFFICIAL_EXTENSION_ID) {
			plugin.primaryCommand ??= OFFICIAL_PRIMARY_COMMAND;
			plugin.primaryCommandLabel ??= OFFICIAL_PRIMARY_COMMAND_LABEL;
			plugin.publisher ??= { ...OFFICIAL_PUBLISHER };
		}
		for (const release of plugin.versions) {
			if (typeof release.installedContentSha256 === 'string') {
				continue;
			}
			const assetUrl = resolveAssetUrl(options.assetBaseUrl, release.assetPath);
			const vsix = await fetchBytes(assetUrl.href, options.timeoutMs, Math.min(MAX_VSIX_BYTES, release.size));
			if (vsix.byteLength !== release.size || createHash('sha256').update(vsix).digest('hex') !== release.sha256) {
				throw new Error(`Catalog asset verification failed for ${plugin.extensionId}@${release.version}.`);
			}
			const temporaryPath = path.join(path.dirname(outputPath), `.basehalf-tree-hash-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.vsix`);
			try {
				fs.writeFileSync(temporaryPath, vsix, { flag: 'wx' });
				release.installedContentSha256 = (await inspectVsixArchive(temporaryPath)).installedContentSha256;
			} finally {
				fs.rmSync(temporaryPath, { force: true });
			}
		}
	}
	validateCatalogRoot(migrated);
	writeCatalogExact(outputPath, migrated);
	return migrated;
}

async function normalizeVsixArchive(inputPath: string, outputPath: string): Promise<void> {
	readBoundedFile(inputPath, MAX_VSIX_BYTES, 'Packaged VSIX');
	const { zip, entries } = await collectVsixEntriesForNormalization(inputPath);
	const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(outputPath), '.basehalf-vsix-normalize-'));
	const normalizedPath = path.join(temporaryDirectory, 'normalized.vsix');
	const extractedFiles = new Map<string, string>();
	try {
		for (const entry of entries) {
			const bytes = await readVsixEntry(zip, entry, MAX_VSIX_ENTRY_BYTES);
			const extractedPath = path.join(temporaryDirectory, 'contents', ...entry.fileName.split('/'));
			fs.mkdirSync(path.dirname(extractedPath), { recursive: true });
			fs.writeFileSync(extractedPath, bytes, { flag: 'wx' });
			extractedFiles.set(entry.fileName, extractedPath);
		}
		zip.close();
		await writeDeterministicVsix(normalizedPath, entries, extractedFiles);
		fs.renameSync(normalizedPath, outputPath);
	} finally {
		zip.close();
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function collectVsixEntriesForNormalization(vsixPath: string): Promise<{ zip: ZipFile; entries: Entry[] }> {
	return new Promise((resolve, reject) => {
		yauzl.open(vsixPath, { lazyEntries: true, validateEntrySizes: true, autoClose: false }, (openError, zip) => {
			if (openError || !zip) {
				reject(openError ?? new Error('Could not open packaged VSIX.'));
				return;
			}
			let settled = false;
			let totalUncompressed = 0;
			const entries: Entry[] = [];
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
			zip.on('entry', entry => {
				if (entries.length >= MAX_VSIX_ENTRIES) {
					fail(new Error(`VSIX contains more than ${MAX_VSIX_ENTRIES} entries.`));
					return;
				}
				if (!safeVsixEntryName(entry.fileName) || !isVsixRegularFile(entry) || isVsixEncrypted(entry)) {
					fail(new Error(`VSIX contains unsafe entry '${entry.fileName}'.`));
					return;
				}
				const canonicalName = canonicalVsixEntryName(entry.fileName);
				if (canonicalFiles.has(canonicalName)) {
					fail(new Error(`VSIX contains duplicate archive path '${entry.fileName}'.`));
					return;
				}
				if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_VSIX_ENTRY_BYTES) {
					fail(new Error(`VSIX entry '${entry.fileName}' exceeds the per-entry size limit.`));
					return;
				}
				totalUncompressed += entry.uncompressedSize;
				if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_VSIX_UNCOMPRESSED_BYTES) {
					fail(new Error('VSIX expands beyond the allowed size.'));
					return;
				}
				canonicalFiles.add(canonicalName);
				files.add(entry.fileName);
				entries.push(entry);
				zip.readEntry();
			});
			zip.on('end', () => {
				try {
					assertNoVsixPathPrefixConflicts(files);
				} catch (error) {
					fail(error);
					return;
				}
				if (!settled) {
					settled = true;
					entries.sort((left, right) => Buffer.compare(Buffer.from(left.fileName, 'utf8'), Buffer.from(right.fileName, 'utf8')));
					resolve({ zip, entries });
				}
			});
			zip.readEntry();
		});
	});
}

function writeDeterministicVsix(outputPath: string, entries: readonly Entry[], extractedFiles: ReadonlyMap<string, string>): Promise<void> {
	return new Promise((resolve, reject) => {
		const archive = new yazl.ZipFile();
		const writer = fs.createWriteStream(outputPath, { flags: 'wx' });
		let settled = false;
		const fail = (error: unknown) => {
			if (!settled) {
				settled = true;
				writer.destroy();
				reject(error);
			}
		};
		archive.on('error', fail);
		archive.outputStream.on('error', fail);
		writer.on('error', fail);
		writer.on('finish', () => {
			if (!settled) {
				settled = true;
				resolve();
			}
		});
		archive.outputStream.pipe(writer);
		for (const entry of entries) {
			const extractedPath = extractedFiles.get(entry.fileName);
			if (!extractedPath) {
				fail(new Error(`VSIX normalization lost entry '${entry.fileName}'.`));
				return;
			}
			const sourceMode = (entry.externalFileAttributes >>> 16) & 0xffff;
			const mode = (sourceMode & 0o111) !== 0 ? 0o100755 : 0o100644;
			archive.addFile(extractedPath, entry.fileName, {
				mtime: DETERMINISTIC_VSIX_MTIME,
				mode,
				compress: false
			});
		}
		archive.end();
	});
}

async function inspectVsixArchive(vsixPath: string): Promise<{ manifest: any; files: ReadonlySet<string>; templateResources: ReadonlyMap<string, Buffer>; installedContentSha256: string }> {
	readBoundedFile(vsixPath, MAX_VSIX_BYTES, 'VSIX');
	const archive = await new Promise<{ manifest: any; files: ReadonlySet<string>; installedContentSha256: string }>((resolve, reject) => {
			yauzl.open(vsixPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
			if (openError || !zip) {
				reject(openError ?? new Error('Could not open VSIX.'));
				return;
			}
			let settled = false;
			let entryCount = 0;
			let totalUncompressed = 0;
			let manifest: any;
			const files = new Set<string>();
			const canonicalFiles = new Set<string>();
			const installedEntries: string[] = [];
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
				try {
					assertNoVsixPathPrefixConflicts(files);
				} catch (error) {
					fail(error);
					return;
				}
				if (!settled) {
					settled = true;
					installedEntries.sort();
					resolve({
						manifest,
						files,
						installedContentSha256: createHash('sha256').update(installedEntries.join('\n')).digest('hex')
					});
				}
			});
			zip.on('entry', entry => {
				entryCount++;
				if (entryCount > MAX_VSIX_ENTRIES) {
					fail(new Error(`VSIX contains more than ${MAX_VSIX_ENTRIES} entries.`));
					return;
				}
				if (!safeVsixEntryName(entry.fileName) || !isVsixRegularFile(entry) || isVsixEncrypted(entry)) {
					fail(new Error(`VSIX contains unsafe entry '${entry.fileName}'.`));
					return;
				}
				const canonicalName = canonicalVsixEntryName(entry.fileName);
				if (canonicalFiles.has(canonicalName)) {
					fail(new Error(`VSIX contains duplicate archive path '${entry.fileName}'.`));
					return;
				}
				canonicalFiles.add(canonicalName);
				files.add(entry.fileName);
				if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_VSIX_ENTRY_BYTES) {
					fail(new Error(`VSIX entry '${entry.fileName}' exceeds the per-entry size limit.`));
					return;
				}
				totalUncompressed += entry.uncompressedSize;
				if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_VSIX_UNCOMPRESSED_BYTES) {
					fail(new Error('VSIX expands beyond the allowed size.'));
					return;
				}
				if (canonicalName === 'extension/package.json' && entry.fileName !== 'extension/package.json') {
					fail(new Error('VSIX manifest path must be exactly extension/package.json.'));
					return;
				}
				const maximumBytes = entry.fileName === 'extension/package.json' ? MAX_MANIFEST_BYTES : MAX_VSIX_ENTRY_BYTES;
				readVsixEntry(zip, entry, maximumBytes, entry.fileName.startsWith('extension/')).then(bytes => {
					try {
						if (entry.fileName.startsWith('extension/')) {
							const relative = entry.fileName.slice('extension/'.length);
							if (!relative || relative !== relative.normalize('NFC')) {
								throw new Error(`VSIX contains an invalid installed path '${entry.fileName}'.`);
							}
							const installedBytes = baseHalfCanonicalInstalledFileBytes(relative, bytes);
							installedEntries.push(JSON.stringify([
								relative,
								installedBytes.byteLength,
								createHash('sha256').update(installedBytes).digest('hex')
							]));
						}
						if (entry.fileName === 'extension/package.json') {
							const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
							manifest = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
						}
						zip.readEntry();
					} catch (error) {
						fail(error);
					}
				}, fail);
			});
			zip.readEntry();
		});
	});
	const templatePaths = declaredTemplateArchivePaths(archive.manifest);
	const templateResources = await readVsixEntries(vsixPath, templatePaths, MAX_TEMPLATE_BYTES);
	return { ...archive, templateResources };
}

export function validateReviewedVsixManifest(
	manifest: any,
	files: ReadonlySet<string>,
	extensionId: string,
	templateResources: ReadonlyMap<string, Buffer>
): void {
	const root = manifestRecord(manifest, 'manifest');
	if (root.publisher !== String(root.publisher ?? '').toLowerCase() || root.name !== String(root.name ?? '').toLowerCase() || manifestId(root) !== extensionId || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)) {
		throw new Error(`Reviewed plugin manifest identity does not match '${extensionId}'.`);
	}
	assertSemver(root.version, 'extension version');
	boundedManifestText(root.displayName, 'displayName', 200);
	boundedManifestText(root.description, 'description', 2_000);
	boundedManifestText(root.license, 'license', 200);
	validateHttpsRepository(root.repository);
	if (root.enabledApiProposals !== undefined && (!Array.isArray(root.enabledApiProposals) || root.enabledApiProposals.length > 0)) {
		throw new Error('Reviewed plugins cannot depend on proposed APIs.');
	}
	for (const field of ['extensionDependencies', 'extensionPack'] as const) {
		if (field in root) {
			throw new Error(`Reviewed plugins cannot declare ${field}.`);
		}
	}

	const engines = manifestRecord(root.engines, 'engines');
	if (typeof engines.vscode !== 'string' || typeof engines.basehalf !== 'string' || !validRange(engines.vscode) || !validRange(engines.basehalf)) {
		throw new Error('Reviewed plugin compatibility ranges are invalid.');
	}
	const main = boundedManifestText(root.main, 'main', 500);
	const mainPath = packageRelativePath(main, 'main');
	if (!files.has(`extension/${mainPath}`)) {
		throw new Error(`Reviewed plugin entry point '${main}' is missing from the VSIX or has different casing.`);
	}

	const basehalf = manifestRecord(root.basehalf, 'basehalf');
	assertOnlyManifestKeys(basehalf, ['primaryCommand', 'primaryCommandLabel'], 'basehalf');
	const primaryCommand = ownedCommandId(basehalf.primaryCommand, extensionId, 'basehalf.primaryCommand');
	boundedManifestText(basehalf.primaryCommandLabel, 'basehalf.primaryCommandLabel', 100);
	const contributes = manifestRecord(root.contributes, 'contributes');
	const unsupported = Object.keys(contributes).filter(point => !ALLOWED_CONTRIBUTION_POINTS.has(point));
	if (unsupported.length > 0) {
		throw new Error(`Reviewed plugin declares unsupported contribution points: ${unsupported.sort().join(', ')}.`);
	}

	const commandIds = validateCommands(contributes.commands, extensionId, primaryCommand);
	validateConfiguration(contributes.configuration, extensionId);
	validateJsonValidation(contributes.jsonValidation, files);
	const projections = contributionArray(contributes.basehalfCardProjections, 'basehalfCardProjections');
	const recipes = contributionArray(contributes.basehalfCanvasRecipes, 'basehalfCanvasRecipes');
	const templates = contributionArray(contributes.basehalfCanvasTemplates, 'basehalfCanvasTemplates');
	const agentCapabilities = contributionArray(contributes.basehalfAgentCapabilities, 'basehalfAgentCapabilities');
	const structuralCleanups = contributionArray(contributes.basehalfStructuralCleanups, 'basehalfStructuralCleanups');
	if (projections.length + recipes.length + templates.length + agentCapabilities.length + structuralCleanups.length === 0) {
		throw new Error('Reviewed plugin must contribute a BaseHalf Agent capability, projection, canvas recipe, canvas template, or structural cleanup.');
	}
	validateAgentCapabilities(agentCapabilities, extensionId, commandIds);
	const projectionIds = validateProjections(projections, extensionId);
	const recipeMap = validateRecipes(recipes, extensionId);
	const structuralCleanupIds = validateStructuralCleanups(structuralCleanups, extensionId);
	validateTemplates(templates, extensionId, files, templateResources, recipeMap);
	validateActivationEvents(root.activationEvents, commandIds, projectionIds, new Set(recipeMap.keys()), structuralCleanupIds);

	if (!hasVsixFile(files, 'extension/readme.md')) {
		throw new Error('Reviewed plugin VSIX is missing README.md.');
	}
	const hasLicense = [...files].some(file => /^extension\/(license|license\.md|license\.txt)$/i.test(file));
	if (!hasLicense) {
		throw new Error('Reviewed plugin VSIX is missing a license file.');
	}
}

function validateCommands(value: unknown, extensionId: string, primaryCommand: string): ReadonlySet<string> {
	const commands = contributionArray(value, 'commands', true);
	if (commands.length > 128) {
		throw new Error('Reviewed plugin declares too many commands.');
	}
	const ids = new Set<string>();
	for (const [index, value] of commands.entries()) {
		const command = manifestRecord(value, `commands[${index}]`);
		assertOnlyManifestKeys(command, ['command', 'title', 'shortTitle', 'category', 'enablement', 'icon'], `commands[${index}]`);
		const id = ownedCommandId(command.command, extensionId, `commands[${index}].command`);
		if (ids.has(id)) {
			throw new Error(`Reviewed plugin command '${id}' is declared more than once.`);
		}
		ids.add(id);
		boundedManifestText(command.title, `commands[${index}].title`, 200);
		optionalBoundedManifestText(command.shortTitle, `commands[${index}].shortTitle`, 100);
		optionalBoundedManifestText(command.category, `commands[${index}].category`, 100);
		optionalBoundedManifestText(command.enablement, `commands[${index}].enablement`, 1_000);
		if (command.icon !== undefined && typeof command.icon !== 'string' && !isManifestRecord(command.icon)) {
			throw new Error(`Reviewed plugin command '${id}' has an invalid icon.`);
		}
	}
	if (!ids.has(primaryCommand)) {
		throw new Error(`VSIX primary command '${primaryCommand}' is not declared in contributes.commands.`);
	}
	return ids;
}

function validateConfiguration(value: unknown, extensionId: string): void {
	if (value === undefined) {
		return;
	}
	const configurations = Array.isArray(value) ? value : [value];
	if (configurations.length === 0 || configurations.length > 32 || configurations.some(candidate => !isManifestRecord(candidate))) {
		throw new Error('Reviewed plugin contribution \'configuration\' is invalid.');
	}
	const propertyIds = new Set<string>();
	const budget = { remaining: 4_096 };
	for (const [index, value] of configurations.entries()) {
		const configuration = manifestRecord(value, `configuration[${index}]`);
		const properties = manifestRecord(configuration.properties, `configuration[${index}].properties`);
		const entries = Object.entries(properties);
		if (entries.length === 0 || entries.length > 256) {
			throw new Error(`Reviewed plugin configuration[${index}] must declare 1-256 settings.`);
		}
		for (const [propertyId, schema] of entries) {
			const canonicalId = propertyId.toLowerCase();
			if (propertyId.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(propertyId) || !canonicalId.startsWith(`${extensionId}.`) || propertyIds.has(canonicalId)) {
				throw new Error(`Reviewed plugin configuration setting '${propertyId}' is invalid, duplicated, or outside '${extensionId}'.`);
			}
			if (schema === undefined) {
				throw new Error(`Reviewed plugin configuration setting '${propertyId}' is missing its schema.`);
			}
			propertyIds.add(canonicalId);
		}
		validateConfigurationSchema(configuration, `configuration[${index}]`, 0, budget, new WeakSet<object>());
	}
}

function validateConfigurationSchema(value: unknown, field: string, depth: number, budget: { remaining: number }, ancestors: WeakSet<object>): void {
	budget.remaining--;
	if (budget.remaining < 0 || depth > 12) {
		throw new Error(`Reviewed plugin ${field} exceeds the configuration complexity limit.`);
	}
	if (value === null || typeof value === 'boolean') {
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`Reviewed plugin ${field} must be finite JSON.`);
		}
		return;
	}
	if (typeof value === 'string') {
		if (value.length > 100_000 || value.includes('\0')) {
			throw new Error(`Reviewed plugin ${field} contains invalid configuration text.`);
		}
		return;
	}
	if (!value || typeof value !== 'object') {
		throw new Error(`Reviewed plugin ${field} must contain JSON-compatible configuration data.`);
	}
	if (ancestors.has(value)) {
		throw new Error(`Reviewed plugin ${field} contains a configuration cycle.`);
	}
	ancestors.add(value);
	const entries: Iterable<[string | number, unknown]> = Array.isArray(value) ? value.entries() : Object.entries(value);
	const size = Array.isArray(value) ? value.length : Object.keys(value).length;
	if (size > 1_000) {
		throw new Error(`Reviewed plugin ${field} exceeds the configuration collection limit.`);
	}
	for (const [key, entry] of entries) {
		if (typeof key === 'string' && (!key || key.length > 200 || key === '__proto__' || key === 'constructor' || key === 'prototype')) {
			throw new Error(`Reviewed plugin ${field} contains an invalid configuration key.`);
		}
		validateConfigurationSchema(entry, `${field}.${String(key)}`, depth + 1, budget, ancestors);
	}
	ancestors.delete(value);
}

function validateActivationEvents(
	value: unknown,
	commands: ReadonlySet<string>,
	projections: ReadonlySet<string>,
	recipes: ReadonlySet<string>,
	structuralCleanups: ReadonlySet<string>
): void {
	if (value === undefined) {
		return;
	}
	if (!Array.isArray(value) || value.length > 256 || value.some(event => typeof event !== 'string')) {
		throw new Error('Reviewed plugin activationEvents are invalid.');
	}
	for (const event of value as string[]) {
		const [kind, id, extra] = event.split(':');
		const allowed = typeof id === 'string' && !!id && extra === undefined && (
			(kind === 'onCommand' && commands.has(id))
			|| (kind === 'onBaseHalfCardProjection' && projections.has(id))
			|| (kind === 'onBaseHalfCanvasRecipe' && recipes.has(id))
			|| (kind === 'onBaseHalfStructuralCleanup' && structuralCleanups.has(id))
		);
		if (!allowed) {
			throw new Error(`Reviewed plugin activation event '${event}' is not tied to a declared contribution.`);
		}
	}
}

function validateStructuralCleanups(values: readonly unknown[], extensionId: string): ReadonlySet<string> {
	if (values.length > 16) {
		throw new Error('Reviewed plugin declares too many structural cleanups.');
	}
	const ids = new Set<string>();
	for (const [index, value] of values.entries()) {
		const cleanup = manifestRecord(value, `basehalfStructuralCleanups[${index}]`);
		assertOnlyManifestKeys(cleanup, ['id', 'extensions'], `basehalfStructuralCleanups[${index}]`);
		const id = ownedContributionId(cleanup.id, extensionId, ids, 'structural cleanup');
		const extensions = contributionArray(cleanup.extensions, `${id}.extensions`, true);
		if (extensions.length > 16
			|| new Set(extensions.map(extension => String(extension).toLowerCase())).size !== extensions.length
			|| extensions.some(extension => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))) {
			throw new Error(`Reviewed plugin structural cleanup '${id}' has invalid file extensions.`);
		}
	}
	return ids;
}

function validateJsonValidation(value: unknown, files: ReadonlySet<string>): void {
	const validators = contributionArray(value, 'jsonValidation');
	if (validators.length > 64) {
		throw new Error('Reviewed plugin contribution \'jsonValidation\' has too many entries.');
	}
	for (const [index, value] of validators.entries()) {
		const validator = manifestRecord(value, `jsonValidation[${index}]`);
		assertOnlyManifestKeys(validator, ['fileMatch', 'url'], `jsonValidation[${index}]`);
		const matches = Array.isArray(validator.fileMatch) ? validator.fileMatch : [validator.fileMatch];
		if (matches.length === 0 || matches.length > 64 || matches.some(match => typeof match !== 'string' || !match.trim() || match.length > 500 || containsControlCharacter(match))) {
			throw new Error(`Reviewed plugin jsonValidation[${index}].fileMatch is invalid.`);
		}
		const schemaPath = packageRelativePath(boundedManifestText(validator.url, `jsonValidation[${index}].url`, 500), `jsonValidation[${index}].url`);
		if (!schemaPath.toLowerCase().endsWith('.json') || !files.has(`extension/${schemaPath}`)) {
			throw new Error(`Reviewed plugin JSON schema '${schemaPath}' is missing from the VSIX or has different casing.`);
		}
	}
}

function validateProjections(values: readonly unknown[], extensionId: string): ReadonlySet<string> {
	if (values.length > 64) {
		throw new Error('Reviewed plugin declares too many card projections.');
	}
	const ids = new Set<string>();
	for (const [index, value] of values.entries()) {
		const projection = manifestRecord(value, `basehalfCardProjections[${index}]`);
		assertOnlyManifestKeys(projection, ['id', 'label', 'icon', 'extensions', 'fileNames', 'order', 'defaultPriority'], `basehalfCardProjections[${index}]`);
		const id = ownedContributionId(projection.id, extensionId, ids, 'card projection');
		boundedManifestText(projection.label, `${id}.label`, 80);
		const icon = optionalBoundedManifestText(projection.icon, `${id}.icon`, 64);
		if (icon !== undefined && !/^[a-z][a-z0-9-]*$/.test(icon)) {
			throw new Error(`Reviewed plugin card projection '${id}' has an invalid icon.`);
		}
		const extensions = contributionArray(projection.extensions, `${id}.extensions`);
		const fileNames = contributionArray(projection.fileNames, `${id}.fileNames`);
		if ((extensions.length === 0 && fileNames.length === 0)
			|| extensions.length > 64
			|| fileNames.length > 64
			|| new Set(extensions.map(extension => String(extension).toLowerCase())).size !== extensions.length
			|| new Set(fileNames.map(fileName => String(fileName).toLowerCase())).size !== fileNames.length
			|| extensions.some(extension => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))
			|| fileNames.some(fileName => typeof fileName !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(fileName) || fileName === '.' || fileName === '..')) {
			throw new Error(`Reviewed plugin card projection '${id}' must declare valid file extensions or exact file names.`);
		}
		optionalFiniteManifestNumber(projection.order, `${id}.order`);
		optionalFiniteManifestNumber(projection.defaultPriority, `${id}.defaultPriority`);
	}
	return ids;
}

function validateRecipes(values: readonly unknown[], extensionId: string): ReadonlyMap<string, Record<string, unknown>> {
	if (values.length > 64) {
		throw new Error('Reviewed plugin declares too many canvas recipes.');
	}
	const ids = new Set<string>();
	const recipes = new Map<string, Record<string, unknown>>();
	for (const [index, value] of values.entries()) {
		const recipe = manifestRecord(value, `basehalfCanvasRecipes[${index}]`);
		assertOnlyManifestKeys(recipe, ['id', 'label', 'description', 'icon', 'modelCapability', 'inputs', 'parameters', 'outputs'], `basehalfCanvasRecipes[${index}]`);
		const id = ownedContributionId(recipe.id, extensionId, ids, 'canvas recipe');
		boundedManifestText(recipe.label, `${id}.label`, 80);
		optionalBoundedManifestText(recipe.description, `${id}.description`, 500);
		const icon = optionalBoundedManifestText(recipe.icon, `${id}.icon`, 64);
		if (icon !== undefined && !/^[a-z][a-z0-9-]*$/.test(icon)) {
			throw new Error(`Reviewed plugin canvas recipe '${id}' has an invalid icon.`);
		}
		if (recipe.modelCapability !== undefined && !MODEL_CAPABILITIES.includes(recipe.modelCapability as typeof MODEL_CAPABILITIES[number])) {
			throw new Error(`Reviewed plugin canvas recipe '${id}' has an invalid model capability.`);
		}
		validateRecipeInputs(id, contributionArray(recipe.inputs, `${id}.inputs`));
		validateRecipeParameters(id, contributionArray(recipe.parameters, `${id}.parameters`));
		validateRecipeOutputs(id, contributionArray(recipe.outputs, `${id}.outputs`, true));
		recipes.set(id, recipe);
	}
	return recipes;
}

function validateRecipeInputs(recipeId: string, values: readonly unknown[]): void {
	if (values.length > 16) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' has too many inputs.`);
	}
	const ids = new Set<string>();
	let maximumItems = 0;
	for (const [index, value] of values.entries()) {
		const input = manifestRecord(value, `${recipeId}.inputs[${index}]`);
		assertOnlyManifestKeys(input, ['id', 'label', 'accepts', 'minItems', 'maxItems'], `${recipeId}.inputs[${index}]`);
		const id = localManifestId(input.id, `${recipeId}.input`, ids);
		boundedManifestText(input.label, `${recipeId}.input.${id}.label`, 80);
		const accepts = contributionArray(input.accepts, `${recipeId}.input.${id}.accepts`, true);
		if (accepts.length > CANVAS_CONTENT_KINDS.length || new Set(accepts).size !== accepts.length || accepts.some(kind => !CANVAS_CONTENT_KINDS.includes(kind as typeof CANVAS_CONTENT_KINDS[number]))) {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' input '${id}' has invalid accepted content kinds.`);
		}
		validateItemRange(input.minItems, input.maxItems, `${recipeId}.input.${id}`);
		maximumItems += Number(input.maxItems);
	}
	if (maximumItems > 64) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' can bind no more than 64 inputs in total.`);
	}
}

function validateRecipeParameters(recipeId: string, values: readonly unknown[]): void {
	if (values.length > 32) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' has too many parameters.`);
	}
	const ids = new Set<string>();
	for (const [index, value] of values.entries()) {
		const parameter = manifestRecord(value, `${recipeId}.parameters[${index}]`);
		const id = localManifestId(parameter.id, `${recipeId}.parameter`, ids);
		boundedManifestText(parameter.label, `${recipeId}.parameter.${id}.label`, 80);
		if (parameter.required !== undefined && typeof parameter.required !== 'boolean') {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has invalid required state.`);
		}
		switch (parameter.type) {
			case 'string':
			case 'multiline':
				validateStringParameter(recipeId, id, parameter);
				break;
			case 'number':
				validateNumberParameter(recipeId, id, parameter);
				break;
			case 'boolean':
				assertOnlyManifestKeys(parameter, ['id', 'label', 'required', 'type', 'default'], `${recipeId}.parameter.${id}`);
				if (parameter.default !== undefined && typeof parameter.default !== 'boolean') {
					throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has an invalid boolean default.`);
				}
				break;
			case 'enum':
				validateEnumParameter(recipeId, id, parameter);
				break;
			default:
				throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has an invalid type.`);
		}
	}
}

function validateStringParameter(recipeId: string, id: string, parameter: Record<string, unknown>): void {
	assertOnlyManifestKeys(parameter, ['id', 'label', 'required', 'type', 'default', 'minLength', 'maxLength'], `${recipeId}.parameter.${id}`);
	const minimum = optionalManifestInteger(parameter.minLength, `${recipeId}.parameter.${id}.minLength`, 0, 100_000);
	const maximum = optionalManifestInteger(parameter.maxLength, `${recipeId}.parameter.${id}.maxLength`, 1, 100_000);
	if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has an invalid length range.`);
	}
	if (parameter.default !== undefined) {
		const defaultValue = boundedManifestText(parameter.default, `${recipeId}.parameter.${id}.default`, maximum ?? 100_000, true);
		if (minimum !== undefined && defaultValue.length < minimum) {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' default is shorter than minLength.`);
		}
	}
}

function validateNumberParameter(recipeId: string, id: string, parameter: Record<string, unknown>): void {
	assertOnlyManifestKeys(parameter, ['id', 'label', 'required', 'type', 'default', 'minimum', 'maximum', 'step'], `${recipeId}.parameter.${id}`);
	const minimum = optionalFiniteManifestNumber(parameter.minimum, `${recipeId}.parameter.${id}.minimum`);
	const maximum = optionalFiniteManifestNumber(parameter.maximum, `${recipeId}.parameter.${id}.maximum`);
	if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has an invalid number range.`);
	}
	const step = optionalFiniteManifestNumber(parameter.step, `${recipeId}.parameter.${id}.step`);
	if (step !== undefined && step <= 0) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' step must be positive.`);
	}
	const defaultValue = optionalFiniteManifestNumber(parameter.default, `${recipeId}.parameter.${id}.default`);
	if (defaultValue !== undefined && ((minimum !== undefined && defaultValue < minimum) || (maximum !== undefined && defaultValue > maximum))) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' default is outside its range.`);
	}
}

function validateEnumParameter(recipeId: string, id: string, parameter: Record<string, unknown>): void {
	assertOnlyManifestKeys(parameter, ['id', 'label', 'required', 'type', 'default', 'options'], `${recipeId}.parameter.${id}`);
	const options = contributionArray(parameter.options, `${recipeId}.parameter.${id}.options`, true);
	if (options.length > 50) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has too many enum options.`);
	}
	const values = new Set<string>();
	for (const [index, value] of options.entries()) {
		const option = manifestRecord(value, `${recipeId}.parameter.${id}.options[${index}]`);
		assertOnlyManifestKeys(option, ['value', 'label'], `${recipeId}.parameter.${id}.options[${index}]`);
		const optionValue = boundedManifestText(option.value, `${recipeId}.parameter.${id}.option.value`, 100);
		boundedManifestText(option.label, `${recipeId}.parameter.${id}.option.label`, 100);
		if (values.has(optionValue)) {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' has duplicate enum value '${optionValue}'.`);
		}
		values.add(optionValue);
	}
	if (parameter.default !== undefined && (typeof parameter.default !== 'string' || !values.has(parameter.default))) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' parameter '${id}' default is not an enum option.`);
	}
}

function validateRecipeOutputs(recipeId: string, values: readonly unknown[]): void {
	if (values.length > 8) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' must declare between 1 and 8 outputs.`);
	}
	const ids = new Set<string>();
	let primary: Record<string, unknown> | undefined;
	let maximumItems = 0;
	for (const [index, value] of values.entries()) {
		const output = manifestRecord(value, `${recipeId}.outputs[${index}]`);
		assertOnlyManifestKeys(output, ['id', 'kind', 'extensions', 'minItems', 'maxItems', 'primary'], `${recipeId}.outputs[${index}]`);
		const id = localManifestId(output.id, `${recipeId}.output`, ids);
		if (!OUTPUT_CONTENT_KINDS.includes(output.kind as typeof OUTPUT_CONTENT_KINDS[number])) {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' output '${id}' has an invalid content kind.`);
		}
		const extensions = contributionArray(output.extensions, `${recipeId}.output.${id}.extensions`, true);
		if (extensions.length > 16 || new Set(extensions.map(extension => String(extension).toLowerCase())).size !== extensions.length || extensions.some(extension => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]{0,15}$/i.test(extension))) {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' output '${id}' has invalid file extensions.`);
		}
		validateItemRange(output.minItems, output.maxItems, `${recipeId}.output.${id}`);
		maximumItems += Number(output.maxItems);
		if (output.primary !== undefined && typeof output.primary !== 'boolean') {
			throw new Error(`Reviewed plugin canvas recipe '${recipeId}' output '${id}' has invalid primary state.`);
		}
		if (output.primary === true) {
			if (primary) {
				throw new Error(`Reviewed plugin canvas recipe '${recipeId}' must declare exactly one primary output.`);
			}
			primary = output;
		}
	}
	if (!primary) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' must declare exactly one primary output.`);
	}
	if (maximumItems > 64) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' can produce no more than 64 artifacts in total.`);
	}
	if (primary.minItems !== 1 || primary.maxItems !== 1) {
		throw new Error(`Reviewed plugin canvas recipe '${recipeId}' primary output must produce exactly one artifact.`);
	}
}

function validateTemplates(
	values: readonly unknown[],
	extensionId: string,
	files: ReadonlySet<string>,
	templateResources: ReadonlyMap<string, Buffer>,
	recipes: ReadonlyMap<string, Record<string, unknown>>
): void {
	if (values.length > MAX_TEMPLATE_RESOURCES) {
		throw new Error('Reviewed plugin declares too many canvas templates.');
	}
	const ids = new Set<string>();
	for (const [index, value] of values.entries()) {
		const template = manifestRecord(value, `basehalfCanvasTemplates[${index}]`);
		assertOnlyManifestKeys(template, ['id', 'label', 'description', 'resource'], `basehalfCanvasTemplates[${index}]`);
		const id = ownedContributionId(template.id, extensionId, ids, 'canvas template');
		boundedManifestText(template.label, `${id}.label`, 80);
		optionalBoundedManifestText(template.description, `${id}.description`, 500);
		const resource = packageRelativePath(boundedManifestText(template.resource, `${id}.resource`, 500), `${id}.resource`);
		const archivePath = `extension/${resource}`;
		if (!resource.toLowerCase().endsWith('.json') || !files.has(archivePath)) {
			throw new Error(`Reviewed plugin canvas template '${id}' resource '${resource}' is missing from the VSIX, has different casing, or is not JSON.`);
		}
		const bytes = templateResources.get(archivePath);
		if (!bytes) {
			throw new Error(`Reviewed plugin canvas template '${id}' resource '${resource}' was not inspected.`);
		}
		validateCanvasTemplate(bytes, id, recipes);
	}
}

function validateAgentCapabilities(values: readonly unknown[], extensionId: string, commands: ReadonlySet<string>): void {
	if (values.length > 32) {
		throw new Error('Reviewed plugin declares too many Agent capabilities.');
	}
	const capabilityIds = new Set<string>();
	const operationIds = new Set<string>();
	for (const [index, value] of values.entries()) {
		const capability = manifestRecord(value, `basehalfAgentCapabilities[${index}]`);
		assertOnlyManifestKeys(capability, ['id', 'label', 'description', 'documents', 'operations'], `basehalfAgentCapabilities[${index}]`);
		if (Buffer.byteLength(JSON.stringify(capability), 'utf8') > 64 * 1024) {
			throw new Error('Reviewed plugin Agent capability exceeds 65536 UTF-8 bytes.');
		}
		const id = ownedContributionId(capability.id, extensionId, capabilityIds, 'Agent capability');
		boundedManifestText(capability.label, `${id}.label`, 80);
		optionalBoundedManifestText(capability.description, `${id}.description`, 500);
		const documents = contributionArray(capability.documents, `${id}.documents`);
		const operations = contributionArray(capability.operations, `${id}.operations`);
		if (documents.length === 0 && operations.length === 0) {
			throw new Error(`Reviewed plugin Agent capability '${id}' must declare a document or operation.`);
		}
		validateAgentDocuments(documents, extensionId, id);
		validateAgentOperations(operations, extensionId, id, commands, operationIds);
	}
}

function validateAgentDocuments(values: readonly unknown[], extensionId: string, capabilityId: string): void {
	if (values.length > 16) {
		throw new Error(`Reviewed plugin Agent capability '${capabilityId}' declares too many documents.`);
	}
	const kinds = new Set<string>();
	for (const [index, value] of values.entries()) {
		const document = manifestRecord(value, `${capabilityId}.documents[${index}]`);
		assertOnlyManifestKeys(document, ['kind', 'version', 'fileExtensions', 'schemaSummary', 'pin'], `${capabilityId}.documents[${index}]`);
		const kind = ownedContributionId(document.kind, extensionId, kinds, 'Agent document kind');
		manifestInteger(document.version, `${kind}.version`, 1, 1_000_000);
		const extensions = contributionArray(document.fileExtensions, `${kind}.fileExtensions`, true);
		if (extensions.length > 16 || new Set(extensions.map(entry => String(entry).toLowerCase())).size !== extensions.length || extensions.some(entry => typeof entry !== 'string' || !/^\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(entry))) {
			throw new Error(`Reviewed plugin Agent document '${kind}' has invalid file extensions.`);
		}
		boundedManifestText(document.schemaSummary, `${kind}.schemaSummary`, 2_000);
		if (document.pin !== undefined) {
			const pin = manifestRecord(document.pin, `${kind}.pin`);
			assertOnlyManifestKeys(pin, ['mode', 'field', 'targetKinds', 'acceptedVersionStates', 'updatePolicy'], `${kind}.pin`);
			const field = boundedManifestText(pin.field, `${kind}.pin.field`, 200);
			if (pin.mode !== 'exact-result-version' || pin.updatePolicy !== 'explicit' || !/^[A-Za-z][A-Za-z0-9_-]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_-]*(?:\[\])?)*$/.test(field)) {
				throw new Error(`Reviewed plugin Agent document '${kind}' has invalid exact-version pin semantics.`);
			}
			validateAgentEnumValues(pin.targetKinds, OUTPUT_CONTENT_KINDS, `${kind}.pin.targetKinds`);
			validateAgentEnumValues(pin.acceptedVersionStates, ['succeeded', 'imported'] as const, `${kind}.pin.acceptedVersionStates`);
		}
	}
}

function validateAgentOperations(values: readonly unknown[], extensionId: string, capabilityId: string, commands: ReadonlySet<string>, operationIds: Set<string>): void {
	if (values.length > 64) {
		throw new Error(`Reviewed plugin Agent capability '${capabilityId}' declares too many operations.`);
	}
	const publishedCommands = new Set<string>();
	for (const [index, value] of values.entries()) {
		const operation = manifestRecord(value, `${capabilityId}.operations[${index}]`);
		assertOnlyManifestKeys(operation, ['id', 'command', 'description', 'deterministic', 'parameters', 'returns'], `${capabilityId}.operations[${index}]`);
		const id = ownedContributionId(operation.id, extensionId, operationIds, 'Agent operation');
		const command = ownedCommandId(operation.command, extensionId, `${id}.command`);
		if (!commands.has(command) || publishedCommands.has(command)) {
			throw new Error(`Reviewed plugin Agent operation '${id}' must reference one unique declared command.`);
		}
		publishedCommands.add(command);
		if (operation.deterministic !== true) {
			throw new Error(`Reviewed plugin Agent operation '${id}' must be deterministic.`);
		}
		boundedManifestText(operation.description, `${id}.description`, 500);
		const parameters = contributionArray(operation.parameters, `${id}.parameters`);
		if (parameters.length > 32) {
			throw new Error(`Reviewed plugin Agent operation '${id}' declares too many parameters.`);
		}
		const names = new Set<string>();
		for (const [parameterIndex, parameterValue] of parameters.entries()) {
			const parameter = manifestRecord(parameterValue, `${id}.parameters[${parameterIndex}]`);
			assertOnlyManifestKeys(parameter, ['name', 'type', 'required', 'description', 'values'], `${id}.parameters[${parameterIndex}]`);
			const name = boundedManifestText(parameter.name, `${id}.parameters[${parameterIndex}].name`, 64);
			if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(name) || names.has(name) || !['uri', 'string', 'integer', 'number', 'boolean', 'enum'].includes(String(parameter.type)) || typeof parameter.required !== 'boolean') {
				throw new Error(`Reviewed plugin Agent operation '${id}' has an invalid parameter '${name}'.`);
			}
			names.add(name);
			boundedManifestText(parameter.description, `${id}.parameters.${name}.description`, 300);
			if (parameter.type === 'enum') {
				const choices = contributionArray(parameter.values, `${id}.parameters.${name}.values`, true);
				if (choices.length > 32 || new Set(choices).size !== choices.length || choices.some(choice => typeof choice !== 'string' || !choice.trim() || choice.length > 100)) {
					throw new Error(`Reviewed plugin Agent operation '${id}' parameter '${name}' has invalid values.`);
				}
			} else if (parameter.values !== undefined) {
				throw new Error(`Reviewed plugin Agent operation '${id}' parameter '${name}' cannot declare values.`);
			}
		}
		const returns = manifestRecord(operation.returns, `${id}.returns`);
		assertOnlyManifestKeys(returns, ['type', 'description'], `${id}.returns`);
		if (!['object', 'array', 'string', 'number', 'boolean', 'void'].includes(String(returns.type))) {
			throw new Error(`Reviewed plugin Agent operation '${id}' has an invalid return type.`);
		}
		boundedManifestText(returns.description, `${id}.returns.description`, 500);
	}
}

function validateAgentEnumValues<const T extends readonly string[]>(value: unknown, allowed: T, field: string): void {
	const entries = contributionArray(value, field, true);
	if (entries.length > allowed.length || new Set(entries).size !== entries.length || entries.some(entry => typeof entry !== 'string' || !allowed.includes(entry))) {
		throw new Error(`Reviewed plugin ${field} contains invalid or duplicate values.`);
	}
}

function declaredTemplateArchivePaths(manifest: any): ReadonlySet<string> {
	const templates = manifest?.contributes?.basehalfCanvasTemplates;
	if (templates === undefined) {
		return new Set();
	}
	if (!Array.isArray(templates) || templates.length > MAX_TEMPLATE_RESOURCES) {
		throw new Error('Reviewed plugin contribution \'basehalfCanvasTemplates\' is invalid.');
	}
	const result = new Set<string>();
	for (const [index, value] of templates.entries()) {
		if (!isManifestRecord(value) || typeof value.resource !== 'string') {
			continue;
		}
		const resource = packageRelativePath(value.resource, `basehalfCanvasTemplates[${index}].resource`);
		result.add(`extension/${resource}`);
	}
	return result;
}

function readVsixEntries(vsixPath: string, wanted: ReadonlySet<string>, maximumBytes: number): Promise<ReadonlyMap<string, Buffer>> {
	if (wanted.size === 0) {
		return Promise.resolve(new Map());
	}
	return new Promise((resolve, reject) => {
		yauzl.open(vsixPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
			if (openError || !zip) {
				reject(openError ?? new Error('Could not reopen VSIX.'));
				return;
			}
			let settled = false;
			const result = new Map<string, Buffer>();
			const fail = (error: unknown) => {
				if (!settled) {
					settled = true;
					zip.close();
					reject(error);
				}
			};
			zip.on('error', fail);
			zip.on('end', () => {
				if (!settled) {
					settled = true;
					resolve(result);
				}
			});
				zip.on('entry', entry => {
					if (!wanted.has(entry.fileName)) {
						zip.readEntry();
						return;
					}
					if (!safeVsixEntryName(entry.fileName) || !isVsixRegularFile(entry) || isVsixEncrypted(entry)) {
						fail(new Error(`VSIX contains unsafe entry '${entry.fileName}'.`));
						return;
					}
					readVsixEntry(zip, entry, maximumBytes).then(bytes => {
					result.set(entry.fileName, bytes);
					zip.readEntry();
				}, fail);
			});
			zip.readEntry();
		});
	});
}

function validateCanvasTemplate(bytes: Buffer, templateId: string, recipes: ReadonlyMap<string, Record<string, unknown>>): void {
	if (bytes.byteLength > MAX_TEMPLATE_BYTES) {
		throw new Error(`Reviewed plugin canvas template '${templateId}' exceeds ${MAX_TEMPLATE_BYTES} bytes.`);
	}
	let value: unknown;
	try {
		const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		value = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
	} catch {
		throw new Error(`Reviewed plugin canvas template '${templateId}' is not valid UTF-8 JSON.`);
	}
	const root = manifestRecord(value, `${templateId} template`);
	assertOnlyManifestKeys(root, ['version', 'files', 'nodes', 'cards', 'references'], `${templateId} template`);
	if (root.version !== 1) {
		throw new Error(`Reviewed plugin canvas template '${templateId}' has an unsupported version.`);
	}
	const files = templateArray(root.files, `${templateId}.files`).map((value, index) => parseTemplateFile(value, `${templateId}.files[${index}]`));
	const nodes = templateArray(root.nodes, `${templateId}.nodes`).map((value, index) => parseTemplateNode(value, `${templateId}.nodes[${index}]`));
	const cards = templateArray(root.cards, `${templateId}.cards`).map((value, index) => parseTemplateCard(value, `${templateId}.cards[${index}]`));
	const references = templateArray(root.references, `${templateId}.references`).map((value, index) => parseTemplateReference(value, `${templateId}.references[${index}]`));
	if (files.length + nodes.length === 0) {
		throw new Error(`Reviewed plugin canvas template '${templateId}' does not create any resources.`);
	}
	const resources = [...files, ...nodes];
	assertUniqueInsensitive(resources.map(resource => resource.path), `${templateId} resource paths`);
	assertNoPathPrefixConflicts(resources.map(resource => resource.path), `${templateId} resource paths`);
	const resourceByPath = new Map(resources.map(resource => [resource.path, resource]));
	const totalTextBytes = files.reduce((total, file) => total + Buffer.byteLength(file.contents, 'utf8'), 0);
	if (totalTextBytes > MAX_TEMPLATE_TEXT_BYTES) {
		throw new Error(`Reviewed plugin canvas template '${templateId}' contains too much text content.`);
	}

	assertUniqueInsensitive(cards.map(card => card.path), `${templateId} card paths`);
	for (const card of cards) {
		if (!resourceByPath.has(card.path)) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' has a card for missing resource '${card.path}'.`);
		}
	}
	assertUniqueInsensitive(references.map(reference => `${reference.from}\0${reference.to}`), `${templateId} references`);
	const referencePairs = new Set<string>();
	for (const reference of references) {
		if (!resourceByPath.has(reference.from) || !resourceByPath.has(reference.to) || reference.from === reference.to) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' has an invalid reference from '${reference.from}' to '${reference.to}'.`);
		}
		referencePairs.add(`${reference.from}\0${reference.to}`);
	}

	for (const node of nodes) {
		const nodeRecipe = node.recipe;
		if (!nodeRecipe) {
			continue;
		}
		const recipe = recipes.get(nodeRecipe.recipeId);
		if (!recipe) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' uses undeclared recipe '${nodeRecipe.recipeId}'.`);
		}
		const outputs = contributionArray(recipe.outputs, `${nodeRecipe.recipeId}.outputs`, true).map(value => manifestRecord(value, `${nodeRecipe.recipeId}.outputs[]`));
		const primary = outputs.find(output => output.primary === true)!;
		if (primary.kind !== node.kind) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' node '${node.path}' does not match recipe '${nodeRecipe.recipeId}' primary output.`);
		}
		validateTemplateParameters(nodeRecipe.parameters, recipe, nodeRecipe.recipeId);
		validateTemplateBindings({ path: node.path, recipe: nodeRecipe }, resourceByPath, recipe, referencePairs, templateId);
	}
}

function parseTemplateFile(value: unknown, field: string): { path: string; contents: string; kind: string } {
	const file = manifestRecord(value, field);
	assertOnlyManifestKeys(file, ['path', 'contents'], field);
	const projectPath = templateProjectPath(file.path, `${field}.path`);
	if (projectPath.toLowerCase().endsWith('.bhnode')) {
		throw new Error(`Reviewed plugin ${field}.path uses the reserved .bhnode extension.`);
	}
	const contents = boundedManifestText(file.contents, `${field}.contents`, MAX_TEMPLATE_TEXT_FILE_BYTES, true);
	if (Buffer.byteLength(contents, 'utf8') > MAX_TEMPLATE_TEXT_FILE_BYTES) {
		throw new Error(`Reviewed plugin ${field}.contents exceeds ${MAX_TEMPLATE_TEXT_FILE_BYTES} bytes.`);
	}
	return { path: projectPath, contents, kind: templateContentKind(projectPath) };
}

function parseTemplateNode(value: unknown, field: string): { path: string; kind: string; recipe?: { recipeId: string; parameters: Record<string, unknown>; inputBindings: { sourcePath: string; slot: string; order: number }[] } } {
	const node = manifestRecord(value, field);
	assertOnlyManifestKeys(node, ['path', 'kind', 'title', 'role', 'recipe'], field);
	const projectPath = templateProjectPath(node.path, `${field}.path`);
	if (!projectPath.toLowerCase().endsWith('.bhnode')) {
		throw new Error(`Reviewed plugin ${field}.path must use the .bhnode extension.`);
	}
	if (typeof node.kind !== 'string' || !OUTPUT_CONTENT_KINDS.includes(node.kind as typeof OUTPUT_CONTENT_KINDS[number])) {
		throw new Error(`Reviewed plugin ${field}.kind is invalid.`);
	}
	boundedManifestText(node.title, `${field}.title`, 240);
	boundedManifestText(node.role, `${field}.role`, 120);
	return {
		path: projectPath,
		kind: node.kind,
		...(node.recipe === undefined ? {} : { recipe: parseTemplateRecipe(node.recipe, `${field}.recipe`) })
	};
}

function parseTemplateRecipe(value: unknown, field: string): { recipeId: string; parameters: Record<string, unknown>; inputBindings: { sourcePath: string; slot: string; order: number }[] } {
	const recipe = manifestRecord(value, field);
	assertOnlyManifestKeys(recipe, ['recipeId', 'parameters', 'inputBindings'], field);
	const recipeId = requiredManifestText(recipe.recipeId, `${field}.recipeId`);
	if (recipeId !== recipeId.toLowerCase() || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(recipeId)) {
		throw new Error(`Reviewed plugin ${field}.recipeId is invalid.`);
	}
	const parameters = manifestRecord(recipe.parameters, `${field}.parameters`);
	const budget = { remaining: MAX_TEMPLATE_PARAMETER_VALUES };
	validateTemplateJsonObject(parameters, `${field}.parameters`, 0, budget);
	const inputBindings = templateArray(recipe.inputBindings, `${field}.inputBindings`).map((value, index) => {
		const bindingField = `${field}.inputBindings[${index}]`;
		const binding = manifestRecord(value, bindingField);
		assertOnlyManifestKeys(binding, ['sourcePath', 'slot', 'order'], bindingField);
		return {
			sourcePath: templateProjectPath(binding.sourcePath, `${bindingField}.sourcePath`),
			slot: boundedManifestText(binding.slot, `${bindingField}.slot`, 120),
			order: manifestInteger(binding.order, `${bindingField}.order`, 0, 63)
		};
	});
	assertUniqueInsensitive(inputBindings.map(binding => String(binding.order)), `${field} binding order`);
	assertUniqueInsensitive(inputBindings.map(binding => `${binding.sourcePath}\0${binding.slot}`), `${field} binding source and slot`);
	assertUniqueInsensitive(inputBindings.map(binding => binding.sourcePath), `${field} binding source`);
	return { recipeId, parameters, inputBindings };
}

function parseTemplateCard(value: unknown, field: string): { path: string } {
	const card = manifestRecord(value, field);
	assertOnlyManifestKeys(card, ['path', 'x', 'y', 'width', 'height'], field);
	finiteTemplateNumber(card.x, `${field}.x`, -1_000_000, 1_000_000);
	finiteTemplateNumber(card.y, `${field}.y`, -1_000_000, 1_000_000);
	finiteTemplateNumber(card.width, `${field}.width`, 140, 2400);
	finiteTemplateNumber(card.height, `${field}.height`, 48, 1800);
	return { path: templateProjectPath(card.path, `${field}.path`) };
}

function parseTemplateReference(value: unknown, field: string): { from: string; to: string } {
	const reference = manifestRecord(value, field);
	assertOnlyManifestKeys(reference, ['from', 'to', 'fromAnchor', 'toAnchor'], field);
	for (const anchor of ['fromAnchor', 'toAnchor'] as const) {
		if (typeof reference[anchor] !== 'string' || !['north', 'east', 'south', 'west'].includes(reference[anchor])) {
			throw new Error(`Reviewed plugin ${field}.${anchor} is invalid.`);
		}
	}
	return {
		from: templateProjectPath(reference.from, `${field}.from`),
		to: templateProjectPath(reference.to, `${field}.to`)
	};
}

function validateTemplateParameters(values: Record<string, unknown>, recipe: Record<string, unknown>, recipeId: string): void {
	const definitions = new Map(contributionArray(recipe.parameters, `${recipeId}.parameters`).map(value => {
		const parameter = manifestRecord(value, `${recipeId}.parameters[]`);
		return [String(parameter.id), parameter] as const;
	}));
	for (const key of Object.keys(values)) {
		if (!definitions.has(key)) {
			throw new Error(`Reviewed plugin canvas template sets undeclared parameter '${key}' for recipe '${recipeId}'.`);
		}
	}
	for (const [id, parameter] of definitions) {
		const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : parameter.default;
		if (value === undefined) {
			if (parameter.required === true) {
				throw new Error(`Reviewed plugin canvas template omits required parameter '${id}' for recipe '${recipeId}'.`);
			}
			continue;
		}
		validateTemplateParameterValue(value, parameter, recipeId, id);
	}
}

function validateTemplateParameterValue(value: unknown, parameter: Record<string, unknown>, recipeId: string, id: string): void {
	switch (parameter.type) {
		case 'string':
		case 'multiline':
			if (typeof value !== 'string' || (typeof parameter.minLength === 'number' && value.length < parameter.minLength) || (typeof parameter.maxLength === 'number' && value.length > parameter.maxLength)) {
				throw new Error(`Reviewed plugin canvas template parameter '${id}' is invalid for recipe '${recipeId}'.`);
			}
			return;
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value) || (typeof parameter.minimum === 'number' && value < parameter.minimum) || (typeof parameter.maximum === 'number' && value > parameter.maximum)) {
				throw new Error(`Reviewed plugin canvas template parameter '${id}' is invalid for recipe '${recipeId}'.`);
			}
			return;
		case 'boolean':
			if (typeof value !== 'boolean') {
				throw new Error(`Reviewed plugin canvas template parameter '${id}' is invalid for recipe '${recipeId}'.`);
			}
			return;
		case 'enum': {
			const options = contributionArray(parameter.options, `${recipeId}.${id}.options`, true).map(option => manifestRecord(option, `${recipeId}.${id}.options[]`).value);
			if (typeof value !== 'string' || !options.includes(value)) {
				throw new Error(`Reviewed plugin canvas template parameter '${id}' is invalid for recipe '${recipeId}'.`);
			}
		}
	}
}

function validateTemplateBindings(
	node: { path: string; recipe: { recipeId: string; inputBindings: { sourcePath: string; slot: string; order: number }[] } },
	resources: ReadonlyMap<string, { path: string; kind: string }>,
	recipe: Record<string, unknown>,
	referencePairs: ReadonlySet<string>,
	templateId: string
): void {
	const slots = new Map(contributionArray(recipe.inputs, `${node.recipe.recipeId}.inputs`).map(value => {
		const slot = manifestRecord(value, `${node.recipe.recipeId}.inputs[]`);
		return [String(slot.id), slot] as const;
	}));
	for (const binding of node.recipe.inputBindings) {
		const source = resources.get(binding.sourcePath);
		const slot = slots.get(binding.slot);
		if (!source || !slot) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' has an invalid input binding for '${node.path}'.`);
		}
		const accepts = contributionArray(slot.accepts, `${node.recipe.recipeId}.${binding.slot}.accepts`, true);
		if (!accepts.includes(source.kind)) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' binds incompatible resource '${source.path}' to '${binding.slot}'.`);
		}
		if (!referencePairs.has(`${binding.sourcePath}\0${node.path}`)) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' binds '${binding.sourcePath}' without a direct reference to '${node.path}'.`);
		}
	}
	for (const [slotId, slot] of slots) {
		const count = node.recipe.inputBindings.filter(binding => binding.slot === slotId).length;
		if (count < Number(slot.minItems) || count > Number(slot.maxItems)) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' has ${count} inputs for '${slotId}', outside the recipe range.`);
		}
	}
	const boundSources = new Set(node.recipe.inputBindings.map(binding => binding.sourcePath));
	for (const pair of referencePairs) {
		const [source = '', target = ''] = pair.split('\0');
		if (target === node.path && !boundSources.has(source)) {
			throw new Error(`Reviewed plugin canvas template '${templateId}' has a direct reference from '${source}' to '${node.path}' without an input binding.`);
		}
	}
}

function validateTemplateJsonObject(value: Record<string, unknown>, field: string, depth: number, budget: { remaining: number }): void {
	if (depth > MAX_TEMPLATE_PARAMETER_DEPTH) {
		throw new Error(`Reviewed plugin ${field} exceeds the parameter nesting limit.`);
	}
	for (const [key, entry] of Object.entries(value)) {
		if (!key || key.length > 128 || key === '__proto__' || key === 'constructor' || key === 'prototype') {
			throw new Error(`Reviewed plugin ${field} contains an invalid parameter name.`);
		}
		validateTemplateJsonValue(entry, `${field}.${key}`, depth + 1, budget);
	}
}

function validateTemplateJsonValue(value: unknown, field: string, depth: number, budget: { remaining: number }): void {
	budget.remaining--;
	if (budget.remaining < 0 || depth > MAX_TEMPLATE_PARAMETER_DEPTH) {
		throw new Error(`Reviewed plugin ${field} exceeds the parameter complexity limit.`);
	}
	if (value === null || typeof value === 'boolean') {
		return;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new Error(`Reviewed plugin ${field} must be finite.`);
		}
		return;
	}
	if (typeof value === 'string') {
		if (value.length > 16 * 1024 || value.includes('\0')) {
			throw new Error(`Reviewed plugin ${field} contains invalid text.`);
		}
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_TEMPLATE_PARAMETER_VALUES) {
			throw new Error(`Reviewed plugin ${field} is too complex.`);
		}
		for (const [index, entry] of value.entries()) {
			validateTemplateJsonValue(entry, `${field}[${index}]`, depth + 1, budget);
		}
		return;
	}
	validateTemplateJsonObject(manifestRecord(value, field), field, depth, budget);
}

function templateArray(value: unknown, field: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > MAX_TEMPLATE_ENTRIES) {
		throw new Error(`Reviewed plugin ${field} must contain no more than ${MAX_TEMPLATE_ENTRIES} entries.`);
	}
	return value;
}

function templateProjectPath(value: unknown, field: string): string {
	const result = boundedManifestText(value, field, 1024);
	if (!safePortableRelativePath(result, true)) {
		throw new Error(`Reviewed plugin ${field} contains a reserved or unsafe path segment.`);
	}
	return result;
}

function templateContentKind(value: string): string {
	const extension = path.posix.extname(value).toLowerCase();
	if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(extension)) {
		return 'image';
	}
	if (['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'].includes(extension)) {
		return 'video';
	}
	if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) {
		return 'audio';
	}
	if (extension === '.pdf') {
		return 'pdf';
	}
	if (['.ppt', '.pptx', '.key'].includes(extension)) {
		return 'presentation';
	}
	if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.css', '.html', '.sh'].includes(extension)) {
		return 'code';
	}
	if (['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv'].includes(extension)) {
		return 'text';
	}
	return 'file';
}

function assertUniqueInsensitive(values: readonly string[], field: string): void {
	const normalized = values.map(value => value.toLowerCase());
	if (new Set(normalized).size !== normalized.length) {
		throw new Error(`Reviewed plugin ${field} must not contain duplicates.`);
	}
}

function assertNoPathPrefixConflicts(values: readonly string[], field: string): void {
	const canonical = new Set(values.map(value => value.toLowerCase()));
	for (const current of canonical) {
		let separator = current.indexOf('/');
		while (separator >= 0) {
			if (canonical.has(current.slice(0, separator))) {
				throw new Error(`Reviewed plugin ${field} must not contain a resource and one of its descendants.`);
			}
			separator = current.indexOf('/', separator + 1);
		}
	}
}

function finiteTemplateNumber(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`Reviewed plugin ${field} must be a finite number from ${minimum} to ${maximum}.`);
	}
	return value;
}

function validateHttpsRepository(value: unknown): void {
	const candidate = typeof value === 'string' ? value.trim() : isManifestRecord(value) ? String(value.url ?? '').trim() : '';
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'https:' || !url.hostname) {
			throw new Error('invalid');
		}
	} catch {
		throw new Error('Reviewed plugin repository must be an absolute HTTPS URL.');
	}
}

function contributionArray(value: unknown, field: string, requireItems = false): readonly unknown[] {
	if (value === undefined && !requireItems) {
		return [];
	}
	if (!Array.isArray(value) || (requireItems && value.length === 0)) {
		throw new Error(`Reviewed plugin contribution '${field}' must be ${requireItems ? 'a non-empty' : 'an'} array.`);
	}
	return value;
}

function manifestRecord(value: unknown, field: string): Record<string, unknown> {
	if (!isManifestRecord(value)) {
		throw new Error(`Reviewed plugin ${field} must be an object.`);
	}
	return value;
}

function isManifestRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyManifestKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
	if (unexpected.length > 0) {
		throw new Error(`Reviewed plugin ${field} contains unsupported fields: ${unexpected.sort().join(', ')}.`);
	}
}

function ownedCommandId(value: unknown, extensionId: string, field: string): string {
	const declared = requiredManifestText(value, field);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(declared) || !declared.toLowerCase().startsWith(`${extensionId}.`)) {
		throw new Error(`Reviewed plugin command '${declared}' is not owned by '${extensionId}'.`);
	}
	return declared;
}

function ownedContributionId(value: unknown, extensionId: string, seen: Set<string>, kind: string): string {
	const declared = requiredManifestText(value, kind);
	const id = declared.toLowerCase();
	if (declared !== id || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(id) || !id.startsWith(`${extensionId}.`) || seen.has(id)) {
		throw new Error(`Reviewed plugin ${kind} '${id}' is not uniquely owned by '${extensionId}'.`);
	}
	seen.add(id);
	return id;
}

function localManifestId(value: unknown, field: string, seen: Set<string>): string {
	const declared = requiredManifestText(value, field);
	const id = declared.toLowerCase();
	if (declared !== id || !/^[a-z][a-z0-9-]{0,63}$/.test(id) || seen.has(id)) {
		throw new Error(`Reviewed plugin canvas ${field} id '${id}' is invalid or duplicated.`);
	}
	seen.add(id);
	return id;
}

function boundedManifestText(value: unknown, field: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== 'string') {
		throw new Error(`Reviewed plugin manifest is missing ${field}.`);
	}
	const result = allowEmpty ? value : value.trim();
	if ((!allowEmpty && !result) || result.length > maximum || result.includes('\0')) {
		throw new Error(`Reviewed plugin manifest field '${field}' is invalid.`);
	}
	return result;
}

function optionalBoundedManifestText(value: unknown, field: string, maximum: number): string | undefined {
	return value === undefined ? undefined : boundedManifestText(value, field, maximum);
}

function validateItemRange(minimumValue: unknown, maximumValue: unknown, field: string): void {
	const minimum = manifestInteger(minimumValue, `${field}.minItems`, 0, 64);
	const maximum = manifestInteger(maximumValue, `${field}.maxItems`, 1, 64);
	if (maximum < minimum) {
		throw new Error(`Reviewed plugin canvas field '${field}' has an invalid item range.`);
	}
}

function optionalManifestInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
	return value === undefined ? undefined : manifestInteger(value, field, minimum, maximum);
}

function manifestInteger(value: unknown, field: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`Reviewed plugin manifest field '${field}' must be an integer from ${minimum} to ${maximum}.`);
	}
	return value as number;
}

function optionalFiniteManifestNumber(value: unknown, field: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Reviewed plugin manifest field '${field}' must be a finite number.`);
	}
	return value;
}

function containsControlCharacter(value: string): boolean {
	return Array.from(value).some(character => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}

function releaseJobId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) {
		throw new Error(`Reviewed release job ${field} is invalid.`);
	}
	return value;
}

function releaseJobText(value: unknown, field: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || containsControlCharacter(value)) {
		throw new Error(`Reviewed release job ${field} is invalid.`);
	}
	const result = value.trim();
	if ((!allowEmpty && !result) || result !== value) {
		throw new Error(`Reviewed release job ${field} is invalid.`);
	}
	return result;
}

function releaseJobByteSize(value: unknown): number {
	const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
	if (typeof text !== 'string' || !/^[1-9][0-9]{0,8}$/.test(text)) {
		throw new Error('Reviewed release job byte_size is invalid.');
	}
	const result = Number(text);
	if (!Number.isSafeInteger(result) || result < 1 || result > MAX_VSIX_BYTES) {
		throw new Error('Reviewed release job byte_size is invalid.');
	}
	return result;
}

function validateSubmissionDownloadUrl(value: unknown, options: {
	submissionBucket: string;
	awsRegion: string;
	submissionId: string;
	sha256: string;
}): string {
	const bucket = releaseJobText(options.submissionBucket, 'submission bucket', 63);
	if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
		throw new Error('Reviewed release job submission bucket is invalid.');
	}
	const region = releaseJobText(options.awsRegion, 'AWS region', 50);
	if (!/^[a-z]{2}(?:-gov)?-[a-z]+-[1-9][0-9]?$/.test(region)) {
		throw new Error('Reviewed release job AWS region is invalid.');
	}
	if (typeof value !== 'string' || value.length > 8_192 || containsControlCharacter(value)) {
		throw new Error('Reviewed release job download URL is invalid.');
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Reviewed release job download URL is invalid.');
	}
	const expectedOrigin = `https://${bucket}.s3.${region}.amazonaws.com`;
	const expectedPath = `/submissions/${options.submissionId}/${options.sha256}.vsix`;
	if (url.protocol !== 'https:' || url.username || url.password || url.port || url.origin !== expectedOrigin || url.pathname !== expectedPath || url.hash) {
		throw new Error('Reviewed release job download URL is outside the submission quarantine.');
	}
	if (url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256'
		|| !/^\d{8}T\d{6}Z$/.test(url.searchParams.get('X-Amz-Date') ?? '')
		|| !/^[1-9][0-9]{0,3}$/.test(url.searchParams.get('X-Amz-Expires') ?? '')
		|| Number(url.searchParams.get('X-Amz-Expires')) > 3_600
		|| !/(?:^|;)host(?:;|$)/.test(url.searchParams.get('X-Amz-SignedHeaders') ?? '')
		|| !/^[a-fA-F0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '')) {
		throw new Error('Reviewed release job download URL is not a valid signed quarantine URL.');
	}
	return value;
}

function readVsixEntry(zip: ZipFile, entry: Entry, maximumBytes: number, retain = true): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		zip.openReadStream(entry, (error, stream) => {
			if (error || !stream) {
				reject(error ?? new Error('Could not read VSIX entry.'));
				return;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			let checksum = 0;
			let settled = false;
			const fail = (reason: unknown) => {
				if (!settled) {
					settled = true;
					reject(reason);
				}
			};
			stream.on('data', chunk => {
				const bytes = Buffer.from(chunk);
				size += bytes.length;
				if (size > maximumBytes) {
					stream.destroy(new Error(`VSIX entry '${entry.fileName}' is too large.`));
					return;
				}
				checksum = crc32(bytes, checksum);
				if (retain) {
					chunks.push(bytes);
				}
			});
			stream.on('error', fail);
			stream.on('end', () => {
				if (settled) {
					return;
				}
				if ((checksum >>> 0) !== (entry.crc32 >>> 0)) {
					fail(new Error(`VSIX entry '${entry.fileName}' failed CRC validation.`));
					return;
				}
				if (size !== entry.uncompressedSize) {
					fail(new Error(`VSIX entry '${entry.fileName}' did not match its declared size.`));
					return;
				}
				settled = true;
				resolve(retain ? Buffer.concat(chunks, size) : Buffer.alloc(0));
			});
		});
	});
}

function safeVsixEntryName(name: string): boolean {
	return !!name
		&& name === name.normalize('NFC')
		&& name === name.trim()
		&& !name.includes('\\')
		&& !/[\u0000-\u001f\u007f<>:"|?*]/.test(name)
		&& !name.startsWith('/')
		&& !/^[A-Za-z]:/.test(name)
		&& name.split('/').every(segment => !!segment
			&& segment !== '.'
			&& segment !== '..'
			&& segment.length <= 255
			&& !segment.endsWith('.')
			&& !segment.endsWith(' ')
			&& segment.toLowerCase() !== '.bh'
			&& !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

function canonicalVsixEntryName(name: string): string {
	return name.normalize('NFC').toLowerCase();
}

function assertNoVsixPathPrefixConflicts(files: ReadonlySet<string>): void {
	const canonical = new Set([...files].map(canonicalVsixEntryName));
	for (const current of canonical) {
		let separator = current.indexOf('/');
		while (separator >= 0) {
			if (canonical.has(current.slice(0, separator))) {
				throw new Error('VSIX contains a file and one of its descendants.');
			}
			separator = current.indexOf('/', separator + 1);
		}
	}
}

function isVsixRegularFile(entry: Entry): boolean {
	const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
	return fileType === 0 || fileType === 0x8000;
}

function isVsixEncrypted(entry: Entry): boolean {
	return (entry.generalPurposeBitFlag & 0x1) !== 0;
}

function hasVsixFile(files: ReadonlySet<string>, wanted: string): boolean {
	const lower = wanted.toLowerCase();
	return [...files].some(file => file.toLowerCase() === lower);
}

function packageRelativePath(value: string, field: string): string {
	const normalized = value.startsWith('./') ? value.slice(2) : value;
	if (!safePortableRelativePath(normalized, true)) {
		throw new Error(`Reviewed plugin manifest ${field} path is invalid.`);
	}
	return normalized;
}

function safePortableRelativePath(value: string, reserveBaseHalfState: boolean): boolean {
	return !!value
		&& value === value.normalize('NFC')
		&& value === value.trim()
		&& value.length <= 1024
		&& !value.startsWith('/')
		&& !value.startsWith('\\')
		&& !value.includes('\\')
		&& !/[\u0000-\u001f\u007f<>:"|?*]/.test(value)
		&& !/^[A-Za-z]:/.test(value)
		&& !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
		&& value.split('/').every(segment => !!segment
			&& segment !== '.'
			&& segment !== '..'
			&& segment.length <= 255
			&& !segment.endsWith('.')
			&& !segment.endsWith(' ')
			&& (!reserveBaseHalfState || segment.toLowerCase() !== '.bh')
			&& !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

function requiredManifestText(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Reviewed plugin manifest is missing ${field}.`);
	}
	return value.trim();
}

function readBoundedFile(file: string, maximumBytes: number, label: string): Buffer {
	const stat = fs.statSync(file);
	if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > maximumBytes) {
		throw new Error(`${label} must be a file no larger than ${maximumBytes} bytes.`);
	}
	return fs.readFileSync(file);
}

async function fetchBytes(url: string, timeoutMs = 10_000, maximumBytes = MAX_VSIX_BYTES): Promise<Uint8Array> {
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
		throw new Error('Plugin release endpoints must use HTTPS, except loopback fixtures.');
	}
	const response = await fetch(parsed, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) {
		throw new Error(`Plugin release endpoint returned ${response.status}.`);
	}
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
		throw new Error(`Plugin release response exceeds ${maximumBytes} bytes.`);
	}
	if (!response.body) {
		throw new Error('Plugin release endpoint returned an empty body.');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}
			size += value.byteLength;
			if (size > maximumBytes) {
				await reader.cancel();
				throw new Error(`Plugin release response exceeds ${maximumBytes} bytes.`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
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

function validateCatalogRoot(catalog: any, options: { readonly allowLegacy?: boolean } = {}): void {
	const root = manifestRecord(catalog, 'catalog');
	assertOnlyManifestKeys(root, ['schemaVersion', 'sequence', 'generatedAt', 'plugins'], 'catalog');
	if (root.schemaVersion !== 1 || !Number.isSafeInteger(root.sequence) || (root.sequence as number) < 1) {
		throw new Error('Invalid BaseHalf plugin catalog v1 sequence.');
	}
	canonicalIsoDate(root.generatedAt, 'catalog.generatedAt');
	if (!Array.isArray(root.plugins) || root.plugins.length > 200) {
		throw new Error('BaseHalf plugin catalog must contain no more than 200 plugins.');
	}
	const extensionIds = new Set<string>();
	for (const [index, value] of root.plugins.entries()) {
		const plugin = manifestRecord(value, `catalog.plugins[${index}]`);
		assertOnlyManifestKeys(plugin, [
			'extensionId', 'label', 'description', 'category', 'primaryCommand', 'primaryCommandLabel', 'publisher', 'versions'
		], `catalog.plugins[${index}]`);
		const extensionId = requiredManifestText(plugin.extensionId, `catalog.plugins[${index}].extensionId`);
		if (extensionId !== extensionId.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId) || extensionIds.has(extensionId)) {
			throw new Error(`Plugin catalog extension id '${extensionId}' is invalid or duplicated.`);
		}
		extensionIds.add(extensionId);
		boundedManifestText(plugin.label, `${extensionId}.label`, 150);
		boundedManifestText(plugin.description, `${extensionId}.description`, 4_000);
		boundedManifestText(plugin.category, `${extensionId}.category`, 50);
		const legacyOfficial = options.allowLegacy === true && extensionId === OFFICIAL_EXTENSION_ID;
		if (!legacyOfficial || plugin.primaryCommand !== undefined || plugin.primaryCommandLabel !== undefined) {
			const primaryCommand = boundedManifestText(plugin.primaryCommand, `${extensionId}.primaryCommand`, 200);
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(primaryCommand) || !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
				throw new Error(`Plugin catalog primary command '${primaryCommand}' is not owned by '${extensionId}'.`);
			}
			boundedManifestText(plugin.primaryCommandLabel, `${extensionId}.primaryCommandLabel`, 100);
		}
		if (!legacyOfficial || plugin.publisher !== undefined) {
			validateCatalogPublisher(plugin.publisher, extensionId);
		}
		validateCatalogVersions(plugin.versions, extensionId, options);
	}
}

function validateCatalogPublisher(value: unknown, extensionId: string): void {
	const publisher = manifestRecord(value, `${extensionId}.publisher`);
	assertOnlyManifestKeys(publisher, ['slug', 'displayName', 'trust'], `${extensionId}.publisher`);
	const slug = boundedManifestText(publisher.slug, `${extensionId}.publisher.slug`, 50);
	if (slug !== slug.toLowerCase() || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) || !extensionId.startsWith(`${slug}.`)) {
		throw new Error(`Plugin catalog Publisher '${slug}' does not own '${extensionId}'.`);
	}
	boundedManifestText(publisher.displayName, `${extensionId}.publisher.displayName`, 100);
	if (publisher.trust !== 'official' && publisher.trust !== 'reviewed') {
		throw new Error(`Plugin catalog Publisher trust for '${extensionId}' is invalid.`);
	}
}

function validateCatalogVersions(value: unknown, extensionId: string, options: { readonly allowLegacy?: boolean } = {}): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > CATALOG_VERSION_LIMIT) {
		throw new Error(`Plugin catalog '${extensionId}' must contain 1-${CATALOG_VERSION_LIMIT} versions.`);
	}
	const versions = new Set<string>();
	let previousVersion: string | undefined;
	for (const [index, candidate] of value.entries()) {
		const release = manifestRecord(candidate, `${extensionId}.versions[${index}]`);
		assertOnlyManifestKeys(release, [
			'version', 'basehalfRange', 'vscodeRange', 'targetPlatform', 'assetPath', 'sha256', 'installedContentSha256', 'size', 'publishedAt', 'status', 'releaseNotes'
		], `${extensionId}.versions[${index}]`);
		assertSemver(release.version, `${extensionId} catalog version`);
		const version = release.version;
		if (versions.has(version) || (previousVersion !== undefined && compare(previousVersion, version) < 0)) {
			throw new Error(`Plugin catalog versions for '${extensionId}' are duplicated or not in descending order.`);
		}
		versions.add(version);
		previousVersion = version;
		if (!validRange(release.basehalfRange) || !validRange(release.vscodeRange)) {
			throw new Error(`Plugin catalog compatibility ranges for '${extensionId}@${version}' are invalid.`);
		}
		if (typeof release.targetPlatform !== 'string' || !TARGET_PLATFORMS.has(release.targetPlatform)) {
			throw new Error(`Plugin catalog target platform for '${extensionId}@${version}' is invalid.`);
		}
		if (typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(release.sha256)) {
			throw new Error(`Plugin catalog SHA-256 for '${extensionId}@${version}' is invalid.`);
		}
		if ((release.installedContentSha256 !== undefined || options.allowLegacy !== true)
			&& (typeof release.installedContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(release.installedContentSha256))) {
			throw new Error(`Plugin catalog installed-content SHA-256 for '${extensionId}@${version}' is invalid.`);
		}
		const expectedAssetPath = `${extensionId}/${version}/${release.sha256}.vsix`;
		if (release.assetPath !== expectedAssetPath) {
			throw new Error(`Plugin catalog asset path for '${extensionId}@${version}' must be '${expectedAssetPath}'.`);
		}
		validateAssetPath(release.assetPath);
		if (!Number.isSafeInteger(release.size) || (release.size as number) < 1 || (release.size as number) > MAX_VSIX_BYTES) {
			throw new Error(`Plugin catalog byte size for '${extensionId}@${version}' is invalid.`);
		}
		canonicalIsoDate(release.publishedAt, `${extensionId}@${version}.publishedAt`);
		if (release.status !== 'active' && release.status !== 'withdrawn') {
			throw new Error(`Plugin catalog status for '${extensionId}@${version}' is invalid.`);
		}
		if (release.releaseNotes !== undefined) {
			boundedManifestText(release.releaseNotes, `${extensionId}@${version}.releaseNotes`, 100_000);
		}
	}
}

function canonicalIsoDate(value: unknown, field: string): string {
	const result = requiredManifestText(value, field);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)) {
		throw new Error(`${field} must be a canonical UTC ISO date.`);
	}
	try {
		if (new Date(result).toISOString() !== result) {
			throw new Error('not canonical');
		}
	} catch {
		throw new Error(`${field} must be a canonical UTC ISO date.`);
	}
	return result;
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
	if (typeof value !== 'string' || valid(value) !== value) {
		throw new Error(`${label} must be canonical semantic version text without build metadata.`);
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

function readBoundedJson(file: string, maximumBytes: number, label: string): any {
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBoundedFile(file, maximumBytes, label)));
}

function writeJsonExact(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function serializeCatalogForPublication(value: unknown): string {
	const serialized = `${JSON.stringify(value, null, 2)}\n`;
	if (new TextEncoder().encode(serialized).byteLength > MAX_CATALOG_BYTES) {
		throw new Error(`Plugin catalog exceeds the ${MAX_CATALOG_BYTES}-byte client limit; refusing to publish an unreadable signed catalog.`);
	}
	return serialized;
}

function writeCatalogExact(file: string, value: unknown): void {
	const serialized = serializeCatalogForPublication(value);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, serialized, 'utf8');
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
		if (args['metadata-output']) {
			writeJsonExact(path.resolve(args['metadata-output']), metadata);
		}
		console.log(JSON.stringify(metadata));
		return;
	}
	if (command === 'job') {
		const job = validateReviewedReleaseJob(
			readBoundedJson(path.resolve(required(args, 'input')), MAX_RELEASE_JOB_BYTES, 'Release job'),
			{
				submissionBucket: required(args, 'submission-bucket'),
				awsRegion: required(args, 'aws-region')
			}
		);
		writeJsonExact(path.resolve(required(args, 'output')), job);
		console.log(JSON.stringify({ jobId: job.job_id, submissionId: job.submission_id }));
		return;
	}
	if (command === 'bootstrap-check') {
		const keys = await assertBootstrapRegistryInventory({
			inventory: readBoundedJson(path.resolve(required(args, 'inventory')), MAX_BOOTSTRAP_INVENTORY_BYTES, 'Bootstrap bucket inventory'),
			metadata: readBoundedJson(path.resolve(required(args, 'metadata')), MAX_RELEASE_METADATA_BYTES, 'Release metadata'),
			sequence: Number(required(args, 'sequence'))
		});
		console.log(JSON.stringify({ keys }));
		return;
	}
	if (command === 'metadata') {
		const job = args['release-job'] ? validateReviewedReleaseJob(
			readBoundedJson(path.resolve(args['release-job']), MAX_RELEASE_JOB_BYTES, 'Release job'),
			{
				submissionBucket: required(args, 'submission-bucket'),
				awsRegion: required(args, 'aws-region')
			}
		) : undefined;
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
	if (command === 'catalog-content-hashes') {
		const catalog = await backfillCatalogInstalledContentHashes({
			catalogPath: path.resolve(required(args, 'catalog')),
			assetBaseUrl: required(args, 'asset-base-url'),
			outputPath: path.resolve(required(args, 'output'))
		});
		console.log(JSON.stringify({ sequence: catalog.sequence, output: path.resolve(required(args, 'output')) }));
		return;
	}
	if (command === 'identity') {
		if (args.catalog) {
			if (args.metadata || args.output) {
				throw new Error('Catalog identity seeding accepts --catalog and --output-directory only.');
			}
			const outputDirectory = path.resolve(required(args, 'output-directory'));
			const identities = createReleaseIdentitiesFromCatalog({
				catalogPath: path.resolve(args.catalog),
				outputDirectory
			});
			console.log(JSON.stringify({ count: identities.length, outputDirectory }));
			return;
		}
		if (args['output-directory']) {
			throw new Error('Metadata identity creation accepts --metadata and --output only.');
		}
		const identity = await createReleaseIdentity({
			metadata: readBoundedJson(path.resolve(required(args, 'metadata')), MAX_RELEASE_METADATA_BYTES, 'Release metadata'),
			outputPath: path.resolve(required(args, 'output'))
		});
		console.log(JSON.stringify(identity));
		return;
	}
	if (command === 'catalog') {
		const metadata = readBoundedJson(path.resolve(required(args, 'metadata')), MAX_RELEASE_METADATA_BYTES, 'Release metadata');
		const catalog = await createCatalog({
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
	if (command === 'reconcile') {
		const result = await reconcileCatalogRelease({
			metadata: readBoundedJson(path.resolve(required(args, 'metadata')), MAX_RELEASE_METADATA_BYTES, 'Release metadata'),
			catalogPath: path.resolve(required(args, 'catalog')),
			basehalfRange: required(args, 'basehalf-range'),
			vscodeRange: required(args, 'vscode-range'),
			targetPlatform: required(args, 'target-platform'),
			outputPath: path.resolve(required(args, 'output'))
		});
		console.log(JSON.stringify(result));
		return;
	}
	if (command === 'candidate-check') {
		assertCatalogCandidateMatchesPublish({
			requestedCatalogPath: path.resolve(required(args, 'requested')),
			candidateCatalogPath: path.resolve(required(args, 'candidate')),
			extensionId: required(args, 'extension-id'),
			version: required(args, 'version')
		});
		console.log(JSON.stringify({ matched: true }));
		return;
	}
	if (command === 'publish-check') {
		const result = await assertCatalogReleaseMatchesPublish({
			metadata: readBoundedJson(path.resolve(required(args, 'metadata')), MAX_RELEASE_METADATA_BYTES, 'Release metadata'),
			catalogPath: path.resolve(required(args, 'catalog')),
			sequence: Number(required(args, 'sequence')),
			basehalfRange: required(args, 'basehalf-range'),
			vscodeRange: required(args, 'vscode-range'),
			targetPlatform: required(args, 'target-platform'),
			outputPath: path.resolve(required(args, 'output'))
		});
		console.log(JSON.stringify(result));
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
	if (command === 'status-check') {
		const catalog = assertCatalogStatus({
			catalogPath: path.resolve(required(args, 'catalog')),
			extensionId: args['extension-id'] ?? OFFICIAL_EXTENSION_ID,
			version: required(args, 'version'),
			mode: required(args, 'mode') as 'withdraw' | 'rollback'
		});
		console.log(JSON.stringify({ sequence: catalog.sequence, catalog: path.resolve(required(args, 'catalog')) }));
		return;
	}
	if (command === 'control') {
		const mode = required(args, 'mode');
		if (mode !== 'block' && mode !== 'restore') {
			throw new Error('Control mode must be block or restore.');
		}
		if (args['learn-more-link'] !== undefined) {
			throw new Error('Emergency extension control manifests do not support learn-more links.');
		}
		const control = updateExtensionControl({
			previousPath: args.previous ? path.resolve(args.previous) : undefined,
			outputPath: path.resolve(required(args, 'output')),
			extensionId: args['extension-id'] ?? OFFICIAL_EXTENSION_ID,
			blocked: mode === 'block'
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
	throw new Error('Usage: basehalf-plugin-release.mts package|job|bootstrap-check|metadata|catalog-content-hashes|identity|catalog|reconcile|candidate-check|publish-check|status|status-check|control|signature|index|verify [--name value ...]');
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
