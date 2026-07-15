/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { generateKeyPairSync, sign } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCatalog, createCatalogIndex, createSignatureFile, metadataFromVsix, OFFICIAL_EXTENSION_ID, packagePlugin, updateCatalogStatus, updateExtensionControl, validateReviewedVsixManifest, verifyRelease } from './basehalf-plugin-release.mts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-plugin-fixture-'));
let server: http.Server | undefined;

try {
	const release = await packagePlugin({ root, outputDirectory: temporary });
	const reviewedRelease = await metadataFromVsix({
		vsixPath: release.vsixPath,
		expectedExtensionId: release.extensionId,
		expectedVersion: release.version,
		label: 'Reviewed workflow',
		publisherSlug: 'pointa',
		publisherDisplayName: 'Community Studio',
		publisherTrust: 'reviewed'
	});
	assert.equal(reviewedRelease.sha256, release.sha256);
	assert.deepEqual(reviewedRelease.publisher, {
		slug: 'pointa',
		displayName: 'Community Studio',
		trust: 'reviewed'
	});
	const reviewedFiles = new Set(['extension/package.json', 'extension/readme.md', 'extension/license.txt', 'extension/out/extension.js']);
	const reviewedManifest = {
		publisher: 'pointa',
		name: 'basehalf-ai-video',
		main: './out/extension.js',
		engines: { vscode: '^1.128.0', basehalf: '^0.4.0' },
		contributes: {
			basehalfCardProjections: [{ id: 'pointa.basehalf-ai-video.project', label: 'AI Video', extensions: ['.aivideo'] }]
		}
	};
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, enabledApiProposals: ['unsafe'] }, reviewedFiles, OFFICIAL_EXTENSION_ID), /proposed APIs/);
	assert.throws(() => validateReviewedVsixManifest({ ...reviewedManifest, contributes: { ...reviewedManifest.contributes, views: {} } }, reviewedFiles, OFFICIAL_EXTENSION_ID), /fixed application shell/);
	const metadataPath = path.join(temporary, 'metadata.json');
	fs.writeFileSync(metadataPath, JSON.stringify(release), 'utf8');
	const catalogPath = path.join(temporary, 'catalog.json');
	createCatalog({
		metadata: release,
		sequence: 41,
		outputPath: catalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:00:00.000Z'
	});
	const nextCatalogPath = path.join(temporary, 'catalog-next.json');
	const next = createCatalog({
		metadata: release,
		sequence: 42,
		outputPath: nextCatalogPath,
		previousPath: catalogPath,
		basehalfRange: '^0.4.0',
		vscodeRange: '^1.128.0',
		targetPlatform: 'universal',
		status: 'active',
		generatedAt: '2026-07-13T00:01:00.000Z'
	});
	assert.equal(next.sequence, 42);
	assert.equal((next.plugins as any[])[0].primaryCommand, 'pointa.basehalf-ai-video.createProject');
	assert.throws(() => createCatalog({
		metadata: release,
		sequence: 40,
		outputPath: path.join(temporary, 'rollback.json'),
		previousPath: catalogPath,
		basehalfRange: '^0.4.0', vscodeRange: '^1.128.0', targetPlatform: 'universal', status: 'active'
	}), /greater than previous sequence/);
	const rollbackPath = path.join(temporary, 'catalog-rollback.json');
	const rollback = updateCatalogStatus({ previousPath: nextCatalogPath, outputPath: rollbackPath, sequence: 43, extensionId: OFFICIAL_EXTENSION_ID, version: release.version, mode: 'rollback' });
	assert.equal(rollback.sequence, 43);
	const blockedControlPath = path.join(temporary, 'extensions-control-blocked.json');
	const blockedControl = updateExtensionControl({ outputPath: blockedControlPath, extensionId: OFFICIAL_EXTENSION_ID, blocked: true, learnMoreLink: 'https://basehalf.com/security/plugins' });
	assert.deepEqual(blockedControl.malicious, [OFFICIAL_EXTENSION_ID]);
	const restoredControl = updateExtensionControl({ previousPath: blockedControlPath, outputPath: path.join(temporary, 'extensions-control-restored.json'), extensionId: OFFICIAL_EXTENSION_ID, blocked: false });
	assert.deepEqual(restoredControl.malicious, []);

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

	mode = 'catalog-tampered';
	await assert.rejects(() => verifyRelease(options), /signature verification failed/);
	mode = 'vsix-tampered';
	await assert.rejects(() => verifyRelease(options), /size or SHA-256/);
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
