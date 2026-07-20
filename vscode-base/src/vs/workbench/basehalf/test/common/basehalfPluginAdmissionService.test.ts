/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { FileAccess } from '../../../../base/common/network.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { extUri, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { BASEHALF_CURATED_PLUGINS } from '../../common/basehalfPluginCatalog.js';
import { BaseHalfPluginAdmissionService, hashBaseHalfPluginInstall, IBaseHalfPluginContributorIdentity } from '../../common/basehalfPluginAdmissionService.js';

suite('BaseHalfPluginAdmissionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const fileService = () => {
		const service = disposables.add(new FileService(new NullLogService()));
		disposables.add(service.registerProvider('plugin-memory', disposables.add(new InMemoryFileSystemProvider())));
		return service;
	};

	test('canonicalizes host-owned manifest metadata without hiding plugin changes', async () => {
		const files = fileService();
		const location = URI.parse('plugin-memory:/canonical-install');
		await files.createFolder(location);
		const manifestLocation = joinPath(location, 'package.json');
		const manifest = { publisher: 'reviewed', name: 'workflow', version: '1.0.0' };
		await files.writeFile(manifestLocation, VSBuffer.fromString(`${JSON.stringify(manifest)}\n`));
		await files.writeFile(joinPath(location, 'extension.js'), VSBuffer.fromString('export {};\n'));
		const archiveTreeHash = await hashBaseHalfPluginInstall(files, location);

		await files.writeFile(manifestLocation, VSBuffer.fromString(JSON.stringify({
			...manifest,
			__metadata: { id: 'dynamic-install-id', installedTimestamp: 123 }
		}, null, '\t')));
		assert.strictEqual(await hashBaseHalfPluginInstall(files, location), archiveTreeHash);

		await files.writeFile(manifestLocation, VSBuffer.fromString(JSON.stringify({
			...manifest,
			version: '1.0.1',
			__metadata: { id: 'dynamic-install-id' }
		}, null, '\t')));
		assert.notStrictEqual(await hashBaseHalfPluginInstall(files, location), archiveTreeHash);

		await files.writeFile(manifestLocation, VSBuffer.wrap(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d])));
		await assert.rejects(() => hashBaseHalfPluginInstall(files, location), /strict UTF-8 JSON/);
	});

	test('separates bundled official trust from exact signed-version trust', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const service = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		const official = BASEHALF_CURATED_PLUGINS[0];
		const officialSha256 = 'a'.repeat(64);
		const reviewedSha256 = 'b'.repeat(64);
		const reviewedLocation = URI.parse('plugin-memory:/installed-reviewed');
		await createPluginContent(files, reviewedLocation);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, reviewedLocation);
		if (!official.bundledPath) {
			throw new Error('Expected an official bundled plugin fixture.');
		}
		const bundledLocation = joinPath(FileAccess.asFileUri(''), '..', ...official.bundledPath.split('/'));

		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.1.0', bundledLocation)), true);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.1.0', URI.file('/tmp/untrusted-extension'))), false);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.1.0', URI.file('/tmp/builtin'), true)), false);
		assert.strictEqual(service.isAllowedContributor(identity('untrusted.extension', '1.0.0', URI.file('/tmp/builtin'), true)), false);

		service.replaceVerifiedPlugins([
			{ extensionId: official.extensionId, versions: [{ version: '0.2.0', sha256: officialSha256, installedContentSha256 }] },
			{ extensionId: 'reviewed.workflow', versions: [{ version: '1.4.0', sha256: reviewedSha256, installedContentSha256 }] }
		]);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.2.0', URI.file('/tmp/installed-official'))), false);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.1.0', URI.file('/tmp/installed-official'))), false);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.4.0', URI.file('/tmp/installed-reviewed'))), false);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.4.1', URI.file('/tmp/installed-reviewed'))), false);
		assert.strictEqual(await service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.4.0', sha256: 'c'.repeat(64), extensionLocation: reviewedLocation, expectedInstalledContentSha256: installedContentSha256 }), undefined);
		assert.strictEqual(await service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.4.0', sha256: reviewedSha256, extensionLocation: reviewedLocation, expectedInstalledContentSha256: 'f'.repeat(64) }), undefined);
		assert.ok(await service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.4.0', sha256: reviewedSha256, extensionLocation: reviewedLocation, expectedInstalledContentSha256: installedContentSha256 }));
		assert.strictEqual(service.getVerifiedInstall('reviewed.workflow', '1.4.0', reviewedLocation)?.sha256, reviewedSha256);
		assert.strictEqual(service.getVerifiedInstall('reviewed.workflow', '1.4.0', URI.parse('plugin-memory:/other-location')), undefined);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.4.0', reviewedLocation)), true);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.4.0', URI.parse('plugin-memory:/other-location'))), false);

		service.replaceVerifiedPlugins([]);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.4.0', reviewedLocation)), false);
	});

	test('reverifies persisted installation bytes and rejects in-place replacement', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const sha256 = 'd'.repeat(64);
		const files = fileService();
		const location = URI.parse('plugin-memory:/persisted-reviewed');
		await files.createFolder(location);
		const manifest = joinPath(location, 'package.json');
		await files.writeFile(manifest, VSBuffer.fromString('{"name":"workflow"}\n'));
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const first = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		first.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256 }] }]);
		assert.ok(await first.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '2.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 }));
		first.dispose();

		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256 }] }]);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), false);
		await restored.reverifyVerifiedInstalls();
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), true);
		// A receipt proves one exact package grant. A later signed catalog entry
		// with the same semantic version but different bits must not inherit it,
		// including when the receipt was restored from offline local state.
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256: 'e'.repeat(64), installedContentSha256 }] }]);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), false);
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256 }] }]);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), true);
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256: 'f'.repeat(64) }] }]);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), false);
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256 }] }]);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), true);
		restored.dispose();
		await files.writeFile(manifest, VSBuffer.fromString('{"name":"replacement"}\n'));
		const replaced = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		replaced.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '2.0.0', sha256, installedContentSha256 }] }]);
		await replaced.reverifyVerifiedInstalls();
		assert.strictEqual(replaced.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), false);
		replaced.forgetVerifiedInstalls('reviewed.workflow');
		assert.strictEqual(replaced.isAllowedContributor(identity('reviewed.workflow', '2.0.0', location)), false);
	});

	test('keeps an exact restored installation and removes its receipt after content replacement', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const location = URI.parse('plugin-memory:/reconciled-install');
		await createPluginContent(files, location);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const service = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), withoutFileChangeEvents(files)));
		const sha256 = '7'.repeat(64);
		service.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '3.0.0', sha256, installedContentSha256 }] }]);
		assert.ok(await service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '3.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 }));

		await files.del(location, { recursive: true });
		await createPluginContent(files, location);
		await service.reconcileVerifiedInstalls('reviewed.workflow', [{ version: '3.0.0', extensionLocation: location }]);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '3.0.0', location)), true);

		await files.writeFile(joinPath(location, 'extension.js'), VSBuffer.fromString('changed content'));
		await service.reconcileVerifiedInstalls('reviewed.workflow', [{ version: '3.0.0', extensionLocation: location }]);
		assert.strictEqual(service.getVerifiedInstall('reviewed.workflow', '3.0.0', location), undefined);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '3.0.0', location)), false);
	});

	test('removes receipts when reconciliation confirms the plugin is uninstalled', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const location = URI.parse('plugin-memory:/removed-install');
		await createPluginContent(files, location);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const service = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), withoutFileChangeEvents(files)));
		const sha256 = '8'.repeat(64);
		const grants = [{ extensionId: 'reviewed.workflow', versions: [{ version: '4.0.0', sha256, installedContentSha256 }] }];
		service.replaceVerifiedPlugins(grants);
		assert.ok(await service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '4.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 }));

		await service.reconcileVerifiedInstalls('reviewed.workflow', []);
		assert.strictEqual(service.getVerifiedInstall('reviewed.workflow', '4.0.0', location), undefined);

		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), withoutFileChangeEvents(files)));
		restored.replaceVerifiedPlugins(grants);
		await restored.reverifyVerifiedInstalls();
		assert.strictEqual(restored.getVerifiedInstall('reviewed.workflow', '4.0.0', location), undefined);
	});

	test('does not restore a receipt whose verification overlaps confirmed uninstall', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const location = URI.parse('plugin-memory:/pending-removed-install');
		await createPluginContent(files, location);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const sha256 = '9'.repeat(64);
		const grants = [{ extensionId: 'reviewed.workflow', versions: [{ version: '5.0.0', sha256, installedContentSha256 }] }];
		const initial = new BaseHalfPluginAdmissionService(storage, environment(), files);
		initial.replaceVerifiedPlugins(grants);
		assert.ok(await initial.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '5.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 }));
		initial.dispose();

		const gate = controlledReadFileService(files);
		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), gate.service));
		restored.replaceVerifiedPlugins(grants);
		const verification = restored.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '5.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 });
		await gate.entered.p;
		await restored.reconcileVerifiedInstalls('reviewed.workflow', []);
		gate.release.complete(undefined);

		assert.strictEqual(await verification, undefined);
		assert.strictEqual(restored.getVerifiedInstall('reviewed.workflow', '5.0.0', location), undefined);
	});

	test('does not admit an installation changed while its first verification is pending', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const location = URI.parse('plugin-memory:/pending-first-verification');
		await createPluginContent(files, location);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const gate = controlledReadFileService(files);
		const service = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), gate.service));
		const sha256 = 'a'.repeat(64);
		service.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '1.0.0', sha256, installedContentSha256 }] }]);

		const verification = service.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 });
		await gate.entered.p;
		await mutateAndWaitForFileChange(gate.service, location, () => files.writeFile(joinPath(location, 'late.js'), VSBuffer.fromString('late content')));
		gate.release.complete(undefined);

		assert.strictEqual(await verification, undefined);
		assert.strictEqual(service.getVerifiedInstall('reviewed.workflow', '1.0.0', location), undefined);
		assert.strictEqual(service.isAllowedContributor(identity('reviewed.workflow', '1.0.0', location)), false);
	});

	test('does not resurrect a persisted receipt invalidated during re-verification', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const location = URI.parse('plugin-memory:/pending-restored-verification');
		await createPluginContent(files, location);
		const installedContentSha256 = await hashBaseHalfPluginInstall(files, location);
		const sha256 = 'b'.repeat(64);
		const first = new BaseHalfPluginAdmissionService(storage, environment(), files);
		first.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '1.0.0', sha256, installedContentSha256 }] }]);
		assert.ok(await first.verifyAndRecordInstall({ extensionId: 'reviewed.workflow', version: '1.0.0', sha256, extensionLocation: location, expectedInstalledContentSha256: installedContentSha256 }));
		first.dispose();

		const gate = controlledReadFileService(files);
		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), gate.service));
		restored.replaceVerifiedPlugins([{ extensionId: 'reviewed.workflow', versions: [{ version: '1.0.0', sha256, installedContentSha256 }] }]);
		const reverify = restored.reverifyVerifiedInstalls();
		await gate.entered.p;
		await mutateAndWaitForFileChange(gate.service, location, () => files.writeFile(joinPath(location, 'late.js'), VSBuffer.fromString('late content')));
		gate.release.complete(undefined);
		await reverify;

		assert.strictEqual(restored.getVerifiedInstall('reviewed.workflow', '1.0.0', location), undefined);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.workflow', '1.0.0', location)), false);
	});

	test('does not resurrect an earlier receipt invalidated while a later receipt is being verified', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const firstLocation = URI.parse('plugin-memory:/first-persisted-install');
		const secondLocation = URI.parse('plugin-memory:/second-persisted-install');
		await createPluginContent(files, firstLocation);
		await createPluginContent(files, secondLocation);
		await waitForNextFileChanges(files);
		const firstInstalledContentSha256 = await hashBaseHalfPluginInstall(files, firstLocation);
		const secondInstalledContentSha256 = await hashBaseHalfPluginInstall(files, secondLocation);
		const firstSha256 = 'c'.repeat(64);
		const secondSha256 = 'd'.repeat(64);
		const initial = new BaseHalfPluginAdmissionService(storage, environment(), files);
		initial.replaceVerifiedPlugins([
			{ extensionId: 'reviewed.first', versions: [{ version: '1.0.0', sha256: firstSha256, installedContentSha256: firstInstalledContentSha256 }] },
			{ extensionId: 'reviewed.second', versions: [{ version: '1.0.0', sha256: secondSha256, installedContentSha256: secondInstalledContentSha256 }] }
		]);
		assert.ok(await initial.verifyAndRecordInstall({ extensionId: 'reviewed.first', version: '1.0.0', sha256: firstSha256, extensionLocation: firstLocation, expectedInstalledContentSha256: firstInstalledContentSha256 }));
		assert.ok(await initial.verifyAndRecordInstall({ extensionId: 'reviewed.second', version: '1.0.0', sha256: secondSha256, extensionLocation: secondLocation, expectedInstalledContentSha256: secondInstalledContentSha256 }));
		initial.dispose();

		const gate = controlledReadFileService(files, secondLocation);
		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), gate.service));
		restored.replaceVerifiedPlugins([
			{ extensionId: 'reviewed.first', versions: [{ version: '1.0.0', sha256: firstSha256, installedContentSha256: firstInstalledContentSha256 }] },
			{ extensionId: 'reviewed.second', versions: [{ version: '1.0.0', sha256: secondSha256, installedContentSha256: secondInstalledContentSha256 }] }
		]);
		const reverify = restored.reverifyVerifiedInstalls();
		await gate.entered.p;
		await mutateAndWaitForFileChange(gate.service, firstLocation, () => files.writeFile(joinPath(firstLocation, 'late.js'), VSBuffer.fromString('late content')));
		gate.release.complete(undefined);
		await reverify;

		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.first', '1.0.0', firstLocation)), false);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.second', '1.0.0', secondLocation)), true);
	});

	test('does not discard a newly verified installation while restored receipts are being checked', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const restoredLocation = URI.parse('plugin-memory:/restored-install');
		const newlyInstalledLocation = URI.parse('plugin-memory:/new-install');
		await createPluginContent(files, restoredLocation);
		await createPluginContent(files, newlyInstalledLocation);
		const restoredInstalledContentSha256 = await hashBaseHalfPluginInstall(files, restoredLocation);
		const newInstalledContentSha256 = await hashBaseHalfPluginInstall(files, newlyInstalledLocation);
		const restoredSha256 = 'e'.repeat(64);
		const newlyInstalledSha256 = 'f'.repeat(64);
		const initial = new BaseHalfPluginAdmissionService(storage, environment(), files);
		initial.replaceVerifiedPlugins([{ extensionId: 'reviewed.restored', versions: [{ version: '1.0.0', sha256: restoredSha256, installedContentSha256: restoredInstalledContentSha256 }] }]);
		assert.ok(await initial.verifyAndRecordInstall({ extensionId: 'reviewed.restored', version: '1.0.0', sha256: restoredSha256, extensionLocation: restoredLocation, expectedInstalledContentSha256: restoredInstalledContentSha256 }));
		initial.dispose();

		const gate = controlledReadFileService(files, restoredLocation);
		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), gate.service));
		restored.replaceVerifiedPlugins([
			{ extensionId: 'reviewed.restored', versions: [{ version: '1.0.0', sha256: restoredSha256, installedContentSha256: restoredInstalledContentSha256 }] },
			{ extensionId: 'reviewed.new', versions: [{ version: '1.0.0', sha256: newlyInstalledSha256, installedContentSha256: newInstalledContentSha256 }] }
		]);
		const reverify = restored.reverifyVerifiedInstalls();
		await gate.entered.p;
		assert.ok(await restored.verifyAndRecordInstall({ extensionId: 'reviewed.new', version: '1.0.0', sha256: newlyInstalledSha256, extensionLocation: newlyInstalledLocation, expectedInstalledContentSha256: newInstalledContentSha256 }));
		gate.release.complete(undefined);
		await reverify;

		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.restored', '1.0.0', restoredLocation)), true);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.new', '1.0.0', newlyInstalledLocation)), true);
	});

	test('admits only the exact extension location in an extension development host', () => {
		const storage = disposables.add(new InMemoryStorageService());
		const developmentLocation = URI.file('/workspace/reviewed-workflow');
		const files = fileService();
		const developmentService = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(true, [developmentLocation]), files));
		const normalService = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(false, [developmentLocation]), files));

		assert.strictEqual(developmentService.isAllowedContributor(identity('reviewed.workflow', '0.0.1', developmentLocation, false, true)), true);
		assert.strictEqual(developmentService.isAllowedContributor(identity('reviewed.workflow', '0.0.1', developmentLocation, false, false)), false);
		assert.strictEqual(developmentService.isAllowedContributor(identity('reviewed.workflow', '0.0.1', URI.file('/workspace/reviewed-workflow/subfolder'), false, true)), false);
		assert.strictEqual(normalService.isAllowedContributor(identity('reviewed.workflow', '0.0.1', developmentLocation, false, true)), false);
	});

	test('admits the official built-in only from the development scanner location', () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const official = BASEHALF_CURATED_PLUGINS[0];
		const applicationRoot = joinPath(FileAccess.asFileUri(''), '..');
		const scannerLocation = joinPath(applicationRoot, 'extensions', 'basehalf-ai-video');
		const staleOutLocation = joinPath(FileAccess.asFileUri(''), 'extensions', 'basehalf-ai-video');
		const service = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(false, undefined, false), files));

		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.6.0', scannerLocation, true)), true);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.6.0', staleOutLocation, true)), false);
		assert.strictEqual(service.isAllowedContributor(identity(official.extensionId, '0.6.0', joinPath(scannerLocation, '..'), true)), false);
	});

	test('merges independent receipts and re-verifies storage changes from another service instance', async () => {
		const storage = disposables.add(new InMemoryStorageService());
		const files = fileService();
		const firstLocation = URI.parse('plugin-memory:/window-one-install');
		const secondLocation = URI.parse('plugin-memory:/window-two-install');
		await createPluginContent(files, firstLocation);
		await createPluginContent(files, secondLocation);
		const firstContent = await hashBaseHalfPluginInstall(files, firstLocation);
		const secondContent = await hashBaseHalfPluginInstall(files, secondLocation);
		const grants = [
			{ extensionId: 'reviewed.first', versions: [{ version: '1.0.0', sha256: '1'.repeat(64), installedContentSha256: firstContent }] },
			{ extensionId: 'reviewed.second', versions: [{ version: '1.0.0', sha256: '2'.repeat(64), installedContentSha256: secondContent }] }
		];
		const first = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		const second = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		first.replaceVerifiedPlugins(grants);
		second.replaceVerifiedPlugins(grants);

		const observedSecond = new DeferredPromise<void>();
		const listener = first.onDidChange(() => {
			if (first.isAllowedContributor(identity('reviewed.second', '1.0.0', secondLocation))) {
				observedSecond.complete(undefined);
			}
		});
		try {
			await Promise.all([
				first.verifyAndRecordInstall({ extensionId: 'reviewed.first', version: '1.0.0', sha256: '1'.repeat(64), extensionLocation: firstLocation, expectedInstalledContentSha256: firstContent }),
				second.verifyAndRecordInstall({ extensionId: 'reviewed.second', version: '1.0.0', sha256: '2'.repeat(64), extensionLocation: secondLocation, expectedInstalledContentSha256: secondContent })
			]);
			await observedSecond.p;
		} finally {
			listener.dispose();
		}

		const restored = disposables.add(new BaseHalfPluginAdmissionService(storage, environment(), files));
		restored.replaceVerifiedPlugins(grants);
		await restored.reverifyVerifiedInstalls();
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.first', '1.0.0', firstLocation)), true);
		assert.strictEqual(restored.isAllowedContributor(identity('reviewed.second', '1.0.0', secondLocation)), true);
	});
});

function identity(extensionId: string, version: string, extensionLocation: URI, isBuiltin = false, isUnderDevelopment = false): IBaseHalfPluginContributorIdentity {
	return { extensionId, version, extensionLocation, isBuiltin, isUnderDevelopment };
}

function environment(isExtensionDevelopment = false, extensionDevelopmentLocationURI?: URI[], isBuilt = true): IEnvironmentService {
	return { isExtensionDevelopment, extensionDevelopmentLocationURI, isBuilt } as unknown as IEnvironmentService;
}

async function createPluginContent(files: IFileService, location: URI): Promise<void> {
	await files.createFolder(location);
	await files.writeFile(joinPath(location, 'package.json'), VSBuffer.fromString('{"name":"workflow"}\n'));
	await files.writeFile(joinPath(location, 'extension.js'), VSBuffer.fromString('export {};\n'));
}

function withoutFileChangeEvents(files: IFileService): IFileService {
	return {
		onDidFilesChange: Event.None,
		stat: (resource: URI) => files.stat(resource),
		resolve: (resource: URI) => files.resolve(resource),
		readFile: (resource: URI, options?: Parameters<IFileService['readFile']>[1]) => files.readFile(resource, options)
	} as unknown as IFileService;
}

function controlledReadFileService(files: IFileService, blockLocation?: URI): {
	readonly service: IFileService;
	readonly entered: DeferredPromise<void>;
	readonly release: DeferredPromise<void>;
} {
	const entered = new DeferredPromise<void>();
	const release = new DeferredPromise<void>();
	let blocked = false;
	return {
		service: {
			onDidFilesChange: files.onDidFilesChange,
			stat: (resource: URI) => files.stat(resource),
			resolve: (resource: URI) => files.resolve(resource),
			readFile: async (resource: URI) => {
				if (!blocked && (!blockLocation || extUri.isEqualOrParent(resource, blockLocation))) {
					blocked = true;
					entered.complete(undefined);
					await release.p;
				}
				return files.readFile(resource);
			}
		} as unknown as IFileService,
		entered,
		release
	};
}

async function mutateAndWaitForFileChange(source: IFileService, affected: URI, mutate: () => Promise<unknown>): Promise<void> {
	const changed = new DeferredPromise<void>();
	const listener = source.onDidFilesChange(event => {
		if (event.affects(affected)) {
			changed.complete(undefined);
		}
	});
	try {
		await mutate();
		await changed.p;
	} finally {
		listener.dispose();
	}
}

async function waitForNextFileChanges(source: IFileService): Promise<void> {
	const changed = new DeferredPromise<void>();
	const listener = source.onDidFilesChange(() => changed.complete(undefined));
	try {
		await changed.p;
	} finally {
		listener.dispose();
	}
}
