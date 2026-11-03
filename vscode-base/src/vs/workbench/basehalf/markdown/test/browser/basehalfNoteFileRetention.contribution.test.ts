/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { IBaseHalfMovedItemsService } from '../../../workspace/common/basehalfMovedItemsService.js';
import { BASEHALF_NOTE_FILE_RESCAN_MS, BaseHalfNoteFileRetentionContribution } from '../../browser/basehalfNoteFileRetention.contribution.js';
import { BASEHALF_NOTE_FILE_RELEASE_MS } from '../../common/basehalfNoteFileRetention.js';

const FOLDER = URI.file('/workspace');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 3);

suite('BaseHalfNoteFileRetentionContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('a window that stays open scans again once the day has passed, and not before (files in notes, rule 37)', () => runWithFakedTimers({ useFakeTimers: true, startTime: NOW }, async () => {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		const write = (path: string, content: string) => fileService.writeFile(joinPath(FOLDER, ...path.split('/')), VSBuffer.fromString(content));
		await write('n.md', 'no files\n');
		await write('.bh/attachments/aaaaaaaaaa/x.png', 'x');
		// The last scan was less than a day ago, and nothing has mentioned the file for longer than the release takes.
		await write('.bh/cache/note-files.json', JSON.stringify({ scanned: NOW - DAY + BASEHALF_NOTE_FILE_RESCAN_MS / 2, unmentioned: { '.bh/attachments/aaaaaaaaaa/x.png': NOW - BASEHALF_NOTE_FILE_RELEASE_MS - DAY } }));
		const stored = joinPath(FOLDER, '.bh', 'attachments', 'aaaaaaaaaa', 'x.png');

		const contribution = new BaseHalfNoteFileRetentionContribution(
			new TestContextService(testWorkspace(FOLDER)),
			fileService,
			new NullLogService(),
			new TestConfigurationService(),
			{ getModels: () => [] } as Partial<IModelService> as IModelService,
			{ whenCompared: () => Promise.resolve() } as Partial<IBaseHalfMovedItemsService> as IBaseHalfMovedItemsService
		);
		await timeout(1);
		const atOpen = await fileService.exists(stored);
		await timeout(BASEHALF_NOTE_FILE_RESCAN_MS);
		const anHourLater = await fileService.exists(stored);
		contribution.dispose();

		assert.deepStrictEqual({ atOpen, anHourLater }, { atOpen: true, anHourLater: false });
	}));
});
