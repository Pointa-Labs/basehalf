/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotification, INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfNoteFileGitContribution } from '../../browser/basehalfNoteFileGit.contribution.js';

const HOME = URI.file('/disk/repo');

suite('BaseHalfNoteFileGitContribution', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	async function machine(gitignore: string) {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		for (const [path, content] of Object.entries({ '.git/HEAD': '', '.gitignore': gitignore, '.bh/attachments/7k3f9q2m1x/a.png': 'a' })) {
			await fileService.writeFile(joinPath(HOME, ...path.split('/')), VSBuffer.fromString(content));
		}
		const storage = disposables.add(new InMemoryStorageService());
		const said: string[] = [];
		const asked: string[] = [];
		const opened: string[] = [];
		let choices: readonly IPromptChoice[] = [];
		/** A window of this machine: its notice, if any, once its home was read. */
		const window = async () => {
			said.length = 0;
			choices = [];
			const instantiationService = disposables.add(new TestInstantiationService());
			instantiationService.stub(IFileService, fileService);
			instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(HOME)));
			instantiationService.stub(IStorageService, storage);
			instantiationService.stub(INotificationService, {
				notify: (notification: INotification) => { said.push(String(notification.message)); return undefined; },
				prompt: (_severity: unknown, message: string, offered: readonly IPromptChoice[]) => { said.push(message); choices = offered; return undefined; },
				info: (message: string) => { said.push(message); return undefined; },
				warn: (message: string) => { said.push(message); return undefined; },
			} as unknown as INotificationService);
			instantiationService.stub(IDialogService, { confirm: async (confirmation: { readonly message: string }) => { asked.push(confirmation.message); return { confirmed: true }; } } as Partial<IDialogService> as IDialogService);
			instantiationService.stub(IPathService, { userHome: async () => URI.file('/disk/user') } as Partial<IPathService> as IPathService);
			instantiationService.stub(ITextFileService, { isDirty: () => false } as Partial<ITextFileService> as ITextFileService);
			instantiationService.stub(IBaseHalfCanvasNavigationService, { openResource: async (resource: URI) => { opened.push(resource.path); return { handled: true }; } } as unknown as IBaseHalfCanvasNavigationService);
			instantiationService.stub(ILogService, new NullLogService());
			const contribution = disposables.add(instantiationService.createInstance(BaseHalfNoteFileGitContribution));
			await contribution.check(HOME);
			return { said: [...said], choices: choices.map(choice => choice.label), run: async (label: string) => { choices.find(choice => choice.label === label)?.run(); await new Promise(resolve => setTimeout(resolve, 0)); } };
		};
		return { fileService, window, asked, opened, gitignore: async () => (await fileService.readFile(joinPath(HOME, '.gitignore'))).value.toString() };
	}

	test('the two lines early versions wrote: Show opens them, Remove deletes exactly them after the user confirms, and Keep is remembered on the machine (files in notes, rule 46)', async () => {
		const early = 'dist/\n# BaseHalf derived cache\n.bh/\n*.log\n';
		const removing = await machine(early);
		const first = await removing.window();
		await first.run('Show');
		await first.run('Remove');
		const afterRemove = await removing.window();

		const keeping = await machine(early);
		await (await keeping.window()).run('Keep');
		const afterKeep = await keeping.window();

		assert.deepStrictEqual({
			first: { said: first.said.length, choices: first.choices },
			opened: removing.opened,
			asked: removing.asked.length,
			removed: await removing.gitignore(),
			afterRemove: afterRemove.said,
			kept: await keeping.gitignore(),
			afterKeep: afterKeep.said,
		}, {
			first: { said: 1, choices: ['Remove', 'Show', 'Keep'] },
			opened: ['/disk/repo/.gitignore'],
			asked: 1,
			removed: 'dist/\n*.log\n',
			afterRemove: [],
			kept: early,
			afterKeep: [],
		});
	});

	test('another ignore file that leaves the store out is said once per home and machine, without a path, and a store git keeps is not', async () => {
		const ignored = await machine('.bh/\n');
		const first = await ignored.window();
		const second = await ignored.window();
		const kept = await (await machine('dist/\n')).window();

		assert.deepStrictEqual({ first: first.said.map(message => message.includes('/disk')), choices: first.choices, second: second.said, kept: kept.said }, {
			first: [false],
			choices: [],
			second: [],
			kept: [],
		});
	});
});
