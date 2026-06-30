/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { workspace, extensions, Uri, commands, EventEmitter } from 'vscode';
import type { LogOutputChannel } from 'vscode';
import { findPullRequestTemplates, pickPullRequestTemplate } from '../pushErrorHandler.js';
import { registerGitHubRemoteSourcePublisher, registerGitHubSourceControlHistoryItemDetailsProvider } from '../extension.js';
import type { OctokitService } from '../auth.js';
import type { API as GitAPI, RemoteSourcePublisher, Repository, SourceControlHistoryItemDetailsProvider } from '../typings/git.d.ts';

suite('github smoke test', function () {
	const cwd = workspace.workspaceFolders![0].uri;

	suiteSetup(async function () {
		const ext = extensions.getExtension('vscode.github');
		await ext?.activate();
	});

	test('should find all templates', async function () {
		const expectedValuesSorted = [
			'PULL_REQUEST_TEMPLATE/a.md',
			'PULL_REQUEST_TEMPLATE/b.md',
			'docs/PULL_REQUEST_TEMPLATE.md',
			'docs/PULL_REQUEST_TEMPLATE/a.md',
			'docs/PULL_REQUEST_TEMPLATE/b.md',
			'.github/PULL_REQUEST_TEMPLATE.md',
			'.github/PULL_REQUEST_TEMPLATE/a.md',
			'.github/PULL_REQUEST_TEMPLATE/b.md',
			'PULL_REQUEST_TEMPLATE.md'
		];
		expectedValuesSorted.sort();

		const uris = await findPullRequestTemplates(cwd);

		const urisSorted = uris.map(x => x.path.slice(cwd.path.length));
		urisSorted.sort();

		assert.deepStrictEqual(urisSorted, expectedValuesSorted);
	});

	test('selecting non-default quick-pick item should correspond to a template', async () => {
		const template0 = Uri.file('some-imaginary-template-0');
		const template1 = Uri.file('some-imaginary-template-1');
		const templates = [template0, template1];

		const pick = pickPullRequestTemplate(Uri.file('/'), templates);

		await commands.executeCommand('workbench.action.quickOpenSelectNext');
		await commands.executeCommand('workbench.action.quickOpenSelectNext');
		await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');

		assert.ok(await pick === template0);
	});

	test('selecting first quick-pick item should return undefined', async () => {
		const templates = [Uri.file('some-imaginary-file')];

		const pick = pickPullRequestTemplate(Uri.file('/'), templates);

		await commands.executeCommand('workbench.action.quickOpenSelectNext');
		await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');

		assert.ok(await pick === undefined);
	});

	test('registers GitHub as a Git remote source publisher', () => {
		let registeredPublisher: RemoteSourcePublisher | undefined;
		let disposed = false;
		const gitAPI = {
			registerRemoteSourcePublisher(publisher: RemoteSourcePublisher) {
				registeredPublisher = publisher;
				return { dispose: () => { disposed = true; } };
			}
		} as unknown as GitAPI;

		const disposable = registerGitHubRemoteSourcePublisher(gitAPI);

		assert.strictEqual(registeredPublisher?.name, 'GitHub');
		assert.strictEqual(registeredPublisher?.icon, 'github');
		assert.strictEqual(typeof registeredPublisher?.publishRepository, 'function');

		disposable.dispose();
		assert.strictEqual(disposed, true);
	});

	test('registers GitHub details for the VS Code Source Control Graph provider path', () => {
		let registeredProvider: SourceControlHistoryItemDetailsProvider | undefined;
		let disposed = false;
		const onDidCloseRepository = new EventEmitter<Repository>();
		const onDidChangeSessions = new EventEmitter<void>();
		const gitAPI = {
			onDidCloseRepository: onDidCloseRepository.event,
			registerSourceControlHistoryItemDetailsProvider(provider: SourceControlHistoryItemDetailsProvider) {
				registeredProvider = provider;
				return { dispose: () => { disposed = true; } };
			}
		} as unknown as GitAPI;
		const octokitService = { onDidChangeSessions: onDidChangeSessions.event } as unknown as OctokitService;
		const logger = {
			trace: () => undefined,
			info: () => undefined,
			warn: () => undefined
		} as unknown as LogOutputChannel;

		const disposable = registerGitHubSourceControlHistoryItemDetailsProvider(gitAPI, octokitService, logger);

		assert.strictEqual(typeof registeredProvider?.provideAvatar, 'function');
		assert.strictEqual(typeof registeredProvider?.provideHoverCommands, 'function');
		assert.strictEqual(typeof registeredProvider?.provideMessageLinks, 'function');

		disposable.dispose();
		onDidCloseRepository.dispose();
		onDidChangeSessions.dispose();
		assert.strictEqual(disposed, true);
	});
});
