/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IExtensionGalleryService, IExtensionManagementService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { NullLogger } from '../../../../platform/log/common/log.js';
import product from '../../../../platform/product/common/product.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { RemoteExtensionManagementCLI } from '../../../api/browser/mainThreadCLICommands.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionManifestPropertiesService } from '../../../services/extensions/common/extensionManifestPropertiesService.js';
import { BASEHALF_MANAGE_PLUGINS_COMMAND_ID } from '../../common/basehalfPluginCatalog.js';
import { assertArbitraryExtensionInstallAllowed } from '../../../contrib/extensions/browser/extensions.contribution.js';

suite('BaseHalf extension install commands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rejects direct gallery and VSIX install command calls before resolving services', async () => {
		const previousBaseHalfVersion = product.basehalfVersion;
		Object.assign(product, { basehalfVersion: 'test' });
		try {
			assert.throws(() => assertArbitraryExtensionInstallAllowed(), /reviewed Plugins library/);
			const command = CommandsRegistry.getCommand('workbench.extensions.installExtension');
			assert.ok(command);
			const accessor = {
				get(): never {
					throw new Error('The rejected command must not resolve an installation service.');
				}
			} as ServicesAccessor;

			await assert.rejects(Promise.resolve(command.handler(accessor, 'outside.extension')), /reviewed Plugins library/);
			await assert.rejects(Promise.resolve(command.handler(accessor, URI.file('/tmp/outside.vsix'))), /reviewed Plugins library/);
		} finally {
			Object.assign(product, { basehalfVersion: previousBaseHalfVersion });
		}
	});

	test('routes stock extension detail commands to the Plugins library', async () => {
		const previousBaseHalfVersion = product.basehalfVersion;
		Object.assign(product, { basehalfVersion: 'test' });
		const calls: { readonly command: string; readonly argument: string }[] = [];
		const commandService = {
			executeCommand: async (command: string, argument: string) => {
				calls.push({ command, argument });
			}
		} as ICommandService;
		const accessor = {
			get(service: unknown): ICommandService {
				assert.strictEqual(service, ICommandService);
				return commandService;
			}
		} as ServicesAccessor;
		try {
			const open = CommandsRegistry.getCommand('extension.open');
			const manage = CommandsRegistry.getCommand('_extensions.manage');
			assert.ok(open);
			assert.ok(manage);
			await open.handler(accessor, 'publisher.first');
			await manage.handler(accessor, 'publisher.second');
			assert.deepStrictEqual(calls, [
				{ command: BASEHALF_MANAGE_PLUGINS_COMMAND_ID, argument: 'publisher.first' },
				{ command: BASEHALF_MANAGE_PLUGINS_COMMAND_ID, argument: 'publisher.second' }
			]);
		} finally {
			Object.assign(product, { basehalfVersion: previousBaseHalfVersion });
		}
	});

	test('rejects remote CLI extension installs before resolving remote services', async () => {
		const previousBaseHalfVersion = product.basehalfVersion;
		Object.assign(product, { basehalfVersion: 'test' });
		try {
			const command = CommandsRegistry.getCommand('_remoteCLI.manageExtensions');
			assert.ok(command);
			const accessor = {
				get(service: unknown): typeof product {
					assert.strictEqual(service, IProductService);
					return product;
				}
			} as ServicesAccessor;
			await assert.rejects(Promise.resolve(command.handler(accessor, { install: ['publisher.plugin'] })), /reviewed Plugins library/);
		} finally {
			Object.assign(product, { basehalfVersion: previousBaseHalfVersion });
		}
	});

	test('rejects direct remote extension management CLI installs', async () => {
		const cli = new RemoteExtensionManagementCLI(
			new NullLogger(),
			{} as IExtensionManagementService,
			{} as IExtensionGalleryService,
			{ getHostLabel: () => '' } as unknown as ILabelService,
			{ remoteAuthority: undefined } as IWorkbenchEnvironmentService,
			{} as IExtensionManifestPropertiesService,
			{ ...product, basehalfVersion: 'test' } as unknown as IProductService
		);
		assert.throws(() => cli.installExtensions(['publisher.plugin'], [], {}, false), /reviewed Plugins library/);
	});
});
