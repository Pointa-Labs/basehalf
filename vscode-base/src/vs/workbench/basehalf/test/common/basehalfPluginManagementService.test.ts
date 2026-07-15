/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { consumeStream, newWriteableStream } from '../../../../base/common/stream.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IChecksumService } from '../../../../platform/checksum/common/checksumService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { EnablementState, IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { BaseHalfPluginManagementService, limitBaseHalfPluginDownloadStream } from '../../common/basehalfPluginManagementService.js';
import { BASEHALF_CURATED_PLUGINS, IBaseHalfResolvedPlugin } from '../../common/basehalfPluginCatalog.js';
import { IBaseHalfPluginCatalogService } from '../../common/basehalfPluginCatalogService.js';

suite('BaseHalfPluginManagementService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('owns install, enable, disable, command, and uninstall lifecycle', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);

		assert.strictEqual((await service.getPlugins())[0].state, 'available');
		await service.install('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'enabled');
		assert.strictEqual((await service.getPlugins())[0].hasConfiguration, true);
		await service.disable('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'disabled');
		await service.enable('pointa.basehalf-ai-video');
		await service.executePrimary('pointa.basehalf-ai-video');
		assert.deepStrictEqual(fixture.commands, ['pointa.basehalf-ai-video.createProject']);
		await service.uninstall('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'available');
	});

	test('serializes concurrent operations for one plugin and recovers after failure', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);
		let active = 0;
		let maximum = 0;
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
		let calls = 0;
		fixture.management.installFromLocation = async () => {
			active++;
			maximum = Math.max(maximum, active);
			calls++;
			if (calls === 1) {
				await firstGate;
			}
			active--;
			if (calls === 2) {
				throw new Error('fixture failure');
			}
			return fixture.extension as never;
		};
		const first = service.install('pointa.basehalf-ai-video');
		const second = service.install('pointa.basehalf-ai-video');
		releaseFirst();
		await first;
		await assert.rejects(second, /fixture failure/);
		assert.strictEqual(maximum, 1);

		fixture.management.installFromLocation = async () => fixture.extension as never;
		await service.install('pointa.basehalf-ai-video');
		assert.strictEqual((await service.getPlugins())[0].state, 'available');
	});

	test('does not advertise cancellation for an operation without a cancellation token', async () => {
		const fixture = createFixture();
		const service = store.add(fixture.service);
		let releaseInstall!: () => void;
		let markEntered!: () => void;
		const entered = new Promise<void>(resolve => markEntered = resolve);
		const gate = new Promise<void>(resolve => releaseInstall = resolve);
		fixture.management.installFromLocation = async () => {
			markEntered();
			await gate;
			return fixture.extension as never;
		};

		const install = service.install('pointa.basehalf-ai-video');
		await entered;
		const [plugin] = await service.getPlugins();
		assert.strictEqual(plugin.busy, true);
		assert.strictEqual(plugin.cancellable, false);
		releaseInstall();
		await install;
	});

	test('hides withdrawn plugins from discovery while retaining an existing installation', async () => {
		const curated = BASEHALF_CURATED_PLUGINS[0];
		const withdrawn: IBaseHalfResolvedPlugin = {
			...curated,
			remote: {
				extensionId: curated.extensionId,
				label: curated.label,
				description: curated.description,
				category: 'Domain',
				versions: [{
					version: '0.1.0',
					basehalfRange: '*',
					vscodeRange: '*',
					targetPlatform: 'universal',
					assetPath: `${curated.extensionId}/0.1.0/${'a'.repeat(64)}.vsix`,
					sha256: 'a'.repeat(64),
					size: 1024,
					publishedAt: '2026-07-13T00:00:00.000Z',
					status: 'withdrawn'
				}]
			}
		};
		const freshFixture = createFixture({ plugins: [withdrawn] });
		const freshService = store.add(freshFixture.service);
		assert.deepStrictEqual(await freshService.getPlugins(), []);
		await assert.rejects(freshService.install(curated.extensionId), /withdrawn/);

		const installedFixture = createFixture({ plugins: [withdrawn], initiallyInstalled: true });
		const installedService = store.add(installedFixture.service);
		assert.strictEqual((await installedService.getPlugins())[0].state, 'enabled');
	});

	test('cancels a chunked download as soon as it exceeds the signed size', async () => {
		const source = newWriteableStream<VSBuffer>(chunks => VSBuffer.concat(chunks));
		const cancellation = store.add(new CancellationTokenSource());
		const limited = limitBaseHalfPluginDownloadStream(source, 5, cancellation);
		const consumed = consumeStream(limited, chunks => VSBuffer.concat(chunks));

		source.write(VSBuffer.fromString('123'));
		source.write(VSBuffer.fromString('456'));

		await assert.rejects(consumed, /exceeds the signed size/);
		assert.strictEqual(cancellation.token.isCancellationRequested, true);
	});
});

function createFixture(options: { readonly plugins?: readonly IBaseHalfResolvedPlugin[]; readonly initiallyInstalled?: boolean } = {}): {
	service: BaseHalfPluginManagementService;
	management: any;
	extension: any;
	commands: string[];
} {
	const extension = { identifier: { id: 'pointa.basehalf-ai-video' }, manifest: { version: '0.1.0', contributes: { configuration: { title: 'AI Video' } } } };
	const installed: any[] = options.initiallyInstalled ? [extension] : [];
	const enabled = new Set<any>(installed);
	const management: any = {
		onDidInstallExtensions: Event.None,
		onDidUninstallExtension: Event.None,
		getInstalled: async () => installed,
		installFromLocation: async () => {
			if (!installed.includes(extension)) {
				installed.push(extension);
				enabled.add(extension);
			}
			return extension;
		},
		uninstall: async (candidate: any) => {
			installed.splice(installed.indexOf(candidate), 1);
			enabled.delete(candidate);
		}
	};
	const enablement: any = {
		onEnablementChanged: Event.None,
		isEnabled: (candidate: any) => enabled.has(candidate),
		setEnablement: async (candidates: any[], state: EnablementState) => {
			for (const candidate of candidates) {
				if (state === EnablementState.EnabledGlobally) {
					enabled.add(candidate);
				} else {
					enabled.delete(candidate);
				}
			}
			return candidates.map(() => false);
		}
	};
	const catalog: IBaseHalfPluginCatalogService = {
		_serviceBrand: undefined,
		onDidChange: Event.None,
		getSnapshot: async () => ({ plugins: options.plugins ?? BASEHALF_CURATED_PLUGINS, source: 'bundled' }),
		refresh: async () => ({ plugins: options.plugins ?? BASEHALF_CURATED_PLUGINS, source: 'bundled' })
	};
	const commands: string[] = [];
	const service = new BaseHalfPluginManagementService(
		catalog,
		management as IWorkbenchExtensionManagementService,
		enablement as IWorkbenchExtensionEnablementService,
		{ exists: async () => true } as unknown as IFileService,
		{} as IRequestService,
		{} as IChecksumService,
		{ tmpDir: URI.file('/tmp') } as INativeEnvironmentService,
		{} as IProductService,
		{ executeCommand: async (id: string) => { commands.push(id); } } as unknown as ICommandService,
		{ error() { }, warn() { } } as unknown as ILogService
	);
	return { service, management, extension, commands };
}
