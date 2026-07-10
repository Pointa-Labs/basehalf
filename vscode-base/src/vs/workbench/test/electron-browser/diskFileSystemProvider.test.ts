/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { FileSystemProviderCapabilities, FileType, IStat } from '../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import { ILoggerService, NullLogService } from '../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { DiskFileSystemProvider } from '../../services/files/electron-browser/diskFileSystemProvider.js';
import { IUtilityProcessWorkerWorkbenchService } from '../../services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';

suite('DiskFileSystemProvider - Electron Browser', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('forwards atomic exclusive writes advertised by its IPC client', async () => {
		const resource = URI.file('/workspace/.bh/mirror/src/badge.yaml');
		const contents = new TextEncoder().encode('kind: file\n');
		const committedStat: IStat = {
			type: FileType.File,
			ctime: 1,
			mtime: 2,
			size: contents.byteLength
		};
		let forwardedCommand: string | undefined;
		let forwardedArguments: unknown[] | undefined;
		const channel: IChannel = {
			call: async <T>(command: string, args?: unknown): Promise<T> => {
				forwardedCommand = command;
				forwardedArguments = args as unknown[];
				return committedStat as T;
			},
			listen: () => Event.None
		};
		const mainProcessService: IMainProcessService = {
			_serviceBrand: undefined,
			getChannel: () => channel,
			registerChannel: () => { }
		};
		const provider = disposables.add(new DiskFileSystemProvider(
			mainProcessService,
			{} as IUtilityProcessWorkerWorkbenchService,
			new NullLogService(),
			{} as ILoggerService
		));

		assert.ok(provider.capabilities & FileSystemProviderCapabilities.FileAtomicWriteExclusive);
		assert.deepStrictEqual(await provider.writeFileExclusiveAtomic(resource, contents), committedStat);
		assert.strictEqual(forwardedCommand, 'writeFileExclusiveAtomic');
		assert.strictEqual(forwardedArguments?.[0], resource);
		assert.ok(VSBuffer.wrap((forwardedArguments?.[1] as VSBuffer).buffer).equals(VSBuffer.wrap(contents)));
	});
});
