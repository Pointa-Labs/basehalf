/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createHash, generateKeyPairSync, sign, webcrypto, type KeyObject } from 'crypto';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { newWriteableStream } from '../../../../base/common/stream.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IExtensionManagementService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IBaseHalfPluginAdmissionService } from '../../common/basehalfPluginAdmissionService.js';
import { ecdsaDerToP1363, sha256HexToChecksumBase64, verifyBaseHalfPluginCatalogSignature } from '../../common/basehalfPluginCatalogSecurity.js';
import { BaseHalfPluginCatalogService, validateBaseHalfCatalogSequence } from '../../common/basehalfPluginCatalogService.js';
import { IBaseHalfPluginStateStore } from '../../common/basehalfPluginStateStore.js';

suite('BaseHalfPluginCatalogSecurity', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	suiteSetup(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }));
	suiteTeardown(() => {
		if (cryptoDescriptor) {
			Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
		} else {
			delete (globalThis as { crypto?: Crypto }).crypto;
		}
	});

	test('verifies an exact catalog payload with a keyed P-256 DER signature', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const payload = new TextEncoder().encode('{"schemaVersion":1,"sequence":3}');
		const signature = sign('sha256', payload, privateKey).toString('base64');
		const keys = [{ keyId: 'release-2026', publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString() }];

		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(payload, {
			keyId: 'release-2026',
			algorithm: 'ECDSA_P256_SHA256_DER',
			signature
		}, keys, webcrypto as unknown as Crypto), true);
		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(new TextEncoder().encode('{"tampered":true}'), {
			keyId: 'release-2026',
			algorithm: 'ECDSA_P256_SHA256_DER',
			signature
		}, keys, webcrypto as unknown as Crypto), false);
	});

	test('accepts signatures from each retained rotation key and rejects unknown key ids', async () => {
		const oldPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const newPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const payload = new TextEncoder().encode('{"schemaVersion":1,"sequence":4}');
		const keys = [
			{ keyId: 'release-old', publicKey: oldPair.publicKey.export({ format: 'pem', type: 'spki' }).toString() },
			{ keyId: 'release-new', publicKey: newPair.publicKey.export({ format: 'pem', type: 'spki' }).toString() }
		];
		const oldSignature = sign('sha256', payload, oldPair.privateKey).toString('base64');
		const newSignature = sign('sha256', payload, newPair.privateKey).toString('base64');

		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(payload, {
			keyId: 'release-old', algorithm: 'ECDSA_P256_SHA256_DER', signature: oldSignature
		}, keys, webcrypto as unknown as Crypto), true);
		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(payload, {
			keyId: 'release-new', algorithm: 'ECDSA_P256_SHA256_DER', signature: newSignature
		}, keys, webcrypto as unknown as Crypto), true);
		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(payload, {
			keyId: 'release-unknown', algorithm: 'ECDSA_P256_SHA256_DER', signature: newSignature
		}, keys, webcrypto as unknown as Crypto), false);
	});

	test('verifies only the bytes in a buffer view', async () => {
		const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const payload = Buffer.from('{"schemaVersion":1,"sequence":5}');
		const backing = Buffer.alloc(payload.byteLength + 32);
		payload.copy(backing, 16);
		const view = backing.subarray(16, 16 + payload.byteLength);
		const signature = sign('sha256', payload, pair.privateKey).toString('base64');

		assert.strictEqual(await verifyBaseHalfPluginCatalogSignature(view, {
			keyId: 'release-test',
			algorithm: 'ECDSA_P256_SHA256_DER',
			signature
		}, [{
			keyId: 'release-test',
			publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
		}], webcrypto as unknown as Crypto), true);
	});

	test('converts DER signatures and expected hex checksums', () => {
		const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const der = sign('sha256', Buffer.from('catalog'), privateKey);
		assert.strictEqual(ecdsaDerToP1363(der, 32).byteLength, 64);
		assert.strictEqual(sha256HexToChecksumBase64('00'.repeat(32)), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
		assert.throws(() => ecdsaDerToP1363(Uint8Array.of(1, 2, 3), 32), /DER sequence/);
	});

	test('rejects sequence rollback and same-sequence equivocation', () => {
		assert.doesNotThrow(() => validateBaseHalfCatalogSequence(8, 'same', 8, 'same'));
		assert.doesNotThrow(() => validateBaseHalfCatalogSequence(9, 'next', 8, 'same'));
		assert.throws(() => validateBaseHalfCatalogSequence(7, 'older', 8, 'same'), /older than/);
		assert.throws(() => validateBaseHalfCatalogSequence(8, 'different', 8, 'same'), /different content/);
	});

	test('serializes concurrent refreshes so a slower older catalog cannot replace a newer request', async () => {
		const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
		const catalogs = new Map([1, 2].map(sequence =>
			[sequence, signedRemoteCatalog(sequence, pair.privateKey)] as const
		));
		let indexRequests = 0;
		let enterOlder!: () => void;
		let releaseOlder!: () => void;
		const olderEntered = new Promise<void>(resolve => enterOlder = resolve);
		const olderGate = new Promise<void>(resolve => releaseOlder = resolve);
		const requestService = {
			async request(options: { readonly url: string }) {
				const url = new URL(options.url);
				if (url.pathname.endsWith('/catalog-index.json')) {
					const sequence = ++indexRequests;
					return response(JSON.stringify({
						schemaVersion: 1,
						sequence,
						catalogPath: `catalogs/${sequence}/catalog.json`,
						signaturePath: `catalogs/${sequence}/catalog.sig.json`
					}));
				}
				const match = /\/catalogs\/(\d+)\/(catalog|catalog\.sig)\.json$/.exec(url.pathname);
				assert.ok(match);
				const sequence = Number(match[1]);
				if (sequence === 1 && match[2] === 'catalog') {
					enterOlder();
					await olderGate;
				}
				const catalog = catalogs.get(sequence)!;
				return response(match[2] === 'catalog' ? catalog.raw : catalog.signature);
			}
		};
		const stored = new Map<string, string | number>();
		const storageService = {
			get: (key: string) => typeof stored.get(key) === 'string' ? stored.get(key) as string : undefined,
			getNumber: (key: string, _scope: StorageScope, fallback: number) => typeof stored.get(key) === 'number' ? stored.get(key) as number : fallback,
			store: (key: string, value: string | number) => stored.set(key, value),
			onDidChangeValue: () => Event.None
		};
		const service = new BaseHalfPluginCatalogService(
			{
				version: '1.128.0',
				basehalfVersion: '0.4.1',
				basehalfPlugins: {
					catalogIndexUrl: 'http://127.0.0.1:8123/catalog-index.json',
					assetBaseUrl: 'http://127.0.0.1:8123/assets/',
					publicKeys: [{
						keyId: 'release-test',
						publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
					}]
				}
			} as unknown as IProductService,
			requestService as unknown as IRequestService,
			storageService as unknown as IStorageService,
			{ getTargetPlatform: async () => 'darwin-arm64' } as unknown as IExtensionManagementService,
			{ warn() { } } as unknown as ILogService,
			{
				replaceVerifiedPlugins() { },
				async reverifyVerifiedInstalls() { }
			} as unknown as IBaseHalfPluginAdmissionService,
			memoryPluginStateStore(stored)
		);
		const older = service.refresh();
		await olderEntered;
		const newer = service.refresh();
		await Promise.resolve();
		assert.strictEqual(indexRequests, 1);
		releaseOlder();
		const olderSnapshot = await older;
		const newerSnapshot = await newer;
		assert.strictEqual(olderSnapshot.sequence, 1, olderSnapshot.error);
		assert.strictEqual(newerSnapshot.sequence, 2, newerSnapshot.error);
		assert.strictEqual((await service.getSnapshot()).sequence, 2);
		assert.strictEqual(JSON.parse(String(stored.get('basehalf.plugins.catalog.state.v1'))).sequence, 2);
		service.dispose();
	});

	test('heals the persisted monotonic floor after accepting a verified cache', async () => {
		const fixture = await createCatalogServiceFixture({
			cachedSequence: 5,
			highestSequence: 3,
			highestFingerprint: 'a'.repeat(64)
		});

		const snapshot = await fixture.service.getSnapshot();
		assert.strictEqual(snapshot.source, 'cache');
		assert.strictEqual(snapshot.sequence, 5);
		const persisted = JSON.parse(String(fixture.stored.get('basehalf.plugins.catalog.state.v1')));
		assert.strictEqual(persisted.sequence, 5);
		assert.match(persisted.fingerprint, /^[a-f0-9]{64}$/);
		fixture.service.dispose();
	});

	test('hydrates a same-sequence signed catalog after restoring a floor-only state', async () => {
		const fixture = await createCatalogServiceFixture({ atomicFloorSequence: 5 });
		assert.strictEqual((await fixture.service.getSnapshot()).source, 'bundled');

		const signed = fixture.signed.get(5)!;
		fixture.stored.set('basehalf.plugins.catalog.state.v1', JSON.stringify({
			schemaVersion: 1,
			sequence: 5,
			fingerprint: createHash('sha256').update(signed.raw).digest('hex'),
			rawCatalog: signed.raw,
			rawSignature: signed.signature
		}));
		await (fixture.service as unknown as { synchronizePersistedState(): Promise<void> }).synchronizePersistedState();

		const snapshot = await fixture.service.getSnapshot();
		assert.strictEqual(snapshot.source, 'cache');
		assert.strictEqual(snapshot.sequence, 5);
		fixture.service.dispose();
	});

	test('preserves a legacy sequence floor when the legacy cache is corrupt', async () => {
		const fixture = await createCatalogServiceFixture({
			cachedSequence: 5,
			highestSequence: 7,
			highestFingerprint: '7'.repeat(64),
			invalidCachedSignature: true
		});

		assert.strictEqual((await fixture.service.getSnapshot()).source, 'bundled');
		const persisted = JSON.parse(String(fixture.stored.get('basehalf.plugins.catalog.state.v1')));
		assert.strictEqual(persisted.sequence, 7);
		assert.strictEqual(persisted.fingerprint, '7'.repeat(64));
		assert.strictEqual(persisted.rawCatalog, undefined);
		fixture.service.dispose();
	});

	test('keeps the accepted in-memory sequence as a floor when persisted state is lost', async () => {
		const fixture = await createCatalogServiceFixture({});
		const sequenceAcceptance = fixture.service as unknown as {
			acceptCatalogSequence(sequence: number, fingerprint: string): void;
			commitCatalogState(state: { schemaVersion: 1; sequence: number; fingerprint: string }): Promise<{ sequence: number; fingerprint?: string }>;
		};
		const acceptedFingerprint = 'a'.repeat(64);
		sequenceAcceptance.acceptCatalogSequence(2, acceptedFingerprint);
		fixture.stored.delete('basehalf.plugins.catalog.state.v1');
		assert.throws(
			() => sequenceAcceptance.acceptCatalogSequence(1, 'b'.repeat(64)),
			/sequence 1 is older than the verified sequence 2/
		);
		await assert.rejects(
			() => sequenceAcceptance.commitCatalogState({ schemaVersion: 1, sequence: 1, fingerprint: 'b'.repeat(64) }),
			/sequence 1 is older than the verified sequence 2/
		);
		await assert.rejects(
			() => sequenceAcceptance.commitCatalogState({ schemaVersion: 1, sequence: 2, fingerprint: 'c'.repeat(64) }),
			/already verified with different content/
		);
		assert.strictEqual(fixture.stored.has('basehalf.plugins.catalog.state.v1'), false);
		fixture.service.dispose();
	});

	test('coordinates sequence advancement and equivocation across service instances', async () => {
		const stored = new Map<string, string | number>();
		const stateStore = memoryPluginStateStore(stored);
		const first = bareCatalogService(stateStore);
		const second = bareCatalogService(stateStore);
		const firstCommit = first as unknown as {
			commitCatalogState(state: { schemaVersion: 1; sequence: number; fingerprint: string }): Promise<{ sequence: number; fingerprint?: string }>;
		};
		const secondCommit = second as unknown as typeof firstCommit;

		const advancement = await Promise.allSettled([
			firstCommit.commitCatalogState({ schemaVersion: 1, sequence: 7, fingerprint: '7'.repeat(64) }),
			secondCommit.commitCatalogState({ schemaVersion: 1, sequence: 8, fingerprint: '8'.repeat(64) })
		]);
		assert.strictEqual(advancement[1].status, 'fulfilled');
		assert.strictEqual(JSON.parse(String(stored.get('basehalf.plugins.catalog.state.v1'))).sequence, 8);

		const equivocationStore = new Map<string, string | number>();
		const equivocationStateStore = memoryPluginStateStore(equivocationStore);
		const thirdService = bareCatalogService(equivocationStateStore);
		const fourthService = bareCatalogService(equivocationStateStore);
		const third = thirdService as unknown as typeof firstCommit;
		const fourth = fourthService as unknown as typeof firstCommit;
		const equivocation = await Promise.allSettled([
			third.commitCatalogState({ schemaVersion: 1, sequence: 9, fingerprint: 'a'.repeat(64) }),
			fourth.commitCatalogState({ schemaVersion: 1, sequence: 9, fingerprint: 'b'.repeat(64) })
		]);
		assert.strictEqual(equivocation.filter(result => result.status === 'fulfilled').length, 1);
		assert.strictEqual(equivocation.filter(result => result.status === 'rejected').length, 1);
		first.dispose();
		second.dispose();
		thirdService.dispose();
		fourthService.dispose();
	});
});

async function createCatalogServiceFixture(options: {
	readonly cachedSequence?: number;
	readonly highestSequence?: number;
	readonly highestFingerprint?: string;
	readonly atomicFloorSequence?: number;
	readonly invalidCachedSignature?: boolean;
	readonly refreshSequences?: readonly number[];
}): Promise<{
	readonly service: BaseHalfPluginCatalogService;
	readonly stored: Map<string, string | number>;
	readonly signed: ReadonlyMap<number, { readonly raw: string; readonly signature: string }>;
}> {
	const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const sequences = new Set([options.cachedSequence, options.atomicFloorSequence, ...(options.refreshSequences ?? [])].filter((value): value is number => value !== undefined));
	const signed = new Map([...sequences].map(sequence =>
		[sequence, signedRemoteCatalog(sequence, pair.privateKey)] as const
	));
	const stored = new Map<string, string | number>();
	if (options.cachedSequence !== undefined) {
		const cached = signed.get(options.cachedSequence)!;
		stored.set('basehalf.plugins.catalog.raw', cached.raw);
		stored.set('basehalf.plugins.catalog.signature', options.invalidCachedSignature ? '{}' : cached.signature);
	}
	if (options.highestSequence !== undefined) {
		stored.set('basehalf.plugins.catalog.highestSequence', options.highestSequence);
	}
	if (options.highestFingerprint !== undefined) {
		stored.set('basehalf.plugins.catalog.highestFingerprint', options.highestFingerprint);
	}
	if (options.atomicFloorSequence !== undefined) {
		const atomic = signed.get(options.atomicFloorSequence)!;
		stored.set('basehalf.plugins.catalog.state.v1', JSON.stringify({
			schemaVersion: 1,
			sequence: options.atomicFloorSequence,
			fingerprint: createHash('sha256').update(atomic.raw).digest('hex')
		}));
	}
	let refreshIndex = 0;
	const requestService = {
		async request(request: { readonly url: string }) {
			const url = new URL(request.url);
			if (url.pathname.endsWith('/catalog-index.json')) {
				const sequence = options.refreshSequences?.[refreshIndex++];
				if (sequence === undefined) {
					throw new Error('Unexpected catalog refresh request.');
				}
				return response(JSON.stringify({
					schemaVersion: 1,
					sequence,
					catalogPath: `catalogs/${sequence}/catalog.json`,
					signaturePath: `catalogs/${sequence}/catalog.sig.json`
				}));
			}
			const match = /\/catalogs\/(\d+)\/(catalog|catalog\.sig)\.json$/.exec(url.pathname);
			assert.ok(match);
			const catalog = signed.get(Number(match[1]))!;
			return response(match[2] === 'catalog' ? catalog.raw : catalog.signature);
		}
	};
	const storageService = {
		get: (key: string) => typeof stored.get(key) === 'string' ? stored.get(key) as string : undefined,
		getNumber: (key: string, _scope: StorageScope, fallback: number) => typeof stored.get(key) === 'number' ? stored.get(key) as number : fallback,
		store: (key: string, value: string | number) => stored.set(key, value),
		onDidChangeValue: () => Event.None
	};
	const service = new BaseHalfPluginCatalogService(
		{
			version: '1.128.0',
			basehalfVersion: '0.4.1',
			basehalfPlugins: {
				catalogIndexUrl: 'http://127.0.0.1:8123/catalog-index.json',
				assetBaseUrl: 'http://127.0.0.1:8123/assets/',
				publicKeys: [{
					keyId: 'release-test',
					publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString()
				}]
			}
		} as unknown as IProductService,
		requestService as unknown as IRequestService,
		storageService as unknown as IStorageService,
		{ getTargetPlatform: async () => 'darwin-arm64' } as unknown as IExtensionManagementService,
		{ warn() { } } as unknown as ILogService,
		{
			replaceVerifiedPlugins() { },
			async reverifyVerifiedInstalls() { }
		} as unknown as IBaseHalfPluginAdmissionService,
		memoryPluginStateStore(stored)
	);
	return { service, stored, signed };
}

function memoryPluginStateStore(stored: Map<string, string | number>): IBaseHalfPluginStateStore {
	return {
		_serviceBrand: undefined,
		async read(key: string) {
			const value = stored.get(key);
			return typeof value === 'string' ? value : undefined;
		},
		async compareAndSwap(key: string, expected: string | undefined, value: string | undefined) {
			const current = stored.get(key);
			const currentString = typeof current === 'string' ? current : undefined;
			if (currentString !== expected) {
				return { swapped: false, current: currentString };
			}
			if (value === undefined) {
				stored.delete(key);
			} else {
				stored.set(key, value);
			}
			return { swapped: true, current: value };
		}
	};
}

function bareCatalogService(stateStore: IBaseHalfPluginStateStore): BaseHalfPluginCatalogService {
	return new BaseHalfPluginCatalogService(
		{ version: '1.128.0', basehalfVersion: '0.4.1' } as IProductService,
		{} as IRequestService,
		{
			get: () => undefined,
			getNumber: (_key: string, _scope: StorageScope, fallback: number) => fallback,
			onDidChangeValue: () => Event.None
		} as unknown as IStorageService,
		{ getTargetPlatform: async () => 'darwin-arm64' } as unknown as IExtensionManagementService,
		{ warn() { } } as unknown as ILogService,
		{
			replaceVerifiedPlugins() { },
			async reverifyVerifiedInstalls() { }
		} as unknown as IBaseHalfPluginAdmissionService,
		stateStore
	);
}

function signedRemoteCatalog(sequence: number, privateKey: KeyObject): { readonly raw: string; readonly signature: string } {
	const raw = JSON.stringify(remoteCatalog(sequence));
	const signature = {
		keyId: 'release-test',
		algorithm: 'ECDSA_P256_SHA256_DER' as const,
		signature: sign('sha256', Buffer.from(raw), privateKey).toString('base64')
	};
	return { raw, signature: JSON.stringify(signature) };
}

function remoteCatalog(sequence: number): Record<string, unknown> {
	const sha256 = String(sequence).repeat(64);
	return {
		schemaVersion: 1,
		sequence,
		generatedAt: `2026-07-${String(sequence).padStart(2, '0')}T00:00:00.000Z`,
		plugins: [{
			extensionId: 'pointa.basehalf-ai-video',
			label: 'AI Video',
			description: 'Official domain tools.',
			category: 'Domain',
			versions: [{
				version: `0.${sequence}.0`,
				basehalfRange: '*',
				vscodeRange: '*',
				targetPlatform: 'universal',
				assetPath: `pointa.basehalf-ai-video/0.${sequence}.0/${sha256}.vsix`,
				sha256,
				installedContentSha256: 'b'.repeat(64),
				size: 4,
				publishedAt: `2026-07-${String(sequence).padStart(2, '0')}T00:00:00.000Z`,
				status: 'active'
			}]
		}]
	};
}

function response(value: string): { res: { statusCode: number; headers: Record<string, string> }; stream: ReturnType<typeof newWriteableStream<VSBuffer>> } {
	const stream = newWriteableStream<VSBuffer>(chunks => VSBuffer.concat(chunks));
	stream.end(VSBuffer.fromString(value));
	return { res: { statusCode: 200, headers: {} }, stream };
}
