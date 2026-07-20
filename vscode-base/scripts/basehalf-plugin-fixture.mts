/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import { createHash, generateKeyPairSync, sign } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { compare } from 'semver';
import yazl from 'yazl';
import { scaffoldPlugin } from '../../packages/plugin-cli/src/scaffold.ts';
import { baseHalfCanonicalInstalledFileBytes } from '../src/vs/workbench/basehalf/common/basehalfPluginInstalledContent.ts';
import { assertBootstrapRegistryInventory, assertCatalogCandidateMatchesPublish, assertCatalogReleaseMatchesPublish, assertCatalogStatus, assertReleaseIdentityMatches, backfillCatalogInstalledContentHashes, CATALOG_VERSION_LIMIT, createCatalog, createCatalogIndex, createReleaseIdentitiesFromCatalog, createReleaseIdentity, createSignatureFile, MAX_CATALOG_BYTES, metadataFromVsix, OFFICIAL_EXTENSION_ID, packagePlugin, reconcileCatalogRelease, serializeCatalogForPublication, serializeReleaseIdentity, updateCatalogStatus, updateExtensionControl, validateReleaseIdentity, validateReviewedReleaseJob, validateReviewedVsixManifest, verifyRelease } from './basehalf-plugin-release.mts';
import { validateControlPlaneBaseUrl } from './basehalf-release-preflight.mts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directPublishWorkflow = path.join(path.dirname(root), '.github', 'workflows', 'publish-plugins.yml');
const pluginInfrastructure = path.join(path.dirname(root), 'infrastructure', 'plugins', 'main.tf');
const developerToolsWorkflow = path.join(path.dirname(root), '.github', 'workflows', 'publish-plugin-developer-tools.yml');
assertWorkflowRunBlocksDoNotInterpolateInputs(directPublishWorkflow);
assertControlPlaneRequestsAreHardened(directPublishWorkflow);
assertDirectPublishReconcilesImmutableAsset(directPublishWorkflow);
assertDirectPublishFailsClosed(directPublishWorkflow);
assert.doesNotMatch(fs.readFileSync(directPublishWorkflow, 'utf8'), /--learn-more-link/);
assertCatalogKeyRotation(directPublishWorkflow);
assert.match(fs.readFileSync(pluginInfrastructure, 'utf8'), /s3:ListBucketVersions/);
assertTerraformSigningKeyRotation(
	pluginInfrastructure,
	path.join(path.dirname(pluginInfrastructure), 'variables.tf'),
	path.join(path.dirname(pluginInfrastructure), 'outputs.tf')
);
assertWorkflowRunBlocksDoNotInterpolateInputs(developerToolsWorkflow);
assertCatalogStateFollowsCdnVerification(directPublishWorkflow);
assertDeveloperToolPublishIsResumable(developerToolsWorkflow);
const reviewedPromotionWorkflow = path.join(path.dirname(root), '.github', 'workflows', 'promote-reviewed-plugin.yml');
assertWorkflowRunBlocksDoNotInterpolateInputs(reviewedPromotionWorkflow);
assertControlPlaneRequestsAreHardened(reviewedPromotionWorkflow);
assertReviewedPromotionConvergesAfterCatalogSwitch(reviewedPromotionWorkflow);
assertReviewedPromotionPreservesVersionIdentity(reviewedPromotionWorkflow);
assertReviewedPromotionRenewsReleaseLease(reviewedPromotionWorkflow);
assertCatalogKeyRotation(reviewedPromotionWorkflow);
assertCatalogKmsTrustSelection(path.join(root, 'scripts', 'basehalf-catalog-kms.sh'));
assertReleaseLeaseRequestIsHardened(path.join(root, 'scripts', 'basehalf-release-lease.sh'));
assertControlPlaneUrlValidation();
assert.equal(new TextEncoder().encode(serializeCatalogForPublication({ padding: 'x'.repeat(MAX_CATALOG_BYTES - 32) })).byteLength <= MAX_CATALOG_BYTES, true);
assert.throws(() => serializeCatalogForPublication({ padding: 'x'.repeat(MAX_CATALOG_BYTES) }), /client limit/);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-plugin-fixture-'));
let server: http.Server | undefined;

try {
	const generatedProjectionRoot = path.join(temporary, 'generated-projection');
	await scaffoldPlugin({
		directory: generatedProjectionRoot,
		publisher: 'studio',
		name: 'storyboard',
		displayName: 'Storyboard',
		repository: 'https://example.com/studio/storyboard',
		kind: 'projection',
		fileExtension: 'story-board'
	});
	const generatedProjectionManifest = JSON.parse(fs.readFileSync(path.join(generatedProjectionRoot, 'package.json'), 'utf8'));
	assert.deepEqual(generatedProjectionManifest.contributes.basehalfCardProjections, [{
		id: 'studio.storyboard.project',
		label: 'Storyboard',
		extensions: ['.story-board'],
		order: 100,
		defaultPriority: 100
	}]);
	validateReviewedVsixManifest(
		generatedProjectionManifest,
		new Set(['extension/package.json', 'extension/readme.md', 'extension/license.txt', 'extension/out/extension.js']),
		'studio.storyboard',
		new Map()
	);
	for (const version of ['v0.1.0', ' 0.1.0 ', '0.1.0+build.1']) {
		assert.throws(() => validateReviewedVsixManifest(
			{ ...generatedProjectionManifest, version },
			new Set(['extension/package.json', 'extension/readme.md', 'extension/license.txt', 'extension/out/extension.js']),
			'studio.storyboard',
			new Map()
		), /canonical semantic version text without build metadata/);
	}
	const duplicateAgentOperationManifest = structuredClone(generatedProjectionManifest);
	duplicateAgentOperationManifest.contributes.commands.push(
		{ command: 'studio.storyboard.run-first', title: 'Run First' },
		{ command: 'studio.storyboard.run-second', title: 'Run Second' }
	);
	duplicateAgentOperationManifest.contributes.basehalfAgentCapabilities = [
		{
			id: 'studio.storyboard.first-capability',
			label: 'First capability',
			operations: [{
				id: 'studio.storyboard.shared-operation',
				command: 'studio.storyboard.run-first',
				description: 'Run the first operation.',
				deterministic: true,
				parameters: [],
				returns: { type: 'void', description: 'No result.' }
			}]
		},
		{
			id: 'studio.storyboard.second-capability',
			label: 'Second capability',
			operations: [{
				id: 'studio.storyboard.shared-operation',
				command: 'studio.storyboard.run-second',
				description: 'Run the second operation.',
				deterministic: true,
				parameters: [],
				returns: { type: 'void', description: 'No result.' }
			}]
		}
	];
	assert.throws(() => validateReviewedVsixManifest(
		duplicateAgentOperationManifest,
		new Set(['extension/package.json', 'extension/readme.md', 'extension/license.txt', 'extension/out/extension.js']),
		'studio.storyboard',
		new Map()
	), /Agent operation 'studio\.storyboard\.shared-operation' is not uniquely owned/);

	const submissionBucket = 'basehalf-plugin-submissions-test';
	const awsRegion = 'us-west-2';
	const submissionId = '21';
	const releaseSha256 = 'a'.repeat(64);
	const signedQuery = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20990101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=' + 'b'.repeat(64);
	const reviewedReleaseJob = {
		job_id: '31',
		submission_id: submissionId,
		lease_expires_at: '2099-01-01T00:15:00.000Z',
		download_url: `https://${submissionBucket}.s3.${awsRegion}.amazonaws.com/submissions/${submissionId}/${releaseSha256}.vsix?${signedQuery}`,
		extension_id: 'studio.storyboard',
		publisher: { slug: 'studio', display_name: 'Studio', trust: 'reviewed' },
		version: '1.0.0',
		sha256: releaseSha256,
		byte_size: '512',
		label: 'Video workflow',
		description: 'Reviewed workflow.',
		category: 'Domain',
		primary_command: 'studio.storyboard.createWorkflow',
		primary_command_label: 'Create Workflow…',
		basehalf_range: '^0.4.0',
		vscode_range: '^1.128.0',
		target_platform: 'universal',
		release_notes: ''
	};
	assert.equal(validateReviewedReleaseJob(reviewedReleaseJob, { submissionBucket, awsRegion }).byte_size, 512);
	for (const version of ['v1.0.0', '1.0.0+build.1']) {
		assert.throws(
			() => validateReviewedReleaseJob({ ...reviewedReleaseJob, version }, { submissionBucket, awsRegion }),
			/canonical semantic version text without build metadata/
		);
	}
	assert.throws(
		() => validateReviewedReleaseJob({ ...reviewedReleaseJob, version: ' 1.0.0 ' }, { submissionBucket, awsRegion }),
		/reviewed release job version is invalid/i
	);
	assert.throws(() => validateReviewedReleaseJob({
		...reviewedReleaseJob,
		extension_id: OFFICIAL_EXTENSION_ID,
		publisher: { slug: 'pointa', display_name: 'Impersonator', trust: 'reviewed' },
		primary_command: `${OFFICIAL_EXTENSION_ID}.createWorkflow`
	}, { submissionBucket, awsRegion }), /reserved for an official plugin/);
	assert.throws(() => validateReviewedReleaseJob({
		...reviewedReleaseJob,
		extension_id: 'pointa.community-tool',
		publisher: { slug: 'pointa', display_name: 'Impersonator', trust: 'reviewed' },
		primary_command: 'pointa.community-tool.createWorkflow'
	}, { submissionBucket, awsRegion }), /namespace 'pointa' is reserved/);
	assert.throws(() => validateReviewedReleaseJob({ ...reviewedReleaseJob, extension_id: 'pointa.basehalf-ai-video\nJOB_ID=forged' }, { submissionBucket, awsRegion }), /extension_id is invalid/);
	assert.throws(() => validateReviewedReleaseJob({ ...reviewedReleaseJob, download_url: `https://foreign.example/submissions/${submissionId}/${releaseSha256}.vsix?${signedQuery}` }, { submissionBucket, awsRegion }), /outside the submission quarantine/);
	assert.throws(() => validateReviewedReleaseJob({ ...reviewedReleaseJob, download_url: `https://${submissionBucket}.s3.${awsRegion}.amazonaws.com/submissions/22/${releaseSha256}.vsix?${signedQuery}` }, { submissionBucket, awsRegion }), /outside the submission quarantine/);
	assert.throws(() => validateReviewedReleaseJob({ ...reviewedReleaseJob, download_url: `https://${submissionBucket}.s3.${awsRegion}.amazonaws.com/submissions/${submissionId}/${'c'.repeat(64)}.vsix?${signedQuery}` }, { submissionBucket, awsRegion }), /outside the submission quarantine/);
	assert.throws(() => validateReviewedReleaseJob({ ...reviewedReleaseJob, unexpected: true }, { submissionBucket, awsRegion }), /unsupported fields/);

	const release = await packagePlugin({ root, outputDirectory: temporary });
	const repeatedPackageDirectory = path.join(temporary, 'repeated-package');
	const repeatedRelease = await packagePlugin({ root, outputDirectory: repeatedPackageDirectory });
	assert.equal(repeatedRelease.sha256, release.sha256);
	assert.equal(repeatedRelease.installedContentSha256, release.installedContentSha256);
	assert.equal(repeatedRelease.size, release.size);
	assert.deepEqual(fs.readFileSync(repeatedRelease.vsixPath), fs.readFileSync(release.vsixPath));
	const workflowOutput = path.join(temporary, 'workflow');
	const workflowMetadataPath = path.join(temporary, 'workflow-metadata.json');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'package',
		'--output', workflowOutput,
		'--metadata-output', workflowMetadataPath
	], { stdio: 'pipe' });
	const workflowMetadata = JSON.parse(fs.readFileSync(workflowMetadataPath, 'utf8'));
	assert.equal(workflowMetadata.extensionId, release.extensionId);
	assert.equal(workflowMetadata.version, release.version);
	assert.equal(workflowMetadata.basehalfRange, '^0.4.0');
	assert.equal(workflowMetadata.vscodeRange, '^1.128.0');
	assert.equal(workflowMetadata.sha256, release.sha256);
	assert.equal(workflowMetadata.installedContentSha256, release.installedContentSha256);
	assert.deepEqual(fs.readFileSync(workflowMetadata.vsixPath), fs.readFileSync(release.vsixPath));
	assert.equal(fs.existsSync(workflowMetadata.vsixPath), true);
	const reviewedRelease = await metadataFromVsix({
		vsixPath: release.vsixPath,
		expectedExtensionId: release.extensionId,
		expectedVersion: release.version,
		label: 'Reviewed workflow',
		publisherSlug: 'pointa',
		publisherDisplayName: 'BaseHalf',
		publisherTrust: 'official'
	});
	assert.equal(reviewedRelease.sha256, release.sha256);
	assert.equal(reviewedRelease.installedContentSha256, release.installedContentSha256);
	assert.deepEqual(reviewedRelease.publisher, {
		slug: 'pointa',
		displayName: 'BaseHalf',
		trust: 'official'
	});
	const reviewedFiles = new Set(['extension/package.json', 'extension/readme.md', 'extension/license.txt', 'extension/out/extension.js', 'extension/templates/starter-workflow.json']);
	const reviewedTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [{ path: 'brief.md', contents: '# Brief\n' }],
		nodes: [],
		cards: [{ path: 'brief.md', x: 0, y: 0, width: 280, height: 180 }],
		references: []
	}));
	const reviewedTemplates = new Map([['extension/templates/starter-workflow.json', reviewedTemplate]]);
	const reviewedManifest = {
		publisher: 'pointa',
		name: 'basehalf-ai-video',
		version: '1.0.0',
		displayName: 'Reviewed workflow',
		description: 'A reviewed workflow fixture.',
		license: 'Apache-2.0',
		repository: 'https://example.com/reviewed-workflow',
		main: './out/extension.js',
		engines: { vscode: '^1.128.0', basehalf: '^0.4.0' },
		basehalf: {
			primaryCommand: 'pointa.basehalf-ai-video.createWorkflow',
			primaryCommandLabel: 'Create Workflow…'
		},
		contributes: {
			commands: [{ command: 'pointa.basehalf-ai-video.createWorkflow', title: 'Create Workflow…' }],
			basehalfCanvasRecipes: [{
				id: 'pointa.basehalf-ai-video.storyboard-frame',
				label: 'Storyboard Frame',
				outputs: [{ id: 'storyboard', kind: 'image', extensions: ['.svg'], minItems: 1, maxItems: 1, primary: true }]
			}],
			basehalfCanvasTemplates: [{
				id: 'pointa.basehalf-ai-video.starter-workflow',
				label: 'Video Starter Workflow',
				resource: 'templates/starter-workflow.json'
			}]
		}
	};
	const reviewedArchiveEntries = new Map<string, Buffer>([
		['extension/package.json', Buffer.from(JSON.stringify(reviewedManifest))],
		['extension/out/extension.js', Buffer.from('exports.activate = () => {};\n')],
		['extension/readme.md', Buffer.from('# Reviewed workflow\n')],
		['extension/license.txt', Buffer.from('Apache-2.0\n')],
		['extension/templates/starter-workflow.json', reviewedTemplate]
	]);
	const reviewedVsix = path.join(temporary, 'reviewed.vsix');
	await writeVsix(reviewedVsix, reviewedArchiveEntries);
	await assert.rejects(() => metadataFromVsix({
		vsixPath: reviewedVsix,
		expectedExtensionId: OFFICIAL_EXTENSION_ID,
		expectedVersion: '1.0.0',
		publisherSlug: 'pointa',
		publisherDisplayName: 'Impersonator',
		publisherTrust: 'reviewed'
	}), /reserved for an official plugin/);
	const reviewedMetadata = await metadataFromVsix({
		vsixPath: reviewedVsix,
		expectedExtensionId: OFFICIAL_EXTENSION_ID,
		expectedVersion: '1.0.0',
		publisherSlug: 'pointa',
		publisherDisplayName: 'BaseHalf',
		publisherTrust: 'official'
	});
	assert.equal(reviewedMetadata.extensionId, OFFICIAL_EXTENSION_ID);
	const communityExtensionId = 'studio.storyboard';
	const communityManifest = JSON.parse(JSON.stringify(reviewedManifest).replaceAll(OFFICIAL_EXTENSION_ID, communityExtensionId));
	communityManifest.publisher = 'studio';
	communityManifest.name = 'storyboard';
	const communityVsix = path.join(temporary, 'community.vsix');
	await writeVsix(communityVsix, new Map([
		...reviewedArchiveEntries,
		['extension/package.json', Buffer.from(JSON.stringify(communityManifest))]
	]));
	const communityMetadata = await metadataFromVsix({
		vsixPath: communityVsix,
		expectedExtensionId: communityExtensionId,
		expectedVersion: '1.0.0',
		publisherSlug: 'studio',
		publisherDisplayName: 'Studio',
		publisherTrust: 'reviewed'
	});
	assert.equal(communityMetadata.publisher.trust, 'reviewed');
	const reviewedInstallRoot = path.join(temporary, 'reviewed-install-tree');
	for (const [archivePath, bytes] of reviewedArchiveEntries) {
		if (!archivePath.startsWith('extension/')) {
			continue;
		}
		const installedPath = path.join(reviewedInstallRoot, ...archivePath.slice('extension/'.length).split('/'));
		fs.mkdirSync(path.dirname(installedPath), { recursive: true });
		fs.writeFileSync(installedPath, bytes);
	}
	const clientCompatibleInstalledHash = hashInstalledTree(reviewedInstallRoot);
	assert.equal(reviewedMetadata.installedContentSha256, clientCompatibleInstalledHash);
	const legacyRawArchiveHash = hashInstalledTree(reviewedInstallRoot, () => true, false);
	const installedManifestPath = path.join(reviewedInstallRoot, 'package.json');
	const installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));
	installedManifest.__metadata = { id: 'dynamic-install-id', installedTimestamp: 123 };
	fs.writeFileSync(installedManifestPath, JSON.stringify(installedManifest, null, '\t'));
	assert.equal(hashInstalledTree(reviewedInstallRoot), reviewedMetadata.installedContentSha256);
	assert.notEqual(hashInstalledTree(reviewedInstallRoot, () => true, false), legacyRawArchiveHash);
	assert.notEqual(reviewedMetadata.installedContentSha256, hashInstalledTree(reviewedInstallRoot, relative => relative === 'package.json'));

	const wrongIdentityVsix = path.join(temporary, 'wrong-identity.vsix');
	await writeVsix(wrongIdentityVsix, new Map([
		...reviewedArchiveEntries,
		['extension/package.json', Buffer.from(JSON.stringify({ ...reviewedManifest, name: 'wrong-plugin' }))]
	]));
	await assert.rejects(() => metadataFromVsix({
		vsixPath: wrongIdentityVsix,
		expectedExtensionId: OFFICIAL_EXTENSION_ID,
		expectedVersion: '1.0.0'
	}), /VSIX id must be/);
	const wrongVersionVsix = path.join(temporary, 'wrong-version.vsix');
	await writeVsix(wrongVersionVsix, new Map([
		...reviewedArchiveEntries,
		['extension/package.json', Buffer.from(JSON.stringify({ ...reviewedManifest, version: '2.0.0' }))]
	]));
	await assert.rejects(() => metadataFromVsix({
		vsixPath: wrongVersionVsix,
		expectedExtensionId: OFFICIAL_EXTENSION_ID,
		expectedVersion: '1.0.0'
	}), /VSIX version must be/);

	const wrongCaseVsix = path.join(temporary, 'wrong-case-manifest.vsix');
	await writeVsix(wrongCaseVsix, new Map([
		...reviewedArchiveEntries,
		['Extension/package.json', reviewedArchiveEntries.get('extension/package.json')!]
	].filter(([name]) => name !== 'extension/package.json')));
	await assert.rejects(() => metadataFromVsix({ vsixPath: wrongCaseVsix }), /path must be exactly/);

	const encryptedVsix = path.join(temporary, 'encrypted-entry.vsix');
	fs.writeFileSync(encryptedVsix, setFirstEntryEncrypted(fs.readFileSync(reviewedVsix)));
	await assert.rejects(() => metadataFromVsix({ vsixPath: encryptedVsix }), /unsafe entry/);

	const corruptVsix = path.join(temporary, 'corrupt-entry.vsix');
	fs.writeFileSync(corruptVsix, corruptCentralCrc(fs.readFileSync(reviewedVsix), 'extension/out/extension.js'));
	await assert.rejects(() => metadataFromVsix({ vsixPath: corruptVsix }), /CRC validation/);

	const fileDescendantConflictVsix = path.join(temporary, 'file-descendant-conflict.vsix');
	await writeVsix(fileDescendantConflictVsix, new Map([
		...reviewedArchiveEntries,
		['extension/assets', Buffer.from('file')],
		['extension/assets!', Buffer.from('intervening sort entry')],
		['extension/assets/reference.txt', Buffer.from('descendant')]
	]));
	await assert.rejects(() => metadataFromVsix({ vsixPath: fileDescendantConflictVsix }), /file and one of its descendants/);

	const floodVsix = path.join(temporary, 'entry-flood.vsix');
	const flood = new Map<string, Buffer>();
	for (let index = 0; index < 4_097; index++) {
		flood.set(`extension/flood/${String(index).padStart(4, '0')}.txt`, Buffer.alloc(0));
	}
	await writeVsix(floodVsix, flood);
	await assert.rejects(() => metadataFromVsix({ vsixPath: floodVsix }), /more than 4096 entries/);
	validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, enabledApiProposals: ['unsafe'] }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /proposed APIs/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, extensionDependencies: ['other.extension'] }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /cannot declare extensionDependencies/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, activationEvents: ['onStartupFinished'] }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /not tied to a declared contribution/);
	validateReviewedVsixManifest({ ...reviewedManifest, activationEvents: ['onCommand:pointa.basehalf-ai-video.createWorkflow', 'onBaseHalfCanvasRecipe:pointa.basehalf-ai-video.storyboard-frame'] }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates);
	validateReviewedVsixManifest({
		...reviewedManifest,
		activationEvents: ['onBaseHalfStructuralCleanup:pointa.basehalf-ai-video.sequence-membership'],
		contributes: {
			commands: reviewedManifest.contributes.commands,
			basehalfStructuralCleanups: [{
				id: 'pointa.basehalf-ai-video.sequence-membership',
				extensions: ['.bhnode']
			}]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map());
	assert.throws(() => validateReviewedVsixManifest({
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			basehalfStructuralCleanups: [{
				id: 'pointa.basehalf-ai-video.sequence-membership',
				extensions: ['../bhnode']
			}]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /invalid file extensions/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, contributes: { ...reviewedManifest.contributes, views: {} } }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /unsupported contribution points/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, name: 'different' }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /identity does not match/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, contributes: { ...reviewedManifest.contributes, commands: [{ command: 'other.extension.run', title: 'Run' }] } }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /not owned/);
	assert.throws(() => validateReviewedVsixManifest({
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			configuration: { properties: { 'other.plugin.apiKey': { type: 'string' } } }
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /outside 'pointa.basehalf-ai-video'/);
	assert.throws(() => validateReviewedVsixManifest({
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			basehalfCanvasRecipes: [{
				...reviewedManifest.contributes.basehalfCanvasRecipes[0],
				inputs: [
					{ id: 'first', label: 'First', accepts: ['text'], minItems: 0, maxItems: 40 },
					{ id: 'second', label: 'Second', accepts: ['text'], minItems: 0, maxItems: 40 }
				]
			}]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /no more than 64 inputs in total/);
	assert.throws(() => validateReviewedVsixManifest({
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			basehalfCanvasRecipes: [{
				...reviewedManifest.contributes.basehalfCanvasRecipes[0],
				outputs: [
					reviewedManifest.contributes.basehalfCanvasRecipes[0].outputs[0],
					{ id: 'alternates', kind: 'image', extensions: ['.svg'], minItems: 0, maxItems: 64 }
				]
			}]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /no more than 64 artifacts in total/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, contributes: {
		...reviewedManifest.contributes,
		basehalfCanvasRecipes: [{
			...reviewedManifest.contributes.basehalfCanvasRecipes[0],
			outputs: [{ id: 'storyboard', kind: 'image', extensions: ['.svg'], minItems: 0, maxItems: 2, primary: true }]
		}]
	} }, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /primary output must produce exactly one artifact/);
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, new Set([...reviewedFiles].filter(file => !file.endsWith('starter-workflow.json'))), OFFICIAL_EXTENSION_ID, reviewedTemplates), /resource .* is missing/);
	assert.throws(() => validateReviewedVsixManifest({
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			basehalfCanvasTemplates: [{ ...reviewedManifest.contributes.basehalfCanvasTemplates[0], resource: '../outside.json' }]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, reviewedTemplates), /path is invalid/);
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, new Set([...reviewedFiles].map(file => file === 'extension/out/extension.js' ? 'extension/out/Extension.js' : file)), OFFICIAL_EXTENSION_ID, reviewedTemplates), /different casing/);
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', Buffer.from('{')]])), /not valid UTF-8 JSON/);
	const unsafeTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [{ path: '.BH/private.json', contents: '{}' }],
		nodes: [],
		cards: [],
		references: []
	}));
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', unsafeTemplate]])), /reserved or unsafe path/);
	const prefixConflictTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [
			{ path: 'assets', contents: '' },
			{ path: 'assets!', contents: '' },
			{ path: 'assets/reference.md', contents: '' }
		],
		nodes: [],
		cards: [],
		references: []
	}));
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', prefixConflictTemplate]])), /resource and one of its descendants/);
	for (const kind of ['file', 'image', 'video', 'audio', 'pdf', 'presentation']) {
		const kindTemplate = Buffer.from(JSON.stringify({
			version: 1,
			files: [],
			nodes: [{ path: `result-${kind}.bhnode`, kind, title: 'Result', role: 'result' }],
			cards: [],
			references: []
		}));
		validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', kindTemplate]]));
	}
	for (const kind of ['text', 'code']) {
		const contentTemplate = Buffer.from(JSON.stringify({
			version: 1,
			files: [],
			nodes: [{ path: `result-${kind}.bhnode`, kind, title: 'Result', role: 'result' }],
			cards: [],
			references: []
		}));
		assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', contentTemplate]])), /kind is invalid/);
	}
	const undeclaredRecipeTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [],
		nodes: [{
			path: 'result.bhnode',
			kind: 'file',
			title: 'Result',
			role: 'result',
			recipe: { recipeId: 'pointa.basehalf-ai-video.missing', parameters: {}, inputBindings: [] }
		}],
		cards: [],
		references: []
	}));
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', undeclaredRecipeTemplate]])), /uses undeclared recipe/);
	const nonCanonicalRecipeTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [],
		nodes: [{
			path: 'result.bhnode',
			kind: 'file',
			title: 'Result',
			role: 'result',
			recipe: { recipeId: 'Pointa.basehalf-ai-video.missing', parameters: {}, inputBindings: [] }
		}],
		cards: [],
		references: []
	}));
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', nonCanonicalRecipeTemplate]])), /recipeId is invalid/);
	const mismatchedOutputTemplate = Buffer.from(JSON.stringify({
		version: 1,
		files: [],
		nodes: [{
			path: 'result.bhnode',
			kind: 'file',
			title: 'Result',
			role: 'result',
			recipe: { recipeId: 'pointa.basehalf-ai-video.storyboard-frame', parameters: {}, inputBindings: [] }
		}],
		cards: [],
		references: []
	}));
	assert.throws(() => validateReviewedVsixManifest(reviewedManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', mismatchedOutputTemplate]])), /does not match .* primary output/);
	const semanticManifest = {
		...reviewedManifest,
		contributes: {
			...reviewedManifest.contributes,
			basehalfCanvasRecipes: [{
				id: 'pointa.basehalf-ai-video.compose-text',
				label: 'Compose Text',
				inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'], minItems: 0, maxItems: 1 }],
				parameters: [{ id: 'heading', label: 'Heading', type: 'string', required: true, maxLength: 80 }],
				outputs: [{ id: 'document', kind: 'file', extensions: ['.md'], minItems: 1, maxItems: 1, primary: true }]
			}]
		}
	};
	const semanticTemplate = {
		version: 1,
		files: [{ path: 'brief.md', contents: '# Brief\n' }],
		nodes: [{
			path: 'result.bhnode',
			kind: 'file',
			title: 'Result',
			role: 'result',
			recipe: { recipeId: 'pointa.basehalf-ai-video.compose-text', parameters: { heading: 'Result' }, inputBindings: [] }
		}],
		cards: [],
		references: [{ from: 'brief.md', to: 'result.bhnode', fromAnchor: 'east', toAnchor: 'west' }]
	};
	assert.throws(() => validateReviewedVsixManifest(semanticManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', Buffer.from(JSON.stringify({
		...semanticTemplate,
		nodes: [{
			...semanticTemplate.nodes[0],
			recipe: {
				...semanticTemplate.nodes[0].recipe,
				inputBindings: [
					{ sourcePath: 'brief.md', slot: 'prompt', order: 0 },
					{ sourcePath: 'brief.md', slot: 'reference', order: 1 }
				]
			}
		}]
	}))]])), /binding source/);
	assert.throws(() => validateReviewedVsixManifest(semanticManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', Buffer.from(JSON.stringify(semanticTemplate))]])), /without an input binding/);
	assert.throws(() => validateReviewedVsixManifest(semanticManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map([['extension/templates/starter-workflow.json', Buffer.from(JSON.stringify({
		...semanticTemplate,
		references: [],
		nodes: [{ ...semanticTemplate.nodes[0], recipe: { ...semanticTemplate.nodes[0].recipe, parameters: {} } }]
	}))]])), /omits required parameter/);
	const projectionManifest = {
		...reviewedManifest,
		contributes: {
			commands: reviewedManifest.contributes.commands,
			basehalfCardProjections: [{
				id: 'pointa.basehalf-ai-video.document-view',
				label: 'Document View',
				extensions: ['.studio-document']
			}]
		}
	};
	validateReviewedVsixManifest(projectionManifest, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map());
	validateReviewedVsixManifest({
		...projectionManifest,
		contributes: {
			commands: reviewedManifest.contributes.commands,
			basehalfCardProjections: [{
				id: 'pointa.basehalf-ai-video.sequence-view',
				label: 'Sequence',
					fileNames: ['video-sequence.json']
			}]
		}
	}, reviewedFiles, OFFICIAL_EXTENSION_ID, new Map());
	await assert.rejects(() => metadataFromVsix({
		vsixPath: release.vsixPath,
		expectedExtensionId: release.extensionId,
		expectedVersion: release.version,
		primaryCommand: 'pointa.basehalf-ai-video.different',
		publisherSlug: 'pointa',
		publisherTrust: 'official'
	}), /does not match the VSIX manifest/);
	const metadataPath = path.join(temporary, 'metadata.json');
	fs.writeFileSync(metadataPath, JSON.stringify(release), 'utf8');
	const bootstrapObjectVersion = (Key: string, IsLatest = true) => ({ Key, VersionId: `version-${Key}`, IsLatest });
	const bootstrapIdentityKey = `identities/${release.extensionId}/${release.version}.json`;
	const resumableBootstrapInventory = {
		IsTruncated: false,
		Versions: [
			bootstrapObjectVersion('v1/extensions-control.json'),
			bootstrapObjectVersion('catalogs/1/catalog.json'),
			bootstrapObjectVersion('catalogs/1/catalog.sig.json'),
			bootstrapObjectVersion(bootstrapIdentityKey),
			bootstrapObjectVersion(release.assetPath)
		],
		DeleteMarkers: []
	};
	assert.deepEqual(await assertBootstrapRegistryInventory({ inventory: {}, metadata: release, sequence: 1 }), []);
	assert.deepEqual(await assertBootstrapRegistryInventory({ inventory: resumableBootstrapInventory, metadata: release, sequence: 1 }), [
		'catalogs/1/catalog.json',
		'catalogs/1/catalog.sig.json',
		bootstrapIdentityKey,
		release.assetPath,
		'v1/extensions-control.json'
	].sort());
	const bootstrapInventoryPath = path.join(temporary, 'bootstrap-inventory.json');
	fs.writeFileSync(bootstrapInventoryPath, JSON.stringify(resumableBootstrapInventory), 'utf8');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'bootstrap-check',
		'--inventory', bootstrapInventoryPath,
		'--metadata', metadataPath,
		'--sequence', '1'
	], { stdio: 'pipe' });
	for (const inventory of [
		{ Versions: [bootstrapObjectVersion('catalogs/2/catalog.json')] },
		{ Versions: [bootstrapObjectVersion('v1/catalog-index.json')] },
		{ Versions: [bootstrapObjectVersion(`identities/${release.extensionId}/9.9.9.json`)] },
		{ Versions: [bootstrapObjectVersion(`${release.extensionId}/${release.version}/${'f'.repeat(64)}.vsix`)] },
		{ Versions: [bootstrapObjectVersion('catalogs/1/catalog.sig.json')] },
		{ Versions: [bootstrapObjectVersion(release.assetPath, false)] },
		{ Versions: [bootstrapObjectVersion(release.assetPath), bootstrapObjectVersion(release.assetPath)] },
		{ Versions: [], DeleteMarkers: [{ Key: 'v1/catalog-index.json', VersionId: 'deleted', IsLatest: true }] },
		{ IsTruncated: true, Versions: [] }
	]) {
		await assert.rejects(() => assertBootstrapRegistryInventory({ inventory, metadata: release, sequence: 1 }), /bootstrap|Bootstrap|Registry/);
	}
	await assert.rejects(() => assertBootstrapRegistryInventory({ inventory: {}, metadata: release, sequence: 2 }), /sequence 1/);
	const identityPath = path.join(temporary, 'release-identity.json');
	for (const version of [`v${release.version}`, `${release.version}+build.1`]) {
		await assert.rejects(() => createReleaseIdentity({
			metadata: {
				...release,
				version,
				assetPath: `${release.extensionId}/${version}/${release.sha256}.vsix`
			},
			outputPath: path.join(temporary, `non-canonical-metadata-${encodeURIComponent(version)}.json`)
		}), /canonical semantic version text without build metadata/);
	}
	const identity = await createReleaseIdentity({ metadata: release, outputPath: identityPath });
	const expectedIdentity = {
		schemaVersion: 1,
		extensionId: release.extensionId,
		version: release.version,
		sha256: release.sha256,
		size: release.size,
		assetPath: release.assetPath
	};
	const expectedIdentityBytes = `${JSON.stringify(expectedIdentity, null, 2)}\n`;
	assert.deepEqual(identity, expectedIdentity);
	assert.equal(serializeReleaseIdentity(identity), expectedIdentityBytes);
	assert.equal(fs.readFileSync(identityPath, 'utf8'), expectedIdentityBytes);
	assert.deepEqual(validateReleaseIdentity(JSON.parse(expectedIdentityBytes)), expectedIdentity);
	for (const version of ['v1.0.0', ' 1.0.0 ', '1.0.0+build.1']) {
		assert.throws(() => validateReleaseIdentity({
			...expectedIdentity,
			version,
			assetPath: `${release.extensionId}/${version}/${release.sha256}.vsix`
		}), /canonical semantic version text without build metadata/);
	}
	const cliIdentityPath = path.join(temporary, 'release-identity-cli.json');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'identity',
		'--metadata', metadataPath,
		'--output', cliIdentityPath
	], { stdio: 'pipe' });
	assert.equal(fs.readFileSync(cliIdentityPath, 'utf8'), expectedIdentityBytes);
	const conflictingVsixPath = path.join(temporary, 'conflicting-release.vsix');
	const conflictingVsixBytes = addZipComment(fs.readFileSync(release.vsixPath), Buffer.from('x'));
	fs.writeFileSync(conflictingVsixPath, conflictingVsixBytes);
	const conflictingSha256 = createHash('sha256').update(conflictingVsixBytes).digest('hex');
	const conflictingRelease = {
		...release,
		sha256: conflictingSha256,
		size: conflictingVsixBytes.byteLength,
		assetPath: `${release.extensionId}/${release.version}/${conflictingSha256}.vsix`,
		vsixPath: conflictingVsixPath
	};
	const conflictingIdentityPath = path.join(temporary, 'conflicting-release-identity.json');
	const conflictingIdentity = await createReleaseIdentity({ metadata: conflictingRelease, outputPath: conflictingIdentityPath });
	assert.notEqual(fs.readFileSync(conflictingIdentityPath, 'utf8'), expectedIdentityBytes);
	await assert.rejects(() => assertReleaseIdentityMatches(identity, conflictingRelease), /Release identity conflict/);
	await assert.rejects(() => assertReleaseIdentityMatches(conflictingIdentity, release), /Release identity conflict/);
	await assert.rejects(() => createReleaseIdentity({
		metadata: { ...release, installedContentSha256: 'f'.repeat(64) },
		outputPath: path.join(temporary, 'tampered-installed-content-identity.json')
	}), /installed-content SHA-256 does not match/);
	const catalogPath = path.join(temporary, 'catalog.json');
	const releaseDecision = {
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal'
	} as const;
	await assert.rejects(() => createCatalog({
		metadata: { ...release, basehalfRange: undefined as unknown as string },
		sequence: 39,
		outputPath: path.join(temporary, 'missing-compatibility-catalog.json'),
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active'
	}), /metadata compatibility ranges/);
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 39,
		outputPath: path.join(temporary, 'invalid-platform-catalog.json'),
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'mystery-platform',
		status: 'active'
	}), /target platform/);
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 39,
		outputPath: path.join(temporary, 'invalid-status-catalog.json'),
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'pending' as 'active'
	}), /Catalog status/);
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 40,
		outputPath: path.join(temporary, 'incompatible-catalog.json'),
		basehalfRange: '^9.0.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active'
	}), /do not match the VSIX manifest/);
	await createCatalog({
		metadata: release,
		sequence: 41,
		outputPath: catalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:00:00.000Z'
	});
	const retriedCatalogPath = path.join(temporary, 'catalog-retried.json');
	await createCatalog({
		metadata: release,
		sequence: 41,
		outputPath: retriedCatalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:01:00.000Z'
	});
	assert.doesNotThrow(() => assertCatalogCandidateMatchesPublish({
		requestedCatalogPath: retriedCatalogPath,
		candidateCatalogPath: catalogPath,
		extensionId: release.extensionId,
		version: release.version
	}));
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'candidate-check',
		'--requested', retriedCatalogPath,
		'--candidate', catalogPath,
		'--extension-id', release.extensionId,
		'--version', release.version
	], { stdio: 'pipe' });
	const conflictingCandidatePath = path.join(temporary, 'catalog-candidate-conflict.json');
	const conflictingCandidate = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	conflictingCandidate.plugins[0].description = 'Different published content.';
	fs.writeFileSync(conflictingCandidatePath, `${JSON.stringify(conflictingCandidate, null, 2)}\n`);
	assert.throws(() => assertCatalogCandidateMatchesPublish({
		requestedCatalogPath: retriedCatalogPath,
		candidateCatalogPath: conflictingCandidatePath,
		extensionId: release.extensionId,
		version: release.version
	}), /does not match the requested publish content/);
	const currentPublishReconciliation = await assertCatalogReleaseMatchesPublish({
		metadata: release,
		catalogPath,
		sequence: 41,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal'
	});
	assert.equal(currentPublishReconciliation.state, 'published');
	const currentPublishOutput = path.join(temporary, 'current-publish-reconciliation.json');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'publish-check',
		'--metadata', metadataPath,
		'--catalog', catalogPath,
		'--sequence', '41',
		'--basehalf-range', '^0.4.0',
		'--vscode-range', '^1.128.0',
		'--target-platform', 'universal',
		'--output', currentPublishOutput
	], { stdio: 'pipe' });
	assert.equal(JSON.parse(fs.readFileSync(currentPublishOutput, 'utf8')).state, 'published');
	await assert.rejects(() => assertCatalogReleaseMatchesPublish({
		metadata: release,
		catalogPath,
		sequence: 42,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal'
	}), /does not match requested sequence/);
	const seededIdentityDirectory = path.join(temporary, 'seeded-release-identities');
	assert.deepEqual(createReleaseIdentitiesFromCatalog({ catalogPath, outputDirectory: seededIdentityDirectory }), [expectedIdentity]);
	assert.equal(fs.readFileSync(path.join(seededIdentityDirectory, release.extensionId, `${release.version}.json`), 'utf8'), expectedIdentityBytes);
	const cliSeededIdentityDirectory = path.join(temporary, 'cli-seeded-release-identities');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'identity',
		'--catalog', catalogPath,
		'--output-directory', cliSeededIdentityDirectory
	], { stdio: 'pipe' });
	assert.equal(fs.readFileSync(path.join(cliSeededIdentityDirectory, release.extensionId, `${release.version}.json`), 'utf8'), expectedIdentityBytes);
	const retainedGrantCatalogPath = path.join(temporary, 'catalog-retained-grants.json');
	const retainedGrantCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	retainedGrantCatalog.sequence = 100;
	retainedGrantCatalog.plugins[0].versions = Array.from({ length: 51 }, (_, index) => {
		const version = `0.0.${51 - index}`;
		return {
			...retainedGrantCatalog.plugins[0].versions[0],
			version,
			assetPath: `${release.extensionId}/${version}/${release.sha256}.vsix`
		};
	});
	fs.writeFileSync(retainedGrantCatalogPath, `${JSON.stringify(retainedGrantCatalog, null, 2)}\n`);
	const retainedCatalog = await createCatalog({
		metadata: release,
		sequence: 101,
		outputPath: path.join(temporary, 'catalog-retained-next.json'),
		previousPath: retainedGrantCatalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:02:00.000Z'
	});
	const retainedVersions = (retainedCatalog.plugins as any[])[0].versions;
	assert.equal(retainedVersions.length, 52);
	assert.equal(retainedVersions.some((candidate: any) => candidate.version === release.version), true);
	assert.equal(retainedVersions.some((candidate: any) => candidate.version === '0.0.1'), true);
	const overLimitCatalogPath = path.join(temporary, 'catalog-over-version-limit.json');
	retainedGrantCatalog.plugins[0].versions = Array.from({ length: CATALOG_VERSION_LIMIT }, (_, index) => {
		const version = `0.${Math.floor(index / 1000)}.${index % 1000}`;
		return {
			...retainedGrantCatalog.plugins[0].versions[0],
			version,
			assetPath: `${release.extensionId}/${version}/${release.sha256}.vsix`
		};
	}).sort((a: any, b: any) => compare(b.version, a.version));
	fs.writeFileSync(overLimitCatalogPath, `${JSON.stringify(retainedGrantCatalog, null, 2)}\n`);
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 102,
		outputPath: path.join(temporary, 'catalog-refused-next.json'),
		previousPath: overLimitCatalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:03:00.000Z'
	}), /refusing to discard an existing grant/);
	const nextCatalogPath = path.join(temporary, 'catalog-next.json');
	const reconciled = await reconcileCatalogRelease({ metadata: release, catalogPath, ...releaseDecision });
	assert.deepEqual(reconciled, {
		state: 'published',
		sequence: 41,
		extensionId: release.extensionId,
		version: release.version,
		sha256: release.sha256,
		assetPath: release.assetPath
	});
	const reconciliationOutput = path.join(temporary, 'release-reconciliation.json');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'reconcile',
		'--metadata', metadataPath,
		'--catalog', catalogPath,
		'--basehalf-range', releaseDecision.basehalfRange,
		'--vscode-range', releaseDecision.vscodeRange,
		'--target-platform', releaseDecision.targetPlatform,
		'--output', reconciliationOutput
	], { stdio: 'pipe' });
	assert.equal(JSON.parse(fs.readFileSync(reconciliationOutput, 'utf8')).state, 'published');
	const absentCatalogPath = path.join(temporary, 'catalog-release-absent.json');
	const absentCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	absentCatalog.plugins[0].versions[0].version = '9.9.9';
	absentCatalog.plugins[0].versions[0].assetPath = `${release.extensionId}/9.9.9/${release.sha256}.vsix`;
	fs.writeFileSync(absentCatalogPath, `${JSON.stringify(absentCatalog, null, 2)}\n`);
	assert.equal((await reconcileCatalogRelease({ metadata: release, catalogPath: absentCatalogPath, ...releaseDecision })).state, 'absent');
	const conflictingCatalogPath = path.join(temporary, 'catalog-release-conflict.json');
	const conflictingCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	conflictingCatalog.plugins[0].versions[0].sha256 = 'f'.repeat(64);
	conflictingCatalog.plugins[0].versions[0].assetPath = `${release.extensionId}/${release.version}/${'f'.repeat(64)}.vsix`;
	fs.writeFileSync(conflictingCatalogPath, `${JSON.stringify(conflictingCatalog, null, 2)}\n`);
	await assert.rejects(() => reconcileCatalogRelease({ metadata: release, catalogPath: conflictingCatalogPath, ...releaseDecision }), /does not match the claimed publication decision/);
	const decisionConflictCases: Array<{ name: string; mutate: (catalog: any) => void }> = [
		{ name: 'label', mutate: catalog => { catalog.plugins[0].label = 'Different label'; } },
		{ name: 'description', mutate: catalog => { catalog.plugins[0].description = 'Different description'; } },
		{ name: 'category', mutate: catalog => { catalog.plugins[0].category = 'Different category'; } },
		{ name: 'primary-command', mutate: catalog => { catalog.plugins[0].primaryCommand = `${release.extensionId}.different`; } },
		{ name: 'primary-command-label', mutate: catalog => { catalog.plugins[0].primaryCommandLabel = 'Different action'; } },
		{ name: 'publisher', mutate: catalog => { catalog.plugins[0].publisher.displayName = 'Different publisher'; } },
		{ name: 'basehalf-range', mutate: catalog => { catalog.plugins[0].versions[0].basehalfRange = '^0.5.0'; } },
		{ name: 'vscode-range', mutate: catalog => { catalog.plugins[0].versions[0].vscodeRange = '^1.129.0'; } },
		{ name: 'target-platform', mutate: catalog => { catalog.plugins[0].versions[0].targetPlatform = 'darwin-arm64'; } },
		{ name: 'status', mutate: catalog => { catalog.plugins[0].versions[0].status = 'withdrawn'; } },
		{ name: 'release-notes', mutate: catalog => { catalog.plugins[0].versions[0].releaseNotes = 'Different notes'; } }
	];
	for (const fixture of decisionConflictCases) {
		const decisionConflict = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
		fixture.mutate(decisionConflict);
		const decisionConflictPath = path.join(temporary, `catalog-release-decision-conflict-${fixture.name}.json`);
		fs.writeFileSync(decisionConflictPath, `${JSON.stringify(decisionConflict, null, 2)}\n`);
		await assert.rejects(
			() => reconcileCatalogRelease({ metadata: release, catalogPath: decisionConflictPath, ...releaseDecision }),
			/does not match the claimed publication decision/
		);
	}
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 42,
		outputPath: nextCatalogPath,
		previousPath: catalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:01:00.000Z'
	}), /Refusing to republish immutable/);
	const next = updateCatalogStatus({
		previousPath: catalogPath,
		outputPath: nextCatalogPath,
		sequence: 42,
		extensionId: OFFICIAL_EXTENSION_ID,
		version: release.version,
		mode: 'withdraw',
		generatedAt: '2026-07-13T00:01:00.000Z'
	});
	assert.equal(next.sequence, 42);
	assert.equal((next.plugins as any[])[0].primaryCommand, 'pointa.basehalf-ai-video.createWorkflow');
	assert.equal(assertCatalogStatus({ catalogPath: nextCatalogPath, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'withdraw' }).sequence, 42);
	assert.throws(() => assertCatalogStatus({ catalogPath, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'withdraw' }), /is not withdrawn/);
	const malformedCatalogCases: Array<{ name: string; mutate: (catalog: any) => void; expected: RegExp }> = [
		{
			name: 'duplicate-plugin',
			mutate: catalog => catalog.plugins.push(structuredClone(catalog.plugins[0])),
			expected: /extension id .* duplicated/
		},
		{
			name: 'duplicate-version',
			mutate: catalog => catalog.plugins[0].versions.push(structuredClone(catalog.plugins[0].versions[0])),
			expected: /duplicated or not in descending order/
		},
		{
			name: 'version-prefix',
			mutate: catalog => { catalog.plugins[0].versions[0].version = `v${release.version}`; },
			expected: /canonical semantic version text without build metadata/
		},
		{
			name: 'version-build-metadata',
			mutate: catalog => { catalog.plugins[0].versions[0].version = `${release.version}+build.1`; },
			expected: /canonical semantic version text without build metadata/
		},
		{
			name: 'asset-path',
			mutate: catalog => { catalog.plugins[0].versions[0].assetPath = '../plugin.vsix'; },
			expected: /asset path/
		},
		{
			name: 'sha256',
			mutate: catalog => { catalog.plugins[0].versions[0].sha256 = 'not-a-digest'; },
			expected: /SHA-256/
		},
		{
			name: 'installed-content-sha256',
			mutate: catalog => { catalog.plugins[0].versions[0].installedContentSha256 = 'not-a-digest'; },
			expected: /installed-content SHA-256/
		},
		{
			name: 'size',
			mutate: catalog => { catalog.plugins[0].versions[0].size = 0; },
			expected: /byte size/
		},
		{
			name: 'status',
			mutate: catalog => { catalog.plugins[0].versions[0].status = 'pending'; },
			expected: /status/
		},
		{
			name: 'range',
			mutate: catalog => { catalog.plugins[0].versions[0].basehalfRange = 'not-a-range'; },
			expected: /compatibility ranges/
		},
		{
			name: 'timestamp',
			mutate: catalog => { catalog.plugins[0].versions[0].publishedAt = 'tomorrow'; },
			expected: /canonical UTC ISO date/
		}
	];
	for (const fixture of malformedCatalogCases) {
		const malformed = structuredClone(next);
		fixture.mutate(malformed);
		const malformedPath = path.join(temporary, `catalog-malformed-${fixture.name}.json`);
		fs.writeFileSync(malformedPath, `${JSON.stringify(malformed)}\n`);
		assert.throws(() => updateCatalogStatus({
			previousPath: malformedPath,
			outputPath: path.join(temporary, `catalog-malformed-${fixture.name}-next.json`),
			sequence: 43,
			extensionId: OFFICIAL_EXTENSION_ID,
			version: release.version,
			mode: 'withdraw'
		}), fixture.expected);
	}
	await assert.rejects(() => createCatalog({
		metadata: release,
		sequence: 40,
		outputPath: path.join(temporary, 'rollback.json'),
		previousPath: catalogPath,
		basehalfRange: '^0.4.0', vscodeRange: '^1.128.0', targetPlatform: 'universal', status: 'active'
	}), /greater than previous sequence/);
	const rollbackPath = path.join(temporary, 'catalog-rollback.json');
	assert.throws(() => updateCatalogStatus({ previousPath: nextCatalogPath, outputPath: path.join(temporary, 'invalid-mode.json'), sequence: 43, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'archive' as 'withdraw' }), /status mode/);
	const rollback = updateCatalogStatus({ previousPath: nextCatalogPath, outputPath: rollbackPath, sequence: 43, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'rollback' });
	assert.equal(rollback.sequence, 43);
	assert.equal(assertCatalogStatus({ catalogPath: rollbackPath, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'rollback' }).sequence, 43);
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'status-check',
		'--catalog', rollbackPath,
		'--extension-id', OFFICIAL_EXTENSION_ID,
		'--version', release.version,
		'--mode', 'rollback'
	], { stdio: 'pipe' });
	assert.throws(() => assertCatalogStatus({ catalogPath: nextCatalogPath, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'rollback' }), /is not active/);
	const blockedControlPath = path.join(temporary, 'extensions-control-blocked.json');
	assert.throws(() => updateExtensionControl({ outputPath: path.join(temporary, 'invalid-control.json'), extensionId: '../plugin', blocked: true }), /control id is invalid/);
	const unsupportedControlOptions: Parameters<typeof updateExtensionControl>[0] & { learnMoreLink: string } = {
		outputPath: path.join(temporary, 'invalid-control-link.json'),
		extensionId: OFFICIAL_EXTENSION_ID,
		blocked: true,
		learnMoreLink: 'https://basehalf.com/security/plugins'
	};
	assert.throws(() => updateExtensionControl(unsupportedControlOptions), /do not support learn-more links/);
	const malformedPreviousControlPath = path.join(temporary, 'extensions-control-malformed-previous.json');
	fs.writeFileSync(malformedPreviousControlPath, JSON.stringify({ malicious: [], deprecated: {}, search: [], autoUpdate: {}, learnMoreLinks: {} }));
	assert.throws(() => updateExtensionControl({ previousPath: malformedPreviousControlPath, outputPath: path.join(temporary, 'invalid-control-previous.json'), extensionId: OFFICIAL_EXTENSION_ID, blocked: true }), /only the emergency extension control fields/);
	const blockedControl = updateExtensionControl({ outputPath: blockedControlPath, extensionId: OFFICIAL_EXTENSION_ID, blocked: true });
	assert.deepEqual(blockedControl, { malicious: [OFFICIAL_EXTENSION_ID], deprecated: {}, search: [], autoUpdate: {} });
	assert.deepEqual(JSON.parse(fs.readFileSync(blockedControlPath, 'utf8')), blockedControl);
	const restoredControl = updateExtensionControl({ previousPath: blockedControlPath, outputPath: path.join(temporary, 'extensions-control-restored.json'), extensionId: OFFICIAL_EXTENSION_ID, blocked: false });
	assert.deepEqual(restoredControl, { malicious: [], deprecated: {}, search: [], autoUpdate: {} });
	const cliBlockedControlPath = path.join(temporary, 'extensions-control-cli-blocked.json');
	execFileSync(process.execPath, [
		'--experimental-strip-types',
		path.join(root, 'scripts/basehalf-plugin-release.mts'),
		'control',
		'--output', cliBlockedControlPath,
		'--mode', 'block',
		'--extension-id', OFFICIAL_EXTENSION_ID
	], { stdio: 'pipe' });
	assert.deepEqual(JSON.parse(fs.readFileSync(cliBlockedControlPath, 'utf8')), blockedControl);
	const unsupportedControlOutputPath = path.join(temporary, 'extensions-control-cli-unsupported.json');
	try {
		execFileSync(process.execPath, [
			'--experimental-strip-types',
			path.join(root, 'scripts/basehalf-plugin-release.mts'),
			'control',
			'--output', unsupportedControlOutputPath,
			'--mode', 'block',
			'--extension-id', OFFICIAL_EXTENSION_ID,
			'--learn-more-link', 'https://basehalf.com/security/plugins'
		], { stdio: 'pipe' });
		assert.fail('The control CLI must reject learn-more links.');
	} catch (error) {
		assert.match(String((error as { stderr?: Buffer }).stderr), /do not support learn-more links/);
	}
	assert.equal(fs.existsSync(unsupportedControlOutputPath), false);

	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const publicKeyPath = path.join(temporary, 'public.pem');
	fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
	const signaturePath = path.join(temporary, 'catalog.sig.json');
	createSignatureFile({
		keyId: 'fixture-2026',
		signatureBase64: sign('sha256', fs.readFileSync(catalogPath), privateKey).toString('base64'),
		outputPath: signaturePath
	});
	const indexPath = path.join(temporary, 'catalog-index.json');
	const index = createCatalogIndex({ sequence: 41, outputPath: indexPath });
	assert.deepEqual(index, {
		schemaVersion: 1,
		sequence: 41,
		catalogPath: 'catalogs/41/catalog.json',
		signaturePath: 'catalogs/41/catalog.sig.json'
	});

	let mode: 'ok' | 'catalog-tampered' | 'vsix-tampered' | 'timeout' = 'ok';
	server = http.createServer((request, response) => {
		if (mode === 'timeout') {
			return;
		}
		if (request.url === '/catalog.json') {
			const bytes = fs.readFileSync(catalogPath);
			response.end(mode === 'catalog-tampered' ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes);
			return;
		}
		if (request.url === '/catalog.sig.json') {
			response.end(fs.readFileSync(signaturePath));
			return;
		}
		if (request.url === `/${release.assetPath}`) {
			const bytes = fs.readFileSync(release.vsixPath);
			response.end(mode === 'vsix-tampered' ? Buffer.concat([bytes, Buffer.from('tamper')]) : bytes);
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not bind a TCP port.');
	}
	const baseUrl = `http://127.0.0.1:${address.port}`;
	const legacyCatalogPath = path.join(temporary, 'catalog-legacy.json');
	const migratedCatalogPath = path.join(temporary, 'catalog-with-content-hashes.json');
	const legacyCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	delete legacyCatalog.plugins[0].primaryCommand;
	delete legacyCatalog.plugins[0].primaryCommandLabel;
	delete legacyCatalog.plugins[0].publisher;
	delete legacyCatalog.plugins[0].versions[0].installedContentSha256;
	fs.writeFileSync(legacyCatalogPath, `${JSON.stringify(legacyCatalog, null, 2)}\n`);
	const migratedCatalog = await backfillCatalogInstalledContentHashes({
		catalogPath: legacyCatalogPath,
		assetBaseUrl: `${baseUrl}/`,
		outputPath: migratedCatalogPath
	});
	assert.equal((migratedCatalog.plugins as any[])[0].primaryCommand, 'pointa.basehalf-ai-video.createWorkflow');
	assert.equal((migratedCatalog.plugins as any[])[0].primaryCommandLabel, 'Create Video Workflow…');
	assert.deepEqual((migratedCatalog.plugins as any[])[0].publisher, { slug: 'pointa', displayName: 'BaseHalf', trust: 'official' });
	assert.equal((migratedCatalog.plugins as any[])[0].versions[0].installedContentSha256, release.installedContentSha256);
	assert.deepEqual(JSON.parse(fs.readFileSync(migratedCatalogPath, 'utf8')), migratedCatalog);
	const options = {
		catalogUrl: `${baseUrl}/catalog.json`,
		signatureUrl: `${baseUrl}/catalog.sig.json`,
		assetBaseUrl: `${baseUrl}/`,
		publicKeyPath,
		keyId: 'fixture-2026',
		extensionId: OFFICIAL_EXTENSION_ID,
		version: release.version,
		expectedStatus: 'active' as const,
		minimumSequence: 41
	};
	const verified = await verifyRelease(options);
	assert.equal(verified.sha256, release.sha256);
	assert.equal(verified.installedContentSha256, release.installedContentSha256);

	mode = 'catalog-tampered';
	await assert.rejects(() => verifyRelease(options), /signature verification failed/);
	mode = 'vsix-tampered';
	await assert.rejects(() => verifyRelease(options), /exceeds|size or SHA-256/);
	mode = 'ok';
	await assert.rejects(() => verifyRelease({ ...options, expectedStatus: 'withdrawn' }), /expected 'withdrawn'/);
	await assert.rejects(() => verifyRelease({ ...options, extensionId: 'pointa.wrong' }), /does not contain/);
	await assert.rejects(() => verifyRelease({ ...options, version: '9.9.9' }), /does not contain/);
	mode = 'timeout';
	await assert.rejects(() => verifyRelease({ ...options, timeoutMs: 50 }), /abort|timeout/i);

	await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
	server = undefined;
	await assert.rejects(() => verifyRelease({ ...options, timeoutMs: 100 }), /fetch failed|ECONNREFUSED/i);
	console.log(JSON.stringify({ ok: true, extensionId: release.extensionId, version: release.version, sequence: 41 }));
} finally {
	if (server) {
		await new Promise<void>(resolve => server!.close(() => resolve()));
	}
	fs.rmSync(temporary, { recursive: true, force: true });
}

function writeVsix(file: string, entries: ReadonlyMap<string, Buffer>): Promise<void> {
	return new Promise((resolve, reject) => {
		const archive = new yazl.ZipFile();
		const output = fs.createWriteStream(file);
		output.on('error', reject);
		output.on('close', resolve);
		archive.outputStream.on('error', reject);
		archive.outputStream.pipe(output);
		for (const [name, bytes] of entries) {
			archive.addBuffer(bytes, name);
		}
		archive.end();
	});
}

function hashInstalledTree(root: string, retain = (_relative: string) => true, canonicalizeManifest = true): string {
	const entries: string[] = [];
	const visit = (directory: string, segments: string[]) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const nextSegments = [...segments, entry.name];
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolute, nextSegments);
				continue;
			}
			assert.equal(entry.isFile(), true);
			const relative = nextSegments.join('/');
				const source = fs.readFileSync(absolute);
				const retained = retain(relative) ? source : Buffer.alloc(0);
				const bytes = canonicalizeManifest && relative === 'package.json'
					? Buffer.from(baseHalfCanonicalInstalledFileBytes(relative, retained))
					: retained;
			entries.push(JSON.stringify([relative, bytes.byteLength, createHash('sha256').update(bytes).digest('hex')]));
		}
	};
	visit(root, []);
	entries.sort();
	return createHash('sha256').update(entries.join('\n')).digest('hex');
}

function setFirstEntryEncrypted(source: Buffer): Buffer {
	const result = Buffer.from(source);
	const local = result.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
	const central = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
	assert.notEqual(local, -1);
	assert.notEqual(central, -1);
	result.writeUInt16LE(result.readUInt16LE(local + 6) | 0x1, local + 6);
	result.writeUInt16LE(result.readUInt16LE(central + 8) | 0x1, central + 8);
	return result;
}

function addZipComment(source: Buffer, comment: Buffer): Buffer {
	const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
	const offset = source.lastIndexOf(signature);
	assert.notEqual(offset, -1);
	assert.equal(source.readUInt16LE(offset + 20), 0);
	assert.ok(comment.byteLength <= 0xffff);
	const result = Buffer.concat([source, comment]);
	result.writeUInt16LE(comment.byteLength, offset + 20);
	return result;
}

function corruptCentralCrc(source: Buffer, fileName: string): Buffer {
	const result = Buffer.from(source);
	let offset = 0;
	while ((offset = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
		const fileNameLength = result.readUInt16LE(offset + 28);
		const extraLength = result.readUInt16LE(offset + 30);
		const commentLength = result.readUInt16LE(offset + 32);
		const name = result.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
		if (name === fileName) {
			result.writeUInt32LE((result.readUInt32LE(offset + 16) ^ 1) >>> 0, offset + 16);
			return result;
		}
		offset += 46 + fileNameLength + extraLength + commentLength;
	}
	throw new Error(`Archive fixture does not contain '${fileName}'.`);
}

function assertWorkflowRunBlocksDoNotInterpolateInputs(file: string): void {
	const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';
		const match = /^(\s*)run:\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const indentation = match[1]?.length ?? 0;
		let block = match[2] ?? '';
		if (block === '|' || block === '>') {
			block = '';
			for (index++; index < lines.length; index++) {
				const candidate = lines[index] ?? '';
				if (candidate.trim() && candidate.length - candidate.trimStart().length <= indentation) {
					index--;
					break;
				}
				block += `${candidate}\n`;
			}
		}
		assert.equal(block.includes('${{ inputs.'), false, `${path.basename(file)} interpolates workflow inputs directly into a run block.`);
	}
}

function assertControlPlaneRequestsAreHardened(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	const preflight = source.indexOf('- name: Validate release trust configuration');
	const firstRequest = source.indexOf('x-basehalf-plugin-release-token:');
	if (firstRequest < 0) {
		return;
	}
	assert.ok(preflight >= 0 && preflight < firstRequest, `${path.basename(file)} must validate its control-plane origin before sending a release token.`);
	assert.match(source.slice(preflight, firstRequest), /basehalf-release-preflight\.mts control-url "\$CONTROL_PLANE_URL"/);

	let cursor = firstRequest;
	while (cursor >= 0) {
		const curlStart = source.lastIndexOf('curl ', cursor);
		const urlEnd = source.indexOf('\n', source.indexOf('$CONTROL_PLANE_URL/', cursor));
		assert.ok(curlStart >= 0 && urlEnd > cursor, `${path.basename(file)} has an incomplete control-plane request.`);
		const command = source.slice(curlStart, urlEnd);
		assert.match(command, /--proto '=https'/);
		assert.match(command, /--tlsv1\.2/);
		assert.match(command, /--connect-timeout 10/);
		assert.match(command, /--max-time 60/);
		assert.match(command, /--max-filesize 1048576/);
		cursor = source.indexOf('x-basehalf-plugin-release-token:', cursor + 1);
	}
}

function assertControlPlaneUrlValidation(): void {
	assert.equal(validateControlPlaneBaseUrl('https://api.example.test'), 'https://api.example.test');
	assert.equal(validateControlPlaneBaseUrl('https://api.example.test/'), 'https://api.example.test');
	for (const value of [
		'',
		' http://api.example.test',
		'http://api.example.test',
		'https://user:secret@api.example.test',
		'https://api.example.test/path',
		'https://api.example.test?mode=release',
		'https://api.example.test#release',
		'https://api.\nexample.test'
	]) {
		assert.throws(() => validateControlPlaneBaseUrl(value));
	}
}

function assertDirectPublishReconcilesImmutableAsset(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	const uploadStart = source.indexOf('- name: Upload immutable VSIX');
	const uploadEnd = source.indexOf('- name: Sign exact catalog bytes', uploadStart);
	const block = uploadStart >= 0 && uploadEnd > uploadStart ? source.slice(uploadStart, uploadEnd) : '';
	assert.match(block, /head-object --bucket "\$BUCKET" --key "\$ASSET_PATH"/);
	assert.match(block, /s3:\/\/\$\{BUCKET\}\/\$\{ASSET_PATH\}/);
	assert.match(block, /cmp "\$VSIX_PATH" "\$EXISTING_PATH"/);
	assert.match(block, /elif ! aws s3api put-object/);
	assert.ok(block.indexOf('s3 cp', block.indexOf('elif ! aws s3api put-object')) >= 0, 'Direct publishing must compare the winner after an immutable upload race.');
}

function assertDirectPublishFailsClosed(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	const fetchStart = source.indexOf('- name: Fetch and verify the previous catalog');
	const fetchEnd = source.indexOf('- name: Backfill immutable identities from the verified catalog', fetchStart);
	const fetchBlock = fetchStart >= 0 && fetchEnd > fetchStart ? source.slice(fetchStart, fetchEnd) : '';
	assert.match(source, /bootstrap_registry:/);
	assert.match(source, /INPUT_BOOTSTRAP_REGISTRY/);
	assert.match(fetchBlock, /object_state\(\)/);
	assert.match(fetchBlock, /\(404\|NoSuchKey\|NotFound\)/);
	assert.match(fetchBlock, /Refusing to bootstrap without explicit confirmation/);
	assert.match(fetchBlock, /bootstrap confirmation is valid only for an exact interrupted first publish/);
	assert.match(fetchBlock, /catalog and emergency control state disagree/);
	assert.match(fetchBlock, /partially completed registry bootstrap has a non-empty emergency control manifest/);
	assert.match(fetchBlock, /status-check/);
	assert.match(fetchBlock, /CATALOG_ALREADY_CURRENT/);
	assert.match(fetchBlock, /PUBLISH_SEQUENCE_CURRENT/);
	assert.match(fetchBlock, /BOOTSTRAP_INVENTORY_REQUIRED/);
	assert.match(fetchBlock, /Only an interrupted catalog change may resume at the current sequence/);
	assert.doesNotMatch(fetchBlock, /head-object[^\n]+>\/dev\/null 2>&1/);

	const bindContentHashes = source.indexOf('- name: Bind canonical installed content hashes');
	const backfill = source.indexOf('- name: Backfill immutable identities from the verified catalog');
	const packageStep = source.indexOf('- name: Compile and package AI Video');
	const inventory = source.indexOf('- name: Verify empty or resumable bootstrap inventory');
	const build = source.indexOf('- name: Build publish catalog');
	const reserve = source.indexOf('- name: Reserve immutable plugin version identity');
	const publish = source.indexOf('- name: Publish immutable catalog pair and atomic current index');
	const publishCondition = source.slice(publish, source.indexOf('\n        run:', publish));
	assert.ok(bindContentHashes > fetchStart && bindContentHashes < backfill, 'The verified legacy catalog must be bound to canonical installed content before identities are reused.');
	assert.match(source.slice(bindContentHashes, backfill), /catalog-content-hashes/);
	assert.ok(backfill > fetchStart && backfill < build, 'Verified catalog identities must be backfilled before a new catalog is built.');
	assert.ok(packageStep > backfill && inventory > packageStep && inventory < build, 'Bootstrap inventory must be checked after exact package metadata exists and before any first-release object is written.');
	const inventoryBlock = source.slice(inventory, build);
	assert.match(inventoryBlock, /BOOTSTRAP_INVENTORY_REQUIRED/);
	assert.match(inventoryBlock, /list-object-versions/);
	assert.match(inventoryBlock, /bootstrap-check/);
	assert.match(inventoryBlock, /--metadata "\$GITHUB_WORKSPACE\/release\/metadata\.json"/);
	assert.match(inventoryBlock, /inventory-extensions-control\.json/);
	assert.match(inventoryBlock, /\.malicious == \[\]/);
	assert.ok(reserve > build && reserve < publish, 'The new immutable version identity must be reserved after catalog validation and before publication.');
	assert.match(publishCondition, /env\.CATALOG_ALREADY_CURRENT != 'true'/);
	assert.match(source.slice(backfill, publish), /identities\/\$\{RELATIVE_PATH\}/);
	assert.match(source.slice(reserve, publish), /identities\/\$\{EXTENSION_ID\}\/\$\{VERSION\}\.json/);

	const reconcileCurrent = source.indexOf('- name: Reconcile an already-current publish');
	assert.ok(reconcileCurrent > build && reconcileCurrent < reserve, 'An already-current publish must be verified against the rebuilt package before publication is skipped.');
	assert.match(source.slice(reconcileCurrent, reserve), /publish-check/);
	assert.match(source.slice(reconcileCurrent, reserve), /CATALOG_ALREADY_CURRENT=true/);

	const reconcile = source.indexOf('- name: Reconcile an interrupted immutable catalog');
	const sign = source.indexOf('- name: Sign exact catalog bytes with KMS P-256');
	assert.ok(reconcile > 0 && reconcile < sign, 'An interrupted immutable status catalog must be reconciled before signing or publishing.');
	assert.match(source.slice(reconcile, sign), /del\(\.generatedAt\)/);
	assert.match(source.slice(reconcile, sign), /candidate-check/);
	assert.match(source.slice(reconcile, sign), /basehalf-catalog-kms\.sh verify/);

	const block = source.indexOf('- name: Publish fail-closed emergency control state');
	const verify = source.indexOf('- name: Verify release from CloudFront');
	const restore = source.indexOf('- name: Publish restored emergency control state');
	assert.ok(block > 0 && block < publish && publish < verify && verify < restore, 'Security withdrawal must block before the catalog switch; restore must unblock only after catalog verification.');
	assert.match(source.slice(block, publish), /security-withdraw/);
	assert.match(source.slice(block, publish), /--if-none-match '\*'/);
	assert.match(source.slice(block, publish), /cmp release\/extensions-control\.json release\/existing-extensions-control\.json/);
	assert.match(source.slice(block, publish), /cmp release\/extensions-control\.json release\/cdn-extensions-control\.json/);
	assert.match(source.slice(restore, source.indexOf('- name: Verify existing current catalog', restore)), /security-restore/);
	assert.doesNotMatch(source.slice(publish, verify), /extensions-control\.json/);
}

function assertReviewedPromotionConvergesAfterCatalogSwitch(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	assert.match(source, /ALREADY_PUBLISHED/);
	assert.match(source, /basehalf-plugin-release\.mts reconcile/);
	assert.equal((source.match(/--basehalf-range "\$\(jq -er \.basehalf_range release\/job\.json\)"/g) ?? []).length, 2);
	assert.equal((source.match(/--vscode-range "\$\(jq -er \.vscode_range release\/job\.json\)"/g) ?? []).length, 2);
	assert.equal((source.match(/--target-platform "\$\(jq -er \.target_platform release\/job\.json\)"/g) ?? []).length, 2);
	assert.match(source, /catalog-publication-attempted/);
	const recoveryStart = source.indexOf('complete_if_published()');
	const cdnSuccessMarker = source.indexOf('touch "$GITHUB_WORKSPACE/release/cdn-verified"');
	const recoveryCdnGuard = source.indexOf('test -f release/cdn-verified', recoveryStart);
	const recoveryComplete = source.indexOf('/complete"', recoveryStart);
	const ordinaryFailure = source.indexOf('/fail"', recoveryStart);
	assert.ok(cdnSuccessMarker >= 0 && recoveryCdnGuard > recoveryStart && recoveryCdnGuard < recoveryComplete, 'Promotion recovery may complete only after the CDN verification step records success.');
	assert.ok(recoveryStart >= 0 && recoveryComplete > recoveryStart && ordinaryFailure > recoveryComplete, 'Promotion recovery must reconcile and complete an already-published build before returning its lease as failed.');
}

function assertReviewedPromotionPreservesVersionIdentity(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	const verifyCatalog = source.indexOf('- name: Fetch and verify the current signed catalog');
	const backfill = source.indexOf('- name: Backfill immutable identities from the verified catalog');
	const reserve = source.indexOf('- name: Reserve immutable plugin version identity');
	const build = source.indexOf('- name: Build the next catalog');
	assert.ok(verifyCatalog >= 0 && backfill > verifyCatalog && reserve > backfill && build > reserve, 'Reviewed publishing must reconcile the signed catalog, backfill identities, and reserve the candidate identity before building the next catalog.');
	assert.match(source.slice(verifyCatalog, backfill), /basehalf-catalog-kms\.sh verify[\s\S]+catalog-content-hashes/);
	assert.match(source.slice(backfill, build), /identity \\\n\s+--catalog/);
	assert.match(source.slice(reserve, build), /identity \\\n\s+--metadata/);
	assert.match(source.slice(backfill, build), /--if-none-match '\*'/);
	assert.match(source, /next-sequence\.head-error/);
	assert.match(source, /\(404\|NoSuchKey\|NotFound\)/);
}

function assertReviewedPromotionRenewsReleaseLease(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	assert.match(source, /WORKER_ID: github-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
	const boundaries = [
		['Backfill immutable identities from the verified catalog', 'Reserve immutable plugin version identity'],
		['Reserve immutable plugin version identity', 'Build the next catalog'],
		['Upload immutable asset and sign catalog', 'Verify exact catalog signature before publication'],
		['Atomically publish the catalog', 'Verify through CloudFront'],
		['Complete release job', 'Return a failed lease to the release queue']
	] as const;
	for (const [startName, endName] of boundaries) {
		const start = source.indexOf(`- name: ${startName}`);
		const end = source.indexOf(`- name: ${endName}`, start);
		assert.ok(start >= 0 && end > start, `Missing reviewed promotion boundary '${startName}'.`);
		const block = source.slice(start, end);
		const renewal = block.indexOf('basehalf-release-lease.sh');
		const irreversible = Math.min(
			...['aws s3api put-object', 'aws kms sign', 'touch release/catalog-publication-attempted', 'x-basehalf-plugin-release-token:']
				.map(marker => block.indexOf(marker))
				.filter(index => index >= 0)
		);
		assert.ok(renewal >= 0 && irreversible >= 0 && renewal < irreversible, `Release lease must be renewed inside '${startName}' before its irreversible request.`);
	}
	const signingStart = source.indexOf('- name: Upload immutable asset and sign catalog');
	const signingEnd = source.indexOf('- name: Verify exact catalog signature before publication', signingStart);
	const signingBlock = source.slice(signingStart, signingEnd);
	assert.ok(
		signingBlock.lastIndexOf('basehalf-release-lease.sh', signingBlock.indexOf('aws kms sign')) > signingBlock.indexOf('cmp release/plugin.vsix'),
		'Reviewed promotion must renew again after asset reconciliation and immediately before signing.'
	);
	const publishStart = source.indexOf('- name: Atomically publish the catalog');
	const publishEnd = source.indexOf('- name: Verify through CloudFront', publishStart);
	const publishBlock = source.slice(publishStart, publishEnd);
	const indexSwitch = publishBlock.indexOf('s3 cp release/catalog-index.json');
	assert.ok(
		publishBlock.lastIndexOf('basehalf-release-lease.sh', indexSwitch) > publishBlock.indexOf('put_immutable release/catalog.sig.json'),
		'Reviewed promotion must renew again after immutable catalog writes and immediately before switching the catalog index.'
	);
	const recoveryStart = source.indexOf('complete_if_published()');
	const recoveryEnd = source.indexOf('/complete"', recoveryStart);
	const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
	assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
	assert.ok(recoveryBlock.indexOf('basehalf-release-lease.sh') > recoveryBlock.indexOf('test -f release/cdn-verified'));
	assert.match(recoveryBlock, /basehalf-release-lease\.sh[^\n]+\|\| true/);
}

function assertReleaseLeaseRequestIsHardened(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	assert.match(source, /--proto '=https'/);
	assert.match(source, /--tlsv1\.2/);
	assert.match(source, /--connect-timeout 10/);
	assert.match(source, /--max-time 30/);
	assert.match(source, /--max-filesize 65536/);
	assert.match(source, /\/internal\/releases\/\$\{JOB_ID\}\/renew/);
	assert.match(source, /\.code == "00000"/);
}

function assertCatalogKeyRotation(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	assert.match(source, /BASEHALF_CATALOG_SIGNING_KMS_KEY_ID/);
	assert.match(source, /BASEHALF_CATALOG_SIGNING_KEY_ID/);
	assert.match(source, /BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON/);
	assert.match(source, /basehalf-catalog-kms\.sh verify release\/previous\.json release\/previous\.sig\.json/);
	assert.match(source, /basehalf-catalog-kms\.sh resolve/);
	const keyPreflight = source.indexOf('basehalf-catalog-kms.sh preflight');
	assert.ok(keyPreflight >= 0, 'Every publishing workflow must validate all signing and trusted KMS keys before release work begins.');
	assert.doesNotMatch(source, /test "\$\(jq -r \.keyId release\/previous\.sig\.json\)" = "\$BASEHALF_CATALOG_SIGNING_KEY_ID"/);
	const sign = source.indexOf('aws kms sign');
	const preflight = source.indexOf('- name: Verify exact catalog signature before publication');
	const publish = Math.max(
		source.indexOf('- name: Publish immutable catalog pair and atomic current index'),
		source.indexOf('- name: Atomically publish the catalog')
	);
	assert.ok(sign >= 0 && keyPreflight < sign && preflight > sign && publish > preflight, 'Usable KMS keys and a generated catalog signature must be verified before any catalog publication step.');
	assert.match(source.slice(preflight, publish), /basehalf-catalog-kms\.sh verify-current release\/catalog\.json release\/catalog\.sig\.json/);
}

function assertCatalogKmsTrustSelection(file: string): void {
	const environment = {
		...process.env,
		BASEHALF_CATALOG_SIGNING_KEY_ID: 'release-new',
		BASEHALF_CATALOG_SIGNING_KMS_KEY_ID: 'kms-new',
		BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON: JSON.stringify({ 'release-old': 'kms-old', 'release-new': 'kms-new' })
	};
	assert.equal(execFileSync('bash', [file, 'resolve', 'release-old'], { encoding: 'utf8', env: environment }).trim(), 'kms-old');
	assert.equal(execFileSync('bash', [file, 'resolve', 'release-new'], { encoding: 'utf8', env: environment }).trim(), 'kms-new');
	assert.throws(() => execFileSync('bash', [file, 'resolve', 'release-unknown'], { stdio: 'pipe', env: environment }));
	const fallbackEnvironment = { ...environment, BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON: '' };
	assert.equal(execFileSync('bash', [file, 'resolve', 'release-new'], { encoding: 'utf8', env: fallbackEnvironment }).trim(), 'kms-new');
	assert.throws(() => execFileSync('bash', [file, 'resolve', 'release-old'], { stdio: 'pipe', env: fallbackEnvironment }));

	const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-kms-preflight-'));
	try {
		const fakeBin = path.join(fixture, 'bin');
		fs.mkdirSync(fakeBin);
		const fakeAws = path.join(fakeBin, 'aws');
		fs.writeFileSync(fakeAws, `#!/usr/bin/env bash
set -euo pipefail
test "$1" = kms
COMMAND="$2"
KEY_ID=
while [ "$#" -gt 0 ]; do
	if [ "$1" = --key-id ]; then KEY_ID="$2"; shift 2; continue; fi
	shift
done
case "$COMMAND" in
	verify)
		test "$KEY_ID" = "$EXPECTED_KMS_KEY"
		printf 'True\\n'
		;;
	describe-key)
		KEY_STATE=Enabled
		KEY_ENABLED=true
		KEY_USAGE=SIGN_VERIFY
		KEY_SPEC=ECC_NIST_P256
		if [ "$KEY_ID" = "\${DISABLED_KMS_KEY:-}" ]; then KEY_STATE=Disabled; KEY_ENABLED=false; fi
		if [ "$KEY_ID" = "\${WRONG_USAGE_KMS_KEY:-}" ]; then KEY_USAGE=ENCRYPT_DECRYPT; fi
		if [ "$KEY_ID" = "\${WRONG_SPEC_KMS_KEY:-}" ]; then KEY_SPEC=SYMMETRIC_DEFAULT; fi
		jq -nc --arg state "$KEY_STATE" --argjson enabled "$KEY_ENABLED" --arg usage "$KEY_USAGE" --arg spec "$KEY_SPEC" \
			'{KeyMetadata:{Enabled:$enabled,KeyState:$state,KeyUsage:$usage,KeySpec:$spec}}'
		;;
	*) exit 2 ;;
esac
`);
		fs.chmodSync(fakeAws, 0o755);
		const catalogPath = path.join(fixture, 'catalog.json');
		const signaturePath = path.join(fixture, 'catalog.sig.json');
		fs.writeFileSync(catalogPath, '{"schemaVersion":1}\n');
		fs.writeFileSync(signaturePath, JSON.stringify({ keyId: 'release-new', algorithm: 'ECDSA_P256_SHA256_DER', signature: 'AA==' }));
		const preflightEnvironment = {
			...environment,
			PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
			EXPECTED_KMS_KEY: 'kms-new'
		};
		execFileSync('bash', [file, 'preflight'], { stdio: 'pipe', env: preflightEnvironment });
		assert.throws(() => execFileSync('bash', [file, 'preflight'], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, DISABLED_KMS_KEY: 'kms-old' }
		}));
		assert.throws(() => execFileSync('bash', [file, 'preflight'], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, WRONG_USAGE_KMS_KEY: 'kms-new' }
		}));
		assert.throws(() => execFileSync('bash', [file, 'preflight'], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, WRONG_SPEC_KMS_KEY: 'kms-old' }
		}));
		assert.throws(() => execFileSync('bash', [file, 'preflight'], {
			stdio: 'pipe',
			env: {
				...preflightEnvironment,
				BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON: JSON.stringify({ 'release-old': 'kms-old' })
			}
		}));
		assert.throws(() => execFileSync('bash', [file, 'preflight'], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, BASEHALF_CATALOG_SIGNING_KMS_KEY_ID: 'kms-old' }
		}));
		execFileSync('bash', [file, 'verify-current', catalogPath, signaturePath], { stdio: 'pipe', env: preflightEnvironment });
		assert.throws(() => execFileSync('bash', [file, 'verify-current', catalogPath, signaturePath], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON: '' }
		}));
		assert.throws(() => execFileSync('bash', [file, 'verify-current', catalogPath, signaturePath], {
			stdio: 'pipe',
			env: {
				...preflightEnvironment,
				BASEHALF_CATALOG_TRUSTED_KMS_KEYS_JSON: JSON.stringify({ 'release-new': 'kms-old' })
			}
		}));
		assert.throws(() => execFileSync('bash', [file, 'verify-current', catalogPath, signaturePath], {
			stdio: 'pipe',
			env: { ...preflightEnvironment, BASEHALF_CATALOG_SIGNING_KMS_KEY_ID: 'kms-old' }
		}));
		fs.writeFileSync(signaturePath, JSON.stringify({ keyId: 'release-old', algorithm: 'ECDSA_P256_SHA256_DER', signature: 'AA==' }));
		assert.throws(() => execFileSync('bash', [file, 'verify-current', catalogPath, signaturePath], { stdio: 'pipe', env: preflightEnvironment }));
	} finally {
		fs.rmSync(fixture, { recursive: true, force: true });
	}
}

function assertCatalogStateFollowsCdnVerification(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	const verification = source.indexOf('- name: Verify release from CloudFront');
	const synchronization = source.indexOf('- name: Synchronize published withdrawal state with the control plane');
	assert.ok(verification >= 0 && synchronization > verification, 'Control-plane state may advance only after the signed CDN catalog is verified.');
	const verificationBlock = source.slice(verification, source.indexOf('- name: Publish restored emergency control state', verification));
	assert.match(verificationBlock, /\/v1\/catalog-index\.json/);
	assert.match(verificationBlock, /cmp "\$GITHUB_WORKSPACE\/release\/catalog-index\.json" "\$GITHUB_WORKSPACE\/release\/cdn-index\.json"/);
	assert.match(source, /options: \[publish, withdraw, rollback, security-withdraw, security-restore, sync-state\]/);
	assert.match(source, /Verify existing current catalog from CloudFront/);
	assert.match(source, /catalog_sequence: \.sequence/);
	assert.match(source, /--retry 3 --retry-all-errors --retry-delay 2/);
}

function assertTerraformSigningKeyRotation(mainFile: string, variablesFile: string, outputsFile: string): void {
	const source = fs.readFileSync(mainFile, 'utf8');
	const variables = fs.readFileSync(variablesFile, 'utf8');
	const outputs = fs.readFileSync(outputsFile, 'utf8');
	assert.match(variables, /variable "current_catalog_signing_key_arn"/);
	assert.match(variables, /variable "trusted_catalog_verification_key_arns"/);
	assert.match(source, /prevent_destroy = true/);
	assert.match(source, /data "aws_kms_key" "externally_managed_catalog"/);
	assert.match(source, /check "externally_managed_catalog_keys_are_usable"/);
	assert.match(source, /key\.enabled &&[\s\S]+key\.key_state == "Enabled"/);
	assert.match(source, /key\.key_usage == "SIGN_VERIFY"/);
	assert.match(source, /key\.key_spec == "ECC_NIST_P256"/);
	assert.match(source, /actions\s+= \["kms:Sign"\][\s\S]+resources = \[local\.catalog_signing_key_arn\]/);
	assert.match(source, /actions\s+= \["kms:GetPublicKey", "kms:Verify"\][\s\S]+resources = local\.catalog_verification_key_arns/);
	assert.match(outputs, /catalog_retained_managed_key_arn/);
	assert.match(outputs, /catalog_trusted_verification_key_arns/);
}

function assertDeveloperToolPublishIsResumable(file: string): void {
	const source = fs.readFileSync(file, 'utf8');
	assert.match(source, /publish_or_confirm @basehalf\/plugin-sdk/);
	assert.match(source, /publish_or_confirm @basehalf\/plugin-cli/);
	assert.match(source, /dist\.shasum/);
	assert.match(source, /already matches; skipping publish/);
}
