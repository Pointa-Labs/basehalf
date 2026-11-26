/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InstantiationService } from '../../../../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { IEditorService, MODAL_GROUP } from '../../../../services/editor/common/editorService.js';
import { IOutputChannel } from '../../../../services/output/common/output.js';
import { showBaseHalfOutputChannel } from '../../common/basehalfOutput.js';
import { shouldBaseHalfHideViewContainer } from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalfOutput', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('a channel opens as a document in the overlay, at its end, and the Output view is a hidden surface', async () => {
		const opened: { editor: unknown; group: unknown }[] = [];
		const editorService = new class extends mock<IEditorService>() {
			override openEditor: IEditorService['openEditor'] = async (editor: unknown, group?: unknown) => {
				opened.push({ editor, group });
				return undefined;
			};
		};
		const instantiationService = store.add(new InstantiationService(new ServiceCollection([IEditorService, editorService])));
		const channel = new class extends mock<IOutputChannel>() {
			override readonly id = 'git';
			override readonly label = 'Git';
			override readonly uri = URI.from({ scheme: 'output', path: 'git' });
		};

		await instantiationService.invokeFunction(showBaseHalfOutputChannel, channel, true);

		assert.deepStrictEqual({ opened, hidden: shouldBaseHalfHideViewContainer('workbench.panel.output') }, {
			opened: [{
				editor: {
					resource: channel.uri,
					label: 'Git',
					options: { pinned: true, preserveFocus: true, selection: { startLineNumber: Number.MAX_SAFE_INTEGER, startColumn: 1 } }
				},
				group: MODAL_GROUP
			}],
			hidden: true
		});
	});
});
