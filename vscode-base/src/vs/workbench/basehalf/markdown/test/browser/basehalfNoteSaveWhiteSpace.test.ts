/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite, toResource } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { Progress } from '../../../../../platform/progress/common/progress.js';
import { SaveReason } from '../../../../common/editor.js';
import { SaveParticipantsContribution } from '../../../../contrib/codeEditor/browser/saveParticipants.js';
import { TextFileEditorModel } from '../../../../services/textfile/common/textFileEditorModel.js';
import { TextFileEditorModelManager } from '../../../../services/textfile/common/textFileEditorModelManager.js';
import { IResolvedTextFileEditorModel, snapshotToString } from '../../../../services/textfile/common/textfiles.js';
import { TestServiceAccessor, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('BaseHalf: a save keeps the white space of a note', function () {

	const disposables = new DisposableStore();
	let instantiationService: TestInstantiationService;
	let accessor: TestServiceAccessor;

	// A line break of Markdown (two spaces), a tab at the end of a line, empty
	// lines at the end, and, without them, no line feed at the end.
	const TEXT = 'A kite over the harbour.  \nIt rises\t\nand stays';

	setup(() => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		accessor = instantiationService.createInstance(TestServiceAccessor);
		disposables.add(<TextFileEditorModelManager>accessor.textFileService.files);
		const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('files', { trimTrailingWhitespace: true, insertFinalNewline: true, trimFinalNewlines: true });
		// The base's own registration, so the test runs every participant a save runs.
		disposables.add(instantiationService.createInstance(SaveParticipantsContribution));
	});

	teardown(() => {
		disposables.clear();
	});

	async function savedText(test: Mocha.Context, path: string, text: string, reason: SaveReason): Promise<string> {
		const model = disposables.add(instantiationService.createInstance(TextFileEditorModel, toResource.call(test, path), 'utf8', undefined) as IResolvedTextFileEditorModel);
		await model.resolve();
		model.textEditorModel.setValue(text);
		await accessor.textFileService.files.runSaveParticipants(model, { reason }, Progress.None, CancellationToken.None);
		return snapshotToString(model.createSnapshot()!);
	}

	test('a note is saved as it is, by a save of the user and by one that BaseHalf makes', async function () {
		assert.deepStrictEqual({
			note: await savedText(this, '/path/harbour.md', TEXT, SaveReason.EXPLICIT),
			noteSavedByItself: await savedText(this, '/path/harbour-auto.md', TEXT, SaveReason.AUTO),
			noteWithEmptyLines: await savedText(this, '/path/harbour-lines.md', `${TEXT}\n\n\n`, SaveReason.EXPLICIT),
			longExtension: await savedText(this, '/path/Harbour.MARKDOWN', TEXT, SaveReason.EXPLICIT)
		}, {
			note: TEXT,
			noteSavedByItself: TEXT,
			noteWithEmptyLines: `${TEXT}\n\n\n`,
			longExtension: TEXT
		});
	});

	test('every other file follows the three settings', async function () {
		assert.deepStrictEqual({
			text: await savedText(this, '/path/harbour.txt', TEXT, SaveReason.EXPLICIT),
			code: await savedText(this, '/path/harbour.ts', `${TEXT}\n\n\n`, SaveReason.EXPLICIT)
		}, {
			text: 'A kite over the harbour.\nIt rises\nand stays\n',
			code: 'A kite over the harbour.\nIt rises\nand stays\n'
		});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
